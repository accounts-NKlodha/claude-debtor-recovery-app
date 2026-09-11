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

/** msme_odr_filed | msefc_dd -> hearing_scheduled, with the hearing date recorded. */
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
