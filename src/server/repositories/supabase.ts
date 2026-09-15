/**
 * Supabase-backed Repository implementation. Selected by `../repo.ts` once
 * NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are configured.
 *
 * Row -> DTO mapping only; no business logic here (PRD §13: every query is
 * scoped, RLS is still the hard boundary underneath these calls -- this
 * client is the session-bound one from src/lib/supabase/server.ts, so RLS
 * applies exactly as it would to a direct query).
 *
 * P0-4 Gate B (2026-09-13): the underlying RPCs/RLS this file calls have
 * been live-verified against a real Supabase project (schema, RLS matrix,
 * every RPC, transaction rollback, concurrency) -- see docs/DEPLOYMENT.md
 * §3a and the Gate B report. This TypeScript layer's own mapping/call
 * construction is still only type-checked + unit-tested with a mocked
 * client (src/server/repositories/supabase.test.ts), not exercised through
 * a live end-to-end Next.js request in this build -- treat any runtime
 * issue found there as a bug to fix here, not a reason to bypass the
 * repository seam.
 */

import { createClient } from "@/lib/supabase/server";
import { estimateSuccessFee } from "@/domain/fees";
import { applyConfirmedPayment } from "@/domain/apply-payment";
import {
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
import { createDraftCase, type IntakeInvoiceInput } from "@/domain/intake";
import { parseCsv, parseDate, parseMoney, validateImport } from "@/domain/bulk-import";
import { runAdapter } from "@/orchestrator/run-adapter";
import { getAdapters } from "@/adapters";
import { isProductionRuntime } from "@/lib/config/production";
import {
  gstComposeSchema,
  type DebtorContactInput,
  type GstComposeInput,
  type ManualInvoiceInput,
} from "@/contract/schemas";
import type { MsmeStage } from "@/contract/adapters";
import type {
  AuditEventRow,
  CalendarEventRow,
  CaseHearingRow,
  CommunicationDeliveryRow,
  CommunicationRow,
  Database,
  DdRecordRow,
  DebtorReplyRow,
  DebtorRow,
  InvoiceRow,
  OrganisationRow,
  PaymentAllocationRow,
  PaymentRecordRow,
  RecoveryCaseRow,
  WorkflowTaskRow,
} from "@/lib/supabase/types";
import type {
  CaseHearing,
  Communication,
  CommunicationDelivery,
  DdRecord,
  Debtor,
  DebtorReply,
  ImportResult,
  Invoice,
  Organisation,
  PaymentAllocation,
  PaymentRecord,
  RecoveryCase,
  WorkflowTask,
} from "@/contract/types";
import { CLIENT_SAFE_LABEL } from "@/contract/enums";
import type { MutationActor } from "@/lib/auth/types";
import type { CaseRow, ClientOverview, QueueItem } from "@/lib/mock-data";
import type {
  AgeingBucket,
  CreateOrganisationResult,
  DashboardKpis,
  Repository,
  StagePoint,
  TrendPoint,
} from "../repository";

type Client = Awaited<ReturnType<typeof createClient>>;

function toOrganisation(row: Database["public"]["Tables"]["organisations"]["Row"]): Organisation {
  return {
    id: row.id,
    clientCode: row.client_code,
    legalEntityName: row.legal_entity_name,
    creditorGstin: row.creditor_gstin,
    udyamNumber: row.udyam_number,
    jitoMember: row.jito_member,
    createdAt: row.created_at,
  };
}

function toDebtor(row: Database["public"]["Tables"]["debtors"]["Row"]): Debtor {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    name: row.name,
    mobile: row.mobile,
    email: row.email,
    gstin: row.gstin,
    address: row.address,
    contactVerified: row.contact_verified,
    totalDue: row.total_due,
  };
}

function toCase(row: RecoveryCaseRow): RecoveryCase {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    debtorId: row.debtor_id,
    status: row.status,
    automationMode: row.automation_mode,
    waitingOn: row.waiting_on,
    automationStartedAt: row.automation_started_at,
    currentStep: row.current_step,
    blocker: row.blocker,
    nextScheduledAction: row.next_scheduled_action,
    nextScheduledAt: row.next_scheduled_at,
    eligibilityRoute: row.eligibility_route,
    principalOutstanding: row.principal_outstanding,
    recoveredToDate: row.recovered_to_date,
    assigneeId: row.assignee_id,
    groupKey: row.group_key,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
    closedAt: row.closed_at,
  };
}

function toInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    caseId: row.case_id,
    organisationId: row.organisation_id,
    debtorId: row.debtor_id,
    invoiceNumber: row.invoice_number,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    taxableValue: row.taxable_value,
    taxRate: row.tax_rate,
    taxAmount: row.tax_amount,
    invoiceTotal: row.invoice_total,
    outstandingBalance: row.outstanding_balance,
    sourceDocumentId: row.source_document_id,
    extractionConfidence: row.extraction_confidence,
  };
}

function toCommunication(row: CommunicationRow): Communication {
  return {
    id: row.id,
    caseId: row.case_id,
    organisationId: row.organisation_id,
    channel: row.channel,
    direction: row.direction,
    templateKey: row.template_key,
    templateVersion: row.template_version,
    subject: row.subject,
    body: row.body,
    providerMessageId: row.provider_message_id,
    threadRef: row.thread_ref,
    deliveryStatus: row.delivery_status,
    hasSecureLink: row.has_secure_link,
    idempotencyKey: row.idempotency_key,
    replyClassification: row.reply_classification,
    reviewedById: row.reviewed_by_id,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
  };
}

function toPayment(row: PaymentRecordRow): PaymentRecord {
  return {
    id: row.id,
    caseId: row.case_id,
    organisationId: row.organisation_id,
    kind: row.kind,
    amount: row.amount,
    receivedOn: row.received_on,
    reference: row.reference,
    clientConfirmed: row.client_confirmed,
    createdAt: row.created_at,
  };
}

function toTask(row: WorkflowTaskRow): WorkflowTask {
  return {
    id: row.id,
    caseId: row.case_id,
    organisationId: row.organisation_id,
    type: row.type,
    title: row.title,
    waitingOn: row.waiting_on,
    assigneeId: row.assignee_id,
    urgent: row.urgent,
    dueAt: row.due_at,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}

function toAllocation(row: PaymentAllocationRow): PaymentAllocation {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    paymentRecordId: row.payment_record_id,
    invoiceId: row.invoice_id,
    amount: row.amount,
    createdAt: row.created_at,
  };
}

function toDdRecord(row: DdRecordRow): DdRecord {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    caseId: row.case_id,
    status: row.status,
    amount: row.amount,
    payee: row.payee,
    reference: row.reference,
    preparedAt: row.prepared_at,
    submittedAt: row.submitted_at,
    documentId: row.document_id,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toHearing(row: CaseHearingRow): CaseHearing {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    caseId: row.case_id,
    calendarEventId: row.calendar_event_id,
    forum: row.forum,
    authority: row.authority,
    caseReference: row.case_reference,
    assignedStaffId: row.assigned_staff_id,
    scheduledAt: row.scheduled_at,
    status: row.status,
    result: row.result,
    rescheduledFromId: row.rescheduled_from_id,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDelivery(row: CommunicationDeliveryRow): CommunicationDelivery {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    communicationId: row.communication_id,
    attempt: row.attempt,
    status: row.status,
    adapterOutcome: row.adapter_outcome,
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    errorDetail: row.error_detail,
    occurredAt: row.occurred_at,
  };
}

function toReply(row: DebtorReplyRow): DebtorReply {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    caseId: row.case_id,
    communicationId: row.communication_id,
    channel: row.channel,
    rawBody: row.raw_body,
    classification: row.classification,
    classificationConfidence: row.classification_confidence,
    reviewedById: row.reviewed_by_id,
    reviewedAt: row.reviewed_at,
    receivedAt: row.received_at,
  };
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, context: string): T {
  if (result.error) throw new Error(`SupabaseRepository.${context}: ${result.error.message}`);
  return result.data as T;
}

