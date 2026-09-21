/**
 * WhatsApp V1 message engine: for a case, decides which of the five approved
 * message families an operator may send, why (or why not), the business
 * event each send is identified by (its idempotency key), and the exact
 * template parameters. Pure and deterministic -- no I/O; the repositories
 * load the data and this module decides. The SAME evaluation is used to
 * render the UI and to authorize the send, so the two can never disagree
 * and a forged UI request can never send something the engine would refuse.
 *
 * V1 policy: every send is operator-triggered. Nothing here schedules or
 * fires a message; "available" only means an operator may now choose to.
 *
 * Invoice association (approved V1 rule): a message uses the specific
 * invoice tied to its business event and NEVER silently picks the first
 * invoice of a multi-invoice case. Where an event cannot be tied to exactly
 * one invoice the offer is unavailable with the ambiguity stated.
 */

import type {
  Communication,
  CommunicationDelivery,
  Debtor,
  Invoice,
  Organisation,
  PaymentAllocation,
  PaymentPromise,
  PaymentRecord,
  RecoveryCase,
} from "@/contract/types";
import { normalizeIndianMobile } from "./phone";
import { istBusinessDate } from "./scheduling";
import { deriveInvoiceReminderStates } from "./reminder-stage";
import { FOLLOW_UP_STAGE, whatsAppEventKeys } from "./whatsapp-event-keys";
import {
  RENDERERS,
  WHATSAPP_TEMPLATES,
  buildCommitmentReminderV2Params,
  buildFollowUpReminderV2Params,
  buildPaymentClosedV2Params,
  buildPaymentReceivedV2Params,
  buildPaymentReminderInitialV2Params,
  formatTemplateAmount,
  formatTemplateDate,
  validateTemplateParams,
  type WhatsAppMessageKind,
  type WhatsAppTemplateDef,
} from "./whatsapp-templates";

export { FOLLOW_UP_STAGE, whatsAppEventKeys };

export interface WhatsAppChannelEntry {
  channel: "whatsapp";
  to: string;
  templateKey: string;
  templateVersion: number;
  subject: null;
  body: string;
  templateParams?: string[];
  /** Business-event key. Absent only on the legacy non-production demo path (date-scoped default). */
  idempotencyKey?: string;
}

export interface WhatsAppEventSubject {
  invoiceId?: string;
  promiseId?: string;
  paymentId?: string;
}

export type WhatsAppOfferOutcome = "accepted" | "rejected" | "ambiguous";

export interface WhatsAppOfferHistory {
  communicationId: string;
  /** ISO timestamp of the most recent attempt. */
  attemptedAt: string;
  attempts: number;
  /** accepted = the provider accepted the request (NOT delivered/read); rejected = it failed; ambiguous = outcome unknown. */
  outcome: WhatsAppOfferOutcome;
}

export interface WhatsAppOffer {
  kind: WhatsAppMessageKind;
  label: string;
  /** Business-event idempotency key; null on a placeholder row (no event exists yet). */
  eventKey: string | null;
  subject: WhatsAppEventSubject;
  status: "available" | "unavailable" | "sent";
  /** Why it is available / why it cannot be sent / that it was sent. */
  reason: string;
  /** The specific payment / promise / invoice the message concerns. */
  detail: string | null;
  invoiceNumber: string | null;
  /** A prior attempt's outcome is unknown: sending needs an explicit operator confirmation. */
  ambiguous: boolean;
  history: WhatsAppOfferHistory | null;
  /** Server-side only (contains the recipient number and parameters). Present iff status === "available". */
  entry: WhatsAppChannelEntry | null;
}

/** What is safe to hand to a browser component. */
export type WhatsAppOfferView = Omit<WhatsAppOffer, "entry">;
export function toOfferView(o: WhatsAppOffer): WhatsAppOfferView {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { entry, ...view } = o;
  return view;
}

export interface LiveSendEnv {
  /** WHATSAPP_PROVIDER=aisensy (and, for the in-memory demo repository, explicitly opted in). */
  liveConfigured: boolean;
  campaignConfigured: (kind: WhatsAppMessageKind) => boolean;
  /** Lazily evaluated and memoised by the engine: the kill switch is only read once cheaper checks pass. */
  isAutomationEnabled: () => Promise<boolean>;
}

