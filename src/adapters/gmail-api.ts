/**
 * Gmail REST API email adapter (`users.messages.send`) -- the Worker-compatible
 * production email path. Pure HTTPS `fetch`, no Node sockets, no dependency:
 * Nodemailer/SMTP cannot run on Cloudflare Workers (it resolves the host to an
 * IP and then attempts TLS to the IP, which the runtime rejects), so hosted
 * production uses this adapter (`EMAIL_PROVIDER=gmail-api`).
 *
 * Auth: OAuth2 refresh-token flow, server-side only. The refresh token is
 * exchanged over HTTPS for a short-lived access token that is held ONLY in
 * process memory (never persisted, never logged). No interactive consent ever
 * runs in production; the refresh token is a one-time human setup step.
 *
 * Failure semantics mirror the other adapters and are deliberately
 * conservative: nothing is reported as "sent" unless Gmail answered 2xx. All
 * error text is built from a fixed vocabulary -- never from a provider
 * response body, a token, a secret or a recipient address.
 */
import "server-only";
import type { AdapterResult, MessagingAdapter, SendMessageInput } from "@/contract/adapters";
import { getGmailApiConfig, type GmailApiConfig } from "@/lib/config/gmail-api";
import { base64Url, buildMimeMessage } from "@/domain/mime";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
export const GMAIL_PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REQUEST_TIMEOUT_MS = 15_000;
const TOKEN_SAFETY_MARGIN_MS = 60_000;

type Failure = AdapterResult<{ providerMessageId: string }>;

const fail = (
  outcome: "retryable_failure" | "permanent_failure",
  errorCode: string,
  nextAction: string,
): Failure => ({ outcome, providerRef: null, errorCode, evidenceRefs: [], nextAction });

// Short-lived access token, process memory only.
let cached: { token: string; expiresAt: number } | null = null;
/** Test hook / forced refresh. */
export function resetGmailApiTokenCache(): void {
  cached = null;
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const isAbort = (e: unknown) => e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");

type TokenResult = { ok: true; token: string; fromCache: boolean } | { ok: false; failure: Failure };

async function getAccessToken(config: GmailApiConfig, forceRefresh = false): Promise<TokenResult> {
  if (!forceRefresh && cached && cached.expiresAt > Date.now() + TOKEN_SAFETY_MARGIN_MS) {
    return { ok: true, token: cached.token, fromCache: true };
  }
  cached = null;
  let res: Response;
  try {
    res = await timedFetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
  } catch (e) {
    // Nothing was sent to Gmail yet, so retrying is always safe here.
    return {
      ok: false,
      failure: fail(
        "retryable_failure",
        isAbort(e) ? "GMAIL_TOKEN_TIMEOUT" : "GMAIL_TOKEN_NETWORK_ERROR",
        "Could not reach Google to obtain an access token. No message was sent. Safe to retry.",
      ),
    };
  }
  if (res.status === 429 || res.status >= 500 || res.status === 408) {
    return { ok: false, failure: fail("retryable_failure", `GMAIL_TOKEN_TEMPORARY_${res.status}`, "Google's token service is temporarily unavailable. No message was sent. Safe to retry.") };
  }
  if (!res.ok) {
    return {
      ok: false,
      failure: fail(
        "permanent_failure",
        "GMAIL_AUTH_FAILED",
        "Google rejected the OAuth client or refresh token (revoked, expired or wrong client). Re-issue the refresh token. Do not retry automatically.",
      ),
    };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const record = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const token = record.access_token;
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, failure: fail("permanent_failure", "GMAIL_TOKEN_MALFORMED", "Google's token response was not in the expected shape. Do not retry automatically.") };
  }
  const expiresIn = typeof record.expires_in === "number" && record.expires_in > 0 ? record.expires_in : 3000;
  cached = { token, expiresAt: Date.now() + expiresIn * 1000 };
  return { ok: true, token, fromCache: false };
}

const RATE_REASONS = /ratelimitexceeded|userratelimitexceeded|dailylimitexceeded|quotaexceeded/i;

async function classifyHttpFailure(res: Response): Promise<Failure> {
  const s = res.status;
  if (s === 429) return fail("retryable_failure", "GMAIL_RATE_LIMITED", "Gmail is rate limiting this sender. Safe to retry later.");
  if (s === 403) {
    // Gmail reports quota / rate limits as 403 too. Only the machine-readable reason is inspected.
    let reason = "";
    try {
      reason = JSON.stringify(((await res.json()) as { error?: { errors?: { reason?: string }[] } })?.error?.errors ?? []);
    } catch {
      reason = "";
    }
    if (RATE_REASONS.test(reason)) return fail("retryable_failure", "GMAIL_RATE_LIMITED", "Gmail is rate limiting this sender. Safe to retry later.");
    return fail("permanent_failure", "GMAIL_FORBIDDEN", "Gmail refused the request (missing gmail.send scope, or the sender is not allowed). Do not retry automatically.");
  }
  if (s === 401) return fail("permanent_failure", "GMAIL_AUTH_FAILED", "Gmail rejected the access token even after a refresh. Re-issue the refresh token. Do not retry automatically.");
  if (s === 400 || s === 404 || s === 422) {
    return fail("permanent_failure", `GMAIL_REQUEST_REJECTED_${s}`, "Gmail rejected the message. Correct the recipient or content before retrying.");
  }
  if (s === 408 || s >= 500) return fail("retryable_failure", `GMAIL_TEMPORARY_${s}`, "Gmail returned a temporary error. Safe to retry.");
  return fail("retryable_failure", `GMAIL_UNEXPECTED_STATUS_${s}`, "Unclassified Gmail response. Treated as retryable; escalate if it recurs.");
}

