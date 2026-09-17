/**
 * R1 residual server-action closure: validateBulkImportAction and
 * commitBulkImportAction previously threw on any failure. They now take
 * the useActionState (prevState, FormData) shape and always return a typed
 * state instead. Row-level validation itself (headers, dates, money,
 * duplicates, debtor email/mobile) is unchanged -- it already lived in the
 * pure `validateImport` domain function and already returned a structured
 * ImportResult rather than throwing; these tests confirm that behavior is
 * preserved through the converted action layer, plus the action layer's
 * own failure modes (authorization, unknown organisation).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as mock from "@/lib/mock-data";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const authorizeStaffMutation = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  authorizeStaffMutation: (...args: unknown[]) => authorizeStaffMutation(...args),
}));

const STAFF = { actorId: "staff-alice", actorRole: "staff" };

const HEADER =
  "client_code,legal_entity_name,creditor_gstin,debtor_name,debtor_gstin,debtor_mobile,debtor_email,invoice_number,invoice_date,due_date,taxable_value,tax_rate,tax_amount,invoice_total,adjustments,total_due,ledger_as_of,client_certified,group_key,notes";

function validRow(overrides: Partial<Record<string, string>> = {}): string {
  const fields = {
    client_code: "NKL-TEST",
    legal_entity_name: "Test Entity",
    creditor_gstin: "27AAAAA0000A1Z5",
    debtor_name: "Synthetic Debtor",
    debtor_gstin: "",
    debtor_mobile: "9876543210",
    debtor_email: "debtor@example.com",
    invoice_number: `INV-${Math.random().toString(36).slice(2, 8)}`,
    invoice_date: "2026-01-15",
    due_date: "2026-02-14",
    taxable_value: "100000",
    tax_rate: "18",
    tax_amount: "18000",
    invoice_total: "118000",
    adjustments: "0",
    total_due: "118000",
    ledger_as_of: "2026-08-29",
    client_certified: "YES",
    group_key: "GROUP-1",
    notes: "",
    ...overrides,
  };
  return HEADER.split(",")
    .map((col) => fields[col as keyof typeof fields])
    .join(",");
}

function csvOf(...rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  authorizeStaffMutation.mockReset();
  authorizeStaffMutation.mockResolvedValue(STAFF);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("validateBulkImportAction", () => {
  it("validates a well-formed synthetic CSV and returns a structured preview, no throw", async () => {
    const { validateBulkImportAction } = await import("./bulk-import");
    const csv = csvOf(validRow());
    const result = await validateBulkImportAction({ result: null, error: null }, fd({ csvText: csv }));
    expect(result.error).toBeNull();
    expect(result.result?.validRows).toBe(1);
    expect(result.result?.errorRows).toBe(0);
    expect(result.result?.preview.length).toBe(1);
  });

  it("returns a structured error (not a throw) for a missing required header", async () => {
    const { validateBulkImportAction } = await import("./bulk-import");
    const malformedHeader = HEADER.replace("invoice_number,", "");
    const csv = [malformedHeader, validRow()].join("\n");
    const result = await validateBulkImportAction({ result: null, error: null }, fd({ csvText: csv }));
    expect(result.error).toBeNull();
    expect(result.result?.errors[0]?.code).toBe("missing_columns");
    expect(result.result?.validRows).toBe(0);
  });

  it("returns a structured error (not a throw) for an empty/malformed file", async () => {
    const { validateBulkImportAction } = await import("./bulk-import");
    const result = await validateBulkImportAction({ result: null, error: null }, fd({ csvText: "" }));
    expect(result.error).toBeNull();
    expect(result.result?.errors[0]?.code).toBe("empty_file");
  });

  it("flags an invalid debtor email as a row-level error, not a throw", async () => {
    const { validateBulkImportAction } = await import("./bulk-import");
    const csv = csvOf(validRow({ debtor_email: "not-an-email" }));
    const result = await validateBulkImportAction({ result: null, error: null }, fd({ csvText: csv }));
    expect(result.error).toBeNull();
    expect(result.result?.errors.some((e) => e.code === "bad_email")).toBe(true);
    expect(result.result?.validRows).toBe(0);
  });

  it("flags an invalid debtor mobile as a row-level error, not a throw", async () => {
    const { validateBulkImportAction } = await import("./bulk-import");
    const csv = csvOf(validRow({ debtor_mobile: "123" }));
    const result = await validateBulkImportAction({ result: null, error: null }, fd({ csvText: csv }));
    expect(result.error).toBeNull();
    expect(result.result?.errors.some((e) => e.code === "bad_mobile")).toBe(true);
  });

  it("rejects with no session, returning a controlled state", async () => {
    authorizeStaffMutation.mockRejectedValue(new Error("no session"));
    const { validateBulkImportAction } = await import("./bulk-import");
    const result = await validateBulkImportAction(
      { result: null, error: null },
      fd({ csvText: csvOf(validRow()) }),
    );
    expect(result.result).toBeNull();
    expect(result.error).toBe("You do not have permission to perform this action.");
  });
});

describe("commitBulkImportAction", () => {
  it("commits a valid synthetic import and creates exactly one case per valid row, no throw", async () => {
    const { commitBulkImportAction } = await import("./bulk-import");
    const org = mock.ORGANISATIONS[0];
    const before = mock.CASES.length;
    const csv = csvOf(validRow(), validRow());

    const result = await commitBulkImportAction(
      { result: null, error: null },
      fd({ organisationId: org.id, csvText: csv }),
    );
    expect(result.error).toBeNull();
    expect(result.result?.casesCreated).toBe(2);
    expect(mock.CASES.length).toBe(before + 2);
    // No cross-org contamination: every newly created case belongs to the
    // organisation the commit was submitted for.
    const created = mock.CASES.slice(before);
    expect(created.every((c) => c.organisationId === org.id)).toBe(true);
  });

  it("skips duplicate/error rows and commits only the valid ones (valid-rows-only semantics)", async () => {
    const { commitBulkImportAction } = await import("./bulk-import");
    const org = mock.ORGANISATIONS[0];
    const before = mock.CASES.length;
    const shared = "INV-DUP-TEST-1";
    const csv = csvOf(
      validRow({ invoice_number: shared }),
      validRow({ invoice_number: shared }), // duplicate within the same batch
      validRow({ taxable_value: "not-a-number" }), // row-level error
    );

    const result = await commitBulkImportAction(
      { result: null, error: null },
      fd({ organisationId: org.id, csvText: csv }),
    );
    expect(result.error).toBeNull();
    expect(result.result?.casesCreated).toBe(1);
    expect(result.result?.result.duplicateRows).toBe(1);
    expect(result.result?.result.errorRows).toBe(1);
    expect(mock.CASES.length).toBe(before + 1);
  });

  it("commits nothing and reports zero valid rows for an all-invalid file", async () => {
    const { commitBulkImportAction } = await import("./bulk-import");
    const org = mock.ORGANISATIONS[0];
    const before = mock.CASES.length;
    const csv = csvOf(validRow({ debtor_name: "" }));

    const result = await commitBulkImportAction(
      { result: null, error: null },
      fd({ organisationId: org.id, csvText: csv }),
    );
    expect(result.error).toBeNull();
    expect(result.result?.casesCreated).toBe(0);
    expect(mock.CASES.length).toBe(before);
  });

  it("rejects an unknown organisation with a controlled error, no case created", async () => {
    const { commitBulkImportAction } = await import("./bulk-import");
    const before = mock.CASES.length;
    const result = await commitBulkImportAction(
      { result: null, error: null },
      fd({ organisationId: "00000000-0000-0000-0000-000000000000", csvText: csvOf(validRow()) }),
    );
    expect(result.result).toBeNull();
    expect(result.error).toBeTruthy();
    expect(mock.CASES.length).toBe(before);
  });

  it("rejects a missing organisationId before authorization", async () => {
    const { commitBulkImportAction } = await import("./bulk-import");
    const result = await commitBulkImportAction(
      { result: null, error: null },
      fd({ organisationId: "", csvText: csvOf(validRow()) }),
    );
    expect(result.result).toBeNull();
    expect(result.error).toBe("Missing organisation.");
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });

  it("rejects an empty csvText before authorization", async () => {
    const { commitBulkImportAction } = await import("./bulk-import");
    const org = mock.ORGANISATIONS[0];
    const result = await commitBulkImportAction(
      { result: null, error: null },
      fd({ organisationId: org.id, csvText: "" }),
    );
    expect(result.result).toBeNull();
    expect(result.error).toBe("No file loaded to commit.");
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });

  it("rejects with no session and never commits any row -- a browser-supplied organisationId alone cannot create cases in any tenant", async () => {
    authorizeStaffMutation.mockRejectedValue(new Error("no session"));
    const { commitBulkImportAction } = await import("./bulk-import");
    const org = mock.ORGANISATIONS[0];
    const before = mock.CASES.length;
    const result = await commitBulkImportAction(
      { result: null, error: null },
      fd({ organisationId: org.id, csvText: csvOf(validRow()) }),
    );
    expect(result.result).toBeNull();
    expect(result.error).toBe("You do not have permission to perform this action.");
    expect(mock.CASES.length).toBe(before);
  });
});
