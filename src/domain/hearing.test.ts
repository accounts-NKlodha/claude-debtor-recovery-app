import { describe, expect, it } from "vitest";
import { applyDdPrepared, applyHearingScheduled } from "./hearing";
import type { RecoveryCase } from "@/contract/types";

const filedCase: RecoveryCase = {
  id: "case-7",
  organisationId: "org-4",
  debtorId: "deb-6",
  status: "msme_odr_filed",
  automationMode: "assist",
  waitingOn: "portal",
  automationStartedAt: "2026-07-20T05:30:00.000Z",
  currentStep: "MSME ODR filed — awaiting MSEFC listing",
  blocker: null,
  nextScheduledAction: "Poll MSEFC portal for hearing date",
  nextScheduledAt: null,
  eligibilityRoute: "msme",
  principalOutstanding: 58_20_000,
  recoveredToDate: 0,
  assigneeId: "user-1",
  groupKey: null,
  createdAt: "2026-07-12T05:30:00.000Z",
  activatedAt: "2026-07-20T05:30:00.000Z",
  closedAt: null,
};

describe("DD / hearing workflow bridge", () => {
  it("moves msme_odr_filed -> msefc_dd and raises a client-waiting DD task", () => {
    const { updatedCase } = applyDdPrepared(filedCase);
    expect(updatedCase.status).toBe("msefc_dd");
    expect(updatedCase.waitingOn).toBe("client");
    expect(updatedCase.blocker).toMatch(/demand draft/i);
  });

  it("schedules a hearing directly from msme_odr_filed", () => {
    const startsAt = new Date("2026-10-01T05:00:00.000Z");
    const { updatedCase } = applyHearingScheduled(filedCase, startsAt);
    expect(updatedCase.status).toBe("hearing_scheduled");
    expect(updatedCase.nextScheduledAt).toBe(startsAt.toISOString());
  });

  it("also schedules a hearing from msefc_dd (after DD prep)", () => {
    const ddCase = applyDdPrepared(filedCase).updatedCase;
    const startsAt = new Date("2026-10-15T05:00:00.000Z");
    const { updatedCase } = applyHearingScheduled(ddCase, startsAt);
    expect(updatedCase.status).toBe("hearing_scheduled");
    expect(updatedCase.waitingOn).toBe("portal");
  });
});
