"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import type { GstComposeInput } from "@/contract/schemas";

/** Validates + prepares the GST pack (PRD §11 field limits enforced server-side too). */
export async function prepareGstNotificationAction(caseId: string, input: GstComposeInput) {
  const result = await getRepo().prepareGstNotification(caseId, input);
  revalidatePath(`/gst/${caseId}`);
  revalidatePath("/gst");
  revalidatePath(`/cases/${caseId}`);
  return result;
}

/** Opens the controlled browser session. The operator completes CAPTCHA + Send. */
export async function openGstAssistedSessionAction(caseId: string) {
  return getRepo().openGstAssistedSession(caseId);
}

/** Called once the operator confirms Send; captures reference evidence and starts the 7-day timer. */
export async function captureGstFilingAction(caseId: string, staffReference: string) {
  const result = await getRepo().captureGstFiling(caseId, staffReference);
  revalidatePath(`/gst/${caseId}`);
  revalidatePath("/gst");
  revalidatePath("/today");
  revalidatePath("/communications");
  revalidatePath(`/cases/${caseId}`);
  return result;
}
