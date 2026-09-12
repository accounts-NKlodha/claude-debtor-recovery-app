"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeStaffMutation } from "@/lib/auth/session";
import type { ManualInvoiceInput } from "@/contract/schemas";

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
 */
export async function createCaseFromManualInvoiceAction(
  organisationId: string,
  input: ManualInvoiceInput,
) {
  const actor = await authorizeStaffMutation();
  const result = await getRepo().createCaseFromManualInvoice(organisationId, input, actor);
  revalidatePath("/cases");
  revalidatePath("/today");
  return result;
}
