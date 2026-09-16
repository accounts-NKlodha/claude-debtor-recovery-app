/**
 * Authorization + server-action hardening task, #17: every action in
 * hearing.ts previously threw on any failure. They now take the
 * useActionState (prevState, FormData) shape and always return a typed
 * state instead. Covers: happy path, validation failure, authorization
 * failure, an unknown case/hearing, and that idempotency/terminal-state
 * handling (already enforced by the repository) still comes back as a
 * controlled no-op result rather than a crash.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as mock from "@/lib/mock-data";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const authorizeStaffMutation = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  authorizeStaffMutation: (...args: unknown[]) => authorizeStaffMutation(...args),
}));

const STAFF = { actorId: "staff-alice", actorRole: "staff" };

beforeEach(() => {
  authorizeStaffMutation.mockReset();
  authorizeStaffMutation.mockResolvedValue(STAFF);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("prepareDdTaskAction / recordDdSubmittedAction", () => {
  it("prepares and then submits a DD on valid input, no throw", async () => {
    const { prepareDdTaskAction, recordDdSubmittedAction } = await import("./hearing");
    const kase = mock.CASES.find((c) => c.id === "case-7")!;

    const prepareFd = new FormData();
    prepareFd.set("caseId", kase.id);
    prepareFd.set("amount", "25000");
    prepareFd.set("payee", "MSEFC");
    prepareFd.set("reference", "");
    const prepareResult = await prepareDdTaskAction({ result: null, error: null }, prepareFd);
    expect(prepareResult.error).toBeNull();
    expect(prepareResult.result?.dd.amount).toBe(25_00_000);

    const submitFd = new FormData();
    submitFd.set("caseId", kase.id);
    const submitResult = await recordDdSubmittedAction({ result: null, error: null }, submitFd);
    expect(submitResult.error).toBeNull();
    expect(submitResult.result?.status).toBe("submitted");
  });

  it("rejects an invalid DD amount with a controlled error, before authorization", async () => {
    const { prepareDdTaskAction } = await import("./hearing");
    const kase = mock.CASES.find((c) => c.id === "case-8")!;

    const fd = new FormData();
    fd.set("caseId", kase.id);
    fd.set("amount", "not-a-number");
    const result = await prepareDdTaskAction({ result: null, error: null }, fd);
    expect(result.result).toBeNull();
    expect(result.error).toBeTruthy();
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });

  it("rejects with no session, returning a controlled state", async () => {
    authorizeStaffMutation.mockRejectedValue(new Error("no session"));
    const { recordDdSubmittedAction } = await import("./hearing");
    const kase = mock.CASES.find((c) => c.id === "case-9")!;

    const fd = new FormData();
    fd.set("caseId", kase.id);
    const result = await recordDdSubmittedAction({ result: null, error: null }, fd);
    expect(result.result).toBeNull();
    expect(result.error).toBe("You do not have permission to perform this action.");
  });
});

describe("scheduleHearingAction / rescheduleHearingAction / recordHearingOutcomeAction", () => {
  it("schedules, reschedules, and records an outcome across the full lifecycle, no throw", async () => {
    const { scheduleHearingAction, rescheduleHearingAction, recordHearingOutcomeAction } = await import("./hearing");
    const kase = mock.CASES.find((c) => c.id === "case-10")!;

    const scheduleFd = new FormData();
    scheduleFd.set("caseId", kase.id);
    scheduleFd.set("startsAt", new Date(Date.now() + 7 * 86_400_000).toISOString());
    const scheduleResult = await scheduleHearingAction({ result: null, error: null }, scheduleFd);
    expect(scheduleResult.error).toBeNull();
    const hearing = scheduleResult.result?.hearing;
    expect(hearing).toBeTruthy();

    const rescheduleFd = new FormData();
    rescheduleFd.set("hearingId", hearing!.id);
    rescheduleFd.set("caseId", kase.id);
    rescheduleFd.set("newStartsAt", new Date(Date.now() + 14 * 86_400_000).toISOString());
    const rescheduleResult = await rescheduleHearingAction({ result: null, error: null }, rescheduleFd);
    expect(rescheduleResult.error).toBeNull();
    const rescheduled = rescheduleResult.result?.hearing;
    expect(rescheduled?.status).toBe("scheduled");

    const outcomeFd = new FormData();
    outcomeFd.set("hearingId", rescheduled!.id);
    outcomeFd.set("caseId", kase.id);
    outcomeFd.set("status", "completed");
    outcomeFd.set("recovered", "true");
    const outcomeResult = await recordHearingOutcomeAction({ result: null, error: null }, outcomeFd);
    expect(outcomeResult.error).toBeNull();
    expect(outcomeResult.result?.hearing.status).toBe("completed");

    // Idempotency: recording the same outcome again is a safe no-op, not a crash.
    const retryResult = await recordHearingOutcomeAction({ result: null, error: null }, outcomeFd);
    expect(retryResult.error).toBeNull();
    expect(retryResult.result?.hearing.status).toBe("completed");
  });

  it("rejects an invalid hearing date with a controlled error, before authorization", async () => {
    const { scheduleHearingAction } = await import("./hearing");
    const kase = mock.CASES.find((c) => c.id === "case-11")!;

    const fd = new FormData();
    fd.set("caseId", kase.id);
    fd.set("startsAt", "not-a-date");
    const result = await scheduleHearingAction({ result: null, error: null }, fd);
    expect(result.result).toBeNull();
    expect(result.error).toBeTruthy();
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });

  it("rejects an invalid outcome status with a controlled error", async () => {
    const { recordHearingOutcomeAction } = await import("./hearing");
    const fd = new FormData();
    fd.set("hearingId", "hearing-nope");
    fd.set("caseId", "case-nope");
    fd.set("status", "bogus");
    fd.set("recovered", "true");
    const result = await recordHearingOutcomeAction({ result: null, error: null }, fd);
    expect(result.result).toBeNull();
    expect(result.error).toBe("Invalid hearing outcome.");
  });

  it("surfaces an unknown case as a controlled error, not a crash", async () => {
    const { scheduleHearingAction } = await import("./hearing");
    const fd = new FormData();
    fd.set("caseId", "00000000-0000-0000-0000-000000000000");
    fd.set("startsAt", new Date().toISOString());
    const result = await scheduleHearingAction({ result: null, error: null }, fd);
    expect(result.result).toBeNull();
    expect(result.error).toBeTruthy();
  });
});
