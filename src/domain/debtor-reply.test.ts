import { describe, expect, it } from "vitest";
import { applyReplyClassified } from "./debtor-reply";
import type { RecoveryCase } from "@/contract/types";

const activeCase: RecoveryCase = {
  id: "case-1",
  organisationId: "org-1",
  debtorId: "deb-1",
  status: "initial_communication_sent",
  automationMode: "assist",
  waitingOn: "system",
  automationStartedAt: "2026-08-01T05:30:00.000Z",
  currentStep: "24-hour response timer running",
  blocker: null,
  nextScheduledAction: "Evaluate GST eligibility route",
  nextScheduledAt: null,
  eligibilityRoute: null,
  principalOutstanding: 184_50_000,
  recoveredToDate: 0,
  assigneeId: "user-1",
  groupKey: null,
  createdAt: "2026-07-24T05:30:00.000Z",
  activatedAt: "2026-07-26T05:30:00.000Z",
  closedAt: null,
};

describe("applyReplyClassified", () => {
  it("payment_made -> payment_confirmation_required", () => {
    const { updatedCase } = applyReplyClassified(activeCase, "payment_made");
    expect(updatedCase.status).toBe("payment_confirmation_required");
    expect(updatedCase.waitingOn).toBe("client");
  });

  it("dispute -> dispute_settlement, staff-waiting", () => {
    const { updatedCase } = applyReplyClassified(activeCase, "dispute");
    expect(updatedCase.status).toBe("dispute_settlement");
    expect(updatedCase.waitingOn).toBe("staff");
  });

  it("promise_to_pay -> promise_to_pay, system-tracked", () => {
    const { updatedCase } = applyReplyClassified(activeCase, "promise_to_pay");
    expect(updatedCase.status).toBe("promise_to_pay");
    expect(updatedCase.waitingOn).toBe("system");
  });

  it("unclear -> stays in place, staff review flagged", () => {
    const { updatedCase } = applyReplyClassified(activeCase, "unclear");
    expect(updatedCase.status).toBe(activeCase.status);
    expect(updatedCase.waitingOn).toBe("staff");
  });
});
