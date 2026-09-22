/**
 * TanStack Start equivalent of src/app/actions/reminders.ts (M1 Batch 2).
 * Same semantics exactly: staff-only, delegates entirely to
 * repo.sendInitialReminder (idempotency key, retry-once policy, mock vs
 * real Gmail/AiSensy adapter selection -- src/adapters/index.ts, unchanged
 * -- all live in the reused repository/adapter layer, not here).
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import { authorizeStaffMutation } from "@/lib/auth/tanstack-session";
import type { Communication } from "@/contract/types";

export type SendReminderState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "sent"; channels: string[]; warnings: string[] }
  | { kind: "failed"; channels: string[]; warnings: string[] }
  | { kind: "ambiguous"; warnings: string[] };

/**
 * Pure outcome classification, factored out for direct unit-testability
 * (see reminders.functions.test.ts) -- same reasoning as the M0-R1/Batch 1
 * guard extractions: createServerFn's wrapper requires a Start runtime
 * context plain vitest doesn't provide.
 *
 * A success outcome is only returned when the durable delivery result
 * actually says "sent" -- never merely because the repository call didn't
 * throw. `warnings` lists channels deliberately not attempted (e.g.
 * WhatsApp skipped because the creditor's UPI details are not configured).
 */
export function decideReminderOutcome(result: {
  communications: Pick<Communication, "deliveryStatus" | "channel">[];
  ambiguous: boolean;
  warnings: string[];
}): SendReminderState {
  const sentChannels = result.communications.filter((c) => c.deliveryStatus === "sent").map((c) => c.channel);
  const failedChannels = result.communications.filter((c) => c.deliveryStatus === "failed").map((c) => c.channel);
  if (result.ambiguous) return { kind: "ambiguous", warnings: result.warnings };
  if (sentChannels.length > 0) return { kind: "sent", channels: sentChannels, warnings: result.warnings };
  return { kind: "failed", channels: failedChannels, warnings: result.warnings };
}

export const sendInitialReminderFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { caseId: string; forceRetryAfterAmbiguous?: boolean; invoiceId?: string | null })
  .handler(async ({ data }): Promise<SendReminderState> => {
    const { caseId, forceRetryAfterAmbiguous = false, invoiceId = null } = data;

    let result;
    try {
      const actor = await authorizeStaffMutation();
      const repo = await getRepo();
      result = await repo.sendInitialReminder(caseId, actor, { forceRetryAfterAmbiguous, invoiceId });
    } catch (e: unknown) {
      return { kind: "error", message: e instanceof Error ? e.message : "Failed to send reminder" };
    }

    return decideReminderOutcome(result);
  });
