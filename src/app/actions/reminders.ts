"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeStaffMutation } from "@/lib/auth/session";

/**
 * Send the initial reminder for an `active` case. Runs the messaging adapter
 * under the retry-once policy, records the communication, and advances the
 * case per src/domain/reminder.ts.
 */
export async function sendInitialReminderAction(caseId: string) {
  const actor = await authorizeStaffMutation();
  const result = await getRepo().sendInitialReminder(caseId, actor);
  revalidatePath("/today");
  revalidatePath("/cases");
  revalidatePath("/communications");
  revalidatePath(`/cases/${caseId}`);
  return result;
}