/**
 * Calls one of the privileged write RPCs from supabase/migrations/0006_production_write_rpcs.sql.
 * `as never` on both the function name and args is the same overload-resolution
 * workaround already used for `.insert()` elsewhere in this file (the
 * hand-written Database type doesn't carry enough generic plumbing for these
 * calls to resolve their own declared Functions[...] types) -- the argument
 * SHAPE is still whatever the caller passes, matching each function's SQL
 * signature; only the compile-time check is bypassed, not the runtime call.
 */
async function callWriteRpc<T>(supabase: Client, fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await supabase.rpc(fn as never, args as never);
  if (res.error) throw new Error(`SupabaseRepository.${fn}: ${res.error.message}`);
  return res.data as T;
}

/** Audit-only write (no case/row mutation) via the privileged writer from
 * 0005_privileged_audit_writer.sql -- backs the handful of mutations that
 * only ever produce an audit trail (openGstAssistedSession, saveMsmeStage,
 * buildMsmePreview), matching MemoryRepository's equivalent calls exactly. */
async function recordAudit(
  supabase: Client,
  organisationId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  reason: string | null,
): Promise<void> {
  const res = await supabase.rpc("record_audit_event" as never, {
    p_organisation_id: organisationId,
    p_action: action,
    p_entity: entity,
    p_entity_id: entityId,
    p_reason: reason,
    p_metadata_json: null,
  } as never);
  if (res.error) throw new Error(`SupabaseRepository.recordAudit(${action}): ${res.error.message}`);
}

export class SupabaseRepository implements Repository {
  private clientPromise: Promise<Client>;

  constructor() {
    this.clientPromise = createClient();
  }

  private async db() {
    return this.clientPromise;
  }

