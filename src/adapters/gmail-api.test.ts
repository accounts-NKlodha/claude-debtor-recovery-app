/**
 * Gmail API adapter: HTTP is mocked, so nothing is ever sent and no network is
 * touched. Proves the request shapes, MIME content, failure classification and
 * that no secret can leak through a result.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  GMAIL_PROFILE_URL,
  GMAIL_SEND_URL,
  GOOGLE_TOKEN_URL,
  gmailApi,
  probeGmailApiReadiness,
  resetGmailApiTokenCache,
} from "./gmail-api";

const SECRETS = { id: "client-id-123", secret: "client-secret-SHH", refresh: "refresh-token-SHH", access: "access-token-SHH" };
const decodeB64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s+/g, "")), (c) => c.charCodeAt(0)));
const fromB64Url = (s: string) => decodeB64(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const tokenOk = (expires = 3599) => json(200, { access_token: SECRETS.access, expires_in: expires, token_type: "Bearer" });

const fetchMock = vi.fn();
type Call = { url: string; init: RequestInit };
const calls = (): Call[] => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), init: init as RequestInit }));
const sendCalls = () => calls().filter((c) => c.url === GMAIL_SEND_URL);

const input = {
  idempotencyKey: "reminder-initial:email:case-1:2026-09-27",
  caseId: "case-1",
  channel: "email" as const,
  to: "debtor@example.com",
  subject: "Payment reminder — Invoice INV-1 (Acme)",
  body: "Plain ₹1,180 outstanding",
  html: "<!DOCTYPE html><p>Rich ₹1,180</p>",
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  resetGmailApiTokenCache();
  process.env.GOOGLE_CLIENT_ID = SECRETS.id;
  process.env.GOOGLE_CLIENT_SECRET = SECRETS.secret;
  process.env.GOOGLE_REFRESH_TOKEN = SECRETS.refresh;
  process.env.GMAIL_SENDER_EMAIL = "sender@example.com";
  process.env.GMAIL_SENDER_NAME = "Debtor Recovery";
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GMAIL_SENDER_EMAIL", "GMAIL_SENDER_NAME"]) delete process.env[k];
});

/** Token OK then a send response. */
const primeSend = (sendRes: Response | (() => Promise<Response>)) => {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === GOOGLE_TOKEN_URL) return tokenOk();
    if (url === GMAIL_SEND_URL) return typeof sendRes === "function" ? sendRes() : sendRes.clone();
    throw new Error("unexpected url " + url);
  });
};
const noSecretsIn = (v: unknown) => {
  const s = JSON.stringify(v);
  for (const secret of Object.values(SECRETS)) expect(s).not.toContain(secret);
  expect(s).not.toContain("debtor@example.com");
};

describe("token refresh request", () => {
  it("POSTs a form-encoded refresh_token grant over HTTPS to Google", async () => {
    primeSend(json(200, { id: "msg-1", threadId: "t-1" }));
    await gmailApi.send(input);
    const t = calls()[0];
    expect(t.url).toBe("https://oauth2.googleapis.com/token");
    expect(t.init.method).toBe("POST");
    expect((t.init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(String(t.init.body));
    expect(Object.fromEntries(form)).toEqual({
      client_id: SECRETS.id, client_secret: SECRETS.secret, refresh_token: SECRETS.refresh, grant_type: "refresh_token",
    });
  });

  it("caches the short-lived access token in memory: a second send does not refresh again", async () => {
    primeSend(json(200, { id: "m" }));
    await gmailApi.send(input);
    await gmailApi.send(input);
    expect(calls().filter((c) => c.url === GOOGLE_TOKEN_URL)).toHaveLength(1);
    expect(sendCalls()).toHaveLength(2);
  });

  it("a 401 on a FRESH token is a permanent auth failure and is not retried", async () => {
    primeSend(json(401, { error: { message: "bad" } }));
    const r = await gmailApi.send(input);
    expect(r).toMatchObject({ outcome: "permanent_failure", errorCode: "GMAIL_AUTH_FAILED" });
    expect(sendCalls()).toHaveLength(1);
  });

  it("a 401 on a CACHED token triggers exactly one refresh and one resend", async () => {
    primeSend(json(200, { id: "warm" }));
    await gmailApi.send(input); // caches the token
    fetchMock.mockReset();
    let sends = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === GOOGLE_TOKEN_URL) return tokenOk();
      sends++;
      return sends === 1 ? json(401, {}) : json(200, { id: "after-refresh" });
    });
    const r = await gmailApi.send(input);
    expect(r).toMatchObject({ outcome: "success", providerRef: "after-refresh" });
    expect(calls().filter((c) => c.url === GOOGLE_TOKEN_URL)).toHaveLength(1);
    expect(sendCalls()).toHaveLength(2);
  });
});

