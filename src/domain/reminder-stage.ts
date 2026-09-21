/**
 * Invoice-level reminder stage, and how the CASE-level status follows from it.
 *
 * Why this exists: WhatsApp reminders are sent per invoice (each invoice is
 * its own business event with its own idempotency key), but the workflow
 * status is one field per case. Deciding "may this invoice be reminded?" from
 * the case status alone meant the first reminder moved the whole case on and
 * locked every other invoice out. The relationship is therefore:
 *
 *   invoice-level reminder history  --(derived, never stored twice)-->  case status
 *
 * - The SOURCE OF TRUTH for an invoice's stage is the durable communication
 *   history: an accepted `wa:initial-reminder:{case}:{invoice}` and an
 *   accepted `wa:followup-reminder:{case}:{invoice}:{stage}`. Nothing new is
 *   stored; there is no second copy that can drift.
 * - Each invoice has its OWN 24h windows, measured from ITS OWN accepted
 *   reminder times.
 * - The CASE status is the coarse gate for escalation and is a deterministic
 *   function of the outstanding invoices, never ahead of the slowest one:
 *     active                      no outstanding invoice has been reminded
 *     initial_communication_sent  at least one reminded, but at least one
 *                                 outstanding invoice still lacks its initial
 *                                 or its follow-up
 *     follow_up_sent              EVERY outstanding invoice has had its
 *                                 initial AND its follow-up
 *   GST/MSME review is only reachable from `follow_up_sent` (after its final
 *   window), so escalation cannot happen while any outstanding invoice's
 *   reminder stages are unresolved. `escalationReadiness` is the explicit
 *   gate any future timer/scheduler must consult.
 * - A settled invoice (no outstanding balance) no longer needs reminders and
 *   drops out of the aggregate.
 *
 * "Accepted" means the provider accepted the request; it is never delivery.
 */

import type { Communication, Invoice, RecoveryCase } from "@/contract/types";
import { reminderTimerDeadline } from "./scheduling";
import { EMAIL_INITIAL_KEY_PREFIX, whatsAppEventKeys } from "./whatsapp-event-keys";

export type InvoiceReminderStage = "settled" | "not_reminded" | "initial_sent" | "follow_up_sent";

/** True when the case's single initial email was already accepted (it must never be repeated for another invoice's reminder). */
export function hasAcceptedEmailInitial(caseId: string, communications: Communication[]): boolean {
  return communications.some(
    (c) => c.channel === "email" && c.direction === "outbound" && isAcceptedComm(c) && c.idempotencyKey?.startsWith(EMAIL_INITIAL_KEY_PREFIX(caseId)),
  );
}

export interface InvoiceReminderState {
  invoiceId: string;
  invoiceNumber: string;
  outstanding: boolean;
  stage: InvoiceReminderStage;
  /** Which evidence established the initial reminder. */
  initialSource: "whatsapp" | "email" | "legacy" | null;
  initialAcceptedAt: string | null;
  /** When the first response window ends and this invoice's follow-up becomes due. */
  followUpDueAt: string | null;
  followUpAcceptedAt: string | null;
  /** When the second (post-follow-up) response window ends. */
  finalWindowEndsAt: string | null;
}

const isAcceptedComm = (c: Communication) => c.deliveryStatus === "sent" || c.deliveryStatus === "delivered" || c.deliveryStatus === "read";
const isAccepted = (c: Communication) => c.deliveryStatus === "sent" || c.deliveryStatus === "delivered" || c.deliveryStatus === "read";
const acceptedAt = (c: Communication) => c.deliveredAt ?? c.createdAt;
const plus24h = (iso: string) => reminderTimerDeadline(new Date(iso)).toISOString();

