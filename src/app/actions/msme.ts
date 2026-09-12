"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeStaffMutation } from "@/lib/auth/session";
import type { MsmeStage } from "@/contract/adapters";

/** Save/resume one of the seven ODR stages. Does not change case status. */
export async function saveMsmeStageAction(
  caseId: string,
  stage: MsmeStage,
  payload: Record<string, unknown>,
) {
  const actor = await authorizeStaffMutation();
  return getRepo().saveMsmeStage(caseId, stage, payload, actor);
}

/** Builds the immutable preview snapshot shown at the Preview stage. */
export async function buildMsmePreviewAction(caseId: string) {
  const actor = await authorizeStaffMutation();
  return getRepo().buildMsmePreview(caseId, actor);
}

/** Called after the operator confirms final submit on the MSME ODR portal. */
export async function captureMsmeAcknowledgementAction(caseId: string) {
  const actor = await authorizeStaffMutation();
  const result = await getRepo().captureMsmeAcknowledgement(caseId, actor);
  revalidatePath(`/msme/${caseId}`);
  revalidatePath("/msme");
  revalidatePath("/today");
  revalidatePath("/communications");
  revalidatePath(`/cases/${caseId}`);
  return result;
}
