"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeStaffMutation } from "@/lib/auth/session";
import { debtorReplySchema } from "@/contract/schemas";
import type { RecoveryCase } from "@/contract/types";

export interface RecordDebtorReplyState {
  result: { case: RecoveryCase; replyId: string } | null;
  error: string | null;
}

/**
 * Staff records and classifies an inbound debtor reply (PRD §8 "AI
 * classifies; staff decides" -- no AI classification is wired in this
 * build, so classification is always staff-entered here). Drives the same
 * workflow transition as any other reply-handling path.
 *
 * Takes the `useActionState`/`<form action=...>` shape (prevState, FormData)
 * and always RETURNS its outcome rather than throwing (authorization
 * hardening task, #16) -- same production-crash fix already applied
 * elsewhere in this surface. A case-not-found or an invalid classification
 * for the case's current workflow state (e.g. a terminal case) now renders
 * as a controlled message instead of crashing the panel.
 */
export async function recordDebtorReplyAction(
  _prevState: RecordDebtorReplyState,
  formData: FormData,
): Promise<RecordDebtorReplyState> {
  const caseId = String(formData.get("caseId") ?? "");
  if (!caseId) {
    return { result: null, error: "Missing case." };
  }

  const parsed = debtorReplySchema.safeParse({
    channel: formData.get("channel"),
    rawBody: formData.get("rawBody"),
    communicationId: formData.get("communicationId"),
    classification: formData.get("classification"),
  });
  if (!parsed.success) {
    return { result: null, error: parsed.error.issues[0]?.message ?? "Invalid reply details" };
  }

  let actor;
  try {
    actor = await authorizeStaffMutation();
  } catch {
    return { result: null, error: "You do not have permission to perform this action." };
  }

  try {
    const { case: updatedCase, reply } = await getRepo().recordDebtorReply(caseId, parsed.data, actor);
    revalidatePath(`/cases/${caseId}`);
    revalidatePath("/today");
    return { result: { case: updatedCase, replyId: reply.id }, error: null };
  } catch (e: unknown) {
    return { result: null, error: e instanceof Error ? e.message : "Failed to record the reply" };
  }
}
