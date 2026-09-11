/**
 * In-memory Repository implementation, backed by the demo dataset in
 * `src/lib/mock-data.ts`. This is the default until a Supabase project is
 * configured (see `../repo.ts`). Every method is async to match the
 * interface real storage will need, and returns defensive copies so callers
 * can't mutate shared demo state.
 */

import { nanoid } from "nanoid";
import * as mock from "@/lib/mock-data";
import { applyConfirmedPayment } from "@/domain/apply-payment";
import {
  applyReminderDelivered,
  applyReminderDeliveryFailed,
  applyReminderSent,
  buildReminderMessage,
} from "@/domain/reminder";
import { runAdapter } from "@/orchestrator/run-adapter";
import { getAdapters } from "@/adapters";
import type { Communication, PaymentRecord } from "@/contract/types";
import type { AgeingBucket, DashboardKpis, Repository, StagePoint, TrendPoint } from "../repository";

async function tick<T>(value: T): Promise<T> {
  // Yield a microtask so this behaves like a real async boundary in tests
  // and doesn't let callers accidentally rely on synchronous resolution.
  return Promise.resolve(value);
}

export class MemoryRepository implements Repository {
  async getOrg(id: string) {
    return tick(mock.getOrg(id));
  }
  async listOrganisations() {
    return tick([...mock.ORGANISATIONS]);
  }
  async getDebtor(id: string) {
    return tick(mock.getDebtor(id));
  }
  async assigneeName(id: string | null) {
    return tick(mock.assigneeName(id));
  }

  async getCase(id: string) {
    return tick(mock.getCase(id));
  }
  async listAllCases() {
    return tick([...mock.CASES]);
  }
  async listCasesForOrg(orgId: string) {
    return tick(mock.listCasesForOrg(orgId));
  }
  async caseRows(orgId?: string) {
    return tick(mock.caseRows(orgId));
  }

  async listInvoicesForCase(caseId: string) {
    return tick(mock.listInvoicesForCase(caseId));
  }
  async listCommunicationsForCase(caseId: string) {
    return tick(mock.listCommunicationsForCase(caseId));
  }
  async listPaymentsForCase(caseId: string) {
    return tick(mock.listPaymentsForCase(caseId));
  }
  async listTasksForCase(caseId: string) {
    return tick(mock.listTasksForCase(caseId));
  }

  async listAllCommunications() {
    return tick([...mock.COMMUNICATIONS]);
  }
  async listAllPayments() {
    return tick([...mock.PAYMENTS]);
  }
  async openTasks(orgId?: string) {
    const open = mock.openTasks();
    return tick(orgId ? open.filter((t) => t.organisationId === orgId) : open);
  }
  async urgentQueue(orgId?: string) {
    return tick(mock.urgentQueue(orgId));
  }

  async dashboardKpis(): Promise<DashboardKpis> {
    return tick(mock.computeDashboardKpis());
  }
  async recoveryTrend(): Promise<TrendPoint[]> {
    return tick([...mock.RECOVERY_TREND]);
  }
  async ageingBuckets(): Promise<AgeingBucket[]> {
    return tick([...mock.AGEING_BUCKETS]);
  }
  async stageFunnel(): Promise<StagePoint[]> {
    return tick([...mock.STAGE_FUNNEL]);
  }
  async clientOverview(orgId: string) {
    return tick(mock.clientOverview(orgId));
  }

  async bulkImport(fileName: string) {
    return tick(mock.stubBulkImport(fileName));
  }

  async recordPayment(input: {
    caseId: string;
    kind: PaymentRecord["kind"];
    amount: number;
    reference: string | null;
    clientConfirmed: boolean;
  }) {
    const payment: PaymentRecord = {
      id: `pay-${nanoid(8)}`,
      caseId: input.caseId,
      organisationId: mock.getCase(input.caseId)?.organisationId ?? "",
      kind: input.kind,
      amount: input.amount,
      receivedOn: new Date().toISOString().slice(0, 10),
      reference: input.reference,
      clientConfirmed: false, // apply confirmation via the shared path below
      createdAt: new Date().toISOString(),
    };
    mock.insertPayment(payment);
    mock.appendAudit({
      action: "payment.recorded",
      entity: "payment_record",
      entityId: payment.id,
      reason: `${input.kind} receipt of ${input.amount} paise recorded for case ${input.caseId}`,
    });

    if (!input.clientConfirmed) return tick({ payment, updatedCase: null });

    const { updatedCase } = await this.confirmPayment(payment.id);
    const confirmed = mock.PAYMENTS.find((p) => p.id === payment.id)!;
    return tick({ payment: confirmed, updatedCase });
  }

