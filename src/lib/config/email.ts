/**
 * Centralized, typed SMTP configuration validation (production email
 * delivery task). Mirrors `src/lib/config/production.ts`'s fail-closed
 * pattern exactly: this is the ONLY place SMTP configuration is read and
 * validated -- `src/adapters/index.ts` calls it before ever constructing
 * the real Gmail SMTP adapter, so a missing/malformed App Password fails
 * closed instead of silently sending nothing or falling back to a mock.
 *
 * Never logs, throws, or returns the App Password itself -- only which
 * named variable is missing or which specific shape check failed. The
 * returned `EmailConfig` intentionally has no field that serializes the
 * password back out (see the type below); callers that need to
 * authenticate (only `src/adapters/gmail-smtp.ts`) read `appPassword`
 * directly off this object and pass it straight to nodemailer's
 * transport options -- it is never logged, thrown, or included in any
 * `AdapterResult` this module or its caller produces.
 */

import "server-only";

export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigError";
  }
}

export interface EmailConfig {
  host: string;
  port: number;
  /** true for port 465 (implicit TLS), false otherwise (STARTTLS on 587/25). */
  secure: boolean;
  user: string;
  /** The Gmail App Password. Server-only; never log, throw, or serialize this value. */
  appPassword: string;
  fromAddress: string;
  fromName: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates the SMTP configuration and returns it, or throws
 * `EmailConfigError`. Called only when the real Gmail SMTP adapter is
 * actually being constructed (production, always; outside production,
 * only when `ADAPTER_PROFILE=live` is explicitly set) -- never on the
 * mock-adapter path, so a developer without SMTP credentials configured
 * never hits this validation.
 */
export function getEmailConfig(): EmailConfig {
  const missing: string[] = [];
  const host = process.env.SMTP_HOST;
  const portRaw = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const appPassword = process.env.SMTP_APP_PASSWORD;
  const fromAddress = process.env.SMTP_FROM_ADDRESS;
  const fromName = process.env.SMTP_FROM_NAME || "N K Lodha & Co";

  if (!host || !host.trim()) missing.push("SMTP_HOST");
  if (!portRaw || !portRaw.trim()) missing.push("SMTP_PORT");
  if (!user || !user.trim()) missing.push("SMTP_USER");
  if (!appPassword || !appPassword.trim()) missing.push("SMTP_APP_PASSWORD");
  if (!fromAddress || !fromAddress.trim()) missing.push("SMTP_FROM_ADDRESS");

  if (missing.length > 0) {
    throw new EmailConfigError(
      `Email delivery misconfigured -- missing required environment variable(s): ${missing.join(", ")}. ` +
        "Production email sending never falls back to a mock provider.",
    );
  }

  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new EmailConfigError(`Email delivery misconfigured -- SMTP_PORT "${portRaw}" is not a valid port number.`);
  }

  if (!EMAIL_RE.test(user!)) {
    throw new EmailConfigError("Email delivery misconfigured -- SMTP_USER does not look like a valid email address.");
  }
  if (!EMAIL_RE.test(fromAddress!)) {
    throw new EmailConfigError(
      "Email delivery misconfigured -- SMTP_FROM_ADDRESS does not look like a valid email address.",
    );
  }

  // A Google App Password is always exactly 16 lowercase letters (Google
  // presents it with spaces every 4 characters; either form is accepted
  // here and the spaces are stripped -- the check is on shape only, never
  // logs or echoes the value itself).
  const normalizedAppPassword = appPassword!.replace(/\s+/g, "");
  if (!/^[a-z]{16}$/.test(normalizedAppPassword)) {
    throw new EmailConfigError(
      "Email delivery misconfigured -- SMTP_APP_PASSWORD does not have the shape of a Google App Password " +
        "(16 letters, optionally space-grouped). Check for a pasted OAuth token, account password, or truncated value.",
    );
  }

  return {
    host: host!.trim(),
    port,
    secure: port === 465,
    user: user!.trim(),
    appPassword: normalizedAppPassword,
    fromAddress: fromAddress!.trim(),
    fromName: fromName.trim(),
  };
}
