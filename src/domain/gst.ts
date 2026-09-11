/**
 * Pure GST-route workflow bridges (PRD §11, workflow-spec). The portal call
 * itself is I/O and lives in the repository layer alongside the adapter +
 * runAdapter retry policy; everything here is deterministic and tested
 * without a network or database, same pattern as reminder.ts / apply-payment.ts.
 */

import { advance, caseToWorkflowState, transitionToCasePatch } from "./workflow";
import { gstTimerDeadline } from "./scheduling";
import type { RecoveryCase } from "@/contract/types";

type CaseInput = Parameters<typeof caseToWorkflowState>[0] & RecoveryCase;

/** gst_eligibility_review -> gst_notification_prepared. No-op if already past it. */
export function applyGstPrepared(kase: CaseInput): { updatedCase: RecoveryCase; note: string } {
  const transition = advance(caseToWorkflowState(kase), {
    type: "GST_ELIGIBILITY_DECIDED",
    route: "gst",
  });
  return { updatedCase: { ...kase, ...transitionToCasePatch(transition.next) }, note: transition.note };
}

/** Successful Send + captured reference starts the 7-day timer (PRD §11). */
export function applyGstFiled(
  kase: CaseInput,
  filedAt: Date,
): { updatedCase: RecoveryCase; note: string } {
  const transition = advance(caseToWorkflowState(kase), { type: "GST_NOTIFICATION_FILED" });
  return {
    updatedCase: {
      ...kase,
      ...transitionToCasePatch(transition.next),
      nextScheduledAt: gstTimerDeadline(filedAt).toISOString(),
    },
    note: transition.note,
  };
}

/** Drift / permanent adapter failure fails closed with an urgent task (PRD §11). */
export function applyGstAutomationFailed(
  kase: CaseInput,
  reason: string,
): { updatedCase: RecoveryCase; note: string } {
  const transition = advance(caseToWorkflowState(kase), { type: "AUTOMATION_FAILED", reason });
  return {
    updatedCase: { ...kase, ...transitionToCasePatch(transition.next), nextScheduledAt: null },
    note: transition.note,
  };
}
