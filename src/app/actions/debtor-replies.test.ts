/**
 * Authorization + server-action hardening task, #16: recordDebtorReplyAction
 * previously threw on any failure. It now takes the useActionState
 * (prevState, FormData) shape and always returns a typed state instead.
 * Covers: happy path, validation failure (server-side, independent of the
 * browser's own <select>/`required` convenience), authorization failure,
 * and an unknown case id -- without changing the accepted manual-
 * classification V1 design (no AI classification is wired in this build).
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

function replyFormData(
  caseId: string,
  fields: Partial<{ channel: string; rawBody: string; communicationId: string; classification: string }> = {},
): FormData {
  const fd = new FormData();
  fd.set("caseId", caseId);
  fd.set("channel", fields.channel ?? "whatsapp");
  fd.set("rawBody", fields.rawBody ?? "Test reply body");
  fd.set("communicationId", fields.communicationId ?? "");
  fd.set("classification", fields.classification ?? "unclear");
  return fd;
}

beforeEach(() => {
  authorizeStaffMutation.mockReset();
  authorizeStaffMutation.mockResolvedValue(STAFF);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("recordDebtorReplyAction", () => {
  it("records a reply on a valid submission and returns the updated case, not a throw", async () => {
    const { recordDebtorReplyAction } = await import("./debtor-replies");
    const kase = mock.CASES.find((c) => c.status === "initial_communication_sent")!;
    const before = mock.DEBTOR_REPLIES.length;

    const result = await recordDebtorReplyAction(
      { result: null, error: null },
      replyFormData(kase.id, { classification: "promise_to_pay" }),
    );

    expect(result.error).toBeNull();
    expect(result.result?.replyId).toBeTruthy();
    expect(mock.DEBTOR_REPLIES.length).toBe(before + 1);
  });

  it("rejects an empty reply body with a controlled error, no reply recorded", async () => {
    const { recordDebtorReplyAction } = await import("./debtor-replies");
    const kase = mock.CASES[0];
    const before = mock.DEBTOR_REPLIES.length;

    const result = await recordDebtorReplyAction(
      { result: null, error: null },
      replyFormData(kase.id, { rawBody: "   " }),
    );

    expect(result.result).toBeNull();
    expect(result.error).toBeTruthy();
    expect(mock.DEBTOR_REPLIES.length).toBe(before);
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });

  it("rejects an invalid classification value with a controlled error", async () => {
    const { recordDebtorReplyAction } = await import("./debtor-replies");
    const kase = mock.CASES[0];

    const result = await recordDebtorReplyAction(
      { result: null, error: null },
      replyFormData(kase.id, { classification: "not-a-real-classification" }),
    );

    expect(result.result).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("rejects with no session and never records the reply", async () => {
    authorizeStaffMutation.mockRejectedValue(new Error("no session"));
    const { recordDebtorReplyAction } = await import("./debtor-replies");
    const kase = mock.CASES[0];
    const before = mock.DEBTOR_REPLIES.length;

    const result = await recordDebtorReplyAction({ result: null, error: null }, replyFormData(kase.id));
    expect(result.result).toBeNull();
    expect(result.error).toBe("You do not have permission to perform this action.");
    expect(mock.DEBTOR_REPLIES.length).toBe(before);
  });

  it("rejects a missing caseId before validation/authorization", async () => {
    const { recordDebtorReplyAction } = await import("./debtor-replies");
    const result = await recordDebtorReplyAction({ result: null, error: null }, replyFormData(""));
    expect(result.result).toBeNull();
    expect(result.error).toBe("Missing case.");
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });

  it("surfaces an unknown case as a controlled error, not a crash", async () => {
    const { recordDebtorReplyAction } = await import("./debtor-replies");
    const result = await recordDebtorReplyAction(
      { result: null, error: null },
      replyFormData("00000000-0000-0000-0000-000000000000"),
    );
    expect(result.result).toBeNull();
    expect(result.error).toBeTruthy();
  });
});
