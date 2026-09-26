/**
 * In-memory Repository implementation, backed by the demo dataset in
 * `src/lib/mock-data.ts`. This is the default until a Supabase project is
 * configured (see `../repo.ts`). Every method is async to match the
 * interface real storage will need, and returns defensive copies so callers
 * can't mutate shared demo state.
 */

import { buildReminderEmail } from "@/domain/reminder-email";
import { AUTOMATION_BLOCKED_AUDIT_ACTION, assertAutomationEnabled } from "@/domain/automation-guard";
import { buildGstFiledReason, GST_EVIDENCE_ACTIONS, reconstructGstEvidence } from "@/domain/gst-evidence";
import { nanoid } from "nanoid";
import * as mock from "@/lib/mock-data";
import { istBusinessDate } from "@/domain/scheduling";
import { applyConfirmedPayment } from "@/domain/apply-payment";
import {
  applyFollowUpSent,
  applyReminderStage,
  applyReminderDelivered,
  applyReminderDeliveryFailed,
  applyReminderSent,
  buildReminderMessage,
  buildReminderSubject,
} from "@/domain/reminder";
import { applyGstAutomationFailed, applyGstFiled, applyGstPrepared } from "@/domain/gst";
import { applyMsmeAutomationFailed, applyMsmeFiled } from "@/domain/msme";
import {
  applyDdPrepared,
  applyHearingAdjourned,
  applyHearingOutcome,
  applyHearingScheduled,
} from "@/domain/hearing";
import { applyReplyClassified } from "@/domain/debtor-reply";
import { applyOcrCorrected } from "@/domain/ocr";
import {
  ACTIVATION_EVIDENCE_ACTIONS,
  activationEvidenceFrom,
  applyActivationGates,
  evaluateActivationGates,
  isPreActivation,
  type ActivationGates,
} from "@/domain/activation";
import { createDraftCase, type IntakeInvoiceInput } from "@/domain/intake";
import { parseCsv, parseDate, parseMoney, validateImport } from "@/domain/bulk-import";
import { runAdapter } from "@/orchestrator/run-adapter";
import { getAdapters, isLiveWhatsAppConfigured } from "@/adapters";
import { isProductionRuntime } from "@/lib/config/production";
import { planWhatsAppReminder } from "@/domain/whatsapp-reminder";
import type { LiveSendEnv } from "@/domain/whatsapp-messages";
import { hasAcceptedEmailInitial } from "@/domain/reminder-stage";
import { applyPromiseRecorded, validatePromiseDate } from "@/domain/promise";
import { isWhatsAppCampaignConfigured } from "@/lib/config/aisensy";
import {
  computeReminderStage,
  getWhatsAppOffersFlow,
  sendWhatsAppMessageFlow,
  type WhatsAppFlowDeps,
} from "@/server/whatsapp-orchestrator";
import type { RecordPaymentPromiseInput } from "@/contract/schemas";
import {
  gstComposeSchema,
  type DebtorContactInput,
  type GstComposeInput,
  type ManualInvoiceInput,
} from "@/contract/schemas";
import type { MsmeStage } from "@/contract/adapters";
import { applyMsmeDraftLock, applyMsmeStageSave, type MsmeDraft } from "@/domain/msme-draft";
import type { Channel, ReplyClassification } from "@/contract/enums";
import type { Communication, Invoice, Organisation, PaymentRecord, RecoveryCase } from "@/contract/types";
import type { MutationActor } from "@/lib/auth/types";
import type {
  AgeingBucket,
  CreateOrganisationResult,
  DashboardKpis,
  Repository,
  StagePoint,
  TrendPoint,
} from "../repository";

async function tick<T>(value: T): Promise<T> {
  // Yield a microtask so this behaves like a real async boundary in tests
  // and doesn't let callers accidentally rely on synchronous resolution.
  return Promise.resolve(value);
}

/** (debtor_gstin|debtor_name)::invoice_number keys already in the system, for
 * the bulk importer's duplicate check (matches src/domain/bulk-import.ts). */
function buildKnownInvoiceKeys(): Set<string> {
  return new Set(
    mock.INVOICES.map((inv) => {
      const debtor = mock.getDebtor(inv.debtorId);
      const key = (debtor?.gstin || debtor?.name || "").toLowerCase();
      return `${key}::${inv.invoiceNumber.toLowerCase()}`;
    }),
  );
}

/** Save & resume drafts for demo mode; lives with the process like the rest of the mock data. */
const msmeDrafts = new Map<string, MsmeDraft>();

export class MemoryRepository implements Repository {
  /**
   * The in-memory repository holds demo/test data, so by default it can
   * NEVER take the live WhatsApp path -- even if WHATSAPP_PROVIDER=aisensy is
   * present in the environment (e.g. a developer's .env.local kept for a
   * controlled live test), a demo debtor must never be messaged for real.
   * Only tests opt in, with fake adapters, to exercise the V2 pipeline.
   */
  constructor(private readonly options: { allowLiveWhatsApp?: boolean } = {}) {}

  async getOrg(id: string) {
    return tick(mock.getOrg(id));
  }
  async listOrganisations() {
    return tick([...mock.ORGANISATIONS]);
  }

  async createOrganisation(
    input: import("@/contract/schemas").CreateOrganisationInput,
    actor: MutationActor,
  ): Promise<CreateOrganisationResult> {
    if (mock.findOrgByClientCode(input.clientCode)) {
      throw new Error(`createOrganisation: client code "${input.clientCode}" is already in use`);
    }
    if (input.creditorGstin && mock.findOrgByGstin(input.creditorGstin)) {
      throw new Error(
        `createOrganisation: creditor GSTIN "${input.creditorGstin}" is already registered to another client`,
      );
    }
    const nameCollision = mock.findOrgByName(input.legalEntityName);
    if (nameCollision && !input.confirmDuplicateName) {
      return tick({
        status: "duplicate_name_warning",
        existingOrganisation: {
          id: nameCollision.id,
          clientCode: nameCollision.clientCode,
          legalEntityName: nameCollision.legalEntityName,
        },
      });
    }

    const organisation = mock.insertOrganisation({
      id: `org-${nanoid(8)}`,
      clientCode: input.clientCode,
      legalEntityName: input.legalEntityName,
      creditorGstin: input.creditorGstin ?? null,
      udyamNumber: input.udyamNumber ?? null,
      jitoMember: input.jitoMember,
      upiId: null,
      upiPayeeName: null,
      createdAt: new Date().toISOString(),
    });
    mock.appendAudit({
      action: "organisation.created",
      entity: "organisation",
      entityId: organisation.id,
      reason: nameCollision
        ? `New client onboarded: ${organisation.legalEntityName} (${organisation.clientCode}) -- ` +
          `staff confirmed this is distinct from existing client ${nameCollision.clientCode}; ` +
          `override reason: ${input.duplicateOverrideReason}`
        : `New client onboarded: ${organisation.legalEntityName} (${organisation.clientCode})`,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
    });
    return tick({ status: "created", organisation });
  }

