/**
 * The one server-side gate every external send passes through.
 *
 *   automation.enabled = true   -> automation enabled, sends permitted
 *   automation.enabled = false  -> kill switch ENGAGED, sends blocked
 *
 * Enforced at the repository layer (the single choke point before any
 * provider adapter -- SMTP or AiSensy -- is reached), never in the UI or in a
 * provider adapter, so no channel can be added or reordered without the guard.
 * Fails closed: if the state cannot be read, the send is blocked.
 */

export const AUTOMATION_BLOCKED_AUDIT_ACTION = "communication.send_blocked";

export class AutomationDisabledError extends Error {
  constructor(message = "Sending is blocked: the global automation switch is disabled (kill switch engaged). No message was sent.") {
    super(message);
    this.name = "AutomationDisabledError";
  }
}

export async function assertAutomationEnabled(
  readEnabled: () => Promise<boolean>,
  onBlocked?: (reason: string) => Promise<void>,
): Promise<void> {
  let enabled = false;
  let reason = "the global automation switch is disabled (kill switch engaged)";
  try {
    enabled = await readEnabled();
  } catch {
    reason = "the global automation state could not be verified, so sending fails closed";
  }
  if (enabled) return;
  try {
    await onBlocked?.(`Send blocked: ${reason}`);
  } catch {
    // an audit failure must never turn a blocked send into a permitted one
  }
  throw new AutomationDisabledError(
    reason.startsWith("the global automation state")
      ? "Sending is blocked: the global automation state could not be verified. No message was sent."
      : undefined,
  );
}
