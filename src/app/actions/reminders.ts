"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeStaffMutation } from "@/lib/auth/session";

/**
 * Send the initial reminder for an `active` case, on every channel the
 * debtor has a real address for (WhatsApp, email). Runs each channel's
 * adapter under the retry-once policy with a durable, database-enforced
 * idempotency key (email-delivery task), records one communication per
 * channel, and advances the case per src/domain/reminder.ts only if at
 * least one channel succeeded.
 *
 * `forceRetryAfterAmbiguous` must only be set true when the caller has
 * explicitly confirmed (via the UI's distinct ambiguous-state prompt) that
 * retrying is safe despite a prior attempt's outcome being unknown -- see
 * docs/email-delivery/index.md.
 */
export async function sendInitialReminderAction(caseId: string, forceRetryAfterAmbiguous = false) {
  const actor = await authorizeStaffMutation();
  const result = await getRepo().sendInitialReminder(caseId, actor, { forceRetryAfterAmbiguous });
  revalidatePath("/today");
  revalidatePath("/cases");
  revalidatePath("/communications");
  revalidatePath(`/cases/${caseId}`);
  return result;
}