  async getOrg(id: string) {
    const supabase = await this.db();
    const { data, error } = await supabase.from("organisations").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`SupabaseRepository.getOrg: ${error.message}`);
    return data ? toOrganisation(data) : undefined;
  }

  async listOrganisations() {
    const supabase = await this.db();
    const res = await supabase.from("organisations").select("*").order("legal_entity_name");
    return unwrap(res, "listOrganisations").map(toOrganisation);
  }

  async createOrganisation(
    input: import("@/contract/schemas").CreateOrganisationInput,
    actor: MutationActor,
  ): Promise<CreateOrganisationResult> {
    const supabase = await this.db();

    // Duplicate checks first -- same rules as MemoryRepository. Client code
    // uniqueness is additionally enforced by a DB constraint (defence in
    // depth); GSTIN and name checks are not yet backed by one, so they run
    // as explicit pre-checks here.
    const [codeRes, gstinRes, nameRes] = await Promise.all([
      supabase.from("organisations").select("*").eq("client_code", input.clientCode).maybeSingle(),
      input.creditorGstin
        ? supabase.from("organisations").select("*").eq("creditor_gstin", input.creditorGstin).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase.from("organisations").select("*"),
    ]);
    if (codeRes.data) {
      throw new Error(`createOrganisation: client code "${input.clientCode}" is already in use`);
    }
    if (gstinRes.data) {
      throw new Error(
        `createOrganisation: creditor GSTIN "${input.creditorGstin}" is already registered to another client`,
      );
    }
    const allOrgs: OrganisationRow[] = nameRes.data ?? [];
    const needle = input.legalEntityName.trim().toLowerCase().replace(/\s+/g, " ");
    const nameCollision = allOrgs.find(
      (o) => o.legal_entity_name.trim().toLowerCase().replace(/\s+/g, " ") === needle,
    );
    if (nameCollision && !input.confirmDuplicateName) {
      return {
        status: "duplicate_name_warning",
        existingOrganisation: {
          id: nameCollision.id,
          clientCode: nameCollision.client_code,
          legalEntityName: nameCollision.legal_entity_name,
        },
      };
    }

    // INSERT + audit happen atomically inside create_organisation() (see
    // supabase/migrations/0006_production_write_rpcs.sql) -- two sequential
    // Supabase calls here would leave a real gap: a crash or transient
    // failure between them could commit the organisation with no audit row.
    const created = await callWriteRpc<OrganisationRow>(supabase, "create_organisation", {
      p_client_code: input.clientCode,
      p_legal_entity_name: input.legalEntityName,
      p_creditor_gstin: input.creditorGstin ?? null,
      p_udyam_number: input.udyamNumber ?? null,
      p_jito_member: input.jitoMember,
      p_reason: nameCollision
        ? `New client onboarded: ${input.legalEntityName} (${input.clientCode}) -- ` +
          `staff confirmed this is distinct from existing client ${nameCollision.client_code}; ` +
          `override reason: ${input.duplicateOverrideReason}`
        : `New client onboarded: ${input.legalEntityName} (${input.clientCode})`,
      p_expected_actor_id: actor.actorId,
    });

    return { status: "created", organisation: toOrganisation(created) };
  }

  async getDebtor(id: string) {
    const supabase = await this.db();
    const { data, error } = await supabase.from("debtors").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`SupabaseRepository.getDebtor: ${error.message}`);
    return data ? toDebtor(data) : undefined;
  }

  async assigneeName(id: string | null) {
    // app_users is not yet part of the typed Database (no auth provider wired
    // in this build) -- surface the id rather than guessing a display name.
    return id ?? "Unassigned";
  }

  async getCase(id: string) {
    const supabase = await this.db();
    const { data, error } = await supabase.from("recovery_cases").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`SupabaseRepository.getCase: ${error.message}`);
    return data ? toCase(data) : undefined;
  }

  async listAllCases() {
    const supabase = await this.db();
    const res = await supabase.from("recovery_cases").select("*").order("created_at", { ascending: false });
    return unwrap(res, "listAllCases").map(toCase);
  }

  async listCasesForOrg(orgId: string) {
    const supabase = await this.db();
    const res = await supabase
      .from("recovery_cases")
      .select("*")
      .eq("organisation_id", orgId)
      .order("created_at", { ascending: false });
    return unwrap(res, "listCasesForOrg").map(toCase);
  }

  async caseRows(orgId?: string): Promise<CaseRow[]> {
    const cases = orgId ? await this.listCasesForOrg(orgId) : await this.listAllCases();
    const rows = await Promise.all(
      cases.map(async (c) => {
        const [debtor, org, invoices] = await Promise.all([
          this.getDebtor(c.debtorId),
          this.getOrg(c.organisationId),
          this.listInvoicesForCase(c.id),
        ]);
        const due = invoices[0]?.dueDate ? new Date(invoices[0].dueDate).getTime() : Date.now();
        const overdueDays = Math.max(0, Math.round((Date.now() - due) / 86_400_000));
        return {
          id: c.id,
          client: org?.legalEntityName ?? "—",
          debtor: debtor?.name ?? "—",
          gstin: debtor?.gstin ?? null,
          status: c.status,
          nextAction: c.nextScheduledAction ?? c.currentStep,
          overdueDays,
          value: c.principalOutstanding,
          assignee: await this.assigneeName(c.assigneeId),
          waitingOn: c.waitingOn,
        } satisfies CaseRow;
      }),
    );
    return rows;
  }

  async listInvoicesForCase(caseId: string) {
    const supabase = await this.db();
    const res = await supabase.from("invoices").select("*").eq("case_id", caseId);
    return unwrap(res, "listInvoicesForCase").map(toInvoice);
  }

  async listCommunicationsForCase(caseId: string) {
    const supabase = await this.db();
    const res = await supabase
      .from("communications")
      .select("*")
      .eq("case_id", caseId)
      .order("created_at", { ascending: true });
    return unwrap(res, "listCommunicationsForCase").map(toCommunication);
  }

  async listPaymentsForCase(caseId: string) {
    const supabase = await this.db();
    const res = await supabase.from("payment_records").select("*").eq("case_id", caseId);
    return unwrap(res, "listPaymentsForCase").map(toPayment);
  }

  async listTasksForCase(caseId: string) {
    const supabase = await this.db();
    const res = await supabase.from("workflow_tasks").select("*").eq("case_id", caseId);
    return unwrap(res, "listTasksForCase").map(toTask);
  }

  async listAllocationsForCase(caseId: string) {
    const supabase = await this.db();
    const payments = await this.listPaymentsForCase(caseId);
    if (payments.length === 0) return [];
    const res = await supabase
      .from("payment_allocations")
      .select("*")
      .in(
        "payment_record_id",
        payments.map((p) => p.id),
      );
    return unwrap(res, "listAllocationsForCase").map(toAllocation);
  }

  async getDdRecord(caseId: string) {
    const supabase = await this.db();
    const { data, error } = await supabase.from("dd_records").select("*").eq("case_id", caseId).maybeSingle();
    if (error) throw new Error(`SupabaseRepository.getDdRecord: ${error.message}`);
    return data ? toDdRecord(data) : undefined;
  }

  async listHearingsForCase(caseId: string) {
    const supabase = await this.db();
    const res = await supabase
      .from("case_hearings")
      .select("*")
      .eq("case_id", caseId)
      .order("scheduled_at", { ascending: false });
    return unwrap(res, "listHearingsForCase").map(toHearing);
  }

  async listDebtorRepliesForCase(caseId: string) {
    const supabase = await this.db();
    const res = await supabase
      .from("debtor_replies")
      .select("*")
      .eq("case_id", caseId)
      .order("received_at", { ascending: false });
    return unwrap(res, "listDebtorRepliesForCase").map(toReply);
  }

  async listDeliveriesForCommunication(communicationId: string) {
    const supabase = await this.db();
    const res = await supabase
      .from("communication_deliveries")
      .select("*")
      .eq("communication_id", communicationId)
      .order("attempt", { ascending: true });
    return unwrap(res, "listDeliveriesForCommunication").map(toDelivery);
  }

  async listAllCommunications() {
    const supabase = await this.db();
    const res = await supabase.from("communications").select("*").order("created_at", { ascending: false });
    return unwrap(res, "listAllCommunications").map(toCommunication);
  }

  async listAllPayments() {
    const supabase = await this.db();
    const res = await supabase.from("payment_records").select("*").order("created_at", { ascending: false });
    return unwrap(res, "listAllPayments").map(toPayment);
  }

  async openTasks(orgId?: string) {
    const supabase = await this.db();
    let query = supabase.from("workflow_tasks").select("*").is("resolved_at", null);
    if (orgId) query = query.eq("organisation_id", orgId);
    const res = await query;
    return unwrap(res, "openTasks").map(toTask);
  }

  async urgentQueue(orgId?: string): Promise<QueueItem[]> {
    const tasks = await this.openTasks(orgId);
    const now = new Date();
    const items = await Promise.all(
      tasks.map(async (t) => {
        const kase = t.caseId ? await this.getCase(t.caseId) : undefined;
        const org = await this.getOrg(t.organisationId);
        const debtor = kase ? await this.getDebtor(kase.debtorId) : undefined;
        const dueState: QueueItem["dueState"] = !t.dueAt
          ? "none"
          : t.dueAt < now.toISOString()
            ? "overdue"
            : t.dueAt.slice(0, 10) === now.toISOString().slice(0, 10)
              ? "today"
              : "upcoming";
        return {
          taskId: t.id,
          caseId: t.caseId,
          title: t.title,
          debtor: debtor?.name ?? null,
          client: org?.legalEntityName ?? "—",
          amountAtRisk: kase?.principalOutstanding ?? 0,
          dueState,
          dueAt: t.dueAt,
          blocker: kase?.blocker ?? null,
          waitingOn: t.waitingOn,
          urgent: t.urgent,
          nextSafeAction: kase?.nextScheduledAction ?? t.title,
        } satisfies QueueItem;
      }),
    );
    const rank = { overdue: 0, today: 1, upcoming: 2, none: 3 } as const;
    return items.sort(
      (a, b) =>
        Number(b.urgent) - Number(a.urgent) ||
        rank[a.dueState] - rank[b.dueState] ||
        b.amountAtRisk - a.amountAtRisk,
    );
  }

  async dashboardKpis(): Promise<DashboardKpis> {
    const [cases, tasks, payments] = await Promise.all([
      this.listAllCases(),
      this.openTasks(),
      this.listAllPayments(),
    ]);
    return {
      openCases: cases.filter((c) => !["recovered", "closed", "withdrawn", "archived"].includes(c.status))
        .length,
      amountUnderRecovery: cases.reduce((s, c) => s + c.principalOutstanding, 0),
      recoveredThisMonth: payments.filter((p) => p.clientConfirmed).reduce((s, p) => s + p.amount, 0),
      urgentTasks: tasks.filter((t) => t.urgent).length,
      awaitingClient: tasks.filter((t) => t.waitingOn === "client").length,
      portalRuns: tasks.filter((t) => t.waitingOn === "portal").length,
    };
  }

  async recoveryTrend(): Promise<TrendPoint[]> {
    // payment_allocations now lands real rows (P0-5, 0012_p0_5_workflow_
    // durability.sql) -- what's still missing is this method's own daily
    // rollup query against them. An empty series stays the honest "no
    // trend computed yet" answer rather than a fabricated one.
    // TODO(api): aggregate payment_allocations by day for this trend.
    return [];
  }

  async ageingBuckets(): Promise<AgeingBucket[]> {
    const cases = await this.listAllCases();
    const buckets: AgeingBucket[] = [
      { bucket: "0–30", amount: 0, cases: 0 },
      { bucket: "31–60", amount: 0, cases: 0 },
      { bucket: "61–90", amount: 0, cases: 0 },
      { bucket: "91–180", amount: 0, cases: 0 },
      { bucket: "180+", amount: 0, cases: 0 },
    ];
    const now = Date.now();
    for (const c of cases) {
      const invoices = await this.listInvoicesForCase(c.id);
      const due = invoices[0]?.dueDate ? new Date(invoices[0].dueDate).getTime() : now;
      const days = Math.max(0, Math.round((now - due) / 86_400_000));
      const idx = days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : days <= 180 ? 3 : 4;
      buckets[idx].amount += c.principalOutstanding;
      buckets[idx].cases += 1;
    }
    return buckets;
  }

  async stageFunnel(): Promise<StagePoint[]> {
    const cases = await this.listAllCases();
    const stageOf = (status: RecoveryCase["status"]): string => {
      if (status === "recovered") return "Recovered";
      if (["msme_odr_filed", "msefc_dd", "hearing_scheduled", "adjourned"].includes(status))
        return "DD / Hearing";
      if (status.startsWith("msme")) return "MSME ODR";
      if (status.startsWith("gst")) return "GST route";
      return "Reminders";
    };
    const byStage = new Map<string, StagePoint>();
    for (const c of cases) {
      const stage = stageOf(c.status);
      const existing = byStage.get(stage) ?? { stage, cases: 0, value: 0 };
      existing.cases += 1;
      existing.value += c.principalOutstanding;
      byStage.set(stage, existing);
    }
    return Array.from(byStage.values());
  }

  async clientOverview(orgId: string): Promise<ClientOverview> {
    const [cases, tasks, ageing, org] = await Promise.all([
      this.listCasesForOrg(orgId),
      this.openTasks(orgId),
      this.ageingBuckets(),
      this.getOrg(orgId),
    ]);
    const outstanding = cases.reduce((s, c) => s + c.principalOutstanding, 0);
    const recovered = cases.reduce((s, c) => s + c.recoveredToDate, 0);
    const denom = outstanding + recovered || 1;
    const nextCase = cases
      .filter((c) => c.nextScheduledAt)
      .sort((a, b) => (a.nextScheduledAt! < b.nextScheduledAt! ? -1 : 1))[0];
    return {
      orgId,
      actionsRequired: tasks.filter((t) => t.waitingOn === "client").length,
      totalOutstanding: outstanding,
      recovered,
      recoveryRatePct: Math.round((recovered / denom) * 100),
      upcomingAction: nextCase
        ? { label: CLIENT_SAFE_LABEL[nextCase.status] ?? "In progress", when: nextCase.nextScheduledAt }
        : null,
      feeSummary: {
        estimatedFee: estimateSuccessFee(recovered, org?.jitoMember ?? false),
        billed: 0,
        currency: "INR",
      },
      stageWise: (await this.stageFunnel()).map((s) => ({ stage: s.stage, value: s.value })),
      ageing: ageing.map((a) => ({ bucket: a.bucket, amount: a.amount })),
    };
  }

  async createCaseFromManualInvoice(
    organisationId: string,
    input: ManualInvoiceInput,
    actor: MutationActor,
  ): Promise<{ case: RecoveryCase; invoice: Invoice; debtor: Debtor }> {
    const supabase = await this.db();

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

    const result = await callWriteRpc<{ case: RecoveryCaseRow; invoice: InvoiceRow; debtor: DebtorRow }>(
      supabase,
      "create_case_from_invoice",
      {
        p_organisation_id: organisationId,
        p_debtor: {
          name: input.debtorName,
          gstin: input.debtorGstin ?? null,
          email: input.debtorEmail ?? null,
          mobile: input.debtorMobile ?? null,
          outstandingBalance: input.outstandingBalance,
        },
        p_case: {
          status: state.status,
          waitingOn: state.waitingOn,
          currentStep: transitions[transitions.length - 1]?.note ?? "Under validation",
          blocker: state.blocker,
          nextScheduledAction: state.nextAction,
          eligibilityRoute: state.eligibilityRoute,
          principalOutstanding: state.principalOutstanding,
        },
        p_invoice: {
          invoiceNumber: input.invoiceNumber,
          invoiceDate: input.invoiceDate,
          dueDate: input.dueDate ?? null,
          taxableValue: input.taxableValue,
          taxRate: input.taxRate,
          taxAmount: input.taxAmount,
          invoiceTotal: input.invoiceTotal,
          outstandingBalance: input.outstandingBalance,
        },
        p_reason: `Draft case created from manual invoice entry -- ${transitions.map((t) => t.note).join("; ")}`,
        p_expected_actor_id: actor.actorId,
      },
    );

    return {
      case: toCase(result.case),
      invoice: toInvoice(result.invoice),
      debtor: toDebtor(result.debtor),
    };
  }

  /**
   * Full-replace update of a debtor's mobile/email (case detail -> "Edit
   * contact details"). Staff/admin only, enforced inside update_debtor_
   * contact (0020_debtor_contact_update.sql) -- debtors is staff-read-only
   * via RLS since 0011_close_direct_write_bypass.sql, so this RPC is the
   * only way to change it; there is no direct-table-write fallback.
   */
  async updateDebtorContact(
    debtorId: string,
    input: DebtorContactInput,
    reason: string,
    actor: MutationActor,
  ): Promise<Debtor> {
    const supabase = await this.db();
    const result = await callWriteRpc<DebtorRow>(supabase, "update_debtor_contact", {
      p_debtor_id: debtorId,
      p_email: input.email ?? null,
      p_mobile: input.mobile ?? null,
      p_reason: reason,
      p_expected_actor_id: actor.actorId,
    });
    return toDebtor(result);
  }

  async validateBulkImport(csvText: string): Promise<ImportResult> {
    // Pure validation needs no case/organisation context -- only the known
    // (debtor, invoice_number) pairs, fetched as two flat queries (no typed
    // join support in the hand-written Database type; see types.ts).
    const supabase = await this.db();
    const [invoicesRes, debtorsRes] = await Promise.all([
      supabase.from("invoices").select("*").limit(5000),
      supabase.from("debtors").select("*"),
    ]);
    const invoiceRows: InvoiceRow[] = invoicesRes.data ?? [];
    const debtorRows: Database["public"]["Tables"]["debtors"]["Row"][] = debtorsRes.data ?? [];
    const debtorById = new Map(debtorRows.map((d) => [d.id, d]));
    const known = new Set(
      invoiceRows.map((inv) => {
        const debtor = debtorById.get(inv.debtor_id);
        const key = (debtor?.gstin || debtor?.name || "").toLowerCase();
        return `${key}::${inv.invoice_number.toLowerCase()}`;
      }),
    );
    return validateImport(csvText, { knownInvoiceKeys: known });
  }

  async commitBulkImport(
    organisationId: string,
    csvText: string,
    actor: MutationActor,
  ): Promise<{ result: ImportResult; casesCreated: number }> {
    const org = await this.getOrg(organisationId);
    if (!org) throw new Error(`commitBulkImport: organisation ${organisationId} not found`);

    const result = await this.validateBulkImport(csvText);
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

      // Sequential, not parallel: each row goes through its own atomic
      // create_case_from_invoice call (see 0006_production_write_rpcs.sql)
      // -- running them concurrently would not corrupt any single case, but
      // would make the row-by-row error semantics ("never partially
      // activate a case", not "the whole batch is one transaction") harder
      // to reason about, and matches MemoryRepository's own sequential loop.
      await this.createCaseFromManualInvoice(
        organisationId,
        {
          debtorName: cell("debtor_name"),
          debtorGstin: cell("debtor_gstin") || null,
          // Both optional -- validated per-row by validateBulkImport/
          // domain/bulk-import.ts before this ever runs; a blank cell is
          // simply absent, never fabricated (core-workflow remediation task).
          debtorEmail: cell("debtor_email") || null,
          debtorMobile: cell("debtor_mobile") || null,
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

    const supabase = await this.db();
    await recordAudit(
      supabase,
      organisationId,
      "bulk_import.committed",
      "organisation",
      organisationId,
      `${casesCreated} draft case(s) created from ${result.validRows} valid row(s) -- ${result.duplicateRows} duplicate, ${result.errorRows} error row(s) skipped (never partially activated)`,
    );

    return { result, casesCreated };
  }

  async recordPayment(
    input: {
      caseId: string;
      kind: PaymentRecordRow["kind"];
      amount: number;
      reference: string | null;
      clientConfirmed: boolean;
    },
    actor: MutationActor,
  ): Promise<{ payment: PaymentRecord; updatedCase: RecoveryCase | null }> {
    const supabase = await this.db();
    const row = await callWriteRpc<PaymentRecordRow>(supabase, "record_payment_row", {
      p_case_id: input.caseId,
      p_kind: input.kind,
      p_amount: input.amount,
      p_reference: input.reference,
      p_expected_actor_id: actor.actorId,
    });
    const payment = toPayment(row);

    if (!input.clientConfirmed) return { payment, updatedCase: null };

    const { updatedCase } = await this.confirmPayment(payment.id, actor);
    return { payment: { ...payment, clientConfirmed: true }, updatedCase };
  }

  async confirmPayment(
    paymentId: string,
    actor: MutationActor,
  ): Promise<{ payment: PaymentRecord; updatedCase: RecoveryCase }> {
    const supabase = await this.db();

    const paymentRes = await supabase.from("payment_records").select("*").eq("id", paymentId).maybeSingle();
    if (paymentRes.error) throw new Error(`SupabaseRepository.confirmPayment: ${paymentRes.error.message}`);
    const paymentRow = paymentRes.data as unknown as PaymentRecordRow | null;
    if (!paymentRow) throw new Error(`confirmPayment: payment ${paymentId} not found`);

    const kase = await this.getCase(paymentRow.case_id);
    if (!kase) throw new Error(`confirmPayment: case ${paymentRow.case_id} not found`);
    const invoices = await this.listInvoicesForCase(kase.id);

    const result = applyConfirmedPayment(
      kase,
      invoices.map((i) => ({ id: i.id, invoiceDate: i.invoiceDate, outstandingBalance: i.outstandingBalance })),
      paymentRow.amount,
    );

    const updatedRow = await callWriteRpc<RecoveryCaseRow>(supabase, "apply_payment_confirmation", {
      p_payment_id: paymentId,
      p_case: result.updatedCase,
      p_invoice_updates: result.invoiceAllocations.map((a) => ({
        id: a.invoiceId,
        outstandingBalance: a.balanceAfter,
        applied: a.applied,
      })),
      p_reason: result.note,
      p_expected_actor_id: actor.actorId,
    });

    return {
      payment: toPayment({ ...paymentRow, client_confirmed: true }),
      updatedCase: toCase(updatedRow),
    };
  }

  /**
   * Runs the durable, idempotent send sequence for one channel of the
   * initial reminder (email-delivery task §6/§7):
   *  1. begin_communication_send -- acquires the durable row BEFORE any
   *     SMTP/adapter call; a retry with the same idempotency key returns
   *     the existing row instead of creating a second one.
   *  2. If that row already reached a terminal 'sent' status, short-circuit
   *     -- no adapter call, no duplicate send.
   *  3. begin_delivery_attempt -- records the attempt is starting, before
   *     the adapter call; refuses to start a new attempt while the latest
   *     one is still 'queued' (ambiguous: a prior attempt's outcome was
   *     never persisted) unless the caller explicitly forces past it.
   *  4. Runs the adapter under the existing retry-once policy
   *     (src/orchestrator/run-adapter.ts).
   *  5. complete_delivery_attempt -- persists the definitive outcome. Case
   *     state is deliberately NOT touched here (p_case: null) -- with two
   *     channels now real, the case's own transition is computed once,
   *     after every channel has been attempted, by the caller.
   */
  private async sendReminderChannel(
    supabase: Client,
    caseId: string,
    channel: "whatsapp" | "email",
    to: string,
    templateKey: string,
    templateVersion: number,
    subject: string | null,
    body: string,
    actor: MutationActor,
    forceRetryAfterAmbiguous: boolean,
  ): Promise<{
    communication: Communication;
    outcome: "success" | "already_sent" | "retryable_failure" | "permanent_failure" | "human_action_required" | "drift_detected";
    ambiguousBlock: boolean;
    blockedReason: string | null;
  }> {
    const idempotencyKey = `reminder-initial:${channel}:${caseId}:${new Date().toISOString().slice(0, 10)}`;

    const begun = await callWriteRpc<{ communication: CommunicationRow; isNew: boolean }>(
      supabase,
      "begin_communication_send",
      {
        p_case_id: caseId,
        p_channel: channel,
        p_idempotency_key: idempotencyKey,
        p_template_key: templateKey,
        p_template_version: templateVersion,
        p_subject: subject,
        p_body: body,
        p_reason: `Initial reminder (${channel})`,
        p_expected_actor_id: actor.actorId,
      },
    );
    const comm = toCommunication(begun.communication);
    if (!begun.isNew && comm.deliveryStatus === "sent") {
      return { communication: comm, outcome: "already_sent", ambiguousBlock: false, blockedReason: null };
    }

    const existingDeliveries = await this.listDeliveriesForCommunication(comm.id);
    const nextAttempt = existingDeliveries.length + 1;

    const begunAttempt = await callWriteRpc<{ blocked: boolean; blockedReason: string | null; delivery: CommunicationDeliveryRow }>(
      supabase,
      "begin_delivery_attempt",
      {
        p_communication_id: comm.id,
        p_attempt: nextAttempt,
        p_reason: `Initial reminder (${channel}) attempt ${nextAttempt}`,
        p_expected_actor_id: actor.actorId,
        p_force_after_ambiguous: forceRetryAfterAmbiguous,
      },
    );
    if (begunAttempt.blocked) {
      return { communication: comm, outcome: "retryable_failure", ambiguousBlock: true, blockedReason: begunAttempt.blockedReason };
    }

    const adapter = channel === "whatsapp" ? getAdapters().whatsapp : getAdapters().email;
    const sendOutcome = await runAdapter(
      (key) =>
        adapter.send({
          idempotencyKey: key,
          caseId,
          channel,
          to,
          templateKey,
          templateVersion,
          subject: subject ?? undefined,
          body,
        }),
      idempotencyKey,
    );

    const status: "sent" | "failed" = sendOutcome.result.outcome === "success" ? "sent" : "failed";
    const completed = await callWriteRpc<{ delivery: CommunicationDeliveryRow; communication: CommunicationRow }>(
      supabase,
      "complete_delivery_attempt",
      {
        p_delivery_id: begunAttempt.delivery.id,
        p_status: status,
        p_adapter_outcome: sendOutcome.result.outcome,
        p_provider_message_id: sendOutcome.result.providerRef,
        p_error_detail: sendOutcome.result.errorCode,
        p_case_id: caseId,
        p_case: null,
        p_reason: sendOutcome.urgentTask?.reason ?? sendOutcome.result.nextAction ?? `${channel} delivery ${status}`,
        p_expected_actor_id: actor.actorId,
      },
    );

    return {
      communication: toCommunication(completed.communication),
      outcome: sendOutcome.result.outcome,
      ambiguousBlock: false,
      blockedReason: null,
    };
  }

  async sendInitialReminder(
    caseId: string,
    actor: MutationActor,
    options: { forceRetryAfterAmbiguous?: boolean } = {},
  ): Promise<{ case: RecoveryCase; communications: Communication[]; ambiguous: boolean }> {
    const supabase = await this.db();

    const kase = await this.getCase(caseId);
    if (!kase) throw new Error(`sendInitialReminder: case ${caseId} not found`);
    if (kase.status !== "active") {
      throw new Error(
        `sendInitialReminder: case ${caseId} is "${kase.status}", not "active" -- nothing to send`,
      );
    }
    const [debtor, org, invoices] = await Promise.all([
      this.getDebtor(kase.debtorId),
      this.getOrg(kase.organisationId),
      this.listInvoicesForCase(caseId),
    ]);

    const body = buildReminderMessage({
      legalEntityName: org?.legalEntityName ?? "our client",
      debtorName: debtor?.name ?? "—",
      invoiceNumber: invoices[0]?.invoiceNumber ?? null,
      amountPaise: kase.principalOutstanding,
    });
    const subject = buildReminderSubject({
      legalEntityName: org?.legalEntityName ?? "our client",
      invoiceNumber: invoices[0]?.invoiceNumber ?? null,
    });

    // WhatsApp has no real production provider (src/adapters/index.ts keeps
    // it mocked unconditionally) -- the mock adapter reports fake success
    // with a realistic-looking `wamid.*` providerRef for virtually every
    // send, which would silently advance a real case's reminder timer and
    // record a communication_delivery claiming a WhatsApp send that never
    // happened. Attempting it at all in production is therefore unsafe;
    // it is only ever attempted outside production, where the mock is an
    // explicit, understood demo/test affordance (final-UAT go-live task).
    const channels: { channel: "whatsapp" | "email"; to: string; templateKey: string; templateVersion: number; subject: string | null }[] = [];
    if (debtor?.mobile && !isProductionRuntime()) {
      channels.push({ channel: "whatsapp", to: debtor.mobile, templateKey: "reminder_initial_v3", templateVersion: 3, subject: null });
    }
    if (debtor?.email) {
      channels.push({ channel: "email", to: debtor.email, templateKey: "reminder_initial_email_v1", templateVersion: 1, subject });
    }
    if (channels.length === 0) {
      const reason =
        isProductionRuntime() && debtor?.mobile && !debtor?.email
          ? "case has a mobile number but no email on file, and WhatsApp is not an available production channel -- add a debtor email"
          : "no mobile or email on file";
      throw new Error(
        `sendInitialReminder: case ${caseId}'s debtor has ${reason} -- nothing to send. Correct the debtor's contact details first.`,
      );
    }

    const results: Awaited<ReturnType<SupabaseRepository["sendReminderChannel"]>>[] = [];
    for (const c of channels) {
      results.push(
        await this.sendReminderChannel(
          supabase,
          caseId,
          c.channel,
          c.to,
          c.templateKey,
          c.templateVersion,
          c.subject,
          body,
          actor,
          options.forceRetryAfterAmbiguous ?? false,
        ),
      );
    }

    const anySuccess = results.some((r) => r.outcome === "success" || r.outcome === "already_sent");
    const anyAmbiguous = results.some((r) => r.ambiguousBlock);
    const allFailedTerminally = results.every((r) => r.outcome !== "success" && r.outcome !== "already_sent") && !anyAmbiguous;

    let updatedCase: RecoveryCase;
    if (anySuccess) {
      const sent = applyReminderSent(kase);
      // Demo/live simplification carried over unchanged from before this
      // task: neither the mock WhatsApp adapter nor plain Gmail SMTP (no
      // Workspace-level bounce webhook) gives a real delivery confirmation,
      // so "adapter accepted the send" is treated as "delivered" for the
      // 24h-timer transition -- see docs/email-delivery/index.md. The
      // communication's own delivery_status stays honestly 'sent', not
      // 'delivered' -- only the case-level timer semantics use this
      // approximation, which already existed for WhatsApp.
      const deliveredAt = new Date();
      const delivered = applyReminderDelivered(sent.updatedCase, deliveredAt);
      const updatedRow = await callWriteRpc<RecoveryCaseRow>(supabase, "apply_case_mutation", {
        p_case_id: caseId,
        p_case: delivered.updatedCase,
        p_action: "reminder.sent",
        p_entity: "recovery_case",
        p_reason: `${sent.note}; ${delivered.note}`,
        p_communication: null,
        p_expected_actor_id: actor.actorId,
      });
      updatedCase = toCase(updatedRow);
    } else if (allFailedTerminally) {
      const sentPatch = applyReminderSent(kase);
      const failed = applyReminderDeliveryFailed(sentPatch.updatedCase, true);
      const updatedRow = await callWriteRpc<RecoveryCaseRow>(supabase, "apply_case_mutation", {
        p_case_id: caseId,
        p_case: failed.updatedCase,
        p_action: "reminder.delivery_failed",
        p_entity: "recovery_case",
        p_reason: `Every attempted channel failed -- ${failed.note}`,
        p_communication: null,
        p_expected_actor_id: actor.actorId,
      });
      updatedCase = toCase(updatedRow);
    } else {
      // Ambiguous and/or a mix that isn't conclusively "every channel
      // failed" -- do not advance or fail the case. Staying `active` makes
      // a fresh click a safe, explicit operator-triggered retry rather
      // than silently claiming either outcome (P0-5 §10 case-state
      // invariant: a failed send must not falsely advance the workflow,
      // and an ambiguous one must not either).
      updatedCase = kase;
    }

    return { case: updatedCase, communications: results.map((r) => r.communication), ambiguous: anyAmbiguous };
  }

  async prepareGstNotification(
    caseId: string,
    input: GstComposeInput,
    actor: MutationActor,
  ): Promise<{ case: RecoveryCase; manifestHash: string | null }> {
    const supabase = await this.db();
    const kase = await this.getCase(caseId);
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
      const updatedRow = await callWriteRpc<RecoveryCaseRow>(supabase, "apply_case_mutation", {
        p_case_id: caseId,
        p_case: failed.updatedCase,
        p_action: "gst.prepare_failed",
        p_entity: "recovery_case",
        p_reason: failed.note,
        p_expected_actor_id: actor.actorId,
      });
      return { case: toCase(updatedRow), manifestHash: null };
    }

    // Idempotent: only transitions when still at the eligibility-review gate.
    const prepared = kase.status === "gst_eligibility_review" ? applyGstPrepared(kase) : null;
    const updatedRow = await callWriteRpc<RecoveryCaseRow>(supabase, "apply_case_mutation", {
      p_case_id: caseId,
      p_case: prepared ? prepared.updatedCase : kase,
      p_action: "gst.prepared",
      p_entity: "recovery_case",
      p_reason: prepared?.note ?? "GST pack re-validated (already prepared)",
      p_expected_actor_id: actor.actorId,
    });

    return { case: toCase(updatedRow), manifestHash: outcome.result.data?.manifestHash ?? null };
  }

  async openGstAssistedSession(
    caseId: string,
    actor: MutationActor,
  ): Promise<{ sessionUrl: string | null }> {
    const supabase = await this.db();
    const kase = await this.getCase(caseId);
    if (!kase) throw new Error(`openGstAssistedSession: case ${caseId} not found`);

    const idempotencyKey = `gst-session:${caseId}`;
    const outcome = await runAdapter((key) => getAdapters().gstPortal.openAssistedSession(key), idempotencyKey);
    void actor; // attribution derived from auth.uid() inside recordAudit's RPC, not this parameter.
    await recordAudit(
      supabase,
      kase.organisationId,
      "gst.session_opened",
      "recovery_case",
      caseId,
      outcome.result.nextAction ?? "Assisted GST portal session opened",
    );
    return { sessionUrl: outcome.result.data?.sessionUrl ?? null };
  }

  async captureGstFiling(
    caseId: string,
    staffReference: string,
    actor: MutationActor,
  ): Promise<{ case: RecoveryCase; referenceNumber: string | null }> {
    const supabase = await this.db();
    const kase = await this.getCase(caseId);
    if (!kase) throw new Error(`captureGstFiling: case ${caseId} not found`);

    const idempotencyKey = `gst-capture:${caseId}`;
    const outcome = await runAdapter((key) => getAdapters().gstPortal.captureResult(key), idempotencyKey);

    if (outcome.result.outcome === "drift_detected" || outcome.result.outcome === "permanent_failure") {
      const failed = applyGstAutomationFailed(
        kase,
        outcome.urgentTask?.reason ?? outcome.result.errorCode ?? "GST filing capture failed",
      );
      const updatedRow = await callWriteRpc<RecoveryCaseRow>(supabase, "apply_case_mutation", {
        p_case_id: caseId,
        p_case: failed.updatedCase,
        p_action: "gst.filing_failed",
        p_entity: "recovery_case",
        p_reason: failed.note,
        p_expected_actor_id: actor.actorId,
      });
      return { case: toCase(updatedRow), referenceNumber: null };
    }

    if (outcome.result.outcome !== "success") {
      // human_action_required / retryable mid-flight -- no state change yet.
      return { case: kase, referenceNumber: null };
    }

    const referenceNumber = staffReference || outcome.result.data?.referenceNumber || "UNSPECIFIED";
    const filedAt = new Date();
    const filed = applyGstFiled(kase, filedAt);
    const debtor = await this.getDebtor(kase.debtorId);

    const updatedRow = await callWriteRpc<RecoveryCaseRow>(supabase, "apply_case_mutation", {
      p_case_id: caseId,
      p_case: filed.updatedCase,
      p_action: "gst.filed",
      p_entity: "recovery_case",
      p_reason: `${filed.note}; reference ${referenceNumber}`,
      p_communication: {
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
        createdAt: filedAt.toISOString(),
        deliveredAt: filedAt.toISOString(),
      },
      p_expected_actor_id: actor.actorId,
    });

    return { case: toCase(updatedRow), referenceNumber };
  }

  async saveMsmeStage(
    caseId: string,
    stage: MsmeStage,
    payload: Record<string, unknown>,
    actor: MutationActor,
  ): Promise<{ resumeToken: string | null }> {
    const supabase = await this.db();
    const kase = await this.getCase(caseId);
    if (!kase) throw new Error(`saveMsmeStage: case ${caseId} not found`);

    const idempotencyKey = `msme-stage:${caseId}:${stage}`;
    const outcome = await runAdapter(
      (key) => getAdapters().msmePortal.saveStage({ idempotencyKey: key, caseId, stage, payload }),
      idempotencyKey,
    );
    void actor; // audit-only write; see the note in openGstAssistedSession above.
    await recordAudit(
      supabase,
      kase.organisationId,
      "msme.stage_saved",
      "recovery_case",
      caseId,
      `Stage "${stage}" saved (${outcome.result.outcome})`,
    );
    return { resumeToken: outcome.result.data?.resumeToken ?? null };
  }

  async buildMsmePreview(
    caseId: string,
    actor: MutationActor,
  ): Promise<{ previewPdfKey: string | null; previewHash: string | null }> {
    const supabase = await this.db();
    const kase = await this.getCase(caseId);
    if (!kase) throw new Error(`buildMsmePreview: case ${caseId} not found`);

    const idempotencyKey = `msme-preview:${caseId}`;
    const outcome = await runAdapter((key) => getAdapters().msmePortal.buildPreview(key), idempotencyKey);
    void actor; // audit-only write; see the note in openGstAssistedSession above.
    await recordAudit(
      supabase,
      kase.organisationId,
      "msme.preview_built",
      "recovery_case",
      caseId,
      `Immutable preview snapshot generated (${outcome.result.outcome})`,
    );
    return {
      previewPdfKey: outcome.result.data?.previewPdfKey ?? null,
      previewHash: outcome.result.data?.previewHash ?? null,
    };
  }

  async captureMsmeAcknowledgement(
    caseId: string,
    actor: MutationActor,
  ): Promise<{ case: RecoveryCase; diaryNumber: string | null; petitionPdfKey: string | null }> {
    const supabase = await this.db();
    const kase = await this.getCase(caseId);
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
      const updatedRow = await callWriteRpc<RecoveryCaseRow>(supabase, "apply_case_mutation", {
        p_case_id: caseId,
        p_case: failed.updatedCase,
        p_action: "msme.filing_failed",
        p_entity: "recovery_case",
        p_reason: failed.note,
        p_expected_actor_id: actor.actorId,
      });
      return { case: toCase(updatedRow), diaryNumber: null, petitionPdfKey: null };
    }

    if (outcome.result.outcome !== "success") {
      return { case: kase, diaryNumber: null, petitionPdfKey: null };
    }

    const diaryNumber = outcome.result.data?.diaryNumber ?? null;
    const petitionPdfKey = outcome.result.data?.petitionPdfKey ?? null;
    const filed = applyMsmeFiled(kase);
    const debtor = await this.getDebtor(kase.debtorId);

    const updatedRow = await callWriteRpc<RecoveryCaseRow>(supabase, "apply_case_mutation", {
      p_case_id: caseId,
      p_case: filed.updatedCase,
      p_action: "msme.filed",
      p_entity: "recovery_case",
      p_reason: `${filed.note}; diary number ${diaryNumber ?? "pending"}`,
      p_communication: {
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
        createdAt: new Date().toISOString(),
        deliveredAt: new Date().toISOString(),
      },
      p_expected_actor_id: actor.actorId,
    });

    return { case: toCase(updatedRow), diaryNumber, petitionPdfKey };
  }

  async prepareDdTask(
    caseId: string,
    input: { amount?: number | null; payee?: string | null; reference?: string | null; notes?: string | null },
    actor: MutationActor,
  ): Promise<{ case: RecoveryCase; dd: DdRecord }> {
    const supabase = await this.db();
    const kase = await this.getCase(caseId);
    if (!kase) throw new Error(`prepareDdTask: case ${caseId} not found`);
    const prepared = applyDdPrepared(kase);
    const result = await callWriteRpc<{ case: RecoveryCaseRow; dd: DdRecordRow }>(supabase, "prepare_dd", {
      p_case_id: caseId,
      p_case: prepared.updatedCase,
      p_amount: input.amount ?? null,
      p_payee: input.payee ?? null,
      p_reference: input.reference ?? null,
      p_notes: input.notes ?? null,
      p_reason: prepared.note,
      p_expected_actor_id: actor.actorId,
    });
    return { case: toCase(result.case), dd: toDdRecord(result.dd) };
  }

  async recordDdSubmitted(
    caseId: string,
    input: { submittedAt?: string | null; documentId?: string | null },
    actor: MutationActor,
  ): Promise<DdRecord> {
    const supabase = await this.db();
    const row = await callWriteRpc<DdRecordRow>(supabase, "record_dd_submitted", {
      p_case_id: caseId,
      p_submitted_at: input.submittedAt ?? null,
      p_document_id: input.documentId ?? null,
      p_reason: "DD handed over / submitted",
      p_expected_actor_id: actor.actorId,
    });
    return toDdRecord(row);
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
  ): Promise<{ case: RecoveryCase; hearing: CaseHearing }> {
    const supabase = await this.db();
    const kase = await this.getCase(caseId);
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

    const scheduled = applyHearingScheduled(kase, startsAt);
    const result = await callWriteRpc<{ case: RecoveryCaseRow; hearing: CaseHearingRow; calendarEvent?: CalendarEventRow }>(
      supabase,
      "schedule_hearing",
      {
        p_case_id: caseId,
        p_case: scheduled.updatedCase,
        p_scheduled_at: startsAt.toISOString(),
        p_forum: input.forum ?? null,
        p_authority: input.authority ?? null,
        p_case_reference: input.caseReference ?? null,
        p_assigned_staff_id: input.assignedStaffId ?? null,
        p_notes: input.notes ?? null,
        p_reason: `${scheduled.note}; calendar adapter event ${outcome.result.data?.eventId ?? "n/a"}`,
        p_expected_actor_id: actor.actorId,
      },
    );

    return { case: toCase(result.case), hearing: toHearing(result.hearing) };
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
  ): Promise<{ case: RecoveryCase; hearing: CaseHearing }> {
    const supabase = await this.db();
    const kase = await this.getCase(caseId);
    if (!kase) throw new Error(`rescheduleHearing: case ${caseId} not found`);
    const newStartsAt = new Date(input.newStartsAtIso);
    if (Number.isNaN(newStartsAt.getTime())) {
      throw new Error(`rescheduleHearing: invalid date "${input.newStartsAtIso}"`);
    }

    const adjourned = applyHearingAdjourned(kase);
    const scheduled = applyHearingScheduled({ ...kase, ...adjourned.updatedCase }, newStartsAt);

    const result = await callWriteRpc<{ case: RecoveryCaseRow; hearing: CaseHearingRow; calendarEvent: CalendarEventRow }>(
      supabase,
      "reschedule_hearing",
      {
        p_hearing_id: hearingId,
        p_case_id: caseId,
        p_case: scheduled.updatedCase,
        p_new_scheduled_at: newStartsAt.toISOString(),
        p_forum: input.forum ?? null,
        p_authority: input.authority ?? null,
        p_case_reference: input.caseReference ?? null,
        p_assigned_staff_id: input.assignedStaffId ?? null,
        p_notes: input.notes ?? null,
        p_reason: `${adjourned.note}; ${scheduled.note}`,
        p_expected_actor_id: actor.actorId,
      },
    );

    return { case: toCase(result.case), hearing: toHearing(result.hearing) };
  }

  async recordHearingOutcome(
    hearingId: string,
    caseId: string,
    input: { status: "completed" | "cancelled"; result?: string | null; recovered: boolean },
    actor: MutationActor,
  ): Promise<{ case: RecoveryCase; hearing: CaseHearing }> {
    const supabase = await this.db();
    const kase = await this.getCase(caseId);
    if (!kase) throw new Error(`recordHearingOutcome: case ${caseId} not found`);
    const outcome = applyHearingOutcome(kase, input.recovered);

    const result = await callWriteRpc<{ case: RecoveryCaseRow; hearing: CaseHearingRow }>(
      supabase,
      "record_hearing_outcome",
      {
        p_hearing_id: hearingId,
        p_case_id: caseId,
        p_case: outcome.updatedCase,
        p_status: input.status,
        p_result: input.result ?? null,
        p_reason: outcome.note,
        p_expected_actor_id: actor.actorId,
      },
    );

    return { case: toCase(result.case), hearing: toHearing(result.hearing) };
  }

  async recordDebtorReply(
    caseId: string,
    input: {
      channel: import("@/contract/enums").Channel;
      rawBody: string;
      communicationId?: string | null;
      classification: import("@/contract/enums").ReplyClassification;
    },
    actor: MutationActor,
  ): Promise<{ case: RecoveryCase; reply: DebtorReply }> {
    const supabase = await this.db();
    const kase = await this.getCase(caseId);
    if (!kase) throw new Error(`recordDebtorReply: case ${caseId} not found`);
    const classified = applyReplyClassified(kase, input.classification);

    const result = await callWriteRpc<{ case: RecoveryCaseRow; reply: DebtorReplyRow }>(
      supabase,
      "record_debtor_reply",
      {
        p_case_id: caseId,
        p_case: classified.updatedCase,
        p_channel: input.channel,
        p_raw_body: input.rawBody,
        p_communication_id: input.communicationId ?? null,
        p_classification: input.classification,
        p_reason: classified.note,
        p_expected_actor_id: actor.actorId,
      },
    );

    return { case: toCase(result.case), reply: toReply(result.reply) };
  }

  async resolveWorkflowTask(taskId: string, reason: string, actor: MutationActor): Promise<WorkflowTask> {
    const supabase = await this.db();
    const row = await callWriteRpc<WorkflowTaskRow>(supabase, "resolve_workflow_task", {
      p_task_id: taskId,
      p_reason: reason,
      p_expected_actor_id: actor.actorId,
    });
    return toTask(row);
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
  ): Promise<{ case: RecoveryCase; invoice: Invoice }> {
    const supabase = await this.db();
    const kase = await this.getCase(caseId);
    if (!kase) throw new Error(`correctInvoiceOcr: case ${caseId} not found`);

    const outstandingBalance = corrections.outstandingBalance ?? kase.principalOutstanding;
    const corrected = applyOcrCorrected({ ...kase, principalOutstanding: outstandingBalance });
    const updatedCase: RecoveryCase = {
      ...corrected.updatedCase,
      principalOutstanding: outstandingBalance,
      activatedAt: corrected.updatedCase.status === "active" ? new Date().toISOString() : kase.activatedAt,
    };

    const invoiceRow = await callWriteRpc<InvoiceRow>(supabase, "correct_invoice_row", {
      p_invoice_id: invoiceId,
      p_corrections: corrections,
      p_case_id: caseId,
      p_case: updatedCase,
      p_reason: `Staff corrected extracted fields (was low-confidence); ${corrected.note}`,
      p_expected_actor_id: actor.actorId,
    });

    return { case: updatedCase, invoice: toInvoice(invoiceRow) };
  }

  async listAuditLog(limit = 200): Promise<import("@/lib/mock-data").AuditEntry[]> {
    const supabase = await this.db();
    const res = await supabase
      .from("audit_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    const rows: AuditEventRow[] = unwrap(res, "listAuditLog");
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id ?? "",
      reason: r.reason,
      createdAt: r.created_at,
      actorId: r.actor_id,
      actorRole: r.actor_role,
    }));
  }

  async getAutomationState(): Promise<{ enabled: boolean }> {
    // Backed by system_settings (supabase/migrations/0006_production_write_rpcs.sql)
    // -- staff/admin may SELECT it directly (system_settings_staff_read
    // policy); only set_automation_state() may write it.
    const supabase = await this.db();
    const res = await supabase.from("system_settings").select("*").eq("key", "automation").maybeSingle();
    if (res.error) throw new Error(`SupabaseRepository.getAutomationState: ${res.error.message}`);
    const row = res.data as unknown as { value_json: { enabled: boolean } } | null;
    if (!row) {
      // Live-verified (Gate B): `data: null` here means either the row is
      // genuinely missing (a migration didn't run) OR -- far more likely --
      // the caller has no staff/admin session, so system_settings_staff_read
      // hides the row entirely; PostgREST can't tell these apart, and
      // neither can we. Do not claim data corruption.
      throw new Error(
        "SupabaseRepository.getAutomationState: no system_settings row visible to this session " +
          "-- expected if the caller has no authenticated staff/admin session (RLS hides the row), " +
          "otherwise the 0006 migration's seed row is missing",
      );
    }
    return { enabled: row.value_json.enabled };
  }

  async setAutomationState(
    enabled: boolean,
    reason: string,
    actor: MutationActor,
  ): Promise<{ enabled: boolean }> {
    const supabase = await this.db();
    return callWriteRpc<{ enabled: boolean }>(supabase, "set_automation_state", {
      p_enabled: enabled,
      p_reason: reason,
      p_expected_actor_id: actor.actorId,
    });
  }
}
