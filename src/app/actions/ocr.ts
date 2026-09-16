"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeStaffMutation } from "@/lib/auth/session";
import { moneyToPaise } from "@/contract/schemas";
import { z } from "zod";
import type { Invoice, RecoveryCase } from "@/contract/types";

export interface CorrectInvoiceOcrState {
  result: { case: RecoveryCase; invoice: Invoice } | null;
  error: string | null;
}

const ocrCorrectionSchema = z.object({
  invoiceNumber: z.string().trim().min(1, "Invoice number is required"),
  taxableValue: moneyToPaise,
  taxAmount: moneyToPaise,
  invoiceTotal: moneyToPaise,
  outstandingBalance: moneyToPaise,
});

/**
 * Staff confirms corrected OCR fields; satisfies the staff-validation gate.
 *
 * Takes the `useActionState`/`<form action=...>` shape (prevState, FormData)
 * and always RETURNS its outcome rather than throwing (authorization
 * hardening task, #10) -- same production-crash fix already applied
 * elsewhere in this surface. The browser panel's own moneyToPaise parsing
 * is convenience only -- this re-parses the raw FormData with the same
 * schema server-side.
 */
export async function correctInvoiceOcrAction(
  _prevState: CorrectInvoiceOcrState,
  formData: FormData,
): Promise<CorrectInvoiceOcrState> {
  const caseId = String(formData.get("caseId") ?? "");
  const invoiceId = String(formData.get("invoiceId") ?? "");
  if (!caseId || !invoiceId) {
    return { result: null, error: "Missing case or invoice." };
  }

  const parsed = ocrCorrectionSchema.safeParse({
    invoiceNumber: formData.get("invoiceNumber"),
    taxableValue: formData.get("taxableValue"),
    taxAmount: formData.get("taxAmount"),
    invoiceTotal: formData.get("invoiceTotal"),
    outstandingBalance: formData.get("outstandingBalance"),
  });
  if (!parsed.success) {
    return { result: null, error: "Check invoice number and amount fields before confirming." };
  }

  let actor;
  try {
    actor = await authorizeStaffMutation();
  } catch {
    return { result: null, error: "You do not have permission to perform this action." };
  }

  try {
    const result = await getRepo().correctInvoiceOcr(caseId, invoiceId, parsed.data, actor);
    revalidatePath(`/cases/${caseId}`);
    revalidatePath("/cases");
    revalidatePath("/today");
    return { result, error: null };
  } catch (e: unknown) {
    return { result: null, error: e instanceof Error ? e.message : "Failed to save the correction" };
  }
}
