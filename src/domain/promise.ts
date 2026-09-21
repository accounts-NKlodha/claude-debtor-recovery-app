/**
 * Pure pieces of recording a promise-to-pay (WhatsApp V1). Persistence and
 * history (superseding the earlier promise) live in the repository / the
 * record_payment_promise RPC (0023); this module owns the workflow bridge
 * and the date rule so both repositories and the UI agree.
 */

import type { RecoveryCase } from "@/contract/types";
import { applyReplyClassified } from "./debtor-reply";
import { SEND_HOUR_IST, istBusinessDate, istWallClockToUtc } from "./scheduling";
import type { caseToWorkflowState } from "./workflow";

type CaseInput = Parameters<typeof caseToWorkflowState>[0] & RecoveryCase;

/** A promise can only be recorded while the case is waiting for the debtor's response. */
export const PROMISE_ALLOWED_STATUSES = ["initial_communication_sent", "follow_up_sent", "promise_to_pay"] as const;

const istToday = istBusinessDate;
const MAX_DAYS_AHEAD = 180;

/** Returns an error message, or null when the promised date is acceptable (today .. 180 days ahead, IST). */
export function validatePromiseDate(promisedOn: string, now: Date): string | null {
  const today = istToday(now);
  if (promisedOn < today) return "The promised date cannot be in the past";
  const limit = istToday(new Date(now.getTime() + MAX_DAYS_AHEAD * 86_400_000));
  if (promisedOn > limit) return `The promised date must be within ${MAX_DAYS_AHEAD} days`;
  return null;
}

/**
 * Case update for a newly recorded promise: the existing "promise to pay"
 * reply transition, with the next scheduled time set to the promised date at
 * the standard 11:00 IST send window (the "remind on promise date" step the
 * workflow already describes).
 */
export function applyPromiseRecorded(
  kase: CaseInput,
  promisedOn: string,
): { updatedCase: RecoveryCase; note: string } {
  if (!(PROMISE_ALLOWED_STATUSES as readonly string[]).includes(kase.status)) {
    throw new Error(
      `A promise can only be recorded while awaiting the debtor's response (this case is "${kase.status.replace(/_/g, " ")}")`,
    );
  }
  const classified = applyReplyClassified(kase, "promise_to_pay");
  const [year, month, dayOfMonth] = promisedOn.split("-").map(Number);
  const remindAt = istWallClockToUtc(year, month - 1, dayOfMonth, SEND_HOUR_IST, 0);
  return {
    updatedCase: { ...classified.updatedCase, nextScheduledAt: remindAt.toISOString() },
    note: `Promise to pay on ${promisedOn} recorded`,
  };
}
