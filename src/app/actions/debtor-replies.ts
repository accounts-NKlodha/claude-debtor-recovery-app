"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeStaffMutation } from "@/lib/auth/session";
import type { Channel, ReplyClassification } from "@/contract/enums";

/**
 * Staff records and classifies an inbound debtor reply (PRD §8 "AI
 * classifies; staff decides" -- no AI classification is wired in this
 * build, so classification is always staff-entered here). Drives the same
 * workflow transition as any other reply-handling path.
 */
export async function recordDebtorReplyAction(
  caseId: string,
  input: {
    channel: Channel;
    rawBody: string;
    communicationId?: string | null;
    classification: ReplyClassification;
  },
) {
  const actor = await authorizeStaffMutation();
  const result = await getRepo().recordDebtorReply(caseId, input, actor);
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/today");
  return result;
}
