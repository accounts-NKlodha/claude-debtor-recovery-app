import { afterEach, describe, expect, it } from "vitest";
import { classifySendError, gmailSmtp } from "./gmail-smtp";

const ENV_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_APP_PASSWORD", "SMTP_FROM_ADDRESS", "SMTP_FROM_NAME"] as const;
const original: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) original[k] = process.env[k];
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});

describe("classifySendError", () => {
  it("classifies auth failure as permanent, never retried automatically", () => {
    const r = classifySendError({ code: "EAUTH" });
    expect(r.outcome).toBe("permanent_failure");
    expect(r.errorCode).toBe("SMTP_AUTH_FAILED");
  });

  it("classifies a malformed envelope (bad address) as permanent", () => {
    const r = classifySendError({ code: "EENVELOPE" });
    expect(r.outcome).toBe("permanent_failure");
  });

  it("classifies connection-level failures as retryable", () => {
    for (const code of ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "ECONNRESET", "EDNS"]) {
      const r = classifySendError({ code });
      expect(r.outcome, `code ${code}`).toBe("retryable_failure");
    }
  });

  it("classifies a 5xx SMTP response as permanent", () => {
    const r = classifySendError({ responseCode: 550 });
    expect(r.outcome).toBe("permanent_failure");
    expect(r.errorCode).toBe("SMTP_REJECTED_550");
  });

  it("classifies a 4xx SMTP response as retryable", () => {
    const r = classifySendError({ responseCode: 421 });
    expect(r.outcome).toBe("retryable_failure");
    expect(r.errorCode).toBe("SMTP_TEMPORARY_421");
  });

  it("defaults an unrecognized error to retryable rather than silently permanent", () => {
    const r = classifySendError(new Error("something unexpected"));
    expect(r.outcome).toBe("retryable_failure");
    expect(r.errorCode).toBe("SMTP_UNKNOWN_ERROR");
  });

  it("never includes the raw error message/response text in the classification output", () => {
    const secretLookingMessage = "534-5.7.9 Application-specific password required abcdefghijklmnop";
    const r = classifySendError({ code: "EAUTH", message: secretLookingMessage, response: secretLookingMessage });
    expect(r.errorCode).not.toContain(secretLookingMessage);
    expect(r.nextAction).not.toContain(secretLookingMessage);
    expect(JSON.stringify(r)).not.toContain("abcdefghijklmnop");
  });
});

describe("gmailSmtp.send", () => {
  it("rejects an empty/malformed recipient before ever touching SMTP config or the network", async () => {
    for (const bad of ["", "not-an-email", "missing-at.example.com", "  "]) {
      const result = await gmailSmtp.send({
        idempotencyKey: "test", caseId: "case-1", channel: "email", to: bad, body: "test",
      });
      expect(result.outcome).toBe("permanent_failure");
      expect(result.errorCode).toBe("INVALID_RECIPIENT");
    }
  });

  it("fails closed (does not throw, does not silently succeed) when SMTP is unconfigured", async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    const result = await gmailSmtp.send({
      idempotencyKey: "test", caseId: "case-1", channel: "email", to: "debtor@example.com", body: "test",
    });
    expect(result.outcome).toBe("permanent_failure");
    expect(result.errorCode).toBe("SMTP_MISCONFIGURED");
    // The failure contract carries no config/secret detail of any kind.
    expect(JSON.stringify(result)).not.toMatch(/SMTP_APP_PASSWORD|password/i);
  });

  it("parseWebhook always returns null -- plain Gmail SMTP has no delivery webhook", () => {
    expect(gmailSmtp.parseWebhook({ anything: "at all" })).toBeNull();
    expect(gmailSmtp.parseWebhook(null)).toBeNull();
  });
});
