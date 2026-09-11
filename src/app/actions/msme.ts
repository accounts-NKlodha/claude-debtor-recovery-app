"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import type { MsmeStage } from "@/contract/adapters";

/** Save/resume one of the seven ODR stages. Does not change case status. */
export async function saveMsmeStageAction(
  caseId: string,
  stage: MsmeStage,
  payload: Record<string, unknown>,
) {
  return getRepo().saveMsmeStage(caseId, stage, payload);
}

/** Builds the immutable preview snapshot shown at the Preview stage. */
export async function buildMsmePreviewAction(caseId: string) {
  return getRepo().buildMsmePreview(caseId);
}

/** Called after the operator confirms final submit on the MSME ODR portal. */
export async function captureMsmeAcknowledgementAction(caseId: string) {
  const result = await getRepo().captureMsmeAcknowledgement(caseId);
  revalidatePath(`/msme/${caseId}`);
  revalidatePath("/msme");
  revalidatePath("/today");
  revalidatePath("/communications");
  revalidatePath(`/cases/${caseId}`);
  return result;
}
