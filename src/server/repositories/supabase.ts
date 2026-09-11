/**
 * Supabase-backed Repository implementation. Selected by `../repo.ts` once
 * NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are configured.
 *
 * Row -> DTO mapping only; no business logic here (PRD §13: every query is
 * scoped, RLS is still the hard boundary underneath these calls -- this
 * client is the session-bound one from src/lib/supabase/server.ts, so RLS
 * applies exactly as it would to a direct query).
 *
 * NOT executed against a live database in this build (none is provisioned).
 * It is type-checked against supabase/migrations + src/lib/supabase/types.ts
 * so it is a mechanical, low-risk swap once a project exists -- treat any
 * runtime issue found against a real project as a bug to fix here, not a
 * reason to bypass the repository seam.
 */

import { createClient } from "@/lib/supabase/server";
import type {
  CommunicationRow,
  Database,
  InvoiceRow,
  PaymentRecordRow,
  RecoveryCaseRow,
  WorkflowTaskRow,
} from "@/lib/supabase/types";
import type {
  Communication,
  Debtor,
  ImportResult,
  Invoice,
  Organisation,
  PaymentRecord,
  RecoveryCase,
  WorkflowTask,
} from "@/contract/types";
import { CLIENT_SAFE_LABEL } from "@/contract/enums";
import type { CaseRow, ClientOverview, QueueItem } from "@/lib/mock-data";
import type { AgeingBucket, DashboardKpis, Repository, StagePoint, TrendPoint } from "../repository";

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

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, context: string): T {
  if (result.error) throw new Error(`SupabaseRepository.${context}: ${result.error.message}`);
  return result.data as T;
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
    // TODO(api): backed by a daily rollup once payment_allocations land;
    // an empty series is the honest "no data yet" answer against a fresh DB.
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
    const [cases, tasks, ageing] = await Promise.all([
      this.listCasesForOrg(orgId),
      this.openTasks(orgId),
      this.ageingBuckets(),
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
      feeSummary: { estimatedFee: Math.round(recovered * 0.08), billed: 0, currency: "INR" },
      stageWise: (await this.stageFunnel()).map((s) => ({ stage: s.stage, value: s.value })),
      ageing: ageing.map((a) => ({ bucket: a.bucket, amount: a.amount })),
    };
  }

  async createCaseFromManualInvoice(
    _organisationId: string,
    _input: import("@/contract/schemas").ManualInvoiceInput,
  ): Promise<{ case: RecoveryCase; invoice: Invoice; debtor: Debtor }> {
    // TODO(api): find-or-create the debtor, run src/domain/intake.ts
    // createDraftCase(), INSERT case + invoice in one transaction, audit it.
    throw new Error("SupabaseRepository.createCaseFromManualInvoice: not wired yet -- see src/domain/intake.ts");
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
    const { validateImport } = await import("@/domain/bulk-import");
    return validateImport(csvText, { knownInvoiceKeys: known });
  }

  async commitBulkImport(
    _organisationId: string,
    _csvText: string,
  ): Promise<{ result: ImportResult; casesCreated: number }> {
    // TODO(api): validateBulkImport() then createCaseFromManualInvoice() per
    // valid row, same as MemoryRepository.commitBulkImport.
    throw new Error("SupabaseRepository.commitBulkImport: not wired yet -- see src/domain/intake.ts");
  }

  async recordPayment(_input: {
    caseId: string;
    kind: PaymentRecordRow["kind"];
    amount: number;
    reference: string | null;
    clientConfirmed: boolean;
  }): Promise<{ payment: PaymentRecord; updatedCase: RecoveryCase | null }> {
    // TODO(api): INSERT into payment_records, then call confirmPayment() below
    // when clientConfirmed -- same rule, real transaction. The pure logic
    // (src/domain/apply-payment.ts) is written and unit-tested; this only
    // needs the INSERT/UPDATE wiring once a project exists.
    throw new Error("SupabaseRepository.recordPayment: not wired yet -- see src/domain/apply-payment.ts");
  }

  async confirmPayment(
    _paymentId: string,
  ): Promise<{ payment: PaymentRecord; updatedCase: RecoveryCase }> {
    // TODO(api): SELECT payment + case + invoices, run
    // applyConfirmedPayment(), UPDATE case + invoices in one transaction,
    // INSERT an audit_events row. Same shape as MemoryRepository.confirmPayment.
    throw new Error("SupabaseRepository.confirmPayment: not wired yet -- see src/domain/apply-payment.ts");
  }

  async sendInitialReminder(
    _caseId: string,
  ): Promise<{ case: RecoveryCase; communication: Communication }> {
    // TODO(api): SELECT case/debtor/org/invoice, call the real messaging
    // adapter through src/orchestrator/run-adapter.ts, INSERT the
    // communications row, UPDATE the case via src/domain/reminder.ts, and
    // persist the webhook-driven delivery transition instead of simulating
    // it immediately (see the comment in MemoryRepository.sendInitialReminder).
    throw new Error("SupabaseRepository.sendInitialReminder: not wired yet -- see src/domain/reminder.ts");
  }

  async prepareGstNotification(
    _caseId: string,
    _input: import("@/contract/schemas").GstComposeInput,
  ): Promise<{ case: RecoveryCase; manifestHash: string | null }> {
    // TODO(api): validate + call the real GST adapter's prepare() through
    // run-adapter.ts, UPDATE the case via src/domain/gst.ts applyGstPrepared(),
    // INSERT an audit_events row. Same shape as MemoryRepository.
    throw new Error("SupabaseRepository.prepareGstNotification: not wired yet -- see src/domain/gst.ts");
  }

  async openGstAssistedSession(_caseId: string): Promise<{ sessionUrl: string | null }> {
    // TODO(api): call the real GST adapter's openAssistedSession(), audit it.
    throw new Error("SupabaseRepository.openGstAssistedSession: not wired yet -- see src/domain/gst.ts");
  }

  async captureGstFiling(
    _caseId: string,
    _staffReference: string,
  ): Promise<{ case: RecoveryCase; referenceNumber: string | null }> {
    // TODO(api): call captureResult() through run-adapter.ts; on success
    // apply src/domain/gst.ts applyGstFiled() and INSERT the communications
    // row; on drift/permanent failure apply applyGstAutomationFailed() and
    // raise an urgent audit_events row (fail closed -- PRD §11, scenario 9).
    throw new Error("SupabaseRepository.captureGstFiling: not wired yet -- see src/domain/gst.ts");
  }

  async saveMsmeStage(
    _caseId: string,
    _stage: import("@/contract/adapters").MsmeStage,
    _payload: Record<string, unknown>,
  ): Promise<{ resumeToken: string | null }> {
    // TODO(api): call the real MSME adapter's saveStage(), audit it.
    throw new Error("SupabaseRepository.saveMsmeStage: not wired yet -- see src/domain/msme.ts");
  }

  async buildMsmePreview(
    _caseId: string,
  ): Promise<{ previewPdfKey: string | null; previewHash: string | null }> {
    // TODO(api): call buildPreview(), store the immutable snapshot as a
    // portal_artifacts row, audit it.
    throw new Error("SupabaseRepository.buildMsmePreview: not wired yet -- see src/domain/msme.ts");
  }

  async captureMsmeAcknowledgement(
    _caseId: string,
  ): Promise<{ case: RecoveryCase; diaryNumber: string | null; petitionPdfKey: string | null }> {
    // TODO(api): call captureAcknowledgement() through run-adapter.ts; on
    // success apply src/domain/msme.ts applyMsmeFiled() and INSERT the
    // communications row; on drift/permanent failure apply
    // applyMsmeAutomationFailed() and raise an urgent audit_events row.
    throw new Error("SupabaseRepository.captureMsmeAcknowledgement: not wired yet -- see src/domain/msme.ts");
  }

  async prepareDdTask(_caseId: string): Promise<{ case: RecoveryCase }> {
    // TODO(api): UPDATE the case via src/domain/hearing.ts applyDdPrepared(),
    // INSERT a workflow_tasks row (dd_preparation, waiting_on client), audit it.
    throw new Error("SupabaseRepository.prepareDdTask: not wired yet -- see src/domain/hearing.ts");
  }

  async scheduleHearing(
    _caseId: string,
    _startsAtIso: string,
  ): Promise<{ case: RecoveryCase; eventId: string | null }> {
    // TODO(api): call the calendar adapter's upsertEvent() through
    // run-adapter.ts, UPDATE the case via applyHearingScheduled(), INSERT a
    // calendar_events row, audit it.
    throw new Error("SupabaseRepository.scheduleHearing: not wired yet -- see src/domain/hearing.ts");
  }

  async correctInvoiceOcr(
    _caseId: string,
    _invoiceId: string,
    _corrections: Partial<
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
  ): Promise<{ case: RecoveryCase; invoice: Invoice }> {
    // TODO(api): UPDATE the invoice row (preserve document_versions
    // provenance), UPDATE the case via src/domain/ocr.ts applyOcrCorrected(),
    // audit it.
    throw new Error("SupabaseRepository.correctInvoiceOcr: not wired yet -- see src/domain/ocr.ts");
  }
}