export const PAYMENT_DETAILS_NOT_CONFIGURED_REASON =
  "the creditor's payment details (UPI ID and UPI payee name) are not configured -- " +
  "an admin must add them for this client on the Clients page before a WhatsApp reminder can be sent";

/**
 * Checks common to every live WhatsApp send, cheapest first. Returns a
 * controlled operator-facing reason, or null when nothing blocks the send.
 * Never falls back to a mock: a message that cannot go through the live
 * adapter is simply unavailable.
 */
export async function liveSendBlocker(
  def: WhatsAppTemplateDef,
  args: { debtorMobile: string | null | undefined; org: Organisation | undefined; env: LiveSendEnv },
): Promise<string | null> {
  const { debtorMobile, org, env } = args;
  if (!env.liveConfigured) return "WhatsApp sending is not enabled in this environment";
  if (!env.campaignConfigured(def.kind)) {
    return "the WhatsApp campaign for this message is not configured -- ask an administrator to configure it";
  }
  if (!debtorMobile) return "the debtor has no mobile number on file";
  if (!normalizeIndianMobile(debtorMobile)) {
    return "the debtor's mobile number on file is not a valid Indian mobile number -- correct it on the case";
  }
  if (!org) return "the creditor organisation for this case could not be found";
  if (def.requiresUpi && (!org.upiId?.trim() || !org.upiPayeeName?.trim())) {
    return PAYMENT_DETAILS_NOT_CONFIGURED_REASON;
  }
  if (!(await env.isAutomationEnabled())) return "the global automation kill switch is off";
  return null;
}

/**
 * The invoice an INITIAL reminder concerns: exactly one invoice, or the
 * operator's explicit selection -- never "the first one". Invoices already
 * sent their initial reminder are excluded, so on a multi-invoice case the
 * remaining invoices stay independently eligible (and a lone remaining
 * invoice is unambiguous).
 */
export function pickReminderInvoice(
  invoices: Invoice[],
  selectedInvoiceId?: string | null,
  alreadyReminded: ReadonlySet<string> = new Set(),
): { invoice: Invoice } | { reason: string } {
  if (invoices.length === 0) return { reason: "the case has no invoice to remind about" };
  if (selectedInvoiceId) {
    const chosen = invoices.find((i) => i.id === selectedInvoiceId);
    if (!chosen) return { reason: "the selected invoice does not belong to this case" };
    if (alreadyReminded.has(chosen.id)) return { reason: `invoice ${chosen.invoiceNumber} has already been sent its initial reminder` };
    if (chosen.outstandingBalance <= 0) return { reason: `invoice ${chosen.invoiceNumber} has no outstanding balance` };
    return { invoice: chosen };
  }
  const candidates = invoices.filter((i) => i.outstandingBalance > 0 && !alreadyReminded.has(i.id));
  if (candidates.length === 1) return { invoice: candidates[0] };
  if (candidates.length === 0) {
    return {
      reason: invoices.some((i) => i.outstandingBalance > 0)
        ? "every outstanding invoice on this case has already been sent its initial reminder"
        : "no invoice on this case has an outstanding balance",
    };
  }
  return {
    reason:
      candidates.length === invoices.length
        ? `the case has ${invoices.length} invoices -- choose the invoice to remind about (WhatsApp reminders are sent per invoice)`
        : `${candidates.length} invoices still await their initial reminder -- choose the invoice to remind about (WhatsApp reminders are sent per invoice)`,
  };
}

/* --------------------------------------------------------------------------
 * Engine
 * ------------------------------------------------------------------------ */

export interface WhatsAppEngineInput {
  now: Date;
  env: LiveSendEnv;
  kase: RecoveryCase;
  debtor: Debtor | undefined;
  org: Organisation | undefined;
  invoices: Invoice[];
  payments: PaymentRecord[];
  allocations: PaymentAllocation[];
  promises: PaymentPromise[];
  communications: Communication[];
  deliveriesByCommunication: Record<string, CommunicationDelivery[]>;
}

const istDate = istBusinessDate;
const day = (iso: string) => formatTemplateDate(iso.slice(0, 10));

