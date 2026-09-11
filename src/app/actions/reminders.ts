"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";

/**
 * Send the initial reminder for an `active` case. Runs the messaging adapter
 * under the retry-once policy, records the communication, and advances the
 * case per src/domain/reminder.ts.
 */
export async function sendInitialReminderAction(caseId: string) {
  const result = await getRepo().sendInitialReminder(caseId);
  revalidatePath("/today");
  revalidatePath("/cases");
  revalidatePath("/communications");
  revalidatePath(`/cases/${caseId}`);
  return result;
}
