import { describe, expect, it } from "vitest";
import { validateImport } from "./bulk-import";
import { BULK_IMPORT_COLUMNS } from "@/contract/schemas";

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

describe("validateImport", () => {
  it("accepts a clean file", () => {
    const csv = [header, row({ invoice_number: "INV-1" }), row({ invoice_number: "INV-2" })].join("\n");
    const res = validateImport(csv);
    expect(res.validRows).toBe(2);
    expect(res.errorRows).toBe(0);
    expect(res.preview).toHaveLength(2);
  });

  it("flags missing required columns", () => {
    const res = validateImport("client_code,debtor_name\nX,Y");
    expect(res.errors[0].code).toBe("missing_columns");
    expect(res.validRows).toBe(0);
  });

  it("reports row-level bad dates and money and still processes good rows", () => {
    const csv = [
      header,
      row({ invoice_number: "INV-1" }),
      row({ invoice_number: "INV-2", invoice_date: "31/31/2025" }),
      row({ invoice_number: "INV-3", total_due: "abc" }),
    ].join("\n");
    const res = validateImport(csv);
    expect(res.validRows).toBe(1);
    expect(res.errorRows).toBe(2);
    expect(res.errors.map((e) => e.code)).toEqual(
      expect.arrayContaining(["bad_date", "bad_money"]),
    );
  });

  it("identifies in-batch and pre-existing duplicates without dropping them silently", () => {
    const csv = [
      header,
      row({ invoice_number: "INV-1" }),
      row({ invoice_number: "INV-1" }), // in-batch dup
      row({ invoice_number: "INV-9" }), // pre-existing dup
    ].join("\n");
    const res = validateImport(csv, {
      knownInvoiceKeys: new Set(["29bbbbb1111b1z5::inv-9"]),
    });
    expect(res.duplicateRows).toBe(2);
    expect(res.validRows).toBe(1);
    expect(res.errors.filter((e) => e.code === "duplicate")).toHaveLength(2);
  });

  it("handles a mixed 50-row file (acceptance scenario 2)", () => {
    const rows = [header];
    for (let i = 1; i <= 44; i++) rows.push(row({ invoice_number: `OK-${i}` }));
    rows.push(row({ invoice_number: "OK-1" })); // dup
    rows.push(row({ invoice_number: "OK-2" })); // dup
    rows.push(row({ invoice_number: "BAD-1", taxable_value: "xx" }));
    rows.push(row({ invoice_number: "BAD-2", invoice_date: "" }));
    rows.push(row({ invoice_number: "BAD-3", debtor_name: "" }));
    rows.push(row({ invoice_number: "OK-45" }));
    const res = validateImport(rows.join("\n"));
    expect(res.totalRows).toBe(50);
    expect(res.validRows).toBe(45);
    expect(res.duplicateRows).toBe(2);
    expect(res.errorRows).toBe(3);
  });
});
