import { afterEach, describe, expect, it } from "vitest";
import { EmailConfigError, getEmailConfig } from "./email";

const ENV_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_APP_PASSWORD", "SMTP_FROM_ADDRESS", "SMTP_FROM_NAME"] as const;
const original: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) original[k] = process.env[k];

function setEnv(vars: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const k of ENV_KEYS) {
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
}

const VALID = {
  SMTP_HOST: "smtp.gmail.com",
  SMTP_PORT: "465",
  SMTP_USER: "accounts@nklodha.in",
  SMTP_APP_PASSWORD: "abcdefghijklmnop", // 16 lowercase letters -- shape-valid, not a real credential
  SMTP_FROM_ADDRESS: "accounts@nklodha.in",
  SMTP_FROM_NAME: "N K Lodha & Co",
} as const;

afterEach(() => setEnv(original));

describe("getEmailConfig", () => {
  it("returns a valid config when every variable is well-formed", () => {
    setEnv(VALID);
    const config = getEmailConfig();
    expect(config.host).toBe("smtp.gmail.com");
    expect(config.port).toBe(465);
    expect(config.secure).toBe(true); // 465 => implicit TLS
    expect(config.user).toBe("accounts@nklodha.in");
    expect(config.appPassword).toBe("abcdefghijklmnop");
    expect(config.fromAddress).toBe("accounts@nklodha.in");
    expect(config.fromName).toBe("N K Lodha & Co");
  });

  it("port 587 resolves to secure=false (STARTTLS)", () => {
    setEnv({ ...VALID, SMTP_PORT: "587" });
    expect(getEmailConfig().secure).toBe(false);
  });

  it("accepts a space-grouped App Password and strips the spaces", () => {
    setEnv({ ...VALID, SMTP_APP_PASSWORD: "abcd efgh ijkl mnop" });
    expect(getEmailConfig().appPassword).toBe("abcdefghijklmnop");
  });

  it("defaults SMTP_FROM_NAME when not set", () => {
    setEnv({ ...VALID, SMTP_FROM_NAME: undefined });
    expect(getEmailConfig().fromName).toBe("N K Lodha & Co");
  });

  it("fails closed with every required variable missing", () => {
    setEnv({ SMTP_HOST: undefined, SMTP_PORT: undefined, SMTP_USER: undefined, SMTP_APP_PASSWORD: undefined, SMTP_FROM_ADDRESS: undefined });
    expect(() => getEmailConfig()).toThrow(EmailConfigError);
    try {
      getEmailConfig();
    } catch (e) {
      expect(e).toBeInstanceOf(EmailConfigError);
      const msg = (e as Error).message;
      expect(msg).toContain("SMTP_HOST");
      expect(msg).toContain("SMTP_PORT");
      expect(msg).toContain("SMTP_USER");
      expect(msg).toContain("SMTP_APP_PASSWORD");
      expect(msg).toContain("SMTP_FROM_ADDRESS");
    }
  });

  it("fails closed when only SMTP_APP_PASSWORD is missing (the critical secret)", () => {
    setEnv({ ...VALID, SMTP_APP_PASSWORD: undefined });
    expect(() => getEmailConfig()).toThrow(/SMTP_APP_PASSWORD/);
  });

  it("never includes the App Password value anywhere in a thrown error's message", () => {
    // A deliberately wrong-shaped password should still never be echoed
    // back in the exception -- only the fact that it's malformed.
    const secret = "not-a-real-16-letter-password";
    setEnv({ ...VALID, SMTP_APP_PASSWORD: secret });
    try {
      getEmailConfig();
      expect.unreachable("expected getEmailConfig to throw for a malformed App Password");
    } catch (e) {
      expect((e as Error).message).not.toContain(secret);
      expect((e as Error).message).toMatch(/App Password/);
    }
  });

  it("rejects a non-numeric or out-of-range SMTP_PORT", () => {
    setEnv({ ...VALID, SMTP_PORT: "not-a-port" });
    expect(() => getEmailConfig()).toThrow(/SMTP_PORT/);
    setEnv({ ...VALID, SMTP_PORT: "99999" });
    expect(() => getEmailConfig()).toThrow(/SMTP_PORT/);
    setEnv({ ...VALID, SMTP_PORT: "0" });
    expect(() => getEmailConfig()).toThrow(/SMTP_PORT/);
  });

  it("rejects a malformed SMTP_USER or SMTP_FROM_ADDRESS", () => {
    setEnv({ ...VALID, SMTP_USER: "not-an-email" });
    expect(() => getEmailConfig()).toThrow(/SMTP_USER/);
    setEnv({ ...VALID, SMTP_FROM_ADDRESS: "also not an email" });
    expect(() => getEmailConfig()).toThrow(/SMTP_FROM_ADDRESS/);
  });

  it("rejects an App Password that doesn't have Google's 16-letter shape (e.g. a pasted OAuth token or account password)", () => {
    setEnv({ ...VALID, SMTP_APP_PASSWORD: "ThisLooksLikeARegularPassword123!" });
    expect(() => getEmailConfig()).toThrow(/App Password/);
    setEnv({ ...VALID, SMTP_APP_PASSWORD: "short" });
    expect(() => getEmailConfig()).toThrow(/App Password/);
    setEnv({ ...VALID, SMTP_APP_PASSWORD: "ABCDEFGHIJKLMNOP" }); // uppercase -- Google's are lowercase
    expect(() => getEmailConfig()).toThrow(/App Password/);
  });
});
