/**
 * Authorization + server-action hardening task, #10: resolveWorkflowTaskAction
 * and correctInvoiceOcrAction previously threw on any failure. Both now take
 * the useActionState (prevState, FormData) shape and always return a typed
 * state instead. Covers success and validation failure for each (their
 * authorization-failure paths are already covered in security.test.ts).
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

beforeEach(() => {
  authorizeStaffMutation.mockReset();
  authorizeStaffMutation.mockResolvedValue(STAFF);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveWorkflowTaskAction", () => {
  it("resolves a task on valid input, no throw", async () => {
    const { resolveWorkflowTaskAction } = await import("./tasks");
    const task = mock.raiseTaskIfNotOpen({
      caseId: null,
      organisationId: mock.ORGANISATIONS[0].id,
      type: "policy_gate",
      title: "resolve-test task",
      waitingOn: "staff",
      assigneeId: null,
      urgent: false,
      dueAt: null,
    });

    const fd = new FormData();
    fd.set("taskId", task.id);
    fd.set("reason", "Marked done by staff");
    const result = await resolveWorkflowTaskAction({ result: null, error: null }, fd);
    expect(result.error).toBeNull();
    expect(result.result?.resolvedAt).toBeTruthy();
  });

  it("rejects a missing taskId before authorization", async () => {
    const { resolveWorkflowTaskAction } = await import("./tasks");
    const fd = new FormData();
    fd.set("reason", "no task id");
    const result = await resolveWorkflowTaskAction({ result: null, error: null }, fd);
    expect(result.result).toBeNull();
    expect(result.error).toBe("Missing task.");
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });
});

describe("correctInvoiceOcrAction", () => {
  it("saves corrected fields on valid input, no throw", async () => {
    const { correctInvoiceOcrAction } = await import("./ocr");
    const kase = mock.CASES.find((c) => mock.listInvoicesForCase(c.id).length > 0)!;
    const invoice = mock.listInvoicesForCase(kase.id)[0];

    const fd = new FormData();
    fd.set("caseId", kase.id);
    fd.set("invoiceId", invoice.id);
    fd.set("invoiceNumber", "CORRECTED-001");
    fd.set("taxableValue", String(invoice.taxableValue / 100));
    fd.set("taxAmount", String(invoice.taxAmount / 100));
    fd.set("invoiceTotal", String(invoice.invoiceTotal / 100));
    fd.set("outstandingBalance", String(invoice.outstandingBalance / 100));
    const result = await correctInvoiceOcrAction({ result: null, error: null }, fd);
    expect(result.error).toBeNull();
    expect(result.result?.invoice.invoiceNumber).toBe("CORRECTED-001");
  });

  it("rejects a malformed amount with a controlled error, before authorization", async () => {
    const { correctInvoiceOcrAction } = await import("./ocr");
    const kase = mock.CASES.find((c) => mock.listInvoicesForCase(c.id).length > 0)!;
    const invoice = mock.listInvoicesForCase(kase.id)[0];

    const fd = new FormData();
    fd.set("caseId", kase.id);
    fd.set("invoiceId", invoice.id);
    fd.set("invoiceNumber", "CORRECTED-002");
    fd.set("taxableValue", "not-a-number");
    fd.set("taxAmount", String(invoice.taxAmount / 100));
    fd.set("invoiceTotal", String(invoice.invoiceTotal / 100));
    fd.set("outstandingBalance", String(invoice.outstandingBalance / 100));
    const result = await correctInvoiceOcrAction({ result: null, error: null }, fd);
    expect(result.result).toBeNull();
    expect(result.error).toBe("Check invoice number and amount fields before confirming.");
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });

  it("rejects a missing caseId/invoiceId before validation", async () => {
    const { correctInvoiceOcrAction } = await import("./ocr");
    const fd = new FormData();
    const result = await correctInvoiceOcrAction({ result: null, error: null }, fd);
    expect(result.result).toBeNull();
    expect(result.error).toBe("Missing case or invoice.");
  });
});
