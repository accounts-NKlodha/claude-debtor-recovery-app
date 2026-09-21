/**
 * Repository-independent orchestration of the five WhatsApp message
 * families. Both SupabaseRepository and MemoryRepository call these two
 * functions, so offer matching, authorization and outcome mapping exist
 * exactly once. The durable send itself (begin_communication_send ->
 * begin_delivery_attempt -> adapter -> complete_delivery_attempt) is
 * supplied by the repository as `sendChannel`, which is the existing,
 * already-verified idempotent pipeline -- this module adds the business
 * event identity on top, never a second send path.
 *
 * V1: every send is operator-triggered. Nothing here runs on a schedule.
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
import {
  evaluateWhatsAppOffers,
  type LiveSendEnv,
  type WhatsAppChannelEntry,
  type WhatsAppOffer,
} from "@/domain/whatsapp-messages";
import type { WhatsAppMessageKind } from "@/domain/whatsapp-templates";
import {
  deriveInvoiceReminderStates,
  summarizeReminderStage,
  type InvoiceReminderState,
  type ReminderStageSummary,
} from "@/domain/reminder-stage";

/** The read side both repositories already implement. */
export interface WhatsAppDataSource {
  getCase(id: string): Promise<RecoveryCase | undefined>;
  getDebtor(id: string): Promise<Debtor | undefined>;
  getOrg(id: string): Promise<Organisation | undefined>;
  listInvoicesForCase(caseId: string): Promise<Invoice[]>;
  listPaymentsForCase(caseId: string): Promise<PaymentRecord[]>;
  listAllocationsForCase(caseId: string): Promise<PaymentAllocation[]>;
  listPromisesForCase(caseId: string): Promise<PaymentPromise[]>;
  listCommunicationsForCase(caseId: string): Promise<Communication[]>;
  listDeliveriesForCommunication(communicationId: string): Promise<CommunicationDelivery[]>;
}

export interface ChannelSendResult {
  communication: Communication;
  outcome: "success" | "already_sent" | "retryable_failure" | "permanent_failure" | "human_action_required" | "drift_detected";
  ambiguousBlock: boolean;
}

export interface WhatsAppFlowDeps {
  source: WhatsAppDataSource;
  env: () => LiveSendEnv;
  /** The existing durable, idempotent per-channel send, keyed by the entry's business-event key. */
  sendChannel: (caseId: string, entry: WhatsAppChannelEntry, forceRetryAfterAmbiguous: boolean, reasonLabel: string) => Promise<ChannelSendResult>;
  /**
   * Applies + persists (with audit) the case update after the provider
   * accepted a follow-up. `summary` is the invoice-level aggregate AFTER that
   * follow-up: the case only advances as far as its slowest outstanding
   * invoice allows (see src/domain/reminder-stage.ts).
   */
  advanceAfterFollowUp: (kase: RecoveryCase, summary: ReminderStageSummary | null, detail: string) => Promise<RecoveryCase>;
  now?: () => Date;
}

/**
 * Invoice-level reminder stage of a case, derived from the durable
 * communication history (plus any communications just written, which a
 * read-after-write lag could otherwise miss).
 */
export async function computeReminderStage(
  source: Pick<WhatsAppDataSource, "getCase" | "listInvoicesForCase" | "listCommunicationsForCase">,
  caseId: string,
  justWritten: Communication[] = [],
): Promise<{ summary: ReminderStageSummary | null; states: InvoiceReminderState[] }> {
  const [kase, invoices, stored] = await Promise.all([
    source.getCase(caseId),
    source.listInvoicesForCase(caseId),
    source.listCommunicationsForCase(caseId),
  ]);
  if (!kase) throw new Error(`reminder stage: case ${caseId} not found`);
  const communications = [...stored.filter((c) => !justWritten.some((w) => w.id === c.id)), ...justWritten];
  const states = deriveInvoiceReminderStates({ kase, invoices, communications });
  return { summary: summarizeReminderStage(states), states };
}

export async function getWhatsAppOffersFlow(deps: WhatsAppFlowDeps, caseId: string): Promise<WhatsAppOffer[]> {
  const { source } = deps;
  const kase = await source.getCase(caseId);
  if (!kase) throw new Error(`WhatsApp messages: case ${caseId} not found`);
  const [debtor, org, invoices, payments, allocations, promises, communications] = await Promise.all([
    source.getDebtor(kase.debtorId),
    source.getOrg(kase.organisationId),
    source.listInvoicesForCase(caseId),
    source.listPaymentsForCase(caseId),
    source.listAllocationsForCase(caseId),
    source.listPromisesForCase(caseId),
    source.listCommunicationsForCase(caseId),
  ]);
  const deliveriesByCommunication: Record<string, CommunicationDelivery[]> = {};
  for (const c of communications) {
    if (c.channel === "whatsapp" && c.idempotencyKey?.startsWith("wa:")) {
      deliveriesByCommunication[c.id] = await source.listDeliveriesForCommunication(c.id);
    }
  }
  return evaluateWhatsAppOffers({
    now: (deps.now ?? (() => new Date()))(),
    env: deps.env(),
    kase, debtor, org, invoices, payments, allocations, promises, communications, deliveriesByCommunication,
  });
}

export type WhatsAppSendStatus = "accepted" | "rejected" | "ambiguous" | "already_sent";

export interface WhatsAppSendResult {
  kind: WhatsAppMessageKind;
  eventKey: string;
  status: WhatsAppSendStatus;
  communication: Communication | null;
  case: RecoveryCase;
}

/**
 * Sends ONE approved WhatsApp message for ONE business event. The client
 * only names the event (`eventKey`); eligibility, recipient, parameters and
 * body are all recomputed here from durable data with the very same engine
 * that rendered the UI, so a forged or stale request can never send
 * something the engine would refuse.
 */
export async function sendWhatsAppMessageFlow(
  deps: WhatsAppFlowDeps,
  input: { caseId: string; eventKey: string; forceRetryAfterAmbiguous: boolean },
): Promise<WhatsAppSendResult> {
  const offers = await getWhatsAppOffersFlow(deps, input.caseId);
  const offer = offers.find((o) => o.eventKey === input.eventKey);
  const kase = (await deps.source.getCase(input.caseId))!;
  if (!offer) throw new Error("That WhatsApp message is not available for this case.");

  if (offer.status === "sent") {
    // A double-click / retry of an event the provider already accepted: no second message, ever.
    return { kind: offer.kind, eventKey: input.eventKey, status: "already_sent", communication: null, case: kase };
  }
  if (offer.status !== "available" || !offer.entry) {
    throw new Error(`${offer.label} not sent: ${offer.reason}`);
  }

  const result = await deps.sendChannel(input.caseId, offer.entry, input.forceRetryAfterAmbiguous, offer.label);
  if (result.ambiguousBlock) {
    return { kind: offer.kind, eventKey: input.eventKey, status: "ambiguous", communication: result.communication, case: kase };
  }
  const accepted = result.outcome === "success" || result.outcome === "already_sent";
  if (!accepted) {
    return { kind: offer.kind, eventKey: input.eventKey, status: "rejected", communication: result.communication, case: kase };
  }

  let updatedCase = kase;
  if (offer.kind === "followup_reminder") {
    const { summary } = await computeReminderStage(deps.source, input.caseId, result.communication ? [result.communication] : []);
    updatedCase = await deps.advanceAfterFollowUp(kase, summary, `Follow-up reminder accepted for invoice ${offer.invoiceNumber ?? ""}`.trim());
  }
  return { kind: offer.kind, eventKey: input.eventKey, status: "accepted", communication: result.communication, case: updatedCase };
}
