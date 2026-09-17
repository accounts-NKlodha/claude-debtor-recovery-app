"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeStaffMutation } from "@/lib/auth/session";
import { gstComposeSchema } from "@/contract/schemas";
import type { RecoveryCase } from "@/contract/types";

/* R1 residual server-action closure: found during the required full
 * residual scan (not in the task's originally-named msme.ts/bulk-import.ts
 * scope), reported per the task's own instruction to include a genuinely
 * equivalent residual action when it's a small, direct application of the
 * same established pattern. All three actions here previously threw on any
 * failure (positional args, no try/catch) -- the same class of bug already
 * fixed elsewhere, and specifically relevant because the R0 hardening
 * task's own GST reference-fabrication fix (supabase.ts's
 * captureGstFiling) added a NEW throw path ("a real portal reference
 * number is required") that this action layer never caught, so a blank
 * staffReference reaching the server directly would still have crashed the
 * client in production even though the fabrication itself was already
 * closed. Converted to the same typed safe-action-state contract
 * (prevState, FormData) -> state, always RETURNED rather than thrown. No
 * real GST portal automation is implemented or added here. */

function revalidateGstPaths(caseId: string) {
  revalidatePath(`/gst/${caseId}`);
  revalidatePath("/gst");
  revalidatePath(`/cases/${caseId}`);
}

export interface PrepareGstNotificationState {
  result: { case: RecoveryCase; manifestHash: string | null } | null;
  error: string | null;
}

/** Validates + prepares the GST pack (PRD §11 field limits enforced server-side too). */
export async function prepareGstNotificationAction(
  _prevState: PrepareGstNotificationState,
  formData: FormData,
): Promise<PrepareGstNotificationState> {
  const caseId = String(formData.get("caseId") ?? "");
  if (!caseId) return { result: null, error: "Missing case." };

  const parsed = gstComposeSchema.safeParse({
    recipientGstin: formData.get("recipientGstin"),
    subject: formData.get("subject"),
    action: formData.get("action"),
    remarks: formData.get("remarks"),
    invoiceRecordCount: Number(formData.get("invoiceRecordCount")),
    attachmentStorageKeys: formData.getAll("attachmentStorageKeys").map(String),
  });
  if (!parsed.success) {
    return { result: null, error: parsed.error.issues[0]?.message ?? "Fix field limits before continuing" };
  }

  let actor;
  try {
    actor = await authorizeStaffMutation();
  } catch {
    return { result: null, error: "You do not have permission to perform this action." };
  }

  try {
    const result = await getRepo().prepareGstNotification(caseId, parsed.data, actor);
    revalidateGstPaths(caseId);
    return { result, error: null };
  } catch (e: unknown) {
    return { result: null, error: e instanceof Error ? e.message : "Failed to prepare the GST pack" };
  }
}

export interface OpenGstAssistedSessionState {
  result: { sessionUrl: string | null } | null;
  error: string | null;
}

/** Opens the controlled browser session. The operator completes CAPTCHA + Send. */
export async function openGstAssistedSessionAction(
  _prevState: OpenGstAssistedSessionState,
  formData: FormData,
): Promise<OpenGstAssistedSessionState> {
  const caseId = String(formData.get("caseId") ?? "");
  if (!caseId) return { result: null, error: "Missing case." };

  let actor;
  try {
    actor = await authorizeStaffMutation();
  } catch {
    return { result: null, error: "You do not have permission to perform this action." };
  }

  try {
    const result = await getRepo().openGstAssistedSession(caseId, actor);
    return { result, error: null };
  } catch (e: unknown) {
    return { result: null, error: e instanceof Error ? e.message : "Failed to open the assisted session" };
  }
}

export interface CaptureGstFilingState {
  result: { case: RecoveryCase; referenceNumber: string | null } | null;
  error: string | null;
}

/** Called once the operator confirms Send; captures reference evidence and
 * starts the 7-day timer. Production never fabricates a reference number:
 * the repository itself rejects a blank `staffReference` outright (R0
 * hardening task) -- that rejection is a controlled business-rule error
 * here now, not an uncaught throw. */
export async function captureGstFilingAction(
  _prevState: CaptureGstFilingState,
  formData: FormData,
): Promise<CaptureGstFilingState> {
  const caseId = String(formData.get("caseId") ?? "");
  const staffReference = String(formData.get("staffReference") ?? "");
  if (!caseId) return { result: null, error: "Missing case." };

  let actor;
  try {
    actor = await authorizeStaffMutation();
  } catch {
    return { result: null, error: "You do not have permission to perform this action." };
  }

  try {
    const result = await getRepo().captureGstFiling(caseId, staffReference, actor);
    revalidateGstPaths(caseId);
    revalidatePath("/today");
    revalidatePath("/communications");
    return { result, error: null };
  } catch (e: unknown) {
    return { result: null, error: e instanceof Error ? e.message : "Failed to capture the filing" };
  }
}
