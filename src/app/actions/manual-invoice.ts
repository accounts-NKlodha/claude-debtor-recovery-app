"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeStaffMutation } from "@/lib/auth/session";
import { manualInvoiceSchema } from "@/contract/schemas";

export interface CreateManualInvoiceState {
  result: { caseId: string; status: string } | null;
  error: string | null;
}

/**
 * Creates a draft case from one manually entered invoice (PRD §5/§7).
 * Preparation (accept -> deterministic checks) runs immediately; the case
 * still stops at certification/validation/age-gate before activation.
 *
 * `organisationId` is which client staff is entering this invoice for --
 * legitimate staff cross-org capability (PRD §4). Requiring an authenticated
 * staff/admin actor is what makes this safe: no other actor kind can reach
 * this action, so it cannot be used to redirect a mutation into another
 * tenant on a client's behalf.
 *
 * Takes the `useActionState`/`<form action=...>` shape (prevState, FormData)
 * and always RETURNS its outcome rather than throwing -- same
 * production-crash fix already applied to sign-in/kill-switch/reminders/
 * debtor-contact/payments (authorization hardening task, #14). The browser
 * form's own zod validation (manualInvoiceSchema via zodResolver) is
 * convenience only -- this re-parses the raw FormData with the exact same
 * schema server-side, so a malformed or direct/bypassed submission is
 * rejected here too, not just in the browser.
 */
export async function createCaseFromManualInvoiceAction(
  _prevState: CreateManualInvoiceState,
  formData: FormData,
): Promise<CreateManualInvoiceState> {
  const organisationId = String(formData.get("organisationId") ?? "");
  if (!organisationId) {
    return { result: null, error: "Missing organisation." };
  }

  const parsed = manualInvoiceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { result: null, error: parsed.error.issues[0]?.message ?? "Invalid invoice details" };
  }

  let actor;
  try {
    actor = await authorizeStaffMutation();
  } catch {
    return { result: null, error: "You do not have permission to perform this action." };
  }

  try {
    const created = await getRepo().createCaseFromManualInvoice(organisationId, parsed.data, actor);
    revalidatePath("/cases");
    revalidatePath("/today");
    return { result: { caseId: created.case.id, status: created.case.status }, error: null };
  } catch (e: unknown) {
    return { result: null, error: e instanceof Error ? e.message : "Failed to create the draft case" };
  }
}
