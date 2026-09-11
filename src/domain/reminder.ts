/**
 * Pure pieces of the initial-reminder flow (workflow-spec: upload -> active ->
 * send -> delivered -> 24h timer). The adapter call itself is I/O and stays in
 * the repository layer (src/server/repositories/memory.ts); everything here
 * is deterministic and unit-tested without a network or a database.
 */

import { advance, caseToWorkflowState, transitionToCasePatch } from "./workflow";
import { reminderTimerDeadline } from "./scheduling";
import type { RecoveryCase } from "@/contract/types";

type CaseInput = Parameters<typeof caseToWorkflowState>[0] & RecoveryCase;

export function buildReminderMessage(input: {
  legalEntityName: string;
  debtorName: string;
  invoiceNumber: string | null;
  amountPaise: number;
}): string {
  const amount = (input.amountPaise / 100).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
  const invoiceRef = input.invoiceNumber ? ` Invoice ${input.invoiceNumber} for ${amount}` : ` ${amount}`;
  return (
    `Namaste, this is N K Lodha & Co on behalf of ${input.legalEntityName}.` +
    `${invoiceRef} is overdue. Kindly arrange payment or reply here.`
  );
}

/** Case status -> next status after the initial reminder is handed to the adapter. */
export function applyReminderSent(kase: CaseInput): { updatedCase: RecoveryCase; note: string } {
  const transition = advance(caseToWorkflowState(kase), { type: "REMINDER_SENT" });
  return { updatedCase: { ...kase, ...transitionToCasePatch(transition.next) }, note: transition.note };
}

/** Successful delivery starts the 24h timer (PRD §5 — only after delivery). */
export function applyReminderDelivered(
  kase: CaseInput,
  deliveredAt: Date,
): { updatedCase: RecoveryCase; note: string } {
  const transition = advance(caseToWorkflowState(kase), { type: "REMINDER_DELIVERED" });
  return {
    updatedCase: {
      ...kase,
      ...transitionToCasePatch(transition.next),
      nextScheduledAt: reminderTimerDeadline(deliveredAt).toISOString(),
    },
    note: transition.note,
  };
}

/** Both channels failing pauses escalation for a contact correction (PRD §8). */
export function applyReminderDeliveryFailed(
  kase: CaseInput,
  bothChannels: boolean,
): { updatedCase: RecoveryCase; note: string } {
  const transition = advance(caseToWorkflowState(kase), {
    type: "REMINDER_DELIVERY_FAILED",
    bothChannels,
  });
  return {
    updatedCase: { ...kase, ...transitionToCasePatch(transition.next), nextScheduledAt: null },
    note: transition.note,
  };
}
