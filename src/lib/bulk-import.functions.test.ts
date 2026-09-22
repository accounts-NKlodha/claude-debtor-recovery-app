/**
 * Covers bulk-import.functions.ts (M1 Batch 3):
 *  - validateCommitPreconditions: the pure guard behind commitBulkImportFn.
 *    Plain function, no Start runtime context needed (same reasoning as
 *    every prior guard test on this branch).
 *  - The mixed valid/invalid row contract commitBulkImportFn's downstream
 *    repo.commitBulkImport depends on: valid rows are processed, invalid
 *    rows are rejected individually -- never redesigned into whole-file
 *    atomic processing. Exercised directly against the real, unmodified
 *    validateImport domain function (src/domain/bulk-import.ts already has
 *    its own exhaustive suite; this test only demonstrates the exact
 *    ImportResult shape this port's wiring is built on, not re-testing
 *    validateImport's own row-level rules).
 */
import { describe, expect, it } from "vitest";
import { validateCommitPreconditions } from "./bulk-import.functions";
import { validateImport } from "@/domain/bulk-import";
import { BULK_IMPORT_COLUMNS } from "@/contract/schemas";

describe("validateCommitPreconditions", () => {
  it("rejects a missing organisation", () => {
    expect(validateCommitPreconditions("", "some,csv\n1,2")).toEqual({ ok: false, error: "Missing organisation." });
  });

  it("rejects blank/whitespace-only csv text", () => {
    expect(validateCommitPreconditions("org-1", "")).toEqual({ ok: false, error: "No file loaded to commit." });
    expect(validateCommitPreconditions("org-1", "   \n  ")).toEqual({ ok: false, error: "No file loaded to commit." });
  });

  it("accepts a present organisation and non-blank csv", () => {
    expect(validateCommitPreconditions("org-1", "some,csv\n1,2")).toEqual({ ok: true });
  });
});

describe("mixed valid/invalid row commit contract (preserved, not redesigned)", () => {
  const header = BULK_IMPORT_COLUMNS.join(",");
  function row(over: Partial<Record<string, string>> = {}) {
    const base: Record<string, string> = {
      client_code: "NKL001",
      legal_entity_name: "Acme Pvt Ltd",
      creditor_gstin: "27AAAAA0000A1Z5",
      debtor_name: "Beta Traders",
      debtor_gstin: "29BBBBB1111B1Z5",
      debtor_mobile: "9876543210",
      debtor_email: "ap@beta.example",
      invoice_number: "INV-1",
      invoice_date: "2025-01-10",
      due_date: "2025-02-10",
      taxable_value: "100000",
      tax_rate: "18",
      tax_amount: "18000",
      invoice_total: "118000",
      adjustments: "0",
      total_due: "118000",
      ledger_as_of: "2025-06-01",
      client_certified: "yes",
      group_key: "",
      notes: "",
    };
    const merged = { ...base, ...over };
    return BULK_IMPORT_COLUMNS.map((c) => merged[c] ?? "").join(",");
  }

  it("processes valid rows and rejects invalid rows individually, not the whole file", () => {
    const csv = [
      header,
      row({ invoice_number: "INV-VALID-1" }),
      row({ invoice_number: "INV-INVALID", taxable_value: "not-a-number" }),
      row({ invoice_number: "INV-VALID-2" }),
    ].join("\n");

    const result = validateImport(csv);

    // The whole file is NOT rejected because one row is bad -- the good
    // rows still validate and appear in the commit preview.
    expect(result.totalRows).toBe(3);
    expect(result.validRows).toBe(2);
    expect(result.errorRows).toBe(1);
    expect(result.preview.map((p) => p.invoiceNumber)).toEqual(["INV-VALID-1", "INV-VALID-2"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].rowNumber).toBe(3); // the invalid row, 1-indexed after the header
  });
});
