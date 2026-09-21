import { describe, expect, it } from "vitest";
import type { RecoveryCase } from "@/contract/types";
import { PROMISE_ALLOWED_STATUSES, applyPromiseRecorded, validatePromiseDate } from "./promise";

// 19 Sep 2026, 11:30 IST.
const NOW = new Date("2026-09-19T06:00:00Z");
const kase = (status: RecoveryCase["status"]): RecoveryCase =>
  ({
    id: "c1", organisationId: "o1", debtorId: "d1", status, automationMode: "assist", waitingOn: "system", automationStartedAt: null,
    currentStep: "", blocker: null, nextScheduledAction: null, nextScheduledAt: "2026-09-19T00:00:00Z", eligibilityRoute: null,
    principalOutstanding: 100_000_00, recoveredToDate: 0, assigneeId: null, groupKey: null, createdAt: "2026-09-01T00:00:00Z",
    activatedAt: null, closedAt: null,
  }) as RecoveryCase;

describe("validatePromiseDate (IST)", () => {
  it("accepts today and up to 180 days ahead", () => {
    expect(validatePromiseDate("2026-09-19", NOW)).toBeNull();
    expect(validatePromiseDate("2026-09-25", NOW)).toBeNull();
    expect(validatePromiseDate("2027-03-18", NOW)).toBeNull();
  });
  it("rejects yesterday and dates beyond 180 days", () => {
    expect(validatePromiseDate("2026-09-18", NOW)).toMatch(/in the past/);
    expect(validatePromiseDate("2027-03-20", NOW)).toMatch(/within 180 days/);
  });
  it("uses the IST calendar day: 23:30 UTC on the 18th is already the 19th in India", () => {
    const lateUtc = new Date("2026-09-18T23:30:00Z");
    expect(validatePromiseDate("2026-09-19", lateUtc)).toBeNull();
    expect(validatePromiseDate("2026-09-18", lateUtc)).toMatch(/in the past/);
  });
});

describe("applyPromiseRecorded", () => {
  it("moves a waiting case to promise_to_pay and schedules the reminder for 11:00 IST on the promised date", () => {
    for (const status of PROMISE_ALLOWED_STATUSES) {
      const r = applyPromiseRecorded(kase(status), "2026-09-25");
      expect(r.updatedCase.status, status).toBe("promise_to_pay");
      expect(r.updatedCase.nextScheduledAt).toBe("2026-09-25T05:30:00.000Z"); // 11:00 IST = 05:30 UTC
      expect(r.note).toContain("2026-09-25");
    }
  });

  it("re-recording while already in promise_to_pay just moves the scheduled date", () => {
    const r = applyPromiseRecorded(kase("promise_to_pay"), "2026-10-02");
    expect(r.updatedCase.status).toBe("promise_to_pay");
    expect(r.updatedCase.nextScheduledAt).toBe("2026-10-02T05:30:00.000Z");
  });

  it("refuses any other stage with a controlled message", () => {
    for (const status of ["active", "gst_eligibility_review", "recovered", "closed", "dispute_settlement"] as const) {
      expect(() => applyPromiseRecorded(kase(status), "2026-09-25"), status).toThrow(/only be recorded while awaiting the debtor's response/);
    }
  });
});
