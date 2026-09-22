/**
 * TanStack Start equivalent of src/app/actions/hearing.ts (M1 Batch 2).
 * Same five mutations, same safe-return contract (never throws across the
 * RPC boundary), same idempotency and terminal-state handling -- all
 * already enforced by the reused repository methods; these wrappers only
 * add authorization + the safe-return shape around whatever the repository
 * decides.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import { authorizeStaffMutation } from "@/lib/auth/tanstack-session";
import { moneyToPaise } from "@/contract/schemas";
import type { CaseHearing, DdRecord, RecoveryCase } from "@/contract/types";

function optionalTrimmed(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
}

/**
 * Pure date-string validation shared by scheduleHearingFn/
 * rescheduleHearingFn, factored out for direct unit-testability (see
 * hearing.functions.test.ts).
 */
export function validateHearingDate(raw: string): { ok: true; iso: string } | { ok: false; error: string } {
  const date = new Date(raw);
  if (!raw || Number.isNaN(date.getTime())) {
    return { ok: false, error: "A valid hearing date/time is required." };
  }
  return { ok: true, iso: date.toISOString() };
}

export interface PrepareDdTaskState {
  result: { case: RecoveryCase; dd: DdRecord } | null;
  error: string | null;
}

export const prepareDdTaskFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { caseId: string; amount?: string | null; payee?: string | null; reference?: string | null })
  .handler(async ({ data }): Promise<PrepareDdTaskState> => {
    if (!data.caseId) return { result: null, error: "Missing case." };

    const rawAmount = (data.amount ?? "").trim();
    let amount: number | null = null;
    if (rawAmount !== "") {
      const parsed = moneyToPaise.safeParse(rawAmount);
      if (!parsed.success) {
        return { result: null, error: parsed.error.issues[0]?.message ?? "Invalid DD amount" };
      }
      amount = parsed.data;
    }

    let actor;
    try {
      actor = await authorizeStaffMutation();
    } catch {
      return { result: null, error: "You do not have permission to perform this action." };
    }

    try {
      const repo = await getRepo();
      const result = await repo.prepareDdTask(
        data.caseId,
        { amount, payee: optionalTrimmed(data.payee), reference: optionalTrimmed(data.reference) },
        actor,
      );
      return { result, error: null };
    } catch (e: unknown) {
      return { result: null, error: e instanceof Error ? e.message : "Failed to prepare the DD" };
    }
  });

export interface RecordDdSubmittedState {
  result: DdRecord | null;
  error: string | null;
}

export const recordDdSubmittedFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { caseId: string; documentId?: string | null })
  .handler(async ({ data }): Promise<RecordDdSubmittedState> => {
    if (!data.caseId) return { result: null, error: "Missing case." };

    let actor;
    try {
      actor = await authorizeStaffMutation();
    } catch {
      return { result: null, error: "You do not have permission to perform this action." };
    }

    try {
      const repo = await getRepo();
      const result = await repo.recordDdSubmitted(
        data.caseId,
        { submittedAt: new Date().toISOString(), documentId: optionalTrimmed(data.documentId) },
        actor,
      );
      return { result, error: null };
    } catch (e: unknown) {
      return { result: null, error: e instanceof Error ? e.message : "Failed to record the DD as submitted" };
    }
  });

export interface ScheduleHearingState {
  result: { case: RecoveryCase; hearing: CaseHearing } | null;
  error: string | null;
}

export const scheduleHearingFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { caseId: string; startsAt: string })
  .handler(async ({ data }): Promise<ScheduleHearingState> => {
    if (!data.caseId) return { result: null, error: "Missing case." };
    const validated = validateHearingDate(data.startsAt);
    if (!validated.ok) return { result: null, error: validated.error };

    let actor;
    try {
      actor = await authorizeStaffMutation();
    } catch {
      return { result: null, error: "You do not have permission to perform this action." };
    }

    try {
      const repo = await getRepo();
      const result = await repo.scheduleHearing(data.caseId, { startsAtIso: validated.iso }, actor);
      return { result, error: null };
    } catch (e: unknown) {
      return { result: null, error: e instanceof Error ? e.message : "Failed to schedule the hearing" };
    }
  });

export interface RescheduleHearingState {
  result: { case: RecoveryCase; hearing: CaseHearing } | null;
  error: string | null;
}

export const rescheduleHearingFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { hearingId: string; caseId: string; newStartsAt: string })
  .handler(async ({ data }): Promise<RescheduleHearingState> => {
    if (!data.hearingId || !data.caseId) return { result: null, error: "Missing hearing or case." };
    const newStartsAtDate = new Date(data.newStartsAt);
    if (!data.newStartsAt || Number.isNaN(newStartsAtDate.getTime())) {
      return { result: null, error: "A valid new hearing date/time is required." };
    }

    let actor;
    try {
      actor = await authorizeStaffMutation();
    } catch {
      return { result: null, error: "You do not have permission to perform this action." };
    }

    try {
      const repo = await getRepo();
      const result = await repo.rescheduleHearing(
        data.hearingId,
        data.caseId,
        { newStartsAtIso: newStartsAtDate.toISOString() },
        actor,
      );
      return { result, error: null };
    } catch (e: unknown) {
      return { result: null, error: e instanceof Error ? e.message : "Failed to reschedule the hearing" };
    }
  });

export interface RecordHearingOutcomeState {
  result: { case: RecoveryCase; hearing: CaseHearing } | null;
  error: string | null;
}

export const recordHearingOutcomeFn = createServerFn({ method: "POST" })
  .validator(
    (data: unknown) =>
      data as { hearingId: string; caseId: string; status: string; recovered?: boolean; resultNote?: string | null },
  )
  .handler(async ({ data }): Promise<RecordHearingOutcomeState> => {
    if (!data.hearingId || !data.caseId) return { result: null, error: "Missing hearing or case." };
    if (data.status !== "completed" && data.status !== "cancelled") {
      return { result: null, error: "Invalid hearing outcome." };
    }
    const recovered = data.recovered ?? false;

    let actor;
    try {
      actor = await authorizeStaffMutation();
    } catch {
      return { result: null, error: "You do not have permission to perform this action." };
    }

    try {
      const repo = await getRepo();
      const result = await repo.recordHearingOutcome(
        data.hearingId,
        data.caseId,
        { status: data.status, recovered, result: optionalTrimmed(data.resultNote) },
        actor,
      );
      return { result, error: null };
    } catch (e: unknown) {
      return { result: null, error: e instanceof Error ? e.message : "Failed to record the hearing outcome" };
    }
  });
