/**
 * Pure intake -> draft-case bridge (PRD §5 "an authorized upload starts
 * preparation immediately"; acceptance scenarios 0 and 14). No I/O here --
 * the repository layer persists the resulting case/invoice and owns the
 * new-id / debtor-lookup concerns. This module only decides what the
 * deterministic first two steps (accept -> check) produce.
 */

import { advance, initialState, type Transition } from "./workflow";

export interface IntakeInvoiceInput {
  debtorName: string;
  debtorGstin: string | null;
  invoiceNumber: string;
  invoiceDate: string; // YYYY-MM-DD
  taxableValue: number; // paise
  taxRate: number;
  taxAmount: number; // paise
  invoiceTotal: number; // paise
  outstandingBalance: number; // paise
}

/** Mandatory invoice data per PRD §7; due date is preferred, not mandatory here. */
export function runIntakeChecks(input: IntakeInvoiceInput): {
  missingMandatory: boolean;
  missingFields: string[];
} {
  const missingFields: string[] = [];
  if (!input.debtorName.trim()) missingFields.push("debtorName");
  if (!input.debtorGstin) missingFields.push("debtorGstin");
  if (!input.invoiceNumber.trim()) missingFields.push("invoiceNumber");
  if (!input.invoiceDate) missingFields.push("invoiceDate");
  if (!(input.taxableValue > 0)) missingFields.push("taxableValue");
  if (!(input.taxAmount >= 0)) missingFields.push("taxAmount");
  if (!(input.invoiceTotal > 0)) missingFields.push("invoiceTotal");
  if (!(input.outstandingBalance >= 0)) missingFields.push("outstandingBalance");
  return { missingMandatory: missingFields.length > 0, missingFields };
}

export interface DraftCaseOutcome {
  state: ReturnType<typeof advance>["next"];
  transitions: Transition[];
}

/**
 * UPLOAD_ACCEPTED -> DETERMINISTIC_CHECKS_COMPLETE, deterministically, with
 * no human click in between (PRD §5). Manual/portal entry has no OCR
 * confidence score, so `lowConfidence` is always false here -- OCR intake
 * (scanned/photo uploads) would pass a real confidence figure instead.
 */
export function createDraftCase(principalOutstanding: number, input: IntakeInvoiceInput): DraftCaseOutcome {
  let state = initialState(principalOutstanding);
  const transitions: Transition[] = [];

  const accepted = advance(state, { type: "UPLOAD_ACCEPTED" });
  transitions.push(accepted);
  state = accepted.next;

  const { missingMandatory } = runIntakeChecks(input);
  const checked = advance(state, {
    type: "DETERMINISTIC_CHECKS_COMPLETE",
    lowConfidence: false,
    missingMandatory,
  });
  transitions.push(checked);
  state = checked.next;

  return { state, transitions };
}
