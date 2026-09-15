"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeStaffMutation } from "@/lib/auth/session";
import { debtorContactSchema } from "@/contract/schemas";

export interface UpdateDebtorContactState {
  debtor: { email: string | null; mobile: string | null } | null;
  error: string | null;
}

/**
 * Staff/admin-only: corrects a debtor's mobile/email (core-workflow
 * remediation task -- final UAT found no mechanism anywhere to do this,
 * which blocked the reminder-send workflow for any case created through
 * the product's own intake paths). Client must never reach this --
 * authorizeStaffMutation() rejects a client session the same way every
 * other staff-only action in this app does.
 *
 * Takes the `useActionState`/`<form action=...>` shape (prevState,
 * FormData) and always RETURNS its outcome rather than throwing, matching
 * the production-crash fix applied to sign-in/kill-switch/send-reminder
 * during final UAT -- a thrown error from a directly-invoked "use server"
 * function crashes the client with an opaque React error in production.
 */
export async function updateDebtorContactAction(
  _prevState: UpdateDebtorContactState,
  formData: FormData,
): Promise<UpdateDebtorContactState> {
  const debtorId = String(formData.get("debtorId") ?? "");
  const caseId = String(formData.get("caseId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || "Staff-corrected debtor contact details";

  const parsed = debtorContactSchema.safeParse({
    email: formData.get("email"),
    mobile: formData.get("mobile"),
  });
  if (!parsed.success) {
    return { debtor: null, error: parsed.error.issues[0]?.message ?? "Invalid contact details" };
  }

  let actor;
  try {
    actor = await authorizeStaffMutation();
  } catch {
    // Never disclose *why* (wrong role vs. no session) -- same principle as
    // src/app/actions/settings.ts's kill-switch denial message.
    return { debtor: null, error: "You do not have permission to change this debtor's contact details." };
  }

  try {
    const debtor = await getRepo().updateDebtorContact(debtorId, parsed.data, reason, actor);
    if (caseId) revalidatePath(`/cases/${caseId}`);
    return { debtor: { email: debtor.email, mobile: debtor.mobile }, error: null };
  } catch (e: unknown) {
    return { debtor: null, error: e instanceof Error ? e.message : "Failed to update contact details" };
  }
}