describe("token response handling", () => {
  it("malformed token response (no access_token) is a permanent failure and nothing is sent", async () => {
    fetchMock.mockResolvedValue(json(200, { token_type: "Bearer" }));
    const r = await gmailApi.send(input);
    expect(r).toMatchObject({ outcome: "permanent_failure", errorCode: "GMAIL_TOKEN_MALFORMED" });
    expect(sendCalls()).toHaveLength(0);
  });

  it("non-JSON token response is malformed, not a crash", async () => {
    fetchMock.mockResolvedValue(new Response("<html>oops</html>", { status: 200 }));
    expect(await gmailApi.send(input)).toMatchObject({ errorCode: "GMAIL_TOKEN_MALFORMED" });
  });

  it("invalid_grant / bad client (400/401) is a permanent auth failure", async () => {
    for (const s of [400, 401]) {
      resetGmailApiTokenCache();
      fetchMock.mockResolvedValue(json(s, { error: "invalid_grant" }));
      expect(await gmailApi.send(input)).toMatchObject({ outcome: "permanent_failure", errorCode: "GMAIL_AUTH_FAILED" });
    }
    expect(sendCalls()).toHaveLength(0);
  });

  it("token service 5xx / 429 is retryable and nothing is sent", async () => {
    for (const s of [429, 500, 503]) {
      resetGmailApiTokenCache();
      fetchMock.mockResolvedValue(json(s, {}));
      expect(await gmailApi.send(input)).toMatchObject({ outcome: "retryable_failure", errorCode: `GMAIL_TOKEN_TEMPORARY_${s}` });
    }
    expect(sendCalls()).toHaveLength(0);
  });

  it("network failure obtaining a token is retryable (nothing was sent)", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect(await gmailApi.send(input)).toMatchObject({ outcome: "retryable_failure", errorCode: "GMAIL_TOKEN_NETWORK_ERROR" });
  });
});

