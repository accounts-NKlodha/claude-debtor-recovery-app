"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeStaffMutation } from "@/lib/auth/session";
import { moneyToPaise } from "@/contract/schemas";
import type { CaseHearing, DdRecord, RecoveryCase } from "@/contract/types";

function revalidateCasePaths(caseId: string) {
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/msme");
  revalidatePath("/today");
}

function optionalTrimmed(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

/* This whole file follows the same useActionState/`<form action=...>` shape
 * (prevState, FormData) -> typed state, always RETURNED rather than thrown,
 * as the rest of this mutation surface (authorization hardening task, #17).
 * A case-not-found or an invalid date now renders as a controlled message
 * on the DD/hearing panel instead of crashing it. Idempotency (retry-safe
 * DD submission, retry-safe hearing outcome) and terminal-state handling
 * are unchanged -- both are already handled by the repository itself
 * (see SupabaseRepository/MemoryRepository), which returns a no-op result
 * rather than throwing; these wrappers only add the safe-return contract
 * around whatever the repository already decides. */

export interface PrepareDdTaskState {
  result: { case: RecoveryCase; dd: DdRecord } | null;
  error: string | null;
}

/** Staff prepares/updates the case's DD record (amount/payee/reference/notes
 * may be filled incrementally). The DD itself stays physical/manual. */
export async function prepareDdTaskAction(
  _prevState: PrepareDdTaskState,
  formData: FormData,
): Promise<PrepareDdTaskState> {
  const caseId = String(formData.get("caseId") ?? "");
  if (!caseId) return { result: null, error: "Missing case." };

  const rawAmount = String(formData.get("amount") ?? "").trim();
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
    const result = await getRepo().prepareDdTask(
      caseId,
      { amount, payee: optionalTrimmed(formData.get("payee")), reference: optionalTrimmed(formData.get("reference")) },
      actor,
    );
    revalidateCasePaths(caseId);
    return { result, error: null };
  } catch (e: unknown) {
    return { result: null, error: e instanceof Error ? e.message : "Failed to prepare the DD" };
  }
}

export interface RecordDdSubmittedState {
  result: DdRecord | null;
  error: string | null;
}

/** Marks the case's DD handed over/submitted. Idempotent on retry. */
export async function recordDdSubmittedAction(
  _prevState: RecordDdSubmittedState,
  formData: FormData,
): Promise<RecordDdSubmittedState> {
  const caseId = String(formData.get("caseId") ?? "");
  if (!caseId) return { result: null, error: "Missing case." };

  let actor;
  try {
    actor = await authorizeStaffMutation();
  } catch {
    return { result: null, error: "You do not have permission to perform this action." };
  }

  try {
    const result = await getRepo().recordDdSubmitted(
      caseId,
      { submittedAt: new Date().toISOString(), documentId: optionalTrimmed(formData.get("documentId")) },
      actor,
    );
    revalidateCasePaths(caseId);
    return { result, error: null };
  } catch (e: unknown) {
    return { result: null, error: e instanceof Error ? e.message : "Failed to record the DD as submitted" };
  }
}

export interface ScheduleHearingState {
  result: { case: RecoveryCase; hearing: CaseHearing } | null;
  error: string | null;
}

/** Records a hearing date, persists a case_hearings row, and creates the calendar event. */
export async function scheduleHearingAction(
  _prevState: ScheduleHearingState,
  formData: FormData,
): Promise<ScheduleHearingState> {
  const caseId = String(formData.get("caseId") ?? "");
  const startsAt = String(formData.get("startsAt") ?? "");
  if (!caseId) return { result: null, error: "Missing case." };
  const startsAtDate = new Date(startsAt);
  if (!startsAt || Number.isNaN(startsAtDate.getTime())) {
    return { result: null, error: "A valid hearing date/time is required." };
  }

  let actor;
  try {
    actor = await authorizeStaffMutation();
  } catch {
    return { result: null, error: "You do not have permission to perform this action." };
  }

  try {
    const result = await getRepo().scheduleHearing(caseId, { startsAtIso: startsAtDate.toISOString() }, actor);
    revalidateCasePaths(caseId);
    return { result, error: null };
  } catch (e: unknown) {
    return { result: null, error: e instanceof Error ? e.message : "Failed to schedule the hearing" };
  }
}

export interface RescheduleHearingState {
  result: { case: RecoveryCase; hearing: CaseHearing } | null;
  error: string | null;
}

/** Adjourns the current hearing and schedules a replacement occurrence. */
export async function rescheduleHearingAction(
  _prevState: RescheduleHearingState,
  formData: FormData,
): Promise<RescheduleHearingState> {
  const hearingId = String(formData.get("hearingId") ?? "");
  const caseId = String(formData.get("caseId") ?? "");
  const newStartsAt = String(formData.get("newStartsAt") ?? "");
  if (!hearingId || !caseId) return { result: null, error: "Missing hearing or case." };
  const newStartsAtDate = new Date(newStartsAt);
  if (!newStartsAt || Number.isNaN(newStartsAtDate.getTime())) {
    return { result: null, error: "A valid new hearing date/time is required." };
  }

  let actor;
  try {
    actor = await authorizeStaffMutation();
  } catch {
    return { result: null, error: "You do not have permission to perform this action." };
  }

  try {
    const result = await getRepo().rescheduleHearing(
      hearingId,
      caseId,
      { newStartsAtIso: newStartsAtDate.toISOString() },
      actor,
    );
    revalidateCasePaths(caseId);
    return { result, error: null };
  } catch (e: unknown) {
    return { result: null, error: e instanceof Error ? e.message : "Failed to reschedule the hearing" };
  }
}

export interface RecordHearingOutcomeState {
  result: { case: RecoveryCase; hearing: CaseHearing } | null;
  error: string | null;
}

/** Records a hearing's result ('completed' | 'cancelled'). Idempotent once recorded. */
export async function recordHearingOutcomeAction(
  _prevState: RecordHearingOutcomeState,
  formData: FormData,
): Promise<RecordHearingOutcomeState> {
  const hearingId = String(formData.get("hearingId") ?? "");
  const caseId = String(formData.get("caseId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!hearingId || !caseId) return { result: null, error: "Missing hearing or case." };
  if (status !== "completed" && status !== "cancelled") {
    return { result: null, error: "Invalid hearing outcome." };
  }
  const recovered = formData.get("recovered") === "true";

  let actor;
  try {
    actor = await authorizeStaffMutation();
  } catch {
    return { result: null, error: "You do not have permission to perform this action." };
  }

  try {
    const result = await getRepo().recordHearingOutcome(
      hearingId,
      caseId,
      { status, recovered, result: optionalTrimmed(formData.get("resultNote")) },
      actor,
    );
    revalidateCasePaths(caseId);
    return { result, error: null };
  } catch (e: unknown) {
    return { result: null, error: e instanceof Error ? e.message : "Failed to record the hearing outcome" };
  }
}
