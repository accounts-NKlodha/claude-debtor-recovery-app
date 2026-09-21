"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeStaffMutation } from "@/lib/auth/session";

export interface RecordActivationGateState {
  result: { status: string; activated: boolean; missing: string[] } | null;
  error: string | null;
}

/**
 * Staff records one activation gate (client certification, or staff
 * validation for a case that is `under_validation`) with a mandatory reason.
 * The 60-day age gate cannot be recorded -- it is derived from the invoice
 * due dates. Always RETURNS its outcome rather than throwing (same
 * production-crash convention as the other form actions).
 */
export async function recordActivationGateAction(
  _prevState: RecordActivationGateState,
  formData: FormData,
): Promise<RecordActivationGateState> {
  const caseId = String(formData.get("caseId") ?? "");
  const gate = String(formData.get("gate") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!caseId) return { result: null, error: "Missing case." };
  if (gate !== "client_certification" && gate !== "staff_validation") return { result: null, error: "Unknown activation gate." };
  if (!reason) return { result: null, error: "A reason is required (who certified / validated, and how)." };

  let actor;
  try {
    actor = await authorizeStaffMutation();
  } catch {
    return { result: null, error: "You do not have permission to perform this action." };
  }

  try {
    const out = await getRepo().recordActivationGate(caseId, gate, reason, actor);
    revalidatePath(`/cases/${caseId}`);
    revalidatePath("/cases");
    revalidatePath("/today");
    return { result: { status: out.case.status, activated: out.activated, missing: out.gates.missing }, error: null };
  } catch (e: unknown) {
    return { result: null, error: e instanceof Error ? e.message : "Failed to record the activation gate" };
  }
}