export const gmailApi: MessagingAdapter = {
  name: "gmail-api",
  async send(input: SendMessageInput): Promise<AdapterResult<{ providerMessageId: string }>> {
    if (!input.to || !EMAIL_RE.test(input.to)) {
      return fail("permanent_failure", "INVALID_RECIPIENT", "Recipient address is missing or malformed. Correct the debtor's email before retrying.");
    }

    let config: GmailApiConfig;
    try {
      config = getGmailApiConfig();
    } catch {
      return fail("permanent_failure", "GMAIL_API_MISCONFIGURED", "Gmail API email delivery is not correctly configured. Contact an operator; do not retry automatically.");
    }

    const raw = base64Url(
      buildMimeMessage({
        fromName: config.senderName,
        fromEmail: config.senderEmail,
        to: input.to,
        subject: input.subject ?? "Payment reminder",
        text: input.body,
        html: input.html ?? `<p>${input.body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>`,
      }),
    );

    // At most two attempts, and only for a 401 on a CACHED token (a stale token
    // proves nothing was sent). Every other outcome is final.
    for (let attempt = 0; attempt < 2; attempt++) {
      const tok = await getAccessToken(config, attempt > 0);
      if (!tok.ok) return tok.failure;

      let res: Response;
      try {
        res = await timedFetch(GMAIL_SEND_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${tok.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ raw }),
        });
      } catch (e) {
        if (isAbort(e)) {
          // The request may have been delivered. Never blindly resend a debtor email.
          return fail("permanent_failure", "GMAIL_SEND_TIMEOUT_AMBIGUOUS", "Gmail did not answer in time and the outcome is unknown. Check the Sent folder before resending; do not retry automatically.");
        }
        return fail("retryable_failure", "GMAIL_NETWORK_ERROR", "Network failure reaching Gmail. Safe to retry.");
      }

      if (res.status === 401 && tok.fromCache) {
        cached = null;
        continue;
      }
      if (!res.ok) return classifyHttpFailure(res);

      let id: string | null = null;
      try {
        const body = (await res.json()) as { id?: unknown };
        id = typeof body?.id === "string" && body.id ? body.id : null;
      } catch {
        id = null;
      }
      return {
        outcome: "success",
        providerRef: id,
        errorCode: null,
        evidenceRefs: [],
        nextAction: null,
        data: { providerMessageId: id ?? "" },
      };
    }
    return fail("permanent_failure", "GMAIL_AUTH_FAILED", "Gmail rejected the access token even after a refresh. Re-issue the refresh token. Do not retry automatically.");
  },

  // The Gmail API has no delivery/bounce webhook in this integration.
  parseWebhook() {
    return null;
  },
};

/**
 * NO-SEND readiness probe: exchanges the refresh token and, when the token's
 * scopes allow, reads the sender's profile. It never calls the send endpoint.
 * Returns booleans/labels only.
 */
export async function probeGmailApiReadiness(): Promise<{
  tokenExchange: boolean;
  profileRead: "ok" | "insufficient_scope" | "error" | "skipped";
  senderMatches: boolean | null;
  errorCode: string | null;
}> {
  let config: GmailApiConfig;
  try {
    config = getGmailApiConfig();
  } catch {
    return { tokenExchange: false, profileRead: "skipped", senderMatches: null, errorCode: "GMAIL_API_MISCONFIGURED" };
  }
  resetGmailApiTokenCache();
  const tok = await getAccessToken(config, true);
  if (!tok.ok) return { tokenExchange: false, profileRead: "skipped", senderMatches: null, errorCode: tok.failure.errorCode };
  try {
    const res = await timedFetch(GMAIL_PROFILE_URL, { headers: { Authorization: `Bearer ${tok.token}` } });
    if (res.status === 403) return { tokenExchange: true, profileRead: "insufficient_scope", senderMatches: null, errorCode: null };
    if (!res.ok) return { tokenExchange: true, profileRead: "error", senderMatches: null, errorCode: `GMAIL_PROFILE_${res.status}` };
    const p = (await res.json()) as { emailAddress?: string };
    return {
      tokenExchange: true,
      profileRead: "ok",
      senderMatches: typeof p.emailAddress === "string" ? p.emailAddress.toLowerCase() === config.senderEmail.toLowerCase() : null,
      errorCode: null,
    };
  } catch {
    return { tokenExchange: true, profileRead: "error", senderMatches: null, errorCode: "GMAIL_PROFILE_NETWORK_ERROR" };
  }
}
