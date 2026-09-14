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
import { createDraftCase, type IntakeInvoiceInput } from "@/domain/intake";
import { parseCsv, parseDate, parseMoney, validateImport } from "@/domain/bulk-import";
import { runAdapter } from "@/orchestrator/run-adapter";
import { getAdapters } from "@/adapters";
import { gstComposeSchema, type GstComposeInput, type ManualInvoiceInput } from "@/contract/schemas";
import type { MsmeStage } from "@/contract/adapters";
import type { Channel, ReplyClassification } from "@/contract/enums";
import type { Communication, Invoice, PaymentRecord, RecoveryCase } from "@/contract/types";
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

export class MemoryRepository implements Repository {
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
        mobile: null,
        email: null,
        gstin: input.debtorGstin ?? null,
        address: null,
        contactVerified: false,
        totalDue: input.outstandingBalance,
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
      const invoiceDate = parseDate(cell("invoice_date")) ?? new Date().toISOString().slice(0, 10);
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

  async sendInitialReminder(caseId: string, actor: MutationActor) {
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
        actorId: actor.actorId,
        actorRole: actor.actorRole,
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
      actorId: actor.actorId,
      actorRole: actor.actorRole,
    });

    return tick({ case: updatedCase, communication: deliveredCommunication });
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
      replyClassification: null,
      reviewedById: null,
      createdAt: filedAt.toISOString(),
      deliveredAt: filedAt.toISOString(),
    } satisfies Communication);

    mock.appendAudit({
      action: "gst.filed",
      entity: "recovery_case",
      entityId: caseId,
      reason: `${filed.note}; reference ${referenceNumber}`,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
    });

    return tick({ case: updatedCase, referenceNumber });
  }

  async saveMsmeStage(
    caseId: string,
    stage: MsmeStage,
    payload: Record<string, unknown>,
    actor: MutationActor,
  ) {
    const idempotencyKey = `msme-stage:${caseId}:${stage}`;
    const outcome = await runAdapter(
      (key) => getAdapters().msmePortal.saveStage({ idempotencyKey: key, caseId, stage, payload }),
      idempotencyKey,
    );
    mock.appendAudit({
      action: "msme.stage_saved",
      entity: "recovery_case",
      entityId: caseId,
      reason: `Stage "${stage}" saved (${outcome.result.outcome})`,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
    });
    return tick({ resumeToken: outcome.result.data?.resumeToken ?? null });
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
    const corrected = applyOcrCorrected({ ...kase, principalOutstanding: outstandingBalance });
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
