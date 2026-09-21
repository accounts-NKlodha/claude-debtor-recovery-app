/**
 * Centralized, typed AiSensy configuration validation. Mirrors
 * `src/lib/config/email.ts`'s fail-closed pattern: this is the ONLY place
 * AiSensy configuration is read and validated, so missing/malformed
 * configuration fails closed instead of silently sending nothing or falling
 * back to a mock success.
 *
 * Never logs, throws, or returns AISENSY_API_KEY itself -- only which named
 * variable is missing or which specific shape check failed.
 *
 * Campaign names are server-side environment configuration, one variable
 * per approved message (names live in the template registry,
 * src/domain/whatsapp-templates.ts). Each is looked up independently, so an
 * unconfigured follow-up campaign makes only the follow-up unavailable --
 * it never weakens or breaks the messages that are configured. Nothing here
 * hardcodes a campaign name.
 */

import "server-only";
import { WHATSAPP_TEMPLATES, type WhatsAppMessageKind } from "@/domain/whatsapp-templates";

export class AiSensyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiSensyConfigError";
  }
}

export interface AiSensyConfig {
  /** Server-only; never log, throw, or serialize this value. */
  apiKey: string;
  /** Milliseconds before a send request is aborted. */
  sendTimeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Validates the credential + timeout configuration and returns it, or
 * throws `AiSensyConfigError`. Called only when the real AiSensy adapter is
 * actually about to send -- never on the mock path.
 */
export function getAiSensyConfig(): AiSensyConfig {
  const apiKey = process.env.AISENSY_API_KEY;
  const timeoutRaw = process.env.AISENSY_SEND_TIMEOUT_MS;

  if (!apiKey || !apiKey.trim()) {
    throw new AiSensyConfigError(
      "AiSensy WhatsApp delivery misconfigured -- missing required environment variable(s): AISENSY_API_KEY. " +
        "Production WhatsApp sending never falls back to a mock provider.",
    );
  }

  let sendTimeoutMs = DEFAULT_TIMEOUT_MS;
  if (timeoutRaw && timeoutRaw.trim()) {
    const parsed = Number(timeoutRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new AiSensyConfigError(`AiSensy WhatsApp delivery misconfigured -- AISENSY_SEND_TIMEOUT_MS "${timeoutRaw}" is not a valid positive integer.`);
    }
    sendTimeoutMs = parsed;
  }

  return { apiKey: apiKey.trim(), sendTimeoutMs };
}

/** The configured AiSensy campaign name for one approved message, or a fail-closed error naming the missing variable. */
export function getCampaignName(kind: WhatsAppMessageKind): string {
  const envVar = WHATSAPP_TEMPLATES[kind].campaignEnvVar;
  const value = process.env[envVar];
  if (!value || !value.trim()) {
    throw new AiSensyConfigError(
      `AiSensy WhatsApp delivery misconfigured -- missing required environment variable(s): ${envVar}. ` +
        "Production WhatsApp sending never falls back to a mock provider.",
    );
  }
  return value.trim();
}

/** Whether the campaign for a message is configured (no secret involved) -- used to make a message unavailable with a clear reason. */
export function isWhatsAppCampaignConfigured(kind: WhatsAppMessageKind): boolean {
  const value = process.env[WHATSAPP_TEMPLATES[kind].campaignEnvVar];
  return Boolean(value && value.trim());
}
