"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepo } from "@/server/repo";
import { authorizeStaffMutation } from "@/lib/auth/session";
import type { MsmeStage } from "@/contract/adapters";
import type { RecoveryCase } from "@/contract/types";

/* R1 residual server-action closure: msme.ts's three actions were the
 * documented residual from the authorization + server-action hardening
 * task -- all three still threw on any failure (case not found, invalid
 * stage, bad payload, no session), which crashes a directly-invoked "use
 * server" function's caller with an opaque React production error, same
 * class of bug already fixed elsewhere in this app. Converted to the same
 * typed safe-action-state contract (prevState, FormData) -> state, always
 * RETURNED rather than thrown. No MSME portal automation is implemented;
 * the adapter stays mocked regardless of profile/environment
 * (src/adapters/index.ts) -- these actions only wrap the existing,
 * unmodified repository calls in the safe-return contract. Neither
 * repository method accepts (or ever fabricates) a staff-entered filing
 * reference -- diaryNumber/petitionPdfKey/previewHash come solely from the
 * (mocked) msmePortal adapter's own result, so there is no equivalent of
 * the GST reference-fabrication bug to close here (confirmed by reading
 * both SupabaseRepository and MemoryRepository's implementations). */

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

/** Save/resume one of the seven ODR stages. Does not change case status.
 * `payload` is the wizard's full free-form draft (one flat object shared
 * across all seven stages, unchanged shape) -- carried as a JSON string in
 * FormData since it isn't a fixed set of named fields. */
export async function saveMsmeStageAction(
  _prevState: SaveMsmeStageState,
  formData: FormData,
): Promise<SaveMsmeStageState> {
  const caseId = String(formData.get("caseId") ?? "");
  if (!caseId) return { result: null, error: "Missing case." };

  const stageParsed = z.enum(MSME_STAGES).safeParse(formData.get("stage"));
  if (!stageParsed.success) {
    return { result: null, error: "Invalid ODR stage." };
  }

  let payload: Record<string, unknown>;
  try {
    const raw = JSON.parse(String(formData.get("payload") ?? "{}"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("not an object");
    payload = raw as Record<string, unknown>;
  } catch {
    return { result: null, error: "Invalid stage data." };
  }

  let actor;
  try {
    actor = await authorizeStaffMutation();
  } catch {
    return { result: null, error: "You do not have permission to perform this action." };
  }

  try {
    const result = await getRepo().saveMsmeStage(caseId, stageParsed.data, payload, actor);
    return { result, error: null };
  } catch (e: unknown) {
    return { result: null, error: e instanceof Error ? e.message : "Failed to save this stage" };
  }
}

export interface BuildMsmePreviewState {
  result: { previewPdfKey: string | null; previewHash: string | null } | null;
  error: string | null;
}

/** Builds the immutable preview snapshot shown at the Preview stage.
 * Triggered automatically when the wizard advances into that stage (no
 * discrete user submit gesture) -- dispatched through a hidden form bound
 * to this action and submitted programmatically via
 * `form.requestSubmit()`, the same `useActionState`/`<form action>`
 * mechanism as every other action in this app, just without a visible
 * button. */
export async function buildMsmePreviewAction(
  _prevState: BuildMsmePreviewState,
  formData: FormData,
): Promise<BuildMsmePreviewState> {
  const caseId = String(formData.get("caseId") ?? "");
  if (!caseId) return { result: null, error: "Missing case." };

  let actor;
  try {
    actor = await authorizeStaffMutation();
  } catch {
    return { result: null, error: "You do not have permission to perform this action." };
  }

  try {
    const result = await getRepo().buildMsmePreview(caseId, actor);
    return { result, error: null };
  } catch (e: unknown) {
    return { result: null, error: e instanceof Error ? e.message : "Failed to build the preview snapshot" };
  }
}

export interface CaptureMsmeAcknowledgementState {
  result: { case: RecoveryCase; diaryNumber: string | null; petitionPdfKey: string | null } | null;
  error: string | null;
}

/** Called after the operator confirms final submit on the MSME ODR portal.
 * No staff-entered reference is ever accepted or required here -- unlike
 * GST filing capture, the diary number/petition PDF key come solely from
 * the (mocked) msmePortal adapter's own result; there is nothing for
 * production to fabricate a fallback for. A missing `diaryNumber` in the
 * result (drift/failure/non-success outcome) is not itself a thrown error
 * -- it's a legitimate business outcome the caller must check and render,
 * same as before this conversion. */
export async function captureMsmeAcknowledgementAction(
  _prevState: CaptureMsmeAcknowledgementState,
  formData: FormData,
): Promise<CaptureMsmeAcknowledgementState> {
  const caseId = String(formData.get("caseId") ?? "");
  if (!caseId) return { result: null, error: "Missing case." };

  let actor;
  try {
    actor = await authorizeStaffMutation();
  } catch {
    return { result: null, error: "You do not have permission to perform this action." };
  }

  try {
    const result = await getRepo().captureMsmeAcknowledgement(caseId, actor);
    revalidatePath(`/msme/${caseId}`);
    revalidatePath("/msme");
    revalidatePath("/today");
    revalidatePath("/communications");
    revalidatePath(`/cases/${caseId}`);
    return { result, error: null };
  } catch (e: unknown) {
    return { result: null, error: e instanceof Error ? e.message : "Failed to submit the filing" };
  }
}
