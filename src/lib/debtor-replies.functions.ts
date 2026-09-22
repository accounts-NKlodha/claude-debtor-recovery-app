/**
 * TanStack Start equivalent of src/app/actions/debtor-replies.ts (M1 Batch
 * 2). Staff records + classifies an inbound debtor reply (no AI
 * classification wired in this build -- classification is always
 * staff-entered, matching the Next.js action exactly).
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import { authorizeStaffMutation } from "@/lib/auth/tanstack-session";
import { debtorReplySchema } from "@/contract/schemas";
import type { RecoveryCase } from "@/contract/types";

export interface RecordDebtorReplyState {
  result: { case: RecoveryCase; replyId: string } | null;
  error: string | null;
}

export const recordDebtorReplyFn = createServerFn({ method: "POST" })
  .validator(
    (data: unknown) =>
      data as { caseId: string; channel: unknown; rawBody: unknown; communicationId?: unknown; classification: unknown },
  )
  .handler(async ({ data }): Promise<RecordDebtorReplyState> => {
    if (!data.caseId) return { result: null, error: "Missing case." };

    const parsed = debtorReplySchema.safeParse({
      channel: data.channel,
      rawBody: data.rawBody,
      communicationId: data.communicationId,
      classification: data.classification,
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
      const repo = await getRepo();
      const { case: updatedCase, reply } = await repo.recordDebtorReply(data.caseId, parsed.data, actor);
      return { result: { case: updatedCase, replyId: reply.id }, error: null };
    } catch (e: unknown) {
      return { result: null, error: e instanceof Error ? e.message : "Failed to record the reply" };
    }
  });
