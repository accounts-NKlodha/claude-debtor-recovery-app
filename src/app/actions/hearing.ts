"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeStaffMutation } from "@/lib/auth/session";

/** Staff prepares/updates the case's DD record (amount/payee/reference/notes
 * may be filled incrementally). The DD itself stays physical/manual. */
export async function prepareDdTaskAction(
  caseId: string,
  input: { amount?: number | null; payee?: string | null; reference?: string | null; notes?: string | null } = {},
) {
  const actor = await authorizeStaffMutation();
  const result = await getRepo().prepareDdTask(caseId, input, actor);
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/msme");
  revalidatePath("/today");
  return result;
}

/** Marks the case's DD handed over/submitted. Idempotent on retry. */
export async function recordDdSubmittedAction(
  caseId: string,
  input: { submittedAt?: string | null; documentId?: string | null } = {},
) {
  const actor = await authorizeStaffMutation();
  const result = await getRepo().recordDdSubmitted(caseId, input, actor);
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/msme");
  revalidatePath("/today");
  return result;
}

/** Records a hearing date, persists a case_hearings row, and creates the calendar event. */
export async function scheduleHearingAction(
  caseId: string,
  startsAtIso: string,
  input: {
    forum?: string | null;
    authority?: string | null;
    caseReference?: string | null;
    assignedStaffId?: string | null;
    notes?: string | null;
  } = {},
) {
  const actor = await authorizeStaffMutation();
  const result = await getRepo().scheduleHearing(caseId, { startsAtIso, ...input }, actor);
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/msme");
  revalidatePath("/today");
  return result;
}

/** Adjourns the current hearing and schedules a replacement occurrence. */
export async function rescheduleHearingAction(
  hearingId: string,
  caseId: string,
  newStartsAtIso: string,
  input: {
    forum?: string | null;
    authority?: string | null;
    caseReference?: string | null;
    assignedStaffId?: string | null;
    notes?: string | null;
  } = {},
) {
  const actor = await authorizeStaffMutation();
  const result = await getRepo().rescheduleHearing(hearingId, caseId, { newStartsAtIso, ...input }, actor);
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/msme");
  revalidatePath("/today");
  return result;
}

/** Records a hearing's result ('completed' | 'cancelled'). Idempotent once recorded. */
export async function recordHearingOutcomeAction(
  hearingId: string,
  caseId: string,
  status: "completed" | "cancelled",
  recovered: boolean,
  result?: string | null,
) {
  const actor = await authorizeStaffMutation();
  const outcome = await getRepo().recordHearingOutcome(hearingId, caseId, { status, result, recovered }, actor);
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/msme");
  revalidatePath("/today");
  return outcome;
}
