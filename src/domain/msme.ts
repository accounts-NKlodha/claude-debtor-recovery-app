/**
 * Pure MSME-route workflow bridges (PRD §12, workflow-spec). Portal calls
 * (save/preview/acknowledgement) are I/O and live in the repository layer
 * with the adapter + runAdapter retry policy; this module is deterministic
 * and tested without a network or database (mirrors gst.ts / reminder.ts).
 *
 * Unlike GST there is no separate "prepared" case status -- the seven-stage
 * save/resume happens client-side of the workflow engine (evidenced by
 * saveMsmeStage/buildMsmePreview audit entries, not a status change); the
 * case only transitions once ODR submission is acknowledged.
 */

import { advance, caseToWorkflowState, transitionToCasePatch } from "./workflow";
import type { RecoveryCase } from "@/contract/types";

type CaseInput = Parameters<typeof caseToWorkflowState>[0] & RecoveryCase;

/** Acknowledged submission: msme_eligibility_review -> msme_odr_filed. */
export function applyMsmeFiled(kase: CaseInput): { updatedCase: RecoveryCase; note: string } {
  const transition = advance(caseToWorkflowState(kase), {
    type: "MSME_ELIGIBILITY_DECIDED",
    eligible: true,
  });
  return { updatedCase: { ...kase, ...transitionToCasePatch(transition.next) }, note: transition.note };
}

/** Staff determines the creditor is not MSME-eligible -> manual legal route. */
export function applyMsmeIneligible(kase: CaseInput): { updatedCase: RecoveryCase; note: string } {
  const transition = advance(caseToWorkflowState(kase), {
    type: "MSME_ELIGIBILITY_DECIDED",
    eligible: false,
  });
  return { updatedCase: { ...kase, ...transitionToCasePatch(transition.next) }, note: transition.note };
}

/** Drift / permanent adapter failure fails closed with an urgent task. */
export function applyMsmeAutomationFailed(
  kase: CaseInput,
  reason: string,
): { updatedCase: RecoveryCase; note: string } {
  const transition = advance(caseToWorkflowState(kase), { type: "AUTOMATION_FAILED", reason });
  return { updatedCase: { ...kase, ...transitionToCasePatch(transition.next) }, note: transition.note };
}