function historyFor(input: WhatsAppEngineInput, eventKey: string): WhatsAppOfferHistory | null {
  const comm = input.communications.find((c) => c.idempotencyKey === eventKey && c.direction === "outbound");
  if (!comm) return null;
  const deliveries = input.deliveriesByCommunication[comm.id] ?? [];
  const last = deliveries[deliveries.length - 1];
  const outcome: WhatsAppOfferOutcome =
    comm.deliveryStatus === "sent" || comm.deliveryStatus === "delivered" || comm.deliveryStatus === "read"
      ? "accepted"
      : comm.deliveryStatus === "failed" || comm.deliveryStatus === "bounced"
        ? "rejected"
        : "ambiguous";
  return { communicationId: comm.id, attemptedAt: last?.occurredAt ?? comm.createdAt, attempts: deliveries.length, outcome };
}

const AMBIGUOUS_REASON =
  "A previous attempt's outcome is unknown -- confirm before retrying, because retrying could send a duplicate message.";

/**
 * Wraps one candidate business event into an offer: history first (an
 * accepted send is final), then blockers, then parameter validation.
 * `eligibility` is the event-specific rule; it returns a blocking reason or
 * the reason the message is available plus its params.
 */
async function buildOffer(
  input: WhatsAppEngineInput,
  def: WhatsAppTemplateDef,
  spec: {
    eventKey: string;
    subject: WhatsAppEventSubject;
    invoice: Invoice | null;
    detail: string | null;
    check: () => { blocked: string } | { ok: string; params: string[] };
  },
): Promise<WhatsAppOffer> {
  const history = historyFor(input, spec.eventKey);
  const base = {
    kind: def.kind,
    label: def.label,
    eventKey: spec.eventKey,
    subject: spec.subject,
    detail: spec.detail,
    invoiceNumber: spec.invoice?.invoiceNumber ?? null,
    history,
    ambiguous: history?.outcome === "ambiguous",
    entry: null as WhatsAppChannelEntry | null,
  };
  if (history?.outcome === "accepted") {
    return { ...base, status: "sent", reason: `Accepted by the WhatsApp provider on ${day(history.attemptedAt)} (delivery is not confirmed).`, ambiguous: false };
  }

  const checked = spec.check();
  if ("blocked" in checked) return { ...base, status: "unavailable", reason: capital(checked.blocked) };

  const live = await liveSendBlocker(def, { debtorMobile: input.debtor?.mobile, org: input.org, env: input.env });
  if (live) return { ...base, status: "unavailable", reason: capital(live) };

  const invalid = validateTemplateParams(def, checked.params);
  if (invalid) return { ...base, status: "unavailable", reason: capital(invalid) };

  const entry: WhatsAppChannelEntry = {
    channel: "whatsapp",
    to: input.debtor!.mobile!,
    templateKey: def.templateKey,
    templateVersion: def.templateVersion,
    subject: null,
    body: RENDERERS[def.kind](checked.params),
    templateParams: checked.params,
    idempotencyKey: spec.eventKey,
  };
  const reason =
    history?.outcome === "ambiguous"
      ? AMBIGUOUS_REASON
      : history?.outcome === "rejected"
        ? `${checked.ok} The previous attempt on ${day(history.attemptedAt)} was rejected -- you can retry.`
        : checked.ok;
  return { ...base, status: "available", reason, entry };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1) + (s.endsWith(".") ? "" : ".");

function placeholder(def: WhatsAppTemplateDef, reason: string): WhatsAppOffer {
  return {
    kind: def.kind, label: def.label, eventKey: null, subject: {}, status: "unavailable",
    reason, detail: null, invoiceNumber: null, ambiguous: false, history: null, entry: null,
  };
}