  async updateOrganisationPaymentDetails(
    organisationId: string,
    input: import("@/contract/schemas").OrganisationPaymentDetailsInput,
    actor: MutationActor,
  ): Promise<Organisation> {
    if (!mock.getOrg(organisationId)) {
      throw new Error(`updateOrganisationPaymentDetails: organisation ${organisationId} not found`);
    }
    const updated = mock.updateOrganisationPaymentDetails(organisationId, input.upiId, input.upiPayeeName)!;
    // Change indicators only -- never the UPI values (mirrors the RPC).
    mock.appendAudit({
      action: "organisation.payment_details_updated",
      entity: "organisation",
      entityId: organisationId,
      reason: input.reason,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
    });
    return tick(updated);
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
  async listAllocationsForCase(caseId: string) {
    return tick(mock.listAllocationsForCase(caseId));
  }
  async getDdRecord(caseId: string) {
    return tick(mock.getDdRecord(caseId));
  }
  async listHearingsForCase(caseId: string) {
    return tick(mock.listHearingsForCase(caseId));
  }
  async listDebtorRepliesForCase(caseId: string) {
    return tick(mock.listDebtorRepliesForCase(caseId));
  }
  async listDeliveriesForCommunication(communicationId: string) {
    return tick(mock.listDeliveriesForCommunication(communicationId));
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

  async createCaseFromManualInvoice(
    organisationId: string,
    input: ManualInvoiceInput,
    actor: MutationActor,
  ) {
    const org = mock.getOrg(organisationId);
    if (!org) throw new Error(`createCaseFromManualInvoice: organisation ${organisationId} not found`);

    let debtor = mock.findDebtorByName(organisationId, input.debtorName);
    if (!debtor) {
      debtor = mock.insertDebtor({
        id: `deb-${nanoid(8)}`,
        organisationId,
        name: input.debtorName,
        mobile: input.debtorMobile ?? null,
        email: input.debtorEmail ?? null,
        gstin: input.debtorGstin ?? null,
        address: null,
        contactVerified: false,
        totalDue: input.outstandingBalance,
      });
    } else if ((input.debtorMobile && !debtor.mobile) || (input.debtorEmail && !debtor.email)) {
      // Populate only whichever contact field is currently missing on the
      // matched existing debtor -- never overwrite an already-set value
      // (mirrors create_case_from_invoice's Supabase behavior,
      // 0020_debtor_contact_update.sql).
      debtor = mock.mutateDebtor(debtor.id, {
        mobile: debtor.mobile ?? input.debtorMobile ?? null,
        email: debtor.email ?? input.debtorEmail ?? null,
      });
    }

    const intakeInput: IntakeInvoiceInput = {
      debtorName: input.debtorName,
      debtorGstin: input.debtorGstin ?? null,
      invoiceNumber: input.invoiceNumber,
      invoiceDate: input.invoiceDate,
      taxableValue: input.taxableValue,
      taxRate: input.taxRate,
      taxAmount: input.taxAmount,
      invoiceTotal: input.invoiceTotal,
      outstandingBalance: input.outstandingBalance,
    };
    const { state, transitions } = createDraftCase(input.outstandingBalance, intakeInput);

    const now = new Date().toISOString();
    const caseId = `case-${nanoid(8)}`;
    const kase: RecoveryCase = {
      id: caseId,
      organisationId,
      debtorId: debtor.id,
      status: state.status,
      automationMode: "assist",
      waitingOn: state.waitingOn,
      automationStartedAt: now,
      currentStep: transitions[transitions.length - 1]?.note ?? "Under validation",
      blocker: state.blocker,
      nextScheduledAction: state.nextAction,
      nextScheduledAt: null,
      eligibilityRoute: state.eligibilityRoute,
      principalOutstanding: state.principalOutstanding,
      recoveredToDate: 0,
      assigneeId: null,
      groupKey: null,
      createdAt: now,
      activatedAt: null,
      closedAt: null,
    };
    mock.insertCase(kase);

    const invoice: Invoice = {
      id: `inv-${nanoid(8)}`,
      caseId,
      organisationId,
      debtorId: debtor.id,
      invoiceNumber: input.invoiceNumber,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate ?? null,
      taxableValue: input.taxableValue,
      taxRate: input.taxRate,
      taxAmount: input.taxAmount,
      invoiceTotal: input.invoiceTotal,
      outstandingBalance: input.outstandingBalance,
      sourceDocumentId: null,
      extractionConfidence: null,
    };
    mock.insertInvoice(invoice);

    mock.appendAudit({
      action: "case.created_from_intake",
      entity: "recovery_case",
      entityId: caseId,
      reason: `Draft case created from manual invoice entry -- ${transitions.map((t) => t.note).join("; ")}`,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
    });

    return tick({ case: kase, invoice, debtor });
  }

  async updateDebtorContact(
    debtorId: string,
    input: DebtorContactInput,
    reason: string,
    actor: MutationActor,
  ) {
    const before = mock.getDebtor(debtorId);
    if (!before) throw new Error(`updateDebtorContact: debtor ${debtorId} not found`);
    const emailChanged = before.email !== (input.email ?? null);
    const mobileChanged = before.mobile !== (input.mobile ?? null);
    const updated = mock.mutateDebtor(debtorId, {
      email: input.email ?? null,
      mobile: input.mobile ?? null,
    });
    mock.appendAudit({
      action: "debtor.contact_updated",
      entity: "debtor",
      entityId: debtorId,
      reason: `${reason} (email changed: ${emailChanged}, mobile changed: ${mobileChanged})`,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
    });
    return tick(updated);
  }

  async validateBulkImport(csvText: string) {
    const known = buildKnownInvoiceKeys();
    return tick(validateImport(csvText, { knownInvoiceKeys: known }));
  }

  async commitBulkImport(organisationId: string, csvText: string, actor: MutationActor) {
    const org = mock.getOrg(organisationId);
    if (!org) throw new Error(`commitBulkImport: organisation ${organisationId} not found`);

    const known = buildKnownInvoiceKeys();
    const result = validateImport(csvText, { knownInvoiceKeys: known });
    const grid = parseCsv(csvText);
    const header = (grid[0] ?? []).map((h) => h.trim().toLowerCase());
    const idx = Object.fromEntries(header.map((h, i) => [h, i]));

    let casesCreated = 0;
    for (const row of result.preview) {
      const raw = grid[row.rowNumber - 1];
      if (!raw) continue;
      const cell = (col: string) => (raw[idx[col]] ?? "").trim();
      const invoiceDate = parseDate(cell("invoice_date")) ?? istBusinessDate(new Date());
      const dueDate = cell("due_date") ? parseDate(cell("due_date")) : null;
      const totalDue = parseMoney(cell("total_due")) ?? row.totalDue;

      await this.createCaseFromManualInvoice(
        organisationId,
        {
          debtorName: cell("debtor_name"),
          debtorGstin: cell("debtor_gstin") || null,
          invoiceNumber: cell("invoice_number"),
          invoiceDate,
          dueDate,
          taxableValue: parseMoney(cell("taxable_value")) ?? 0,
          taxRate: Number(cell("tax_rate")) || 0,
          taxAmount: parseMoney(cell("tax_amount")) ?? 0,
          invoiceTotal: parseMoney(cell("invoice_total")) ?? totalDue,
          outstandingBalance: totalDue,
        },
        actor,
      );
      casesCreated++;
    }

    mock.appendAudit({
      action: "bulk_import.committed",
      entity: "organisation",
      entityId: organisationId,
      reason: `${casesCreated} draft case(s) created from ${result.validRows} valid row(s) -- ${result.duplicateRows} duplicate, ${result.errorRows} error row(s) skipped (never partially activated)`,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
    });

    return tick({ result, casesCreated });
  }

  async recordPayment(
    input: {
      caseId: string;
      kind: PaymentRecord["kind"];
      amount: number;
      reference: string | null;
      clientConfirmed: boolean;
    },
    actor: MutationActor,
  ) {
    const payment: PaymentRecord = {
      id: `pay-${nanoid(8)}`,
      caseId: input.caseId,
      organisationId: mock.getCase(input.caseId)?.organisationId ?? "",
      kind: input.kind,
      amount: input.amount,
      receivedOn: istBusinessDate(new Date()), // IST business date, never the UTC date
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
      actorId: actor.actorId,
      actorRole: actor.actorRole,
    });

    if (!input.clientConfirmed) return tick({ payment, updatedCase: null });

    const { updatedCase } = await this.confirmPayment(payment.id, actor);
    const confirmed = mock.PAYMENTS.find((p) => p.id === payment.id)!;
    return tick({ payment: confirmed, updatedCase });
  }

  async confirmPayment(paymentId: string, actor: MutationActor) {
    const before = mock.PAYMENTS.find((p) => p.id === paymentId);
    if (!before) throw new Error(`confirmPayment: payment ${paymentId} not found`);
    if (before.clientConfirmed) {
      throw new Error(`confirmPayment: payment ${paymentId} is already confirmed -- refusing to re-apply`);
    }
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
      if (alloc.applied > 0) {
        mock.insertAllocation({
          organisationId: kase.organisationId,
          paymentRecordId: paymentId,
          invoiceId: alloc.invoiceId,
          amount: alloc.applied,
        });
      }
    }
    const updatedCase = mock.mutateCase(kase.id, result.updatedCase);
    mock.closeCaseTasksIfTerminal(kase.id, updatedCase.status);
    mock.appendAudit({
      action: "payment.confirmed",
      entity: "recovery_case",
      entityId: kase.id,
      reason: result.note,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
    });

    return tick({ payment, updatedCase });
  }

