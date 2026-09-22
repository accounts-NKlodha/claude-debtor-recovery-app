/**
 * TanStack Start equivalent of src/app/actions/ocr.ts (M1 Batch 2). Staff
 * confirms corrected OCR fields for the invoice embedded in case detail
 * (case status "correction_required") -- this is the case-detail OCR
 * review, not the /intake bulk-import OCR workflow (out of scope).
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import { authorizeStaffMutation } from "@/lib/auth/tanstack-session";
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

export const correctInvoiceOcrFn = createServerFn({ method: "POST" })
  .validator(
    (data: unknown) =>
      data as {
        caseId: string;
        invoiceId: string;
        invoiceNumber: unknown;
        taxableValue: unknown;
        taxAmount: unknown;
        invoiceTotal: unknown;
        outstandingBalance: unknown;
      },
  )
  .handler(async ({ data }): Promise<CorrectInvoiceOcrState> => {
    if (!data.caseId || !data.invoiceId) {
      return { result: null, error: "Missing case or invoice." };
    }

    const parsed = ocrCorrectionSchema.safeParse({
      invoiceNumber: data.invoiceNumber,
      taxableValue: data.taxableValue,
      taxAmount: data.taxAmount,
      invoiceTotal: data.invoiceTotal,
      outstandingBalance: data.outstandingBalance,
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
      const repo = await getRepo();
      const result = await repo.correctInvoiceOcr(data.caseId, data.invoiceId, parsed.data, actor);
      return { result, error: null };
    } catch (e: unknown) {
      return { result: null, error: e instanceof Error ? e.message : "Failed to save the correction" };
    }
  });
