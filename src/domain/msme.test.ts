import { describe, expect, it } from "vitest";
import { applyMsmeAutomationFailed, applyMsmeFiled, applyMsmeIneligible } from "./msme";
import type { RecoveryCase } from "@/contract/types";

const reviewCase: RecoveryCase = {
  id: "case-12",
  organisationId: "org-2",
  debtorId: "deb-4",
  status: "msme_eligibility_review",
  automationMode: "assist",
  waitingOn: "staff",
  automationStartedAt: "2026-08-15T05:30:00.000Z",
  currentStep: "Confirm creditor Udyam / MSME eligibility",
  blocker: "Confirm creditor Udyam / MSME eligibility",
  nextScheduledAction: "Decide MSME route",
  nextScheduledAt: null,
  eligibilityRoute: null,
  principalOutstanding: 20_00_000,
  recoveredToDate: 0,
  assigneeId: "user-1",
  groupKey: null,
  createdAt: "2026-08-01T05:30:00.000Z",
  activatedAt: "2026-08-02T05:30:00.000Z",
  closedAt: null,
};

describe("MSME workflow bridge", () => {
  it("moves msme_eligibility_review -> msme_odr_filed on acknowledged submission", () => {
    const { updatedCase } = applyMsmeFiled(reviewCase);
    expect(updatedCase.status).toBe("msme_odr_filed");
    expect(updatedCase.eligibilityRoute).toBe("msme");
    expect(updatedCase.waitingOn).toBe("portal");
    expect(updatedCase.blocker).toBeNull();
  });

  it("routes to manual legal handling when not MSME eligible", () => {
    const { updatedCase } = applyMsmeIneligible(reviewCase);
    expect(updatedCase.status).toBe("dispute_settlement");
    expect(updatedCase.eligibilityRoute).toBe("non_msme_manual");
  });

  it("fails closed on portal drift / permanent failure", () => {
    const { updatedCase } = applyMsmeAutomationFailed(reviewCase, "MSME portal UI drift detected");
    expect(updatedCase.status).toBe("automation_failed");
    expect(updatedCase.waitingOn).toBe("staff");
  });
});
