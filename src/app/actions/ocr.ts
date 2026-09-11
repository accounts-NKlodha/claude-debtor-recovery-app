"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import type { Invoice } from "@/contract/types";

/** Staff confirms corrected OCR fields; satisfies the staff-validation gate. */
export async function correctInvoiceOcrAction(
  caseId: string,
  invoiceId: string,
  corrections: Partial<
    Pick<
      Invoice,
      | "invoiceNumber"
      | "invoiceDate"
      | "dueDate"
      | "taxableValue"
      | "taxRate"
      | "taxAmount"
      | "invoiceTotal"
      | "outstandingBalance"
    >
  >,
) {
  const result = await getRepo().correctInvoiceOcr(caseId, invoiceId, corrections);
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/cases");
  revalidatePath("/today");
  return result;
}
