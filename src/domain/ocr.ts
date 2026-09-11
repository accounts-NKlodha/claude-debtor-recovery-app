/**
 * Pure OCR-correction workflow bridge (PRD §7 "staff confirmation of
 * OCR/AI output", acceptance scenario 1). Provenance (source page/region,
 * per-field confidence) lives on the adapter contract
 * (`OcrExtractionField` in src/contract/adapters.ts) and is captured at
 * extraction time; this module only decides what staff *confirming* the
 * corrected fields does to the case.
 */

import { advance, caseToWorkflowState, transitionToCasePatch } from "./workflow";
import type { RecoveryCase } from "@/contract/types";

type CaseInput = Parameters<typeof caseToWorkflowState>[0] & RecoveryCase;

/**
 * Staff has reviewed and corrected the low-confidence extraction. This
 * satisfies the staff-validation gate; per the shared caseToWorkflowState
 * bridge (see workflow.ts) certification/age-gate are already treated as
 * cleared by this point in the demo model, so a correction_required case
 * moves straight to active.
 */
export function applyOcrCorrected(kase: CaseInput): { updatedCase: RecoveryCase; note: string } {
  const transition = advance(caseToWorkflowState(kase), { type: "STAFF_VALIDATED" });
  return { updatedCase: { ...kase, ...transitionToCasePatch(transition.next) }, note: transition.note };
}
