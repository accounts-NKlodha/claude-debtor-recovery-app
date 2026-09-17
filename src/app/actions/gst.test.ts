/**
 * R1 residual server-action closure: gst.ts was found during the required
 * full residual scan (not in the task's originally-named msme.ts/
 * bulk-import.ts scope) -- all three actions previously threw on any
 * failure, using raw positional arguments with no try/catch. They now take
 * the useActionState (prevState, FormData) shape and always return a typed
 * state instead. Covers: success where practical, validation failure,
 * missing reference (the specific bug this closes -- the R0 hardening
 * task's fix to reject a blank staffReference in production now throws
 * from inside the repository, and this action layer must catch that and
 * return a controlled state, not let it crash the client), authorization
 * failure, and that production never fabricates a filing reference.
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

function prepareFormData(caseId: string, overrides: Partial<Record<string, string>> = {}): FormData {
  const fd = new FormData();
  fd.set("caseId", caseId);
  fd.set("recipientGstin", overrides.recipientGstin ?? "27AAAAA0000A1Z5");
  fd.set("subject", overrides.subject ?? "Payment not received - Test Debtor");
  fd.set("action", overrides.action ?? "payment_not_received");
  fd.set("remarks", overrides.remarks ?? "Outstanding invoices remain unpaid.");
  fd.set("invoiceRecordCount", overrides.invoiceRecordCount ?? "3");
  fd.append("attachmentStorageKeys", "ledger.pdf");
  return fd;
}

function caseIdFormData(caseId: string): FormData {
  const fd = new FormData();
  fd.set("caseId", caseId);
  return fd;
}

function captureFormData(caseId: string, staffReference: string): FormData {
  const fd = new FormData();
  fd.set("caseId", caseId);
  fd.set("staffReference", staffReference);
  return fd;
}

describe("prepareGstNotificationAction", () => {
  it("prepares the GST pack on valid input, no throw", async () => {
    const { prepareGstNotificationAction } = await import("./gst");
    const result = await prepareGstNotificationAction({ result: null, error: null }, prepareFormData("case-11"));
    expect(result.error).toBeNull();
    expect(result.result?.case).toBeTruthy();
  });

  it("rejects a field-limit violation with a controlled error, before authorization", async () => {
    const { prepareGstNotificationAction } = await import("./gst");
    const result = await prepareGstNotificationAction(
      { result: null, error: null },
      prepareFormData("case-11", { subject: "x".repeat(51) }),
    );
    expect(result.result).toBeNull();
    expect(result.error).toBeTruthy();
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });

  it("rejects an invalid recipient GSTIN with a controlled error", async () => {
    const { prepareGstNotificationAction } = await import("./gst");
    const result = await prepareGstNotificationAction(
      { result: null, error: null },
      prepareFormData("case-11", { recipientGstin: "not-a-gstin" }),
    );
    expect(result.result).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("rejects a missing caseId before validation/authorization", async () => {
    const { prepareGstNotificationAction } = await import("./gst");
    const result = await prepareGstNotificationAction({ result: null, error: null }, prepareFormData(""));
    expect(result.result).toBeNull();
    expect(result.error).toBe("Missing case.");
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });

  it("rejects with no session, returning a controlled state", async () => {
    authorizeStaffMutation.mockRejectedValue(new Error("no session"));
    const { prepareGstNotificationAction } = await import("./gst");
    const result = await prepareGstNotificationAction({ result: null, error: null }, prepareFormData("case-11"));
    expect(result.result).toBeNull();
    expect(result.error).toBe("You do not have permission to perform this action.");
  });

  it("surfaces an unknown case as a controlled error, not a crash", async () => {
    const { prepareGstNotificationAction } = await import("./gst");
    const result = await prepareGstNotificationAction(
      { result: null, error: null },
      prepareFormData("00000000-0000-0000-0000-000000000000"),
    );
    expect(result.result).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

describe("openGstAssistedSessionAction", () => {
  it("opens the assisted session on valid input, no throw", async () => {
    const { openGstAssistedSessionAction } = await import("./gst");
    const result = await openGstAssistedSessionAction({ result: null, error: null }, caseIdFormData("case-11"));
    expect(result.error).toBeNull();
    expect(result.result).not.toBeNull();
  });

  it("rejects with no session, returning a controlled state", async () => {
    authorizeStaffMutation.mockRejectedValue(new Error("no session"));
    const { openGstAssistedSessionAction } = await import("./gst");
    const result = await openGstAssistedSessionAction({ result: null, error: null }, caseIdFormData("case-11"));
    expect(result.result).toBeNull();
    expect(result.error).toBe("You do not have permission to perform this action.");
  });
});

describe("captureGstFilingAction: no fabricated reference number in production", () => {
  // getRepo() resolves to MemoryRepository under vitest, whose
  // captureGstFiling deliberately keeps its own demo-only fallback (never
  // selected in production -- see src/server/repo.ts and the R0 hardening
  // task's supabase.gst-reference-safety.test.ts, which already proves
  // SupabaseRepository itself rejects a blank reference). What THIS action
  // layer must guarantee is different: if the repository throws that
  // rejection (exactly as SupabaseRepository does in production), the
  // action catches it and returns a controlled state instead of letting it
  // escape as an uncaught exception. Mock getRepo() to exercise that catch
  // path directly, independent of which repository implementation is live.
  it("catches a repository rejection for a blank staffReference as a controlled state -- not a throw, not a crash", async () => {
    vi.resetModules();
    const throwingRepo = {
      captureGstFiling: vi.fn().mockRejectedValue(
        new Error("captureGstFiling: a real portal reference number is required -- none was supplied."),
      ),
    };
    vi.doMock("@/server/repo", () => ({ getRepo: () => throwingRepo }));

    const { captureGstFilingAction } = await import("./gst");
    const result = await captureGstFilingAction({ result: null, error: null }, captureFormData("case-11", ""));
    expect(result.result).toBeNull();
    expect(result.error).toBeTruthy();
    expect(result.error).not.toMatch(/^Error:/); // no raw stack/class name leaked
    expect(throwingRepo.captureGstFiling).toHaveBeenCalledWith("case-11", "", STAFF);

    vi.doUnmock("@/server/repo");
    vi.resetModules();
  });

  it("MemoryRepository itself (demo-only, never selected in production) still returns without throwing for a blank reference -- confirms the action layer safely passes through either behavior", async () => {
    const { captureGstFilingAction } = await import("./gst");
    const result = await captureGstFilingAction({ result: null, error: null }, captureFormData("case-11", "   "));
    expect(result.error).toBeNull();
    expect(result.result).not.toBeNull();
  });

  it("accepts a real staff-supplied reference and uses exactly that value", async () => {
    const { captureGstFilingAction } = await import("./gst");
    const result = await captureGstFilingAction(
      { result: null, error: null },
      captureFormData("case-11", "AD0809260009999"),
    );
    expect(result.error).toBeNull();
    expect(result.result?.referenceNumber).toBe("AD0809260009999");
  });

  it("rejects a missing caseId before authorization", async () => {
    const { captureGstFilingAction } = await import("./gst");
    const result = await captureGstFilingAction({ result: null, error: null }, captureFormData("", "AD0809260009999"));
    expect(result.result).toBeNull();
    expect(result.error).toBe("Missing case.");
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });

  it("rejects with no session, returning a controlled state", async () => {
    authorizeStaffMutation.mockRejectedValue(new Error("no session"));
    const { captureGstFilingAction } = await import("./gst");
    const result = await captureGstFilingAction(
      { result: null, error: null },
      captureFormData("case-11", "AD0809260009999"),
    );
    expect(result.result).toBeNull();
    expect(result.error).toBe("You do not have permission to perform this action.");
  });

  it("surfaces an unknown case as a controlled error, not a crash", async () => {
    const { captureGstFilingAction } = await import("./gst");
    const result = await captureGstFilingAction(
      { result: null, error: null },
      captureFormData("00000000-0000-0000-0000-000000000000", "AD0809260009999"),
    );
    expect(result.result).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

describe("gst.ts regression guard: mock.CASES is untouched by the case-not-found tests", () => {
  it("never mutates any case for an unknown caseId across all three actions", async () => {
    const before = JSON.stringify(mock.CASES);
    const { prepareGstNotificationAction, openGstAssistedSessionAction, captureGstFilingAction } = await import(
      "./gst"
    );
    const bogus = "00000000-0000-0000-0000-000000000001";
    await prepareGstNotificationAction({ result: null, error: null }, prepareFormData(bogus));
    await openGstAssistedSessionAction({ result: null, error: null }, caseIdFormData(bogus));
    await captureGstFilingAction({ result: null, error: null }, captureFormData(bogus, "AD08092600011"));
    expect(JSON.stringify(mock.CASES)).toBe(before);
  });
});