export async function evaluateWhatsAppOffers(input: WhatsAppEngineInput): Promise<WhatsAppOffer[]> {
  // The kill switch is read at most once per evaluation.
  let killSwitch: Promise<boolean> | null = null;
  const memoInput: WhatsAppEngineInput = {
    ...input,
    env: { ...input.env, isAutomationEnabled: () => (killSwitch ??= input.env.isAutomationEnabled()) },
  };
  const { kase, invoices, debtor, org } = memoInput;
  const reminderStates = new Map(
    deriveInvoiceReminderStates({ kase, invoices, communications: memoInput.communications }).map((r) => [r.invoiceId, r]),
  );
  const debtorName = debtor?.name ?? "";
  const creditorName = org?.legalEntityName ?? "";
  const upiId = org?.upiId?.trim() ?? "";
  const upiPayeeName = org?.upiPayeeName?.trim() ?? "";
  const offers: WhatsAppOffer[] = [];

  /* 1 + 2: initial and follow-up reminders -- one offer per invoice (per-invoice identity). */
  const reminderInvoices = invoices.length > 0 ? invoices : [null];
  for (const kind of ["initial_reminder", "followup_reminder"] as const) {
    const def = WHATSAPP_TEMPLATES[kind];
    if (invoices.length === 0) {
      offers.push(placeholder(def, "The case has no invoice to remind about."));
      continue;
    }
    for (const invoice of reminderInvoices as Invoice[]) {
      const eventKey =
        kind === "initial_reminder"
          ? whatsAppEventKeys.initialReminder(kase.id, invoice.id)
          : whatsAppEventKeys.followUpReminder(kase.id, invoice.id);
      const paramsFor = () =>
        buildPaymentReminderInitialV2ParamsFor(kind, {
          debtorName, invoice, creditorName, upiId, upiPayeeName,
        });
      offers.push(
        await buildOffer(memoInput, def, {
          eventKey,
          subject: { invoiceId: invoice.id },
          invoice,
          detail: `Invoice ${invoice.invoiceNumber} — outstanding ₹${formatTemplateAmount(invoice.outstandingBalance)}`,
          check: () => {
            if (invoice.outstandingBalance <= 0) return { blocked: `invoice ${invoice.invoiceNumber} has no outstanding balance` };
            // Invoice-level history decides; the case status only says whether the case is still in its reminder phase.
            const rs = reminderStates.get(invoice.id);
            const stageLabel = kase.status.replace(/_/g, " ");
            if (kind === "initial_reminder") {
              if (kase.status !== "active" && kase.status !== "initial_communication_sent") {
                return { blocked: `initial reminders are only sent while a case is in its reminder stage (this case is "${stageLabel}")` };
              }
              return { ok: "This invoice has not been sent its initial reminder yet.", params: paramsFor() };
            }
            // follow-up: measured from THIS invoice's own initial reminder, independent of every other invoice
            if (kase.status !== "active" && kase.status !== "initial_communication_sent" && kase.status !== "follow_up_sent") {
              return { blocked: `a follow-up is not applicable in the current stage ("${stageLabel}")` };
            }
            if (!rs?.initialAcceptedAt || !rs.followUpDueAt) {
              return { blocked: "this invoice's initial reminder has not been sent yet -- its follow-up becomes available 24 hours after it" };
            }
            if (memoInput.now.getTime() < new Date(rs.followUpDueAt).getTime()) {
              return { blocked: `this invoice's 24-hour response window runs until ${day(rs.followUpDueAt)}` };
            }
            return {
              ok: `No reply or payment was recorded within 24 hours of this invoice's initial reminder (window ended ${day(rs.followUpDueAt)}).`,
              params: paramsFor(),
            };
          },
        }),
      );
    }
  }

  /* 3: commitment reminders -- one per ACTIVE promise. */
  const commitmentDef = WHATSAPP_TEMPLATES.commitment_reminder;
  const activePromises = memoInput.promises.filter((p) => p.status === "active");
  if (activePromises.length === 0) {
    offers.push(placeholder(commitmentDef, "No promise to pay has been recorded for this case."));
  }
  for (const promise of activePromises) {
    const invoice =
      (promise.invoiceId ? invoices.find((i) => i.id === promise.invoiceId) : invoices.length === 1 ? invoices[0] : undefined) ?? null;
    const detail = `Promise for ${formatTemplateDate(promise.promisedOn)}${promise.promisedAmount ? ` of ₹${formatTemplateAmount(promise.promisedAmount)}` : ""}${invoice ? ` — invoice ${invoice.invoiceNumber}` : ""}`;
    offers.push(
      await buildOffer(memoInput, commitmentDef, {
        eventKey: whatsAppEventKeys.commitmentReminder(promise.id),
        subject: { promiseId: promise.id, ...(invoice ? { invoiceId: invoice.id } : {}) },
        invoice,
        detail,
        check: () => {
          if (!invoice) {
            return { blocked: "the promise is not linked to an invoice and the case has several invoices -- re-record it against a specific invoice" };
          }
          if (kase.status !== "promise_to_pay") {
            return { blocked: `the case is no longer in the promise-to-pay stage ("${kase.status.replace(/_/g, " ")}")` };
          }
          if (istDate(memoInput.now) > promise.promisedOn) {
            return { blocked: `the promised date (${formatTemplateDate(promise.promisedOn)}) has passed -- record the debtor's new promise or continue escalation` };
          }
          if (invoice.outstandingBalance <= 0) return { blocked: `invoice ${invoice.invoiceNumber} has no outstanding balance` };
          const dueToday = istDate(memoInput.now) === promise.promisedOn;
          const amountDue = Math.min(promise.promisedAmount ?? invoice.outstandingBalance, invoice.outstandingBalance);
          return {
            ok: dueToday
              ? "The promised payment date is today."
              : `A promise to pay on ${formatTemplateDate(promise.promisedOn)} is recorded for this invoice.`,
            params: buildCommitmentReminderV2Params({
              debtorName, invoiceNumber: invoice.invoiceNumber, promisedOn: promise.promisedOn,
              amountDuePaise: amountDue, creditorName, upiId, upiPayeeName,
            }),
          };
        },
      }),
    );
  }

  const paymentsById = new Map(memoInput.payments.map((p) => [p.id, p]));

  /* Closed-message structure (also decides whether "received" is suppressed). */
  const sortedAllocations = [...memoInput.allocations].sort(
    (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1),
  );
  const soleInvoice = invoices.length === 1 ? invoices[0] : null;
  const settlement =
    soleInvoice && kase.status === "recovered" && kase.principalOutstanding === 0 && soleInvoice.outstandingBalance === 0
      ? (() => {
          const forInvoice = sortedAllocations.filter((a) => a.invoiceId === soleInvoice.id);
          const settling = forInvoice[forInvoice.length - 1];
          return settling ? { invoice: soleInvoice, settling, forInvoice, totalPaid: forInvoice.reduce((sum, a) => sum + a.amount, 0) } : null;
        })()
      : null;
  // The approved template says "Total Amount Paid". The application only knows
  // payments RECORDED against the case, not lifetime payments (part of an
  // invoice may have been paid before the case was opened, or cleared by a
  // credit note / TDS / settlement). The message may therefore only be offered
  // when the recorded cash payments demonstrably equal the whole invoice total;
  // otherwise a recovery-only amount would be presented as a lifetime total.
  const totalPaidProblem = settlement ? unreliableTotalPaidReason(settlement.invoice, settlement.forInvoice, paymentsById) : null;
  const closeStructure = settlement && !totalPaidProblem ? settlement : null;

  /* 4: payment received -- one per confirmed allocation. */
  const receivedDef = WHATSAPP_TEMPLATES.payment_received;
  const receivedRows = [...sortedAllocations].reverse().filter((a) => paymentsById.get(a.paymentRecordId)?.clientConfirmed);
  if (receivedRows.length === 0) {
    offers.push(placeholder(receivedDef, "No confirmed payment has been recorded against an invoice of this case."));
  }
  for (const alloc of receivedRows) {
    const payment = paymentsById.get(alloc.paymentRecordId)!;
    const invoice = invoices.find((i) => i.id === alloc.invoiceId) ?? null;
    const later = sortedAllocations
      .slice(sortedAllocations.indexOf(alloc) + 1)
      .filter((a) => a.invoiceId === alloc.invoiceId)
      .reduce((s, a) => s + a.amount, 0);
    const balanceAfter = invoice ? invoice.outstandingBalance + later : 0;
    offers.push(
      await buildOffer(memoInput, receivedDef, {
        eventKey: whatsAppEventKeys.paymentReceived(payment.id, alloc.invoiceId),
        subject: { paymentId: payment.id, invoiceId: alloc.invoiceId },
        invoice,
        detail: `Payment of ₹${formatTemplateAmount(alloc.amount)} received on ${formatTemplateDate(payment.receivedOn)}${invoice ? ` against invoice ${invoice.invoiceNumber}` : ""}`,
        check: () => {
          if (!invoice) return { blocked: "the invoice this payment was applied to could not be found" };
          if (closeStructure && closeStructure.settling.id === alloc.id) {
            return { blocked: "this payment settled the invoice in full -- send the Payment Closed confirmation instead (the two are never both sent)" };
          }
          return {
            ok: "A payment has been recorded and confirmed against this invoice.",
            params: buildPaymentReceivedV2Params({
              debtorName, creditorName, invoiceNumber: invoice.invoiceNumber, amountReceivedPaise: alloc.amount,
              receivedOn: payment.receivedOn, balanceOutstandingPaise: balanceAfter,
            }),
          };
        },
      }),
    );
  }

  /* 5: payment closed -- the single-invoice settlement event. */
  const closedDef = WHATSAPP_TEMPLATES.payment_closed;
  if (closeStructure) {
    const { invoice, settling, totalPaid } = closeStructure;
    const payment = paymentsById.get(settling.paymentRecordId);
    offers.push(
      await buildOffer(memoInput, closedDef, {
        eventKey: whatsAppEventKeys.paymentClosed(kase.id, invoice.id, settling.paymentRecordId),
        subject: { paymentId: settling.paymentRecordId, invoiceId: invoice.id },
        invoice,
        detail: `Invoice ${invoice.invoiceNumber} fully paid — total ₹${formatTemplateAmount(totalPaid)}`,
        check: () =>
          !payment
            ? { blocked: "the settling payment could not be found" }
            : {
                ok: "The outstanding balance is zero and the case is recovered.",
                params: buildPaymentClosedV2Params({
                  debtorName, creditorName, invoiceNumber: invoice.invoiceNumber, totalPaidPaise: totalPaid, settledOn: payment.receivedOn,
                }),
              },
      }),
    );
  } else {
    let reason: string;
    if (invoices.length === 0) reason = "The case has no invoice.";
    else if (invoices.length > 1) reason = "This case has several invoices -- consolidated closed messages are not supported yet, so no single invoice can be named.";
    else if (totalPaidProblem) reason = totalPaidProblem;
    else if (kase.status !== "recovered") reason = "Available once the invoice is fully paid and the case is recovered.";
    else if (kase.principalOutstanding !== 0 || invoices[0].outstandingBalance !== 0) {
      reason = `An outstanding balance of ₹${formatTemplateAmount(Math.max(kase.principalOutstanding, invoices[0].outstandingBalance))} remains.`;
    } else reason = "No confirmed payment has been recorded against this invoice.";
    offers.push(placeholder(closedDef, reason));
  }

  return offers;
}