  /** Throws (and audits) unless automation is enabled; mirrors SupabaseRepository.assertSendsPermitted. */
  private async assertSendsPermitted(caseId: string): Promise<void> {
    await assertAutomationEnabled(
      async () => (await this.getAutomationState()).enabled,
      async (reason) => {
        mock.appendAudit({
          action: AUTOMATION_BLOCKED_AUDIT_ACTION,
          entity: "recovery_case",
          entityId: caseId,
          reason,
          actorId: "system",
          actorRole: "system",
        });
      },
    );
  }

  /** Mirrors SupabaseRepository.sendReminderChannel() exactly -- same
   * begin/attempt/complete sequence, same idempotency semantics, backed by
   * mock.beginCommunicationSend/beginDeliveryAttempt/completeDeliveryAttempt
   * instead of the RPCs (email-delivery task, repository parity). */
  private async sendReminderChannel(
    caseId: string,
    organisationId: string,
    channel: "whatsapp" | "email",
    to: string,
    templateKey: string,
    templateVersion: number,
    subject: string | null,
    body: string,
    forceRetryAfterAmbiguous: boolean,
    templateParams?: string[],
    idempotencyKeyOverride?: string,
    html?: string,
  ): Promise<{
    communication: Communication;
    outcome: "success" | "already_sent" | "retryable_failure" | "permanent_failure" | "human_action_required" | "drift_detected";
    ambiguousBlock: boolean;
  }> {
    await this.assertSendsPermitted(caseId);

    const idempotencyKey =
      idempotencyKeyOverride ?? `reminder-initial:${channel}:${caseId}:${new Date().toISOString().slice(0, 10)}`;

    const begun = mock.beginCommunicationSend({
      organisationId,
      caseId,
      channel,
      idempotencyKey,
      templateKey,
      templateVersion,
      subject,
      body,
    });
    if (!begun.isNew && begun.communication.deliveryStatus === "sent") {
      return { communication: begun.communication, outcome: "already_sent", ambiguousBlock: false };
    }

    const nextAttempt = mock.listDeliveriesForCommunication(begun.communication.id).length + 1;
    const begunAttempt = mock.beginDeliveryAttempt(organisationId, begun.communication.id, nextAttempt, forceRetryAfterAmbiguous);
    if (begunAttempt.blocked) {
      return { communication: begun.communication, outcome: "retryable_failure", ambiguousBlock: true };
    }

    const adapter = channel === "whatsapp" ? getAdapters().whatsapp : getAdapters().email;
    const sendOutcome = await runAdapter(
      (key) => adapter.send({ idempotencyKey: key, caseId, channel, to, templateKey, templateVersion, subject: subject ?? undefined, body, templateParams, html }),
      idempotencyKey,
    );

    const status: "sent" | "failed" = sendOutcome.result.outcome === "success" ? "sent" : "failed";
    const completed = mock.completeDeliveryAttempt({
      deliveryId: begunAttempt.delivery.id,
      status,
      adapterOutcome: sendOutcome.result.outcome,
      providerMessageId: sendOutcome.result.providerRef,
      errorDetail: sendOutcome.result.errorCode,
      provider: adapter.name,
    });

    return { communication: completed.communication, outcome: sendOutcome.result.outcome, ambiguousBlock: false };
  }

