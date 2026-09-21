/**
 * Pure pieces of the initial-reminder flow (workflow-spec: upload -> active ->
 * send -> delivered -> 24h timer). The adapter call itself is I/O and stays in
 * the repository layer (src/server/repositories/memory.ts); everything here
 * is deterministic and unit-tested without a network or a database.
 */

import { advance, caseToWorkflowState, transitionToCasePatch } from "./workflow";
import { reminderTimerDeadline } from "./scheduling";
import type { RecoveryCase } from "@/contract/types";
import type { ReminderStageSummary } from "./reminder-stage";

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

/** Subject line for the email channel -- deterministic (no timestamp/random
 * content) so the same logical reminder always produces the same subject,
 * matching the body's determinism (idempotency/audit -- email-delivery task). */
export function buildReminderSubject(input: { legalEntityName: string; invoiceNumber: string | null }): string {
  return input.invoiceNumber
    ? `Payment reminder — Invoice ${input.invoiceNumber} (${input.legalEntityName})`
    : `Payment reminder (${input.legalEntityName})`;
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

/**
 * An operator-sent follow-up reminder was accepted by the provider: move to
 * the follow-up stage and start the second response window. The window
 * reuses the existing 24h reminder timer rule (no new timer constant); GST
 * eligibility review only follows if that window also elapses.
 */
export function applyFollowUpSent(
  kase: CaseInput,
  sentAt: Date,
): { updatedCase: RecoveryCase; note: string } {
  const transition = advance(caseToWorkflowState(kase), { type: "FOLLOW_UP_SENT" });
  return {
    updatedCase: {
      ...kase,
      ...transitionToCasePatch(transition.next),
      nextScheduledAt: reminderTimerDeadline(sentAt).toISOString(),
    },
    note: transition.note,
  };
}

/**
 * Case update after the INVOICE-level reminder history changed (an initial or
 * follow-up reminder was accepted). The case status is the deterministic
 * aggregate of its outstanding invoices (src/domain/reminder-stage.ts): it
 * only advances, and only as far as the SLOWEST outstanding invoice allows --
 * so, for example, sending the follow-up for invoice A does not move a case
 * whose invoice B still awaits its follow-up, and escalation review stays
 * unreachable until every outstanding invoice has had its follow-up.
 */
export function applyReminderStage(
  kase: CaseInput,
  summary: ReminderStageSummary,
  ctx: { at: Date; detail: string },
): { updatedCase: RecoveryCase; note: string } {
  let next: RecoveryCase = kase;
  let note = ctx.detail;

  if (kase.status === "active" && summary.status !== "active") {
    const sent = applyReminderSent(kase);
    const delivered = applyReminderDelivered(sent.updatedCase, ctx.at);
    next = delivered.updatedCase;
    note = `${sent.note}; ${delivered.note}; ${ctx.detail}`;
  }
  if (next.status === "initial_communication_sent" && summary.status === "follow_up_sent") {
    const followUp = applyFollowUpSent(next as CaseInput, ctx.at);
    next = followUp.updatedCase;
    note = `${note}; ${followUp.note}`;
  }
  if (next.status === "initial_communication_sent" && summary.outstandingInvoices > 1) {
    const awaiting = summary.awaitingInitial.length;
    const followUps = summary.awaitingFollowUp.length;
    next = {
      ...next,
      waitingOn: "system",
      blocker:
        `Invoice reminders in progress -- ${summary.remindedInvoices} of ${summary.outstandingInvoices} outstanding invoices reminded` +
        (awaiting > 0 ? `; ${awaiting} still await an initial reminder` : "") +
        (followUps > 0 ? `; ${followUps} await a follow-up` : ""),
    };
  }
  return { updatedCase: { ...next, nextScheduledAt: summary.nextScheduledAt }, note };
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
