/**
 * Pure bridge from a classified inbound debtor reply to the workflow state
 * machine (PRD §8 "AI classifies; staff decides" -- classification here is
 * always staff-entered in this build, see docs/workflow-durability/index.md;
 * no AI classification is wired). `advance()`'s REPLY_CLASSIFIED handling
 * (src/domain/workflow.ts, `handleReply`) already covers every classification
 * from any waiting state -- this module only bridges the DTO shape.
 */

import { advance, caseToWorkflowState, transitionToCasePatch } from "./workflow";
import type { RecoveryCase } from "@/contract/types";
import type { ReplyClassification } from "@/contract/enums";

type CaseInput = Parameters<typeof caseToWorkflowState>[0] & RecoveryCase;

export function applyReplyClassified(
  kase: CaseInput,
  classification: ReplyClassification,
): { updatedCase: RecoveryCase; note: string } {
  const transition = advance(caseToWorkflowState(kase), {
    type: "REPLY_CLASSIFIED",
    classification,
  });
  return { updatedCase: { ...kase, ...transitionToCasePatch(transition.next) }, note: transition.note };
}