  async sendInitialReminder(
    caseId: string,
    actor: MutationActor,
    options: { forceRetryAfterAmbiguous?: boolean; invoiceId?: string | null } = {},
  ) {
    const kase = mock.getCase(caseId);
    if (!kase) throw new Error(`sendInitialReminder: case ${caseId} not found`);
    // Kill switch first: with automation disabled NO channel may be planned or attempted.
    await this.assertSendsPermitted(caseId);
    // With the live WhatsApp provider configured, initial reminders are tracked
    // PER INVOICE (src/domain/reminder-stage.ts): the case stays in its reminder
    // phase while other invoices still await theirs. Without it (email only /
    // demo) the original once-per-case, active-only rule is unchanged.
    const invoiceLevel = this.whatsAppEnv().liveConfigured;
    const inReminderPhase = kase.status === "active" || (invoiceLevel && kase.status === "initial_communication_sent");
    if (!inReminderPhase) {
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
    const subject = buildReminderSubject({
      legalEntityName: org?.legalEntityName ?? "our client",
      invoiceNumber: invoice?.invoiceNumber ?? null,
    });
    const allInvoices = mock.listInvoicesForCase(caseId);
    const email = buildReminderEmail({
      creditorName: org?.legalEntityName ?? "our client",
      debtorName: debtor?.name ?? "",
      invoiceNumber: invoice?.invoiceNumber ?? null,
      invoiceAmountPaise: invoice?.invoiceTotal ?? null,
      dueDate: invoice?.dueDate ?? null,
      outstandingPaise: invoice?.outstandingBalance ?? kase.principalOutstanding,
      upiId: org?.upiId,
      upiPayeeName: org?.upiPayeeName,
      otherInvoiceCount: Math.max(0, allInvoices.filter((i) => i.outstandingBalance > 0).length - 1),
      totalOutstandingPaise: kase.principalOutstanding,
    });

    let alreadyRemindedInvoiceIds: ReadonlySet<string> = new Set();
    let emailInitialAlreadySent = false;
    if (invoiceLevel) {
      const before = await computeReminderStage(this, caseId);
      alreadyRemindedInvoiceIds = new Set(before.states.filter((r) => r.initialSource === "whatsapp").map((r) => r.invoiceId));
      emailInitialAlreadySent = hasAcceptedEmailInitial(caseId, mock.listCommunicationsForCase(caseId));
    }

    // Same shared planner as SupabaseRepository (src/domain/whatsapp-reminder.ts)
    // so the two repositories cannot drift on a WhatsApp safety rule.
    const whatsAppPlan = await planWhatsAppReminder({
      caseId,
      debtor,
      org,
      invoices: mock.listInvoicesForCase(caseId),
      selectedInvoiceId: options.invoiceId,
      alreadyRemindedInvoiceIds,
      isProduction: isProductionRuntime(),
      env: this.whatsAppEnv(),
      legacyBody: body,
    });

    const channels: {
      channel: "whatsapp" | "email";
      to: string;
      templateKey: string;
      templateVersion: number;
      subject: string | null;
      body: string;
      templateParams?: string[];
      idempotencyKey?: string;
      html?: string;
    }[] = [];
    const warnings: string[] = [];
    if (whatsAppPlan.kind === "attempt") channels.push(whatsAppPlan.entry);
    if (whatsAppPlan.kind === "skipped") warnings.push(`WhatsApp reminder not sent: ${whatsAppPlan.reason}.`);
    // The initial email is case-level and sent at most once per case: a
    // reminder for another invoice must never repeat it.
    if (debtor?.email && !emailInitialAlreadySent) {
      channels.push({ channel: "email", to: debtor.email, templateKey: "reminder_initial_email_v1", templateVersion: 1, subject, body: email.text, html: email.html });
    }
    if (channels.length === 0) {
      if (whatsAppPlan.kind === "skipped") {
        throw new Error(
          emailInitialAlreadySent && debtor?.email
            ? `sendInitialReminder: WhatsApp reminder not sent: ${whatsAppPlan.reason}. The initial email was already sent for this case.`
            : `sendInitialReminder: WhatsApp reminder not sent: ${whatsAppPlan.reason}. The debtor has no email on file, so there is no other channel to send on.`,
        );
      }
      if (emailInitialAlreadySent) {
        throw new Error("sendInitialReminder: the initial reminder was already sent by email and there is no WhatsApp reminder left to send for this debtor.");
      }
      throw new Error(
        `sendInitialReminder: case ${caseId}'s debtor has no mobile or email on file -- nothing to send. Correct the debtor's contact details first.`,
      );
    }

    const results: Awaited<ReturnType<MemoryRepository["sendReminderChannel"]>>[] = [];
    for (const c of channels) {
      results.push(
        await this.sendReminderChannel(
          caseId,
          kase.organisationId,
          c.channel,
          c.to,
          c.templateKey,
          c.templateVersion,
          c.subject,
          c.body,
          options.forceRetryAfterAmbiguous ?? false,
          c.templateParams,
          c.idempotencyKey,
          c.html,
        ),
      );
    }

    const anySuccess = results.some((r) => r.outcome === "success" || r.outcome === "already_sent");
    const anyAmbiguous = results.some((r) => r.ambiguousBlock);
    const allFailedTerminally = results.every((r) => r.outcome !== "success" && r.outcome !== "already_sent") && !anyAmbiguous;

    let updatedCase: RecoveryCase;
    const stage = anySuccess && invoiceLevel ? (await computeReminderStage(this, caseId, results.map((r) => r.communication))).summary : null;
    if (anySuccess && stage && stage.status !== "active") {
      const staged = applyReminderStage(kase, stage, { at: new Date(), detail: "Initial reminder accepted" });
      updatedCase = mock.mutateCase(caseId, staged.updatedCase);
      mock.appendAudit({
        action: "reminder.sent",
        entity: "recovery_case",
        entityId: caseId,
        reason: staged.note,
        actorId: actor.actorId,
        actorRole: actor.actorRole,
      });
    } else if (anySuccess && kase.status === "active") {
      const sent = applyReminderSent(kase);
      const deliveredAt = new Date();
      const delivered = applyReminderDelivered(sent.updatedCase, deliveredAt);
      updatedCase = mock.mutateCase(caseId, delivered.updatedCase);
      mock.appendAudit({
        action: "reminder.sent",
        entity: "recovery_case",
        entityId: caseId,
        reason: `${sent.note}; ${delivered.note}`,
        actorId: actor.actorId,
        actorRole: actor.actorRole,
      });
    } else if (anySuccess) {
      updatedCase = kase; // already past the initial stage; nothing new advances the case aggregate
    } else if (allFailedTerminally && kase.status === "active") {
      const sentPatch = applyReminderSent(kase);
      const failed = applyReminderDeliveryFailed(sentPatch.updatedCase, true);
      updatedCase = mock.mutateCase(caseId, failed.updatedCase);
      mock.appendAudit({
        action: "reminder.delivery_failed",
        entity: "recovery_case",
        entityId: caseId,
        reason: `Every attempted channel failed -- ${failed.note}`,
        actorId: actor.actorId,
        actorRole: actor.actorRole,
      });
    } else {
      updatedCase = kase;
    }

    return tick({ case: updatedCase, communications: results.map((r) => r.communication), ambiguous: anyAmbiguous, warnings });
  }

  /* ---- WhatsApp V1 message families ---------------------------------- */

  private whatsAppEnv(): LiveSendEnv {
    return {
      // Demo data can never take the live path unless a test explicitly opts in.
      liveConfigured: this.options.allowLiveWhatsApp === true && isLiveWhatsAppConfigured(),
      campaignConfigured: isWhatsAppCampaignConfigured,
      isAutomationEnabled: async () => (await this.getAutomationState()).enabled,
    };
  }

  private whatsAppFlow(actor: MutationActor | null): WhatsAppFlowDeps {
    return {
      source: this,
      env: () => this.whatsAppEnv(),
      sendChannel: async (caseId, entry, force) => {
        const kase = mock.getCase(caseId)!;
        const r = await this.sendReminderChannel(
          caseId, kase.organisationId, "whatsapp", entry.to, entry.templateKey, entry.templateVersion,
          null, entry.body, force, entry.templateParams, entry.idempotencyKey,
        );
        return r;
      },
      advanceAfterFollowUp: async (kase, summary, detail) => {
        const sent =
          summary && summary.status !== "active"
            ? applyReminderStage(kase, summary, { at: new Date(), detail })
            : applyFollowUpSent(kase, new Date());
        const updated = mock.mutateCase(kase.id, sent.updatedCase);
        mock.appendAudit({
          action: "reminder.followup_sent",
          entity: "recovery_case",
          entityId: kase.id,
          reason: sent.note,
          actorId: actor?.actorId ?? null,
          actorRole: actor?.actorRole ?? null,
        });
        return updated;
      },
    };
  }

  async listPromisesForCase(caseId: string) {
    return tick(mock.listPromisesForCase(caseId));
  }

  async recordPaymentPromise(caseId: string, input: RecordPaymentPromiseInput, actor: MutationActor) {
    const kase = mock.getCase(caseId);
    if (!kase) throw new Error(`recordPaymentPromise: case ${caseId} not found`);
    const dateError = validatePromiseDate(input.promisedOn, new Date());
    if (dateError) throw new Error(dateError);

    const invoices = mock.listInvoicesForCase(caseId);
    let invoiceId = input.invoiceId;
    if (invoiceId && !invoices.some((i) => i.id === invoiceId)) {
      throw new Error("The selected invoice does not belong to this case");
    }
    if (!invoiceId && invoices.length === 1) invoiceId = invoices[0].id;
    if (!invoiceId && invoices.length > 1) {
      throw new Error("Choose the invoice this promise relates to (the case has several invoices)");
    }
    const invoice = invoices.find((i) => i.id === invoiceId);
    if (input.promisedAmountPaise && invoice && input.promisedAmountPaise > invoice.outstandingBalance) {
      throw new Error("The promised amount exceeds the invoice's outstanding balance");
    }
    if (input.sourceReplyId && !mock.listDebtorRepliesForCase(caseId).some((r) => r.id === input.sourceReplyId)) {
      throw new Error("The linked reply does not belong to this case");
    }

    const applied = applyPromiseRecorded(kase, input.promisedOn); // throws unless awaiting the debtor's response
    const promise = mock.insertPromiseSupersedingActive({
      id: `promise-${nanoid(8)}`,
      organisationId: kase.organisationId,
      caseId,
      invoiceId: invoiceId ?? null,
      promisedOn: input.promisedOn,
      promisedAmount: input.promisedAmountPaise ?? null,
      sourceReplyId: input.sourceReplyId ?? null,
      recordedById: actor.actorId,
    });
    const updatedCase = mock.mutateCase(caseId, applied.updatedCase);
    // Date + indicators only (mirrors the RPC's audit metadata).
    mock.appendAudit({
      action: "promise.recorded",
      entity: "recovery_case",
      entityId: caseId,
      reason: applied.note,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
    });
    return tick({ promise, case: updatedCase });
  }

  async getWhatsAppOffers(caseId: string) {
    return getWhatsAppOffersFlow(this.whatsAppFlow(null), caseId);
  }

  async sendWhatsAppMessage(
    caseId: string,
    input: { eventKey: string; forceRetryAfterAmbiguous?: boolean },
    actor: MutationActor,
  ) {
    return sendWhatsAppMessageFlow(this.whatsAppFlow(actor), {
      caseId,
      eventKey: input.eventKey,
      forceRetryAfterAmbiguous: input.forceRetryAfterAmbiguous ?? false,
    });
  }

  async prepareGstNotification(caseId: string, input: GstComposeInput, actor: MutationActor) {
    const kase = mock.getCase(caseId);
    if (!kase) throw new Error(`prepareGstNotification: case ${caseId} not found`);
    const parsed = gstComposeSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? "Invalid GST compose input");
    }

