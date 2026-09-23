/**
 * TanStack Start equivalent of src/app/actions/msme.ts (M1 Batch 4). Same
 * three mutations, same stage/payload validation, same staff-only
 * authorization. No MSME portal automation exists in either app -- the
 * msmePortal adapter stays mocked regardless of profile/environment
 * (src/adapters/index.ts, unchanged); diaryNumber/petitionPdfKey/
 * previewHash come solely from the mocked adapter's own result, never
 * fabricated here, so this migration performs no real external send by
 * construction.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRepo } from "@/server/repo.tanstack";
import { authorizeStaffMutation } from "@/lib/auth/tanstack-session";
import type { MsmeStage } from "@/contract/adapters";
import type { RecoveryCase } from "@/contract/types";

const MSME_STAGES = [
  "claimant",
  "respondent",
  "advocate",
  "statement_of_claim",
  "documents",
  "checklist",
  "preview",
] as const satisfies readonly MsmeStage[];

export interface SaveMsmeStageState {
  result: { resumeToken: string | null } | null;
  error: string | null;
}

/**
 * Pure stage + payload validation, factored out for direct
 * unit-testability (see msme.functions.test.ts) -- same reasoning as
 * every prior guard extraction on this branch. Only the seven canonical
 * ODR stages are accepted; the payload must be a plain object (not an
 * array, not null, not a primitive).
 */
export function validateMsmeStageInput(
  caseId: string,
  stage: unknown,
  payload: unknown,
): { ok: true; stage: MsmeStage; payload: Record<string, unknown> } | { ok: false; error: string } {
  if (!caseId) return { ok: false, error: "Missing case." };

  const stageParsed = z.enum(MSME_STAGES).safeParse(stage);
  if (!stageParsed.success) {
    return { ok: false, error: "Invalid ODR stage." };
  }

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { ok: false, error: "Invalid stage data." };
  }

  return { ok: true, stage: stageParsed.data, payload: payload as Record<string, unknown> };
}

/** `payload` is the wizard's full free-form draft (one flat object shared
 * across all seven stages, unchanged shape) -- passed as a plain object
 * here rather than a JSON string in FormData, since there's no FormData
 * boundary to cross. */
export const saveMsmeStageFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { caseId: string; stage: unknown; payload: unknown })
  .handler(async ({ data }): Promise<SaveMsmeStageState> => {
    const validated = validateMsmeStageInput(data.caseId, data.stage, data.payload);
    if (!validated.ok) return { result: null, error: validated.error };
    const { stage, payload } = validated;

    let actor;
    try {
      actor = await authorizeStaffMutation();
    } catch {
      return { result: null, error: "You do not have permission to perform this action." };
    }

    try {
      const repo = await getRepo();
      const result = await repo.saveMsmeStage(data.caseId, stage, payload, actor);
      return { result, error: null };
    } catch (e: unknown) {
      return { result: null, error: e instanceof Error ? e.message : "Failed to save this stage" };
    }
  });

export interface BuildMsmePreviewState {
  result: { previewPdfKey: string | null; previewHash: string | null } | null;
  error: string | null;
}

export const buildMsmePreviewFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { caseId: string })
  .handler(async ({ data }): Promise<BuildMsmePreviewState> => {
    if (!data.caseId) return { result: null, error: "Missing case." };

    let actor;
    try {
      actor = await authorizeStaffMutation();
    } catch {
      return { result: null, error: "You do not have permission to perform this action." };
    }

    try {
      const repo = await getRepo();
      const result = await repo.buildMsmePreview(data.caseId, actor);
      return { result, error: null };
    } catch (e: unknown) {
      return { result: null, error: e instanceof Error ? e.message : "Failed to build the preview snapshot" };
    }
  });

export interface CaptureMsmeAcknowledgementState {
  result: { case: RecoveryCase; diaryNumber: string | null; petitionPdfKey: string | null } | null;
  error: string | null;
}

export const captureMsmeAcknowledgementFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { caseId: string })
  .handler(async ({ data }): Promise<CaptureMsmeAcknowledgementState> => {
    if (!data.caseId) return { result: null, error: "Missing case." };

    let actor;
    try {
      actor = await authorizeStaffMutation();
    } catch {
      return { result: null, error: "You do not have permission to perform this action." };
    }

    try {
      const repo = await getRepo();
      const result = await repo.captureMsmeAcknowledgement(data.caseId, actor);
      return { result, error: null };
    } catch (e: unknown) {
      return { result: null, error: e instanceof Error ? e.message : "Failed to submit the filing" };
    }
  });
