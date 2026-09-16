/**
 * Authorization + server-action hardening task, #14: createCaseFromManualInvoiceAction
 * previously threw on any failure, which crashes a directly-invoked "use
 * server" function's caller with an opaque React production error. It now
 * takes the useActionState (prevState, FormData) shape and always returns a
 * typed state instead. Covers: happy path, malformed/direct FormData
 * (server-side zod validation, independent of the browser's own
 * convenience validation), and missing organisationId.
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

function manualInvoiceFormData(
  organisationId: string,
  fields: Partial<{
    debtorName: string;
    invoiceNumber: string;
    invoiceDate: string;
    dueDate: string;
    taxableValue: string;
    taxRate: string;
    taxAmount: string;
    invoiceTotal: string;
    outstandingBalance: string;
    debtorGstin: string;
    debtorEmail: string;
    debtorMobile: string;
  }> = {},
): FormData {
  const fd = new FormData();
  fd.set("organisationId", organisationId);
  fd.set("debtorName", fields.debtorName ?? "Test Debtor");
  fd.set("invoiceNumber", fields.invoiceNumber ?? "INV-TEST-1");
  fd.set("invoiceDate", fields.invoiceDate ?? "01/06/2026");
  fd.set("dueDate", fields.dueDate ?? "");
  fd.set("taxableValue", fields.taxableValue ?? "1000");
  fd.set("taxRate", fields.taxRate ?? "18");
  fd.set("taxAmount", fields.taxAmount ?? "180");
  fd.set("invoiceTotal", fields.invoiceTotal ?? "1180");
  fd.set("outstandingBalance", fields.outstandingBalance ?? "1180");
  fd.set("debtorGstin", fields.debtorGstin ?? "");
  fd.set("debtorEmail", fields.debtorEmail ?? "");
  fd.set("debtorMobile", fields.debtorMobile ?? "");
  return fd;
}

beforeEach(() => {
  authorizeStaffMutation.mockReset();
  authorizeStaffMutation.mockResolvedValue(STAFF);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("createCaseFromManualInvoiceAction", () => {
  it("creates a draft case on a valid submission and returns its id/status, not a throw", async () => {
    const { createCaseFromManualInvoiceAction } = await import("./manual-invoice");
    const org = mock.ORGANISATIONS[0];
    const before = mock.CASES.length;

    const result = await createCaseFromManualInvoiceAction(
      { result: null, error: null },
      manualInvoiceFormData(org.id),
    );

    expect(result.error).toBeNull();
    expect(result.result?.caseId).toBeTruthy();
    expect(mock.CASES.length).toBe(before + 1);
  });

  it("rejects a malformed/direct submission (invalid amount) with a controlled error, no case created", async () => {
    const { createCaseFromManualInvoiceAction } = await import("./manual-invoice");
    const org = mock.ORGANISATIONS[0];
    const before = mock.CASES.length;

    const result = await createCaseFromManualInvoiceAction(
      { result: null, error: null },
      manualInvoiceFormData(org.id, { taxableValue: "not-a-number" }),
    );

    expect(result.result).toBeNull();
    expect(result.error).toBeTruthy();
    expect(mock.CASES.length).toBe(before);
    // Bypasses the browser's own zod validation entirely -- authorization is
    // never reached because the malformed input is rejected first.
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });

  it("rejects a missing invoiceNumber with a controlled error, no case created", async () => {
    const { createCaseFromManualInvoiceAction } = await import("./manual-invoice");
    const org = mock.ORGANISATIONS[0];
    const before = mock.CASES.length;

    const result = await createCaseFromManualInvoiceAction(
      { result: null, error: null },
      manualInvoiceFormData(org.id, { invoiceNumber: "" }),
    );

    expect(result.result).toBeNull();
    expect(result.error).toBeTruthy();
    expect(mock.CASES.length).toBe(before);
  });

  it("rejects a missing organisationId before ever touching validation/authorization", async () => {
    const { createCaseFromManualInvoiceAction } = await import("./manual-invoice");
    const result = await createCaseFromManualInvoiceAction({ result: null, error: null }, manualInvoiceFormData(""));
    expect(result.result).toBeNull();
    expect(result.error).toBe("Missing organisation.");
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });

  it("surfaces an unknown organisation as a controlled error, not a crash", async () => {
    const { createCaseFromManualInvoiceAction } = await import("./manual-invoice");
    const result = await createCaseFromManualInvoiceAction(
      { result: null, error: null },
      manualInvoiceFormData("00000000-0000-0000-0000-000000000000"),
    );
    expect(result.result).toBeNull();
    expect(result.error).toBeTruthy();
  });
});
