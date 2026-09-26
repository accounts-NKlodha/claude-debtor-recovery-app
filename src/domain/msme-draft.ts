/**
 * MSME ODR "Save & resume" draft: the durable record of what the operator has
 * typed so far. One per case. The database (0026_msme_drafts.sql) is the
 * source of truth in production; applyMsmeStageSave/applyMsmeDraftLock below
 * are the same rules in pure form, used by the in-memory (demo) repository so
 * both modes behave identically.
 */

export const MSME_STAGES = [
  "claimant",
  "respondent",
  "advocate",
  "statement_of_claim",
  "documents",
  "checklist",
  "preview",
] as const;
export type MsmeDraftStage = (typeof MSME_STAGES)[number];

/** Case statuses at/after submission: the filing must no longer be edited. */
export const MSME_FILED_CASE_STATUSES: readonly string[] = ["msme_odr_filed", "msefc_dd", "hearing_scheduled", "adjourned"];

export interface MsmeDraft {
  caseId: string;
  formData: Record<string, unknown>;
  savedStages: MsmeDraftStage[];
  currentStage: MsmeDraftStage;
  status: "draft" | "locked";
  diaryNumber: string | null;
  petitionPdfKey: string | null;
  lockedAt: string | null;
  version: number;
  updatedAt: string;
}

export const MSME_LOCKED_MESSAGE = "The ODR filing was submitted; the draft is locked.";
export const MSME_CONFLICT_MESSAGE =
  "This draft was changed in another session. Reload the page to see the latest saved data before saving again.";

export class MsmeDraftError extends Error {
  constructor(
    message: string,
    readonly kind: "locked" | "conflict",
  ) {
    super(message);
  }
}

export function applyMsmeStageSave(input: {
  existing: MsmeDraft | undefined;
  caseId: string;
  caseStatus: string;
  stage: MsmeDraftStage;
  payload: Record<string, unknown>;
  expectedVersion?: number | null;
  now: string;
}): MsmeDraft {
  const { existing, expectedVersion } = input;
  if (MSME_FILED_CASE_STATUSES.includes(input.caseStatus) || existing?.status === "locked") {
    throw new MsmeDraftError(MSME_LOCKED_MESSAGE, "locked");
  }
  const currentVersion = existing?.version ?? 0;
  if (expectedVersion != null && expectedVersion !== currentVersion) {
    throw new MsmeDraftError(MSME_CONFLICT_MESSAGE, "conflict");
  }
  return {
    caseId: input.caseId,
    formData: { ...(existing?.formData ?? {}), ...input.payload },
    savedStages: existing?.savedStages.includes(input.stage)
      ? existing.savedStages
      : [...(existing?.savedStages ?? []), input.stage],
    currentStage: input.stage,
    status: "draft",
    diaryNumber: null,
    petitionPdfKey: null,
    lockedAt: null,
    version: currentVersion + 1,
    updatedAt: input.now,
  };
}

export function applyMsmeDraftLock(input: {
  existing: MsmeDraft | undefined;
  caseId: string;
  diaryNumber: string;
  petitionPdfKey: string | null;
  now: string;
}): MsmeDraft {
  const { existing } = input;
  if (existing?.status === "locked") {
    if (existing.diaryNumber !== input.diaryNumber) {
      throw new MsmeDraftError("The filing is already locked with a different diary number.", "locked");
    }
    return existing;
  }
  return {
    caseId: input.caseId,
    formData: existing?.formData ?? {},
    savedStages: existing?.savedStages ?? [],
    currentStage: existing?.currentStage ?? "preview",
    status: "locked",
    diaryNumber: input.diaryNumber,
    petitionPdfKey: input.petitionPdfKey,
    lockedAt: input.now,
    version: (existing?.version ?? 0) + 1,
    updatedAt: input.now,
  };
}

/** Which wizard step to open: where the operator left off, never past what
 * they have saved, and the last step for a locked filing. */
export function resumeStepIndex(draft: MsmeDraft | null | undefined): number {
  if (!draft) return 0;
  const last = MSME_STAGES.length - 1;
  if (draft.status === "locked") return last;
  return Math.max(0, Math.min(MSME_STAGES.indexOf(draft.currentStage), last));
}
