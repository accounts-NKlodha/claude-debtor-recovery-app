// Default-safe provider environment for every locally runnable app command.
//
// Real external sends (Gmail SMTP, AiSensy WhatsApp) happen ONLY when the
// operator has set this exact variable for the run:
//
//   LIVE_COMMS_CONFIRM=I-APPROVE-LIVE-SENDS
//
// Without it, whatever .env.local (or the shell) says, providers are forced to
// mock/disabled and the send secrets are blanked, so even production mode
// (`next start`, where the Gmail adapter is always the real one) fails closed
// instead of sending. No secret value is ever read into, printed by, or
// returned from this module.

export const LIVE_CONFIRM_VAR = "LIVE_COMMS_CONFIRM";
export const LIVE_CONFIRM_VALUE = "I-APPROVE-LIVE-SENDS";

/** Whether this environment carries the explicit per-run live-send approval. */
export function liveSendsApproved(env) {
  return env[LIVE_CONFIRM_VAR] === LIVE_CONFIRM_VALUE;
}

/**
 * Returns a new environment with providers forced safe unless live sends were
 * explicitly approved. Never mutates `env`.
 */
export function applySafeProviderEnv(env) {
  if (liveSendsApproved(env)) return { ...env };
  return {
    ...env,
    ADAPTER_PROFILE: "mock",
    WHATSAPP_PROVIDER: "disabled",
    SMTP_APP_PASSWORD: "",
    AISENSY_API_KEY: "",
  };
}

/** Booleans/labels only -- safe to print. */
export function describeProviderSafety(env) {
  const live = liveSendsApproved(env);
  return {
    mode: live ? "LIVE-APPROVED" : "SAFE",
    adapterProfile: env.ADAPTER_PROFILE ?? "mock",
    whatsappProvider: env.WHATSAPP_PROVIDER ?? "disabled",
    smtpSecret: env.SMTP_APP_PASSWORD ? "set" : "blank",
    aisensyKey: env.AISENSY_API_KEY ? "set" : "blank",
  };
}
