/**
 * Gmail API (OAuth2 refresh-token) configuration. Mirrors the fail-closed
 * pattern of email.ts / aisensy.ts: this is the ONLY place these variables are
 * read; missing or malformed values throw an error that names the variable,
 * never a value. All of them are SERVER-ONLY -- none may carry a NEXT_PUBLIC_
 * / VITE_ prefix. The refresh token is long-lived and interactive OAuth is a
 * one-time human setup step; production never runs an OAuth consent flow.
 */
import "server-only";

export class GmailApiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailApiConfigError";
  }
}

export interface GmailApiConfig {
  /** Server-only secrets: never log, throw or serialise these. */
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  senderEmail: string;
  senderName: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function getGmailApiConfig(): GmailApiConfig {
  const read = (k: string) => (process.env[k] ?? "").trim();
  const required = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GMAIL_SENDER_EMAIL"];
  const missing = required.filter((k) => !read(k));
  if (missing.length) {
    throw new GmailApiConfigError(
      `Gmail API email delivery misconfigured -- missing required environment variable(s): ${missing.join(", ")}.`,
    );
  }
  const senderEmail = read("GMAIL_SENDER_EMAIL");
  if (!EMAIL_RE.test(senderEmail)) {
    throw new GmailApiConfigError("Gmail API email delivery misconfigured -- GMAIL_SENDER_EMAIL is not a valid email address.");
  }
  return {
    clientId: read("GOOGLE_CLIENT_ID"),
    clientSecret: read("GOOGLE_CLIENT_SECRET"),
    refreshToken: read("GOOGLE_REFRESH_TOKEN"),
    senderEmail,
    senderName: read("GMAIL_SENDER_NAME") || "N K Lodha & Co",
  };
}