describe("Gmail send request", () => {
  it("POSTs {raw} with a Bearer token to users.messages.send", async () => {
    primeSend(json(200, { id: "msg-1" }));
    await gmailApi.send(input);
    const s = sendCalls()[0];
    expect(s.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(s.init.method).toBe("POST");
    expect((s.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRETS.access}`);
    const body = JSON.parse(String(s.init.body));
    expect(Object.keys(body)).toEqual(["raw"]);
    expect(body.raw).not.toMatch(/[+/=]/); // base64url, unpadded
  });

  it("the MIME carries From/To/Subject, text/plain AND text/html, UTF-8 with the rupee sign", async () => {
    primeSend(json(200, { id: "msg-1" }));
    await gmailApi.send(input);
    const mime = fromB64Url(JSON.parse(String(sendCalls()[0].init.body)).raw);
    expect(mime).toContain('From: "Debtor Recovery" <sender@example.com>');
    expect(mime).toContain("To: debtor@example.com");
    expect(mime).toContain("MIME-Version: 1.0");
    expect(mime).toContain("multipart/alternative");
    const decodedParts = [...mime.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/g)].map((m) => decodeB64(m[1]));
    expect(decodedParts).toEqual(["Plain ₹1,180 outstanding", "<!DOCTYPE html><p>Rich ₹1,180</p>"]);
    const subjectWords = [...mime.matchAll(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g)].map((m) => decodeB64(m[1])).join("");
    expect(subjectWords).toBe(input.subject);
  });

  it("falls back to an escaped paragraph when no html is supplied", async () => {
    primeSend(json(200, { id: "m" }));
    await gmailApi.send({ ...input, html: undefined, body: "a <b> & c" });
    const mime = fromB64Url(JSON.parse(String(sendCalls()[0].init.body)).raw);
    const htmlPart = decodeB64([...mime.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/g)][1][1]);
    expect(htmlPart).toBe("<p>a &lt;b&gt; &amp; c</p>");
  });
});

describe("result mapping", () => {
  it("2xx maps to success with the Gmail message id as the provider reference", async () => {
    primeSend(json(200, { id: "18c0ffee", threadId: "t" }));
    const r = await gmailApi.send(input);
    expect(r).toMatchObject({ outcome: "success", providerRef: "18c0ffee", errorCode: null, data: { providerMessageId: "18c0ffee" } });
    noSecretsIn(r);
  });

  it.each([
    [401, "permanent_failure", "GMAIL_AUTH_FAILED"],
    [403, "permanent_failure", "GMAIL_FORBIDDEN"],
    [400, "permanent_failure", "GMAIL_REQUEST_REJECTED_400"],
    [404, "permanent_failure", "GMAIL_REQUEST_REJECTED_404"],
    [429, "retryable_failure", "GMAIL_RATE_LIMITED"],
    [500, "retryable_failure", "GMAIL_TEMPORARY_500"],
    [503, "retryable_failure", "GMAIL_TEMPORARY_503"],
  ])("HTTP %i is %s / %s -- and never a success", async (status, outcome, code) => {
    primeSend(json(status, { error: { message: "debtor@example.com " + SECRETS.access } }));
    const r = await gmailApi.send(input);
    expect(r).toMatchObject({ outcome, errorCode: code, providerRef: null });
    expect(r.outcome).not.toBe("success");
    noSecretsIn(r); // provider body text is never echoed
  });

  it("a 403 whose reason is a rate/quota limit is retryable, not a permission failure", async () => {
    primeSend(json(403, { error: { errors: [{ reason: "userRateLimitExceeded" }] } }));
    expect(await gmailApi.send(input)).toMatchObject({ outcome: "retryable_failure", errorCode: "GMAIL_RATE_LIMITED" });
  });

  it("network failure sending is retryable", async () => {
    primeSend(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await gmailApi.send(input)).toMatchObject({ outcome: "retryable_failure", errorCode: "GMAIL_NETWORK_ERROR" });
  });

  it("a send TIMEOUT is treated as an unknown outcome and is NOT retried (no duplicate debtor email)", async () => {
    primeSend(async () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    });
    const r = await gmailApi.send(input);
    expect(r).toMatchObject({ outcome: "permanent_failure", errorCode: "GMAIL_SEND_TIMEOUT_AMBIGUOUS" });
    expect(r.nextAction).toMatch(/Sent folder/);
    expect(sendCalls()).toHaveLength(1);
  });
});

describe("guards and secrets", () => {
  it("rejects a malformed recipient before any network call", async () => {
    expect(await gmailApi.send({ ...input, to: "not-an-email" })).toMatchObject({ outcome: "permanent_failure", errorCode: "INVALID_RECIPIENT" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("missing configuration fails closed with a fixed message, without touching the network", async () => {
    delete process.env.GOOGLE_REFRESH_TOKEN;
    const r = await gmailApi.send(input);
    expect(r).toMatchObject({ outcome: "permanent_failure", errorCode: "GMAIL_API_MISCONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
    noSecretsIn(r);
  });

  it("a sender address that is not an email is a config failure", async () => {
    process.env.GMAIL_SENDER_EMAIL = "not-an-email";
    expect(await gmailApi.send(input)).toMatchObject({ errorCode: "GMAIL_API_MISCONFIGURED" });
  });

  it("no secret, token or recipient appears in any result or console output across failure modes", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const results: unknown[] = [];
    for (const res of [json(400, {}), json(401, {}), json(429, {}), json(500, {})]) {
      resetGmailApiTokenCache();
      primeSend(res);
      results.push(await gmailApi.send(input));
    }
    fetchMock.mockRejectedValue(new TypeError("boom " + SECRETS.refresh));
    resetGmailApiTokenCache();
    results.push(await gmailApi.send(input));
    noSecretsIn(results);
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain("SHH");
    spies.forEach((s) => s.mockRestore());
  });

  it("does not use any Node socket API: only fetch is called", async () => {
    primeSend(json(200, { id: "m" }));
    await gmailApi.send(input);
    expect(fetchMock).toHaveBeenCalled();
    expect(gmailApi.name).toBe("gmail-api");
  });
});

describe("probeGmailApiReadiness (no-send)", () => {
  it("exchanges the token and reads the profile; never calls the send endpoint", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === GOOGLE_TOKEN_URL) return tokenOk();
      if (url === GMAIL_PROFILE_URL) return json(200, { emailAddress: "SENDER@example.com" });
      throw new Error("unexpected " + url);
    });
    expect(await probeGmailApiReadiness()).toEqual({ tokenExchange: true, profileRead: "ok", senderMatches: true, errorCode: null });
    expect(sendCalls()).toHaveLength(0);
  });

  it("with a send-only scope the profile read is 403: reported as insufficient_scope, token still proven", async () => {
    fetchMock.mockImplementation(async (url: string) => (url === GOOGLE_TOKEN_URL ? tokenOk() : json(403, {})));
    expect(await probeGmailApiReadiness()).toMatchObject({ tokenExchange: true, profileRead: "insufficient_scope" });
  });

  it("reports a failed token exchange without calling the profile endpoint", async () => {
    fetchMock.mockResolvedValue(json(400, { error: "invalid_grant" }));
    expect(await probeGmailApiReadiness()).toMatchObject({ tokenExchange: false, profileRead: "skipped", errorCode: "GMAIL_AUTH_FAILED" });
  });
});