export function deriveInvoiceReminderStates(input: {
  kase: RecoveryCase;
  invoices: Invoice[];
  communications: Communication[];
}): InvoiceReminderState[] {
  const { kase, invoices } = input;
  const accepted = input.communications.filter((c) => c.direction === "outbound" && isAccepted(c));
  const byKey = new Map(accepted.filter((c) => c.idempotencyKey).map((c) => [c.idempotencyKey!, c]));
  const earliestEmailInitial = accepted
    .filter((c) => c.channel === "email" && c.idempotencyKey?.startsWith(EMAIL_INITIAL_KEY_PREFIX(kase.id)))
    .sort((a, b) => (acceptedAt(a) < acceptedAt(b) ? -1 : 1))[0];
  const single = invoices.length === 1;

  return invoices.map((inv): InvoiceReminderState => {
    const outstanding = inv.outstandingBalance > 0;
    const waInitial = byKey.get(whatsAppEventKeys.initialReminder(kase.id, inv.id));
    const followUp = byKey.get(whatsAppEventKeys.followUpReminder(kase.id, inv.id));

    // The single email per case names only one invoice, so it can stand in for
    // an invoice's initial reminder ONLY when the case has exactly one invoice.
    let initialAcceptedAt: string | null = null;
    let initialSource: InvoiceReminderState["initialSource"] = null;
    let followUpDueAt: string | null = null;
    if (waInitial) {
      initialAcceptedAt = acceptedAt(waInitial);
      initialSource = "whatsapp";
    } else if (single && earliestEmailInitial) {
      initialAcceptedAt = acceptedAt(earliestEmailInitial);
      initialSource = "email";
    } else if (single && kase.nextScheduledAt && (kase.status === "initial_communication_sent" || kase.status === "follow_up_sent")) {
      // Single-invoice case already in the reminder stage with a scheduled
      // window but no derivable communication (created before invoice-level
      // tracking): trust the case's own recorded window.
      initialSource = "legacy";
      followUpDueAt = kase.nextScheduledAt;
      initialAcceptedAt = new Date(new Date(kase.nextScheduledAt).getTime() - 24 * 3_600_000).toISOString();
    }
    if (initialAcceptedAt && !followUpDueAt) followUpDueAt = plus24h(initialAcceptedAt);

    const followUpAcceptedAt = followUp ? acceptedAt(followUp) : null;
    const finalWindowEndsAt = followUpAcceptedAt ? plus24h(followUpAcceptedAt) : null;

    const stage: InvoiceReminderStage = !outstanding
      ? "settled"
      : followUpAcceptedAt
        ? "follow_up_sent"
        : initialAcceptedAt
          ? "initial_sent"
          : "not_reminded";

    return { invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, outstanding, stage, initialSource, initialAcceptedAt, followUpDueAt, followUpAcceptedAt, finalWindowEndsAt };
  });
}

export interface ReminderStageSummary {
  /** The case status implied by the invoices. Never moves backwards (see `advancesOver`). */
  status: "active" | "initial_communication_sent" | "follow_up_sent";
  /** Next time something becomes due: earliest pending follow-up, or the end of the final window. */
  nextScheduledAt: string | null;
  outstandingInvoices: number;
  remindedInvoices: number;
  awaitingInitial: string[];
  awaitingFollowUp: string[];
}

export function summarizeReminderStage(states: InvoiceReminderState[]): ReminderStageSummary | null {
  const open = states.filter((s) => s.stage !== "settled");
  if (open.length === 0) return null; // nothing left to remind: the case status is decided elsewhere (payment / recovery)

  const awaitingInitial = open.filter((s) => s.stage === "not_reminded");
  const awaitingFollowUp = open.filter((s) => s.stage === "initial_sent");
  const remindedInvoices = open.length - awaitingInitial.length;

  let status: ReminderStageSummary["status"];
  let nextScheduledAt: string | null = null;
  if (awaitingInitial.length === 0 && awaitingFollowUp.length === 0) {
    status = "follow_up_sent";
    nextScheduledAt = open.map((s) => s.finalWindowEndsAt!).sort().at(-1) ?? null; // the LAST invoice's final window
  } else if (remindedInvoices > 0) {
    status = "initial_communication_sent";
    nextScheduledAt = awaitingFollowUp.map((s) => s.followUpDueAt!).sort()[0] ?? null; // the EARLIEST follow-up due
  } else {
    status = "active";
  }

  return {
    status,
    nextScheduledAt,
    outstandingInvoices: open.length,
    remindedInvoices,
    awaitingInitial: awaitingInitial.map((s) => s.invoiceNumber),
    awaitingFollowUp: awaitingFollowUp.map((s) => s.invoiceNumber),
  };
}

const RANK = { active: 0, initial_communication_sent: 1, follow_up_sent: 2 } as const;
/** True when `next` is strictly further along than `current` (statuses never regress). */
export function advancesOver(current: string, next: ReminderStageSummary["status"]): boolean {
  return current in RANK && RANK[next] > RANK[current as keyof typeof RANK];
}

const dayFmt = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

/**
 * The gate for statutory escalation (GST -> MSME). True only when EVERY
 * outstanding invoice has had its initial reminder AND its follow-up AND its
 * final response window has elapsed. No code path escalates today (the app has
 * no scheduler); any future timer MUST consult this, and `follow_up_sent` is
 * itself only reachable when all outstanding invoices have had their
 * follow-up.
 */
export function escalationReadiness(states: InvoiceReminderState[], now: Date): { ready: boolean; blockers: string[] } {
  const open = states.filter((s) => s.stage !== "settled");
  if (open.length === 0) return { ready: false, blockers: ["there is no outstanding invoice"] };
  const blockers: string[] = [];
  for (const s of open) {
    if (s.stage === "not_reminded") blockers.push(`invoice ${s.invoiceNumber} has not been sent its initial reminder`);
    else if (s.stage === "initial_sent") blockers.push(`invoice ${s.invoiceNumber} has not been sent its follow-up reminder`);
    else if (s.finalWindowEndsAt && now.getTime() < new Date(s.finalWindowEndsAt).getTime()) {
      blockers.push(`invoice ${s.invoiceNumber}'s response window runs until ${dayFmt(s.finalWindowEndsAt)}`);
    }
  }
  return { ready: blockers.length === 0, blockers };
}