  async confirmPayment(paymentId: string) {
    const payment = mock.markPaymentConfirmed(paymentId);
    const kase = mock.getCase(payment.caseId);
    if (!kase) throw new Error(`confirmPayment: case ${payment.caseId} not found`);

    const invoices = mock.listInvoicesForCase(kase.id);
    const result = applyConfirmedPayment(
      kase,
      invoices.map((i) => ({ id: i.id, invoiceDate: i.invoiceDate, outstandingBalance: i.outstandingBalance })),
      payment.amount,
    );

    for (const alloc of result.invoiceAllocations) {
      mock.mutateInvoice(alloc.invoiceId, { outstandingBalance: alloc.balanceAfter });
    }
    const updatedCase = mock.mutateCase(kase.id, result.updatedCase);
    mock.appendAudit({
      action: "payment.confirmed",
      entity: "recovery_case",
      entityId: kase.id,
      reason: result.note,
    });

    return tick({ payment, updatedCase });
  }

  async sendInitialReminder(caseId: string) {
    const kase = mock.getCase(caseId);
    if (!kase) throw new Error(`sendInitialReminder: case ${caseId} not found`);
    if (kase.status !== "active") {
      throw new Error(
        `sendInitialReminder: case ${caseId} is "${kase.status}", not "active" -- nothing to send`,
      );
    }
    const debtor = mock.getDebtor(kase.debtorId);
    const org = mock.getOrg(kase.organisationId);
    const invoice = mock.listInvoicesForCase(caseId)[0];

    const body = buildReminderMessage({
      legalEntityName: org?.legalEntityName ?? "our client",
      debtorName: debtor?.name ?? "—",
      invoiceNumber: invoice?.invoiceNumber ?? null,
      amountPaise: kase.principalOutstanding,
    });

    const idempotencyKey = `reminder-initial:${caseId}:${new Date().toISOString().slice(0, 10)}`;
    const adapters = getAdapters();
    const sendOutcome = await runAdapter(
      (key) =>
        adapters.whatsapp.send({
          idempotencyKey: key,
          caseId,
          channel: "whatsapp",
          to: debtor?.mobile ?? "unknown",
          templateKey: "reminder_initial_v3",
          templateVersion: 3,
          body,
        }),
      idempotencyKey,
    );

    const communication = mock.insertCommunication({
      id: `com-${nanoid(8)}`,
      caseId,
      organisationId: kase.organisationId,
      channel: "whatsapp",
      direction: "outbound",
      templateKey: "reminder_initial_v3",
      templateVersion: 3,
      subject: null,
      body,
      providerMessageId: sendOutcome.result.providerRef,
      threadRef: `thread-${caseId}`,
      deliveryStatus: sendOutcome.result.outcome === "success" ? "sent" : "failed",
      hasSecureLink: false,
      replyClassification: null,
      reviewedById: null,
      createdAt: new Date().toISOString(),
      deliveredAt: null,
    } satisfies Communication);

    if (sendOutcome.result.outcome !== "success") {
      const sentPatch = applyReminderSent(kase);
      const failed = applyReminderDeliveryFailed(sentPatch.updatedCase, true);
      const updatedCase = mock.mutateCase(caseId, failed.updatedCase);
      mock.appendAudit({
        action: "reminder.delivery_failed",
        entity: "recovery_case",
        entityId: caseId,
        reason: `${sendOutcome.urgentTask?.reason ?? sendOutcome.result.errorCode ?? "adapter failure"} -- ${failed.note}`,
      });
      return tick({ case: updatedCase, communication });
    }

    const sent = applyReminderSent(kase);
    mock.mutateCase(caseId, sent.updatedCase);

    // Demo simplification: the mock adapter has no real delivery webhook, so
    // delivery is simulated immediately rather than waiting for one. A live
    // adapter's parseWebhook() result would drive this transition instead.
    const deliveredAt = new Date();
    const delivered = applyReminderDelivered(sent.updatedCase, deliveredAt);
    const updatedCase = mock.mutateCase(caseId, delivered.updatedCase);
    const deliveredCommunication = mock.mutateCommunication(communication.id, {
      deliveryStatus: "delivered",
      deliveredAt: deliveredAt.toISOString(),
    });

    mock.appendAudit({
      action: "reminder.sent",
      entity: "recovery_case",
      entityId: caseId,
      reason: `${sent.note}; ${delivered.note}`,
    });

    return tick({ case: updatedCase, communication: deliveredCommunication });
  }
}
