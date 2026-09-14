import { describe, expect, it } from "vitest";
import { applyDdPrepared, applyHearingAdjourned, applyHearingOutcome, applyHearingScheduled } from "./hearing";
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

  it("adjourns a scheduled hearing, then accepts a reschedule back to hearing_scheduled", () => {
    const scheduledCase = applyHearingScheduled(filedCase, new Date("2026-10-01T05:00:00.000Z")).updatedCase;
    const { updatedCase: adjourned } = applyHearingAdjourned(scheduledCase);
    expect(adjourned.status).toBe("adjourned");
    expect(adjourned.blocker).toMatch(/adjourned/i);

    const rescheduled = applyHearingScheduled(adjourned, new Date("2026-11-01T05:00:00.000Z"));
    expect(rescheduled.updatedCase.status).toBe("hearing_scheduled");
    expect(rescheduled.updatedCase.nextScheduledAt).toBe("2026-11-01T05:00:00.000Z");
  });

  it("records a recovered hearing outcome as 'recovered', and an against outcome as 'closed'", () => {
    const scheduledCase = applyHearingScheduled(filedCase, new Date("2026-10-01T05:00:00.000Z")).updatedCase;

    const won = applyHearingOutcome(scheduledCase, true);
    expect(won.updatedCase.status).toBe("recovered");

    const lost = applyHearingOutcome(scheduledCase, false);
    expect(lost.updatedCase.status).toBe("closed");
  });

  it("also records an outcome directly from adjourned (hearing never resumed)", () => {
    const scheduledCase = applyHearingScheduled(filedCase, new Date("2026-10-01T05:00:00.000Z")).updatedCase;
    const adjourned = applyHearingAdjourned(scheduledCase).updatedCase;
    const { updatedCase } = applyHearingOutcome(adjourned, false);
    expect(updatedCase.status).toBe("closed");
  });
});
