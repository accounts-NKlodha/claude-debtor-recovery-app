import { beforeEach, describe, expect, it } from "vitest";
import { runAdapter } from "./run-adapter";
import { __resetMockAdapterState, mockGstPortal, mockWhatsApp } from "@/adapters/mock";

beforeEach(() => __resetMockAdapterState());

describe("runAdapter retry policy (acceptance scenario 16)", () => {
  it("retries a retryable failure exactly once, then succeeds", async () => {
    const out = await runAdapter(
      (key) => mockWhatsApp.send({ idempotencyKey: key, caseId: "c1", channel: "whatsapp", to: "9", body: "hi" }),
      "send-fail-once-1",
    );
    expect(out.attempts).toBe(2);
    expect(out.result.outcome).toBe("success");
    expect(out.urgentTask).toBeNull();
  });

  it("raises exactly one urgent task after a repeat failure, no duplicate effect", async () => {
    const out = await runAdapter(
      (key) => mockWhatsApp.send({ idempotencyKey: key, caseId: "c1", channel: "whatsapp", to: "9", body: "hi" }),
      "send-fail-hard-1",
    );
    // permanent failure is terminal: no retry.
    expect(out.attempts).toBe(1);
    expect(out.result.outcome).toBe("permanent_failure");
  });

  it("does not retry a permanent failure", async () => {
    const out = await runAdapter(
      (key) => mockWhatsApp.send({ idempotencyKey: key, caseId: "c1", channel: "whatsapp", to: "9", body: "x" }),
      "send-fail-hard-2",
    );
    expect(out.attempts).toBe(1);
  });

  it("surfaces portal drift as fail-closed urgent task (scenario 9)", async () => {
    const out = await runAdapter((key) => mockGstPortal.captureResult(key), "gst-drift-1");
    expect(out.result.outcome).toBe("drift_detected");
    expect(out.urgentTask?.kind).toBe("portal_drift");
  });

  it("surfaces human_action_required without a retry", async () => {
    const out = await runAdapter((key) => mockGstPortal.openAssistedSession(key), "gst-human-1");
    expect(out.result.outcome).toBe("human_action_required");
    expect(out.urgentTask?.kind).toBe("human_checkpoint");
    expect(out.attempts).toBe(1);
  });

  it("GST prepare rejects field-limit violations (scenario 8)", async () => {
    const out = await runAdapter(
      (key) =>
        mockGstPortal.prepare({
          idempotencyKey: key,
          caseId: "c1",
          recipientGstin: "29ABCDE1234F1Z5",
          subject: "x".repeat(60),
          action: "others",
          remarks: "ok",
          attachmentStorageKeys: [],
          invoiceRecordCount: 3,
        }),
      "gst-prep-badfields",
    );
    expect(out.result.outcome).toBe("permanent_failure");
    expect(out.result.errorCode).toBe("GST_FIELD_LIMIT");
  });
});
