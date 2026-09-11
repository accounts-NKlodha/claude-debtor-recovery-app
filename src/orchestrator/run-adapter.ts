/**
 * Adapter execution policy (PRD §5 automation policy, invariant §15.2, acceptance
 * scenario 16):
 *  - A retryable technical failure is retried exactly once with the SAME
 *    idempotency key.
 *  - A second failure creates ONE urgent task and does not advance state or
 *    duplicate the external effect.
 *  - success / permanent_failure / human_action_required / drift_detected are
 *    returned to the caller as-is (no retry).
 */

import type { AdapterResult } from "@/contract/adapters";

export interface RunOutcome<T> {
  result: AdapterResult<T>;
  attempts: number;
  /** the orchestrator should create exactly one urgent task iff this is set. */
  urgentTask:
    | null
    | { code: string; reason: string; kind: "retry_exhausted" | "portal_drift" | "human_checkpoint" };
}

export async function runAdapter<T>(
  op: (idempotencyKey: string) => Promise<AdapterResult<T>>,
  idempotencyKey: string,
): Promise<RunOutcome<T>> {
  let attempts = 0;

  const first = await op(idempotencyKey);
  attempts++;

  if (first.outcome !== "retryable_failure") {
    return { result: first, attempts, urgentTask: classifyTerminal(first) };
  }

  // Retry once, same key — the provider must dedupe on it.
  const second = await op(idempotencyKey);
  attempts++;

  if (second.outcome === "success" || second.outcome === "human_action_required") {
    return { result: second, attempts, urgentTask: classifyTerminal(second) };
  }

  return {
    result: second,
    attempts,
    urgentTask: {
      code: second.errorCode ?? "RETRY_EXHAUSTED",
      reason:
        second.nextAction ??
        "Adapter failed after one retry; manual intervention required. No duplicate effect performed.",
      kind: "retry_exhausted",
    },
  };
}

function classifyTerminal(r: AdapterResult<unknown>): RunOutcome<unknown>["urgentTask"] {
  if (r.outcome === "drift_detected")
    return { code: r.errorCode ?? "UI_DRIFT", reason: r.nextAction ?? "Portal drift detected — fail closed", kind: "portal_drift" };
  if (r.outcome === "human_action_required")
    return { code: "HUMAN_CHECKPOINT", reason: r.nextAction ?? "Operator action required", kind: "human_checkpoint" };
  return null;
}
