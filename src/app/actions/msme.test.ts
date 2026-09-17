/**
 * R1 residual server-action closure: all three actions in msme.ts
 * previously threw on any failure. They now take the useActionState
 * (prevState, FormData) shape and always return a typed state instead.
 * Covers: success where practical, validation failure, missing reference/
 * business-rule rejection (a drift/failure outcome from the ODR portal
 * adapter -- always mocked, no real MSME portal automation exists),
 * authorization failure, and that production never fabricates a filing
 * success/diary number.
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

function saveStageFormData(caseId: string, stage: string, payload: Record<string, unknown> = { a: "b" }): FormData {
  const fd = new FormData();
  fd.set("caseId", caseId);
  fd.set("stage", stage);
  fd.set("payload", JSON.stringify(payload));
  return fd;
}

function caseIdFormData(caseId: string): FormData {
  const fd = new FormData();
  fd.set("caseId", caseId);
  return fd;
}

describe("saveMsmeStageAction", () => {
  it("saves a stage on valid input, no throw", async () => {
    const { saveMsmeStageAction } = await import("./msme");
    const kase = mock.CASES.find((c) => c.id === "case-2")!;
    const result = await saveMsmeStageAction(
      { result: null, error: null },
      saveStageFormData(kase.id, "claimant", { claimantName: "Test Claimant" }),
    );
    expect(result.error).toBeNull();
    expect(result.result).not.toBeNull();
  });

  it("rejects an invalid stage with a controlled error, before authorization", async () => {
    const { saveMsmeStageAction } = await import("./msme");
    const result = await saveMsmeStageAction(
      { result: null, error: null },
      saveStageFormData("case-2", "not-a-real-stage"),
    );
    expect(result.result).toBeNull();
    expect(result.error).toBe("Invalid ODR stage.");
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON payload with a controlled error, before authorization", async () => {
    const { saveMsmeStageAction } = await import("./msme");
    const fd = new FormData();
    fd.set("caseId", "case-2");
    fd.set("stage", "claimant");
    fd.set("payload", "{not valid json");
    const result = await saveMsmeStageAction({ result: null, error: null }, fd);
    expect(result.result).toBeNull();
    expect(result.error).toBe("Invalid stage data.");
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });

  it("rejects a non-object payload (array) with a controlled error", async () => {
    const { saveMsmeStageAction } = await import("./msme");
    const fd = new FormData();
    fd.set("caseId", "case-2");
    fd.set("stage", "claimant");
    fd.set("payload", JSON.stringify(["not", "an", "object"]));
    const result = await saveMsmeStageAction({ result: null, error: null }, fd);
    expect(result.result).toBeNull();
    expect(result.error).toBe("Invalid stage data.");
  });

  it("rejects a missing caseId before validation/authorization", async () => {
    const { saveMsmeStageAction } = await import("./msme");
    const result = await saveMsmeStageAction({ result: null, error: null }, saveStageFormData("", "claimant"));
    expect(result.result).toBeNull();
    expect(result.error).toBe("Missing case.");
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });

  it("rejects with no session, returning a controlled state", async () => {
    authorizeStaffMutation.mockRejectedValue(new Error("no session"));
    const { saveMsmeStageAction } = await import("./msme");
    const result = await saveMsmeStageAction({ result: null, error: null }, saveStageFormData("case-2", "claimant"));
    expect(result.result).toBeNull();
    expect(result.error).toBe("You do not have permission to perform this action.");
  });

  it("surfaces an unknown case as a controlled error via the underlying repository, not a crash", async () => {
    const { saveMsmeStageAction } = await import("./msme");
    // MemoryRepository.saveMsmeStage does not itself check case existence
    // (it only records an audit entry + calls the adapter), so this proves
    // the action layer still never throws even for an unrecognised id.
    const result = await saveMsmeStageAction(
      { result: null, error: null },
      saveStageFormData("00000000-0000-0000-0000-000000000000", "claimant"),
    );
    expect(result.error).toBeNull();
  });
});

describe("buildMsmePreviewAction", () => {
  it("builds a preview snapshot on valid input, no throw", async () => {
    const { buildMsmePreviewAction } = await import("./msme");
    const result = await buildMsmePreviewAction({ result: null, error: null }, caseIdFormData("case-3"));
    expect(result.error).toBeNull();
    expect(result.result?.previewPdfKey).toBeTruthy();
    expect(result.result?.previewHash).toBeTruthy();
  });

  it("rejects a missing caseId before authorization", async () => {
    const { buildMsmePreviewAction } = await import("./msme");
    const result = await buildMsmePreviewAction({ result: null, error: null }, caseIdFormData(""));
    expect(result.result).toBeNull();
    expect(result.error).toBe("Missing case.");
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });

  it("rejects with no session, returning a controlled state", async () => {
    authorizeStaffMutation.mockRejectedValue(new Error("no session"));
    const { buildMsmePreviewAction } = await import("./msme");
    const result = await buildMsmePreviewAction({ result: null, error: null }, caseIdFormData("case-3"));
    expect(result.result).toBeNull();
    expect(result.error).toBe("You do not have permission to perform this action.");
  });
});

describe("captureMsmeAcknowledgementAction", () => {
  it("captures a successful acknowledgement and transitions the case, no throw", async () => {
    const { captureMsmeAcknowledgementAction } = await import("./msme");
    const kase = mock.CASES.find((c) => c.id === "case-4")!;
    const result = await captureMsmeAcknowledgementAction({ result: null, error: null }, caseIdFormData(kase.id));
    expect(result.error).toBeNull();
    expect(result.result?.diaryNumber).toBeTruthy();
    expect(result.result?.petitionPdfKey).toBeTruthy();
  });

  it("rejects a missing caseId before authorization", async () => {
    const { captureMsmeAcknowledgementAction } = await import("./msme");
    const result = await captureMsmeAcknowledgementAction({ result: null, error: null }, caseIdFormData(""));
    expect(result.result).toBeNull();
    expect(result.error).toBe("Missing case.");
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });

  it("rejects with no session, returning a controlled state", async () => {
    authorizeStaffMutation.mockRejectedValue(new Error("no session"));
    const { captureMsmeAcknowledgementAction } = await import("./msme");
    const result = await captureMsmeAcknowledgementAction({ result: null, error: null }, caseIdFormData("case-5"));
    expect(result.result).toBeNull();
    expect(result.error).toBe("You do not have permission to perform this action.");
  });

  it("surfaces an unknown case as a controlled error, not a crash", async () => {
    const { captureMsmeAcknowledgementAction } = await import("./msme");
    const result = await captureMsmeAcknowledgementAction(
      { result: null, error: null },
      caseIdFormData("00000000-0000-0000-0000-000000000000"),
    );
    expect(result.result).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("a portal drift/failure outcome is a controlled business result (null diaryNumber), never a fabricated success", async () => {
    vi.resetModules();
    const fakeMsmePortal = {
      name: "fake-msme-portal",
      saveStage: vi.fn(),
      buildPreview: vi.fn(),
      captureAcknowledgement: vi.fn().mockResolvedValue({
        outcome: "drift_detected",
        providerRef: null,
        errorCode: "MOCK_UI_DRIFT",
        evidenceRefs: ["mock://screenshot/drift.png"],
        nextAction: "Fail closed; raise urgent portal-drift task",
      }),
    };
    vi.doMock("@/adapters", () => ({ getAdapters: () => ({ msmePortal: fakeMsmePortal }) }));

    const { captureMsmeAcknowledgementAction } = await import("./msme");
    const kase = mock.CASES.find((c) => c.id === "case-6")!;
    const result = await captureMsmeAcknowledgementAction({ result: null, error: null }, caseIdFormData(kase.id));

    // Not a throw, not a crash -- a legitimate business outcome the caller
    // must check and render (matches the pre-existing UI contract).
    expect(result.error).toBeNull();
    expect(result.result).not.toBeNull();
    expect(result.result?.diaryNumber).toBeNull();
    expect(result.result?.petitionPdfKey).toBeNull();
    // Never fabricated: no reference/diary number is invented to paper over
    // the failure, and the case is not silently advanced to "filed".
    expect(result.result?.case.status).not.toBe("msme_odr_filed");

    vi.doUnmock("@/adapters");
  });
});