/**
 * Why "Total Amount Paid" cannot be stated truthfully for this settlement, or
 * null when it can (recorded BANK/CASH payments add up to exactly the invoice
 * total).
 */
function unreliableTotalPaidReason(
  invoice: Invoice,
  allocations: PaymentAllocation[],
  paymentsById: Map<string, PaymentRecord>,
): string | null {
  const notReceivedAsMoney = allocations.some((a) => {
    const kind = paymentsById.get(a.paymentRecordId)?.kind;
    return kind !== "bank" && kind !== "cash";
  });
  if (notReceivedAsMoney) {
    return "The total paid cannot be stated reliably: the settlement includes TDS, credit-note or settlement entries, which are not payments received. The Payment Received confirmation is available instead.";
  }
  const recorded = allocations.reduce((sum, a) => sum + a.amount, 0);
  if (recorded === invoice.invoiceTotal) return null;
  const detail =
    recorded < invoice.invoiceTotal
      ? `₹${formatTemplateAmount(invoice.invoiceTotal - recorded)} was settled outside the recorded payments, for example before this case was opened`
      : "the recorded payments exceed the invoice total";
  return `The total paid cannot be stated reliably: recorded payments total ₹${formatTemplateAmount(recorded)}, but the invoice total is ₹${formatTemplateAmount(invoice.invoiceTotal)} (${detail}). The Payment Received confirmation is available instead.`;
}

function buildPaymentReminderInitialV2ParamsFor(
  kind: "initial_reminder" | "followup_reminder",
  a: { debtorName: string; invoice: Invoice; creditorName: string; upiId: string; upiPayeeName: string },
): string[] {
  const input = {
    debtorName: a.debtorName,
    invoiceNumber: a.invoice.invoiceNumber,
    invoiceAmountPaise: a.invoice.invoiceTotal,
    dueDate: a.invoice.dueDate,
    outstandingAmountPaise: a.invoice.outstandingBalance,
    creditorName: a.creditorName,
    upiId: a.upiId,
    upiPayeeName: a.upiPayeeName,
  };
  return kind === "initial_reminder" ? buildPaymentReminderInitialV2Params(input) : buildFollowUpReminderV2Params(input);
}
