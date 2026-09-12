"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeStaffMutation } from "@/lib/auth/session";
import type { GstComposeInput } from "@/contract/schemas";

/** Validates + prepares the GST pack (PRD §11 field limits enforced server-side too). */
export async function prepareGstNotificationAction(caseId: string, input: GstComposeInput) {
  const actor = await authorizeStaffMutation();
  const result = await getRepo().prepareGstNotification(caseId, input, actor);
  revalidatePath(`/gst/${caseId}`);
  revalidatePath("/gst");
  revalidatePath(`/cases/${caseId}`);
  return result;
}

/** Opens the controlled browser session. The operator completes CAPTCHA + Send. */
export async function openGstAssistedSessionAction(caseId: string) {
  const actor = await authorizeStaffMutation();
  return getRepo().openGstAssistedSession(caseId, actor);
}

/** Called once the operator confirms Send; captures reference evidence and starts the 7-day timer. */
export async function captureGstFilingAction(caseId: string, staffReference: string) {
  const actor = await authorizeStaffMutation();
  const result = await getRepo().captureGstFiling(caseId, staffReference, actor);
  revalidatePath(`/gst/${caseId}`);
  revalidatePath("/gst");
  revalidatePath("/today");
  revalidatePath("/communications");
  revalidatePath(`/cases/${caseId}`);
  return result;
}
