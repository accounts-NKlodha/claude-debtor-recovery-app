/**
 * Final-UAT go-live task: `manualInvoiceSchema`'s optional `dueDate` field
 * rejected an intentionally-blank form field with "unrecognised date
 * format" -- react-hook-form submits "" for an empty uncontrolled input,
 * not undefined, and `flexibleDate.nullable().optional()` only tolerates
 * `null`/`undefined`, not "". This blocked creating a case with no due date
 * at all (found live: the manual-invoice form silently failed client-side
 * validation and never reached the server action). Fixed the same way
 * `optionalGstinSchema` already handles this exact class of bug.
 */
import { describe, expect, it } from "vitest";
import { manualInvoiceSchema } from "./schemas";

function baseInvoice(overrides: Record<string, unknown> = {}) {
  return {
    invoiceNumber: "INV-1",
    invoiceDate: "01/08/2026",
    dueDate: "",
    taxableValue: "100000",
    taxRate: "18",
    taxAmount: "18000",
    invoiceTotal: "118000",
    outstandingBalance: "118000",
    debtorName: "Debtor Co",
    debtorGstin: "",
    ...overrides,
  };
}

describe("manualInvoiceSchema: dueDate", () => {
  it("accepts an empty string as absent, not an invalid date", () => {
    const result = manualInvoiceSchema.safeParse(baseInvoice());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.dueDate).toBeUndefined();
  });

  it("accepts a real DD/MM/YYYY date and normalizes it", () => {
    const result = manualInvoiceSchema.safeParse(baseInvoice({ dueDate: "15/09/2026" }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.dueDate).toBe("2026-09-15");
  });

  it("still rejects a genuinely malformed non-empty date", () => {
    const result = manualInvoiceSchema.safeParse(baseInvoice({ dueDate: "not-a-date" }));
    expect(result.success).toBe(false);
  });

  it("required invoiceDate is unaffected -- an empty string there still fails", () => {
    const result = manualInvoiceSchema.safeParse(baseInvoice({ invoiceDate: "" }));
    expect(result.success).toBe(false);
  });
});
