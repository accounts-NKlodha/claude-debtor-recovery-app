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

describe("applyOcrCorrected", () => {
  it("moves a correction_required case to active once staff confirms fields", () => {
    const { updatedCase } = applyOcrCorrected(correctionCase);
    expect(updatedCase.status).toBe("active");
    expect(updatedCase.blocker).toBeNull();
    expect(updatedCase.waitingOn).toBe("system");
    expect(updatedCase.nextScheduledAction).toMatch(/reminder/i);
  });
});
