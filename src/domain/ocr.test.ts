import { describe, expect, it } from "vitest";
import { applyOcrCorrected } from "./ocr";
import type { RecoveryCase } from "@/contract/types";

const correctionCase: RecoveryCase = {
  id: "case-4",
  organisationId: "org-2",
  debtorId: "deb-4",
  status: "correction_required",
  automationMode: "manual",
  waitingOn: "staff",
  automationStartedAt: "2026-09-09T05:30:00.000Z",
  currentStep: "OCR extraction below confidence threshold",
  blocker: "Invoice total and tax amount could not be read — needs manual entry",
  nextScheduledAction: "Staff validation of extracted invoice fields",
  nextScheduledAt: null,
  eligibilityRoute: null,
  principalOutstanding: 12_30_000,
  recoveredToDate: 0,
  assigneeId: "user-2",
  groupKey: null,
  createdAt: "2026-09-09T05:30:00.000Z",
  activatedAt: null,
  closedAt: null,
};

describe("applyOcrCorrected: confirming the fields is ONLY the staff-validation gate", () => {
  it("activates when the other two gates (client certification, 60-day age) already hold", () => {
    const out = applyOcrCorrected(correctionCase, { clientCertified: true, ageGatePassed: true, missing: [] });
    expect(out.activated).toBe(true);
    expect(out.updatedCase.status).toBe("active");
    expect(out.updatedCase.blocker).toBeNull();
    expect(out.updatedCase.waitingOn).toBe("system");
    expect(out.updatedCase.nextScheduledAction).toMatch(/reminder/i);
  });

  it("does NOT activate without client certification: waits in under_validation on the client", () => {
    const out = applyOcrCorrected(correctionCase, { clientCertified: false, ageGatePassed: true, missing: ["client certification"] });
    expect(out.activated).toBe(false);
    expect(out.updatedCase.status).toBe("under_validation");
    expect(out.updatedCase.waitingOn).toBe("client");
    expect(out.updatedCase.blocker).toMatch(/client certification/);
    expect(out.updatedCase.blocker).not.toMatch(/staff validation/);
  });

  it("does NOT activate before the 60-day age gate", () => {
    const out = applyOcrCorrected(correctionCase, { clientCertified: true, ageGatePassed: false, missing: ["60-day age gate"] });
    expect(out.activated).toBe(false);
    expect(out.updatedCase.status).toBe("under_validation");
    expect(out.updatedCase.blocker).toMatch(/60-day age gate/);
  });

  it("never resets a case that has already moved past activation", () => {
    const later = { ...correctionCase, status: "initial_communication_sent" as const };
    const out = applyOcrCorrected(later, { clientCertified: false, ageGatePassed: false, missing: ["client certification", "60-day age gate"] });
    expect(out.updatedCase.status).toBe("initial_communication_sent");
    expect(out.activated).toBe(false);
  });
});