    const idempotencyKey = `gst-prepare:${caseId}`;
    const outcome = await runAdapter(
      (key) => getAdapters().gstPortal.prepare({ idempotencyKey: key, caseId, ...parsed.data }),
      idempotencyKey,
    );

    if (outcome.result.outcome !== "success") {
      const failed = applyGstAutomationFailed(
        kase,
        outcome.urgentTask?.reason ?? outcome.result.errorCode ?? "GST prepare failed",
      );
      const updatedCase = mock.mutateCase(caseId, failed.updatedCase);
      mock.appendAudit({
        action: "gst.prepare_failed",
        entity: "recovery_case",
        entityId: caseId,
        reason: failed.note,
        actorId: actor.actorId,
        actorRole: actor.actorRole,
      });
      return tick({ case: updatedCase, manifestHash: null });
    }

    // Idempotent: only transitions when still at the eligibility-review gate.
    const prepared = kase.status === "gst_eligibility_review" ? applyGstPrepared(kase) : null;
    const updatedCase = prepared ? mock.mutateCase(caseId, prepared.updatedCase) : kase;
    mock.appendAudit({
      action: "gst.prepared",
      entity: "recovery_case",
      entityId: caseId,
      reason: prepared?.note ?? "GST pack re-validated (already prepared)",
      actorId: actor.actorId,
      actorRole: actor.actorRole,
    });

