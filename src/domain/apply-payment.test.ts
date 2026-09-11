import { describe, expect, it } from "vitest";
import { applyConfirmedPayment } from "./apply-payment";
import type { RecoveryCase } from "@/contract/types";

const baseCase: RecoveryCase = {
  id: "case-1",
  organisationId: "org-1",
  debtorId: "deb-1",
  status: "initial_communication_sent",
  automationMode: "assist",
  waitingOn: "system",
  automationStartedAt: "2026-09-01T05:30:00.000Z",
  currentStep: "24-hour response timer running",
  blocker: null,
  nextScheduledAction: "Evaluate GST eligibility route",
  nextScheduledAt: null,
  eligibilityRoute: null,
  principalOutstanding: 100_000_00,
  recoveredToDate: 0,
  assigneeId: null,
  groupKey: null,
  createdAt: "2026-08-25T05:30:00.000Z",
  activatedAt: "2026-08-26T05:30:00.000Z",
  closedAt: null,
};

const invoices = [
  { id: "inv-1", invoiceDate: "2026-06-01", outstandingBalance: 100_000_00 },
];

describe("applyConfirmedPayment", () => {
  it("partial payment reduces principal but keeps the case escalating", () => {
    const res = applyConfirmedPayment(baseCase, invoices, 40_000_00);
    expect(res.updatedCase.principalOutstanding).toBe(60_000_00);
    expect(res.updatedCase.recoveredToDate).toBe(40_000_00);
    expect(res.updatedCase.status).toBe("payment_confirmation_required");
    expect(res.updatedCase.closedAt).toBeNull();
    expect(res.invoiceAllocations).toEqual([{ invoiceId: "inv-1", applied: 40_000_00, balanceAfter: 60_000_00 }]);
  });

  it("full payment recovers the case and cancels escalation, regardless of prior status", () => {
    const res = applyConfirmedPayment(
      { ...baseCase, status: "gst_notification_filed", waitingOn: "portal" },
      invoices,
      100_000_00,
    );
    expect(res.updatedCase.status).toBe("recovered");
    expect(res.updatedCase.principalOutstanding).toBe(0);
    expect(res.updatedCase.recoveredToDate).toBe(100_000_00);
    expect(res.updatedCase.closedAt).not.toBeNull();
  });

  it("a payment across two invoices allocates oldest first and reports no surplus", () => {
    const res = applyConfirmedPayment(
      { ...baseCase, principalOutstanding: 150_000_00 },
      [
        { id: "b", invoiceDate: "2026-03-01", outstandingBalance: 100_000_00 },
        { id: "a", invoiceDate: "2026-01-01", outstandingBalance: 50_000_00 },
      ],
      120_000_00,
    );
    expect(res.invoiceAllocations.map((a) => a.invoiceId)).toEqual(["a", "b"]);
    expect(res.unapplied).toBe(0);
    expect(res.updatedCase.principalOutstanding).toBe(30_000_00);
  });

  it("reports unapplied surplus without going negative on principal", () => {
    const res = applyConfirmedPayment(baseCase, invoices, 250_000_00);
    expect(res.unapplied).toBe(150_000_00);
    expect(res.updatedCase.principalOutstanding).toBe(0);
    expect(res.updatedCase.status).toBe("recovered");
  });

  it("degrades to applying against the case balance when no invoice rows exist", () => {
    const res = applyConfirmedPayment(baseCase, [], 100_000_00);
    expect(res.invoiceAllocations).toEqual([]);
    expect(res.unapplied).toBe(0);
    expect(res.updatedCase.principalOutstanding).toBe(0);
    expect(res.updatedCase.status).toBe("recovered");
  });
});
