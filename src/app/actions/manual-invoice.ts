"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import type { ManualInvoiceInput } from "@/contract/schemas";

/**
 * Creates a draft case from one manually entered invoice (PRD §5/§7).
 * Preparation (accept -> deterministic checks) runs immediately; the case
 * still stops at certification/validation/age-gate before activation.
 */
export async function createCaseFromManualInvoiceAction(
  organisationId: string,
  input: ManualInvoiceInput,
) {
  const result = await getRepo().createCaseFromManualInvoice(organisationId, input);
  revalidatePath("/cases");
  revalidatePath("/today");
  return result;
}
