import { describe, expect, it } from "vitest";
import { applyGstAutomationFailed, applyGstFiled, applyGstPrepared } from "./gst";
import type { RecoveryCase } from "@/contract/types";

const reviewCase: RecoveryCase = {
  id: "case-11",
  organisationId: "org-1",
  debtorId: "deb-2",
  status: "gst_eligibility_review",
  automationMode: "assist",
  waitingOn: "staff",
  automationStartedAt: "2026-09-01T05:30:00.000Z",
  currentStep: "Confirm creditor + debtor GST registration",
  blocker: null,
  nextScheduledAction: "Decide GST route",
  nextScheduledAt: null,
  eligibilityRoute: null,
  principalOutstanding: 42_00_000,
  recoveredToDate: 0,
  assigneeId: "user-2",
  groupKey: null,
  createdAt: "2026-08-20T05:30:00.000Z",
  activatedAt: "2026-08-21T05:30:00.000Z",
  closedAt: null,
};

describe("GST workflow bridge", () => {
  it("moves gst_eligibility_review -> gst_notification_prepared", () => {
    const { updatedCase } = applyGstPrepared(reviewCase);
    expect(updatedCase.status).toBe("gst_notification_prepared");
    expect(updatedCase.eligibilityRoute).toBe("gst");
  });

  it("starts the 7-day timer only once Send + reference are captured", () => {
    const prepared = applyGstPrepared(reviewCase).updatedCase;
    const filedAt = new Date("2026-09-05T05:30:00.000Z");
    const { updatedCase } = applyGstFiled(prepared, filedAt);
    expect(updatedCase.status).toBe("gst_notification_filed");
    expect(updatedCase.nextScheduledAt).toBe("2026-09-12T05:30:00.000Z");
  });

  it("fails closed on portal drift with an urgent-task-shaped transition", () => {
    const prepared = applyGstPrepared(reviewCase).updatedCase;
    const { updatedCase, note } = applyGstAutomationFailed(prepared, "GST portal UI drift detected");
    expect(updatedCase.status).toBe("automation_failed");
    expect(updatedCase.waitingOn).toBe("staff");
    expect(updatedCase.nextScheduledAt).toBeNull();
    expect(note).toContain("drift");
  });
});
