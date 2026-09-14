/**
 * Pure DD / hearing workflow bridges (PRD §12 "DD, hearing, calendar and
 * evidence tracking"). DD preparation and the physical DD itself stay
 * human/manual per PRD; the calendar call is I/O and lives in the repository
 * layer with the adapter + runAdapter retry policy. This module is
 * deterministic and tested without a network or database.
 */

import { advance, caseToWorkflowState, transitionToCasePatch } from "./workflow";
import type { RecoveryCase } from "@/contract/types";

type CaseInput = Parameters<typeof caseToWorkflowState>[0] & RecoveryCase;

/** msme_odr_filed -> msefc_dd: staff has prepared the DD task for MSEFC. */
export function applyDdPrepared(kase: CaseInput): { updatedCase: RecoveryCase; note: string } {
  const transition = advance(caseToWorkflowState(kase), { type: "DD_PREPARED" });
  return { updatedCase: { ...kase, ...transitionToCasePatch(transition.next) }, note: transition.note };
}

/**
 * msme_odr_filed | msefc_dd -> hearing_scheduled, with the hearing date
 * recorded. Also reused for rescheduling an adjourned hearing to a new date
 * (adjourned -> hearing_scheduled) -- `advance()` routes by current status,
 * so the same bridge is correct for both the first schedule and a reschedule.
 */
export function applyHearingScheduled(
  kase: CaseInput,
  startsAt: Date,
): { updatedCase: RecoveryCase; note: string } {
  const transition = advance(caseToWorkflowState(kase), { type: "HEARING_SCHEDULED" });
  return {
    updatedCase: {
      ...kase,
      ...transitionToCasePatch(transition.next),
      nextScheduledAt: startsAt.toISOString(),
    },
    note: transition.note,
  };
}

/** hearing_scheduled -> adjourned: the hearing did not conclude; a new date is pending. */
export function applyHearingAdjourned(kase: CaseInput): { updatedCase: RecoveryCase; note: string } {
  const transition = advance(caseToWorkflowState(kase), { type: "HEARING_ADJOURNED" });
  return { updatedCase: { ...kase, ...transitionToCasePatch(transition.next) }, note: transition.note };
}

/**
 * hearing_scheduled | adjourned -> recovered | closed, per the hearing's
 * result. Both outcomes are terminal, so -- unlike the other bridges here --
 * `closedAt` is stamped explicitly (`transitionToCasePatch()` never sets it;
 * the payment-confirmation path sets it the same way in
 * src/domain/apply-payment.ts for the same reason: a terminal transition
 * without a closedAt would leave case-state invariants (P0-5 §10) unable to
 * tell a genuinely closed case from one that merely changed status).
 */
export function applyHearingOutcome(
  kase: CaseInput,
  recovered: boolean,
): { updatedCase: RecoveryCase; note: string } {
  const transition = advance(caseToWorkflowState(kase), { type: "DISPUTE_RESOLVED", recovered });
  return {
    updatedCase: {
      ...kase,
      ...transitionToCasePatch(transition.next),
      closedAt: new Date().toISOString(),
    },
    note: transition.note,
  };
}
