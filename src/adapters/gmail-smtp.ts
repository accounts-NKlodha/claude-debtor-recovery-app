/**
 * Real Gmail SMTP adapter (Google App Password auth, no OAuth -- see
 * docs/email-delivery/index.md). Implements the same `MessagingAdapter`
 * interface as the mock adapters (src/adapters/mock.ts) so no call site
 * changes when this replaces `mockGmail` in production/`ADAPTER_PROFILE=live`
 * (src/adapters/index.ts).
 *
 * Server-only: imports `server-only` transitively via
 * `src/lib/config/email.ts`, so any accidental client-component import of
 * this module fails the build rather than shipping SMTP config into a
 * browser bundle.
 *
 * Secret handling: `getEmailConfig().appPassword` is read once (at
 * transporter construction) and handed directly to nodemailer's `auth.pass`
 * option -- it is never logged, never included in an `AdapterResult`
 * (`errorCode`/`nextAction`/`data` are always built from a fixed,
 * pre-approved vocabulary, never from the raw SMTP error's `message`,
 * which nodemailer does not guarantee is free of transcript fragments),
 * and never re-derivable from anything this module returns.
 */

import "server-only";
import { createTransport, type Transporter } from "nodemailer";
import type { AdapterResult, MessagingAdapter, SendMessageInput } from "@/contract/adapters";
import { getEmailConfig } from "@/lib/config/email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let transporter: Transporter | null = null;

/** Lazily constructs and reuses one pooled transporter per process --
 * validates config (fail-closed) on first use, not at import time, so
 * importing this module never throws; only sending through it can. */
function getTransporter(): Transporter {
  if (transporter) return transporter;
  const config = getEmailConfig();
  transporter = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.appPassword },
    pool: true,
    maxConnections: 3,
    // Fixed, generous but bounded timeouts -- a hung TCP connection to a
    // firewalled port must not hang the request indefinitely.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

interface ClassifiedFailure {
  outcome: "retryable_failure" | "permanent_failure";
  errorCode: string;
  nextAction: string;
}

/**
 * Classifies a thrown SMTP error into retryable vs terminal (task's
 * explicit taxonomy). Never reads or returns `err.message`/`err.response`
 * (nodemailer does not guarantee these are free of transcript fragments
 * that could echo back parts of the SMTP session) -- only the small,
 * well-known `code`/`responseCode` fields nodemailer attaches, mapped to a
 * fixed set of safe, non-sensitive codes.
 */
/** Exported for direct unit testing (src/adapters/gmail-smtp.test.ts) --
 * real SMTP connection/auth failures are impractical to reproduce reliably
 * in a fast test suite, so the classification logic itself is tested in
 * isolation against synthetic error shapes instead. */
export function classifySendError(err: unknown): ClassifiedFailure {
  const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : null;
  const responseCode =
    typeof err === "object" && err !== null && "responseCode" in err
      ? Number((err as { responseCode: unknown }).responseCode)
      : null;

  if (code === "EAUTH") {
    return {
      outcome: "permanent_failure",
      errorCode: "SMTP_AUTH_FAILED",
      nextAction: "SMTP authentication failed -- verify SMTP_USER/SMTP_APP_PASSWORD are correct and the Google App Password has not been revoked. Do not retry automatically.",
    };
  }
  if (code === "EENVELOPE") {
    return {
      outcome: "permanent_failure",
      errorCode: "SMTP_INVALID_ENVELOPE",
      nextAction: "Sender or recipient address rejected as malformed by the SMTP layer. Correct the address before retrying.",
    };
  }
  if (code === "ECONNECTION" || code === "ETIMEDOUT" || code === "ESOCKET" || code === "ECONNRESET" || code === "EDNS") {
    return {
      outcome: "retryable_failure",
      errorCode: `SMTP_CONNECTION_${code}`,
      nextAction: "Transient network/connection failure reaching the SMTP server. Safe to retry.",
    };
  }
  if (responseCode !== null && Number.isFinite(responseCode)) {
    if (responseCode >= 500) {
      return {
        outcome: "permanent_failure",
        errorCode: `SMTP_REJECTED_${responseCode}`,
        nextAction: "SMTP server permanently rejected the message (5xx). Do not retry automatically -- check the recipient address.",
      };
    }
    if (responseCode >= 400) {
      return {
        outcome: "retryable_failure",
        errorCode: `SMTP_TEMPORARY_${responseCode}`,
        nextAction: "SMTP server temporarily rejected the message (4xx). Safe to retry.",
      };
    }
  }
  return {
    outcome: "retryable_failure",
    errorCode: "SMTP_UNKNOWN_ERROR",
    nextAction: "Unclassified SMTP failure. Treated as retryable; escalate to an urgent task if it recurs.",
  };
}

export const gmailSmtp: MessagingAdapter = {
  name: "gmail-smtp",
  async send(input: SendMessageInput): Promise<AdapterResult<{ providerMessageId: string }>> {
    if (!input.to || !EMAIL_RE.test(input.to)) {
      return {
        outcome: "permanent_failure",
        providerRef: null,
        errorCode: "INVALID_RECIPIENT",
        evidenceRefs: [],
        nextAction: "Recipient address is missing or malformed. Correct the debtor's email before retrying.",
      };
    }

    let config: ReturnType<typeof getEmailConfig>;
    try {
      config = getEmailConfig();
    } catch {
      // getEmailConfig() never throws with the secret in the message (see
      // its own contract), but this adapter still never re-throws a raw
      // config error to the caller -- it returns the same shape every
      // other adapter failure does, so callers have one failure contract.
      return {
        outcome: "permanent_failure",
        providerRef: null,
        errorCode: "SMTP_MISCONFIGURED",
        evidenceRefs: [],
        nextAction: "Email delivery is not correctly configured. Contact an operator; do not retry automatically.",
      };
    }

    try {
      const info = await getTransporter().sendMail({
        from: `"${config.fromName}" <${config.fromAddress}>`,
        to: input.to,
        subject: input.subject ?? "Payment reminder",
        text: input.body,
        html: `<p>${escapeHtml(input.body)}</p>`,
      });

      if (info.rejected && info.rejected.length > 0) {
        // sendMail() can resolve without throwing even when the server
        // rejected the (sole) recipient -- do not report success just
        // because no exception was thrown.
        return {
          outcome: "permanent_failure",
          providerRef: info.messageId ?? null,
          errorCode: "SMTP_RECIPIENT_REJECTED",
          evidenceRefs: [],
          nextAction: "SMTP server accepted the connection but rejected the recipient. Correct the address before retrying.",
        };
      }

      return {
        outcome: "success",
        providerRef: info.messageId ?? null,
        errorCode: null,
        evidenceRefs: [],
        nextAction: null,
        data: { providerMessageId: info.messageId ?? "" },
      };
    } catch (err) {
      const classified = classifySendError(err);
      return {
        outcome: classified.outcome,
        providerRef: null,
        errorCode: classified.errorCode,
        evidenceRefs: [],
        nextAction: classified.nextAction,
      };
    }
  },

  // Plain Gmail SMTP (App Password auth) has no delivery/bounce webhook --
  // that requires Google Workspace API-level integration, out of scope
  // here (see docs/email-delivery/index.md "What Gmail SMTP does not give
  // us"). This adapter never receives a webhook payload to parse.
  parseWebhook() {
    return null;
  },
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\n/g, "<br>");
}