    return tick({ case: updatedCase, manifestHash: outcome.result.data?.manifestHash ?? null });
  }

  async openGstAssistedSession(caseId: string, actor: MutationActor) {
    const idempotencyKey = `gst-session:${caseId}`;
    const outcome = await runAdapter((key) => getAdapters().gstPortal.openAssistedSession(key), idempotencyKey);
    mock.appendAudit({
      action: "gst.session_opened",
      entity: "recovery_case",
      entityId: caseId,
      reason: outcome.result.nextAction ?? "Assisted GST portal session opened",
      actorId: actor.actorId,
      actorRole: actor.actorRole,
    });
    return tick({ sessionUrl: outcome.result.data?.sessionUrl ?? null });
  }

  async captureGstFiling(caseId: string, staffReference: string, actor: MutationActor) {
    const kase = mock.getCase(caseId);
    if (!kase) throw new Error(`captureGstFiling: case ${caseId} not found`);

    const idempotencyKey = `gst-capture:${caseId}`;
    const outcome = await runAdapter((key) => getAdapters().gstPortal.captureResult(key), idempotencyKey);

    if (outcome.result.outcome === "drift_detected" || outcome.result.outcome === "permanent_failure") {
      const failed = applyGstAutomationFailed(
        kase,
        outcome.urgentTask?.reason ?? outcome.result.errorCode ?? "GST filing capture failed",
      );
      const updatedCase = mock.mutateCase(caseId, failed.updatedCase);
      mock.appendAudit({
        action: "gst.filing_failed",
        entity: "recovery_case",
        entityId: caseId,
        reason: failed.note,
        actorId: actor.actorId,
        actorRole: actor.actorRole,
      });
      return tick({ case: updatedCase, referenceNumber: null });
    }

    if (outcome.result.outcome !== "success") {
      // human_action_required / retryable mid-flight -- no state change yet.
      return tick({ case: kase, referenceNumber: null });
    }

    const referenceNumber = staffReference || outcome.result.data?.referenceNumber || "UNSPECIFIED";
    const filedAt = new Date();
    const filed = applyGstFiled(kase, filedAt);
    const updatedCase = mock.mutateCase(caseId, filed.updatedCase);

    const debtor = mock.getDebtor(kase.debtorId);
    mock.insertCommunication({
      id: `com-${nanoid(8)}`,
      caseId,
      organisationId: kase.organisationId,
      channel: "email",
      direction: "outbound",
      templateKey: "gst_notification_v2",
      templateVersion: 2,
      subject: `GST communication filed — ${debtor?.name ?? "debtor"}`,
      body: `A taxpayer communication has been filed on the GST portal. Reference: ${referenceNumber}.`,
      providerMessageId: null,
      threadRef: `thread-${caseId}`,
      deliveryStatus: "delivered",
      hasSecureLink: false,
      idempotencyKey: null,
      replyClassification: null,
      reviewedById: null,
      createdAt: filedAt.toISOString(),
      deliveredAt: filedAt.toISOString(),
    } satisfies Communication);

    mock.appendAudit({
      action: "gst.filed",
      entity: "recovery_case",
      entityId: caseId,
      reason: buildGstFiledReason(filed.note, referenceNumber),
      actorId: actor.actorId,
      actorRole: actor.actorRole,
    });

    return tick({ case: updatedCase, referenceNumber });
  }

  async getGstEvidence(caseId: string) {
    return tick(
      reconstructGstEvidence(
        mock.AUDIT_LOG.filter((e) => e.entity === "recovery_case" && e.entityId === caseId && GST_EVIDENCE_ACTIONS.includes(e.action)),
      ),
    );
  }

  async saveMsmeStage(
    caseId: string,
    stage: MsmeStage,
    payload: Record<string, unknown>,
    actor: MutationActor,
    expectedVersion?: number | null,
  ) {
    const idempotencyKey = `msme-stage:${caseId}:${stage}`;
    const outcome = await runAdapter(
      (key) => getAdapters().msmePortal.saveStage({ idempotencyKey: key, caseId, stage, payload }),
      idempotencyKey,
    );
    const kase = mock.getCase(caseId);
    const draft = applyMsmeStageSave({
      existing: msmeDrafts.get(caseId),
      caseId,
      caseStatus: kase?.status ?? "",
      stage,
      payload,
      expectedVersion,
      now: new Date().toISOString(),
    });
    msmeDrafts.set(caseId, draft);
    mock.appendAudit({
      action: "msme.stage_saved",
      entity: "recovery_case",
      entityId: caseId,
      reason: `Stage "${stage}" saved (${outcome.result.outcome})`,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
    });
    return tick({ resumeToken: outcome.result.data?.resumeToken ?? null, version: draft.version });
  }

  async getMsmeDraft(caseId: string) {
    return tick(msmeDrafts.get(caseId) ?? null);
  }

  async buildMsmePreview(caseId: string, actor: MutationActor) {
    const idempotencyKey = `msme-preview:${caseId}`;
    const outcome = await runAdapter((key) => getAdapters().msmePortal.buildPreview(key), idempotencyKey);
    mock.appendAudit({
      action: "msme.preview_built",
      entity: "recovery_case",
      entityId: caseId,
      reason: `Immutable preview snapshot generated (${outcome.result.outcome})`,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
    });
    return tick({
      previewPdfKey: outcome.result.data?.previewPdfKey ?? null,
      previewHash: outcome.result.data?.previewHash ?? null,
    });
  }

  async captureMsmeAcknowledgement(caseId: string, actor: MutationActor) {
    const kase = mock.getCase(caseId);
    if (!kase) throw new Error(`captureMsmeAcknowledgement: case ${caseId} not found`);

    const idempotencyKey = `msme-ack:${caseId}`;
    const outcome = await runAdapter(
      (key) => getAdapters().msmePortal.captureAcknowledgement(key),
      idempotencyKey,
    );

    if (outcome.result.outcome === "drift_detected" || outcome.result.outcome === "permanent_failure") {
      const failed = applyMsmeAutomationFailed(
        kase,
        outcome.urgentTask?.reason ?? outcome.result.errorCode ?? "MSME filing capture failed",
      );
      const updatedCase = mock.mutateCase(caseId, failed.updatedCase);
      mock.appendAudit({
        action: "msme.filing_failed",
        entity: "recovery_case",
        entityId: caseId,
        reason: failed.note,
        actorId: actor.actorId,
        actorRole: actor.actorRole,
      });
      return tick({ case: updatedCase, diaryNumber: null, petitionPdfKey: null });
    }

    if (outcome.result.outcome !== "success") {
      return tick({ case: kase, diaryNumber: null, petitionPdfKey: null });
    }

    const diaryNumber = outcome.result.data?.diaryNumber ?? null;
    const petitionPdfKey = outcome.result.data?.petitionPdfKey ?? null;
    const filed = applyMsmeFiled(kase);
    if (diaryNumber) {
      msmeDrafts.set(
        caseId,
        applyMsmeDraftLock({
          existing: msmeDrafts.get(caseId),
          caseId,
          diaryNumber,
          petitionPdfKey,
          now: new Date().toISOString(),
        }),
      );
    }
    const updatedCase = mock.mutateCase(caseId, filed.updatedCase);

    const debtor = mock.getDebtor(kase.debtorId);
    mock.insertCommunication({
      id: `com-${nanoid(8)}`,
      caseId,
      organisationId: kase.organisationId,
      channel: "email",
      direction: "outbound",
      templateKey: "msme_odr_filed_v1",
      templateVersion: 1,
      subject: `MSME ODR filed — ${debtor?.name ?? "debtor"}`,
      body: `The MSME ODR claim has been submitted. Diary number: ${diaryNumber ?? "pending"}.`,
      providerMessageId: null,
      threadRef: `thread-${caseId}`,
      deliveryStatus: "delivered",
      hasSecureLink: false,
      idempotencyKey: null,
      replyClassification: null,
      reviewedById: null,
      createdAt: new Date().toISOString(),
      deliveredAt: new Date().toISOString(),
    } satisfies Communication);

    mock.appendAudit({
      action: "msme.filed",
      entity: "recovery_case",
      entityId: caseId,
      reason: `${filed.note}; diary number ${diaryNumber ?? "pending"}`,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
    });

    return tick({ case: updatedCase, diaryNumber, petitionPdfKey });
  }

  async prepareDdTask(
    caseId: string,
    input: { amount?: number | null; payee?: string | null; reference?: string | null; notes?: string | null },
    actor: MutationActor,
  ) {
    const kase = mock.getCase(caseId);
    if (!kase) throw new Error(`prepareDdTask: case ${caseId} not found`);
    const prepared = applyDdPrepared(kase);
    const updatedCase = mock.mutateCase(caseId, prepared.updatedCase);
    const dd = mock.upsertDdRecord(caseId, kase.organisationId, input);
    mock.raiseTaskIfNotOpen({
      caseId,
      organisationId: kase.organisationId,
      type: "dd_preparation",
      title: "Prepare and dispatch MSEFC demand draft",
      waitingOn: "client",
      assigneeId: null,
      urgent: false,
      dueAt: null,
    });
    mock.appendAudit({
      action: "dd.prepared",
      entity: "recovery_case",
      entityId: caseId,
      reason: prepared.note,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
    });
    return tick({ case: updatedCase, dd });
  }

  async recordDdSubmitted(
    caseId: string,
    input: { submittedAt?: string | null; documentId?: string | null },
    actor: MutationActor,
  ) {
    const before = mock.getDdRecord(caseId);
    const dd = mock.markDdSubmitted(caseId, input);
    if (before?.status !== "submitted") {
      mock.TASKS.filter((t) => t.caseId === caseId && t.type === "dd_preparation" && !t.resolvedAt).forEach(
        (t) => mock.resolveTask(t.id),
      );
      mock.appendAudit({
        action: "dd.submitted",
        entity: "recovery_case",
        entityId: caseId,
        reason: "DD handed over / submitted",
        actorId: actor.actorId,
        actorRole: actor.actorRole,
      });
    }
    return tick(dd);
  }

  async scheduleHearing(
    caseId: string,
    input: {
      startsAtIso: string;
      forum?: string | null;
      authority?: string | null;
      caseReference?: string | null;
      assignedStaffId?: string | null;
      notes?: string | null;
    },
    actor: MutationActor,
  ) {
    const kase = mock.getCase(caseId);
    if (!kase) throw new Error(`scheduleHearing: case ${caseId} not found`);
    const startsAt = new Date(input.startsAtIso);
    if (Number.isNaN(startsAt.getTime())) throw new Error(`scheduleHearing: invalid date "${input.startsAtIso}"`);

    const idempotencyKey = `hearing:${caseId}:${input.startsAtIso}`;
    const outcome = await runAdapter(
      (key) =>
        getAdapters().calendar.upsertEvent({
          idempotencyKey: key,
          caseId,
          title: `${input.forum ?? "MSEFC hearing"} — case ${caseId}`,
          startsAt: startsAt.toISOString(),
          kind: "hearing",
        }),
      idempotencyKey,
    );

    const existingOpen = mock.listHearingsForCase(caseId).find((h) => h.status === "scheduled");
    const isExactRetry = existingOpen?.scheduledAt === startsAt.toISOString();

    const hearing = mock.insertHearing(kase.organisationId, caseId, {
      scheduledAt: startsAt.toISOString(),
      forum: input.forum,
      authority: input.authority,
      caseReference: input.caseReference,
      assignedStaffId: input.assignedStaffId,
      notes: input.notes,
    });
    if (isExactRetry) return tick({ case: kase, hearing }); // idempotent no-op

    const scheduled = applyHearingScheduled(kase, startsAt);
    const updatedCase = mock.mutateCase(caseId, scheduled.updatedCase);
    mock.raiseTaskIfNotOpen({
      caseId,
      organisationId: kase.organisationId,
      type: "hearing_followup",
      title: "Attend hearing and record outcome",
      waitingOn: "staff",
      assigneeId: null,
      urgent: false,
      dueAt: startsAt.toISOString(),
    });
    mock.appendAudit({
      action: "hearing.scheduled",
      entity: "recovery_case",
      entityId: caseId,
      reason: `${scheduled.note}; calendar adapter event ${outcome.result.data?.eventId ?? "n/a"}`,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
    });

    return tick({ case: updatedCase, hearing });
  }

  async rescheduleHearing(
    hearingId: string,
    caseId: string,
    input: {
      newStartsAtIso: string;
      forum?: string | null;
      authority?: string | null;
      caseReference?: string | null;
      assignedStaffId?: string | null;
      notes?: string | null;
    },
    actor: MutationActor,
  ) {
    const kase = mock.getCase(caseId);
    if (!kase) throw new Error(`rescheduleHearing: case ${caseId} not found`);
    const newStartsAt = new Date(input.newStartsAtIso);
    if (Number.isNaN(newStartsAt.getTime())) throw new Error(`rescheduleHearing: invalid date "${input.newStartsAtIso}"`);

    const adjourned = applyHearingAdjourned(kase);
    const scheduled = applyHearingScheduled({ ...kase, ...adjourned.updatedCase }, newStartsAt);
    const updatedCase = mock.mutateCase(caseId, scheduled.updatedCase);
    const hearing = mock.rescheduleHearingRecord(hearingId, {
      newScheduledAt: newStartsAt.toISOString(),
      forum: input.forum,
      authority: input.authority,
      caseReference: input.caseReference,
      assignedStaffId: input.assignedStaffId,
      notes: input.notes,
    });
    mock.appendAudit({
      action: "hearing.rescheduled",
      entity: "recovery_case",
      entityId: caseId,
      reason: `${adjourned.note}; ${scheduled.note}`,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
    });
    return tick({ case: updatedCase, hearing });
  }

  async recordHearingOutcome(
    hearingId: string,
    caseId: string,
    input: { status: "completed" | "cancelled"; result?: string | null; recovered: boolean },
    actor: MutationActor,
  ) {
    const kase = mock.getCase(caseId);
    if (!kase) throw new Error(`recordHearingOutcome: case ${caseId} not found`);
    const before = mock.listHearingsForCase(caseId).find((h) => h.id === hearingId);
    const wasTerminal = before?.status === "completed" || before?.status === "cancelled";
    const hearing = mock.markHearingOutcome(hearingId, input.status, input.result ?? null);
    if (wasTerminal) return tick({ case: kase, hearing }); // idempotent no-op

    const outcome = applyHearingOutcome(kase, input.recovered);
    const updatedCase = mock.mutateCase(caseId, outcome.updatedCase);
    mock.TASKS.filter((t) => t.caseId === caseId && t.type === "hearing_followup" && !t.resolvedAt).forEach((t) =>
      mock.resolveTask(t.id),
    );
    mock.closeCaseTasksIfTerminal(caseId, updatedCase.status);
    mock.appendAudit({
      action: "hearing.outcome_recorded",
      entity: "recovery_case",
      entityId: caseId,
      reason: outcome.note,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
    });
    return tick({ case: updatedCase, hearing });
  }

  async recordDebtorReply(
    caseId: string,
    input: { channel: Channel; rawBody: string; communicationId?: string | null; classification: ReplyClassification },
    actor: MutationActor,
  ) {
    const kase = mock.getCase(caseId);
    if (!kase) throw new Error(`recordDebtorReply: case ${caseId} not found`);
    const classified = applyReplyClassified(kase, input.classification);
    const updatedCase = mock.mutateCase(caseId, classified.updatedCase);
    const reply = mock.insertDebtorReply(kase.organisationId, caseId, input, actor.actorId);

    if (input.classification === "payment_made") {
      mock.raiseTaskIfNotOpen({
        caseId, organisationId: kase.organisationId, type: "payment_confirmation",
        title: "Client to confirm receipt claimed by debtor", waitingOn: "client",
        assigneeId: null, urgent: false, dueAt: null,
      });
    } else if (["dispute", "settlement_offer", "document_request"].includes(input.classification)) {
      mock.raiseTaskIfNotOpen({
        caseId, organisationId: kase.organisationId, type: "dispute_resolution",
        title: `Staff to resolve debtor ${input.classification}`, waitingOn: "staff",
        assigneeId: null, urgent: false, dueAt: null,
      });
    } else if (input.classification === "unclear") {
      mock.raiseTaskIfNotOpen({
        caseId, organisationId: kase.organisationId, type: "staff_validation",
        title: "Staff to review unclear debtor reply", waitingOn: "staff",
        assigneeId: null, urgent: false, dueAt: null,
      });
    }

    mock.appendAudit({
      action: "debtor_reply.recorded",
      entity: "recovery_case",
      entityId: caseId,
      reason: classified.note,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
    });
    return tick({ case: updatedCase, reply });
  }

  async resolveWorkflowTask(taskId: string, reason: string, actor: MutationActor) {
    const before = mock.TASKS.find((t) => t.id === taskId);
    const task = mock.resolveTask(taskId);
    if (!before?.resolvedAt) {
      mock.appendAudit({
        action: "task.resolved",
        entity: "workflow_task",
        entityId: taskId,
        reason,
        actorId: actor.actorId,
        actorRole: actor.actorRole,
      });
    }
    return tick(task);
  }

  async correctInvoiceOcr(
    caseId: string,
    invoiceId: string,
    corrections: Partial<
      Pick<
        Invoice,
        | "invoiceNumber"
        | "invoiceDate"
        | "dueDate"
        | "taxableValue"
        | "taxRate"
        | "taxAmount"
        | "invoiceTotal"
        | "outstandingBalance"
      >
    >,
    actor: MutationActor,
  ) {
    const kase = mock.getCase(caseId);
    if (!kase) throw new Error(`correctInvoiceOcr: case ${caseId} not found`);

    mock.mutateInvoice(invoiceId, { ...corrections, extractionConfidence: 0.99 });
    const invoice = mock.listInvoicesForCase(caseId).find((i) => i.id === invoiceId);
    if (!invoice) throw new Error(`correctInvoiceOcr: invoice ${invoiceId} not found on case ${caseId}`);

    const outstandingBalance = corrections.outstandingBalance ?? invoice.outstandingBalance;
    const gates = await this.getActivationGates(caseId);
    const corrected = applyOcrCorrected({ ...kase, principalOutstanding: outstandingBalance }, gates);
    const updatedCase = mock.mutateCase(caseId, {
      ...corrected.updatedCase,
      principalOutstanding: outstandingBalance,
      activatedAt: corrected.updatedCase.status === "active" ? new Date().toISOString() : kase.activatedAt,
    });

    mock.appendAudit({
      action: "ocr.corrected",
      entity: "invoice",
      entityId: invoiceId,
      reason: `Staff corrected extracted fields (was low-confidence); ${corrected.note}`,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
    });

    return tick({ case: updatedCase, invoice });
  }

  private activationEvidence(caseId: string) {
    const invoiceIds = mock.listInvoicesForCase(caseId).map((i) => i.id);
    const relevant = mock.AUDIT_LOG.filter((e) => (ACTIVATION_EVIDENCE_ACTIONS as readonly string[]).includes(e.action));
    return activationEvidenceFrom(relevant, caseId, invoiceIds);
  }

  async getActivationGates(caseId: string): Promise<ActivationGates> {
    if (!mock.getCase(caseId)) throw new Error(`getActivationGates: case ${caseId} not found`);
    return tick(
      evaluateActivationGates({ invoices: mock.listInvoicesForCase(caseId), evidence: this.activationEvidence(caseId), now: new Date() }),
    );
  }

  async recordActivationGate(caseId: string, gate: "client_certification" | "staff_validation", reason: string, actor: MutationActor) {
    const kase = mock.getCase(caseId);
    if (!kase) throw new Error(`recordActivationGate: case ${caseId} not found`);
    if (!reason.trim()) throw new Error("recordActivationGate: a reason is required");
    if (!isPreActivation(kase.status)) {
      throw new Error(`recordActivationGate: case is already "${kase.status.replace(/_/g, " ")}" -- activation gates apply only before activation`);
    }
    if (gate === "staff_validation" && kase.status !== "under_validation") {
      throw new Error("recordActivationGate: staff validation of a case awaiting correction is given by confirming the corrected invoice fields");
    }
    const action = gate === "client_certification" ? "case.client_certified" : "case.staff_validated";
    // Evidence is the audit event itself; write it, then evaluate WITH it.
    mock.appendAudit({ action, entity: "recovery_case", entityId: caseId, reason, actorId: actor.actorId, actorRole: actor.actorRole });
    const gates = evaluateActivationGates({ invoices: mock.listInvoicesForCase(caseId), evidence: this.activationEvidence(caseId), now: new Date() });
    // A case still awaiting correction only records the certification; the OCR confirmation evaluates everything.
    const applied = kase.status === "correction_required" ? { updatedCase: kase, note: "", activated: false } : applyActivationGates(kase, gates);
    const updatedCase = applied.updatedCase === kase ? kase : mock.mutateCase(caseId, { ...applied.updatedCase, activatedAt: applied.activated ? new Date().toISOString() : kase.activatedAt });
    return tick({ case: updatedCase, gates, activated: applied.activated });
  }

  async listAuditLog(limit = 200) {
    return tick(mock.AUDIT_LOG.slice(0, limit));
  }

  async getAutomationState() {
    return tick({ enabled: mock.getAutomationEnabled() });
  }

  async setAutomationState(enabled: boolean, reason: string, actor: MutationActor) {
    if (!reason.trim()) throw new Error("setAutomationState: a reason is required");
    const result = mock.setAutomationEnabled(enabled);
    mock.appendAudit({
      action: enabled ? "automation.enabled" : "automation.disabled",
      entity: "organisation",
      entityId: "global",
      reason,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
    });
    return tick({ enabled: result });
  }
}
