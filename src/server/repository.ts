/**
 * Data-access seam between UI (server components) and storage.
 *
 * Pages call `getRepo()` and await these methods instead of importing
 * `@/lib/mock-data` directly. Today `getRepo()` returns the in-memory
 * implementation (`repositories/memory.ts`, built on the same demo data);
 * once a Supabase project is provisioned and `NEXT_PUBLIC_SUPABASE_URL` /
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set, `getRepo()` returns
 * `repositories/supabase.ts` with no call-site change (see `repo.ts`).
 *
 * Every method is async and every list method takes an explicit tenant scope
 * where one applies (PRD §13 — client-level authorization on every query).
 *
 * TENANT INVARIANT (P0-1/P0-2-R1 §3): every mutation below takes a mandatory
 * trailing `actor: MutationActor` parameter -- it is a compile error to call
 * any of these without one, and the only way to obtain one is
 * `authorizeStaffMutation()`/`authorizeClientMutation()` in
 * `src/lib/auth/session.ts`, which derive it from the verified server-side
 * session (never from the method's own `input`/form-shaped parameters, which
 * a browser fully controls). This makes attribution forgery a compile-time
 * impossibility at every call site, not a caller convention.
 *
 * Today every mutation call site is staff-only (see `src/app/actions/*` --
 * none of the `(client)` surface pages import a server action), and staff
 * are cross-org by design (PRD §4), so no repository mutation method here
 * additionally re-derives or re-checks a tenant boundary from `actor` --
 * there is none to enforce for a staff actor. If a client-invokable mutation
 * is ever added, its action MUST call `authorizeClientMutation(organisationId)`
 * with an `organisationId` read from the entity being mutated (e.g. via
 * `getCase()`), not from a form field -- `requireClientContext` already
 * throws `ForbiddenError` when the session's organisation doesn't match
 * (see `src/lib/auth/context.test.ts`) -- and should not trust the
 * repository to re-derive that check on its behalf.
 */

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
import type { MutationActor } from "@/lib/auth/types";
import type { CaseRow, ClientOverview, QueueItem } from "@/lib/mock-data";

export type CreateOrganisationResult =
  | { status: "created"; organisation: Organisation }
  | {
      status: "duplicate_name_warning";
      existingOrganisation: { id: string; clientCode: string; legalEntityName: string };
    };

export interface DashboardKpis {
  openCases: number;
  amountUnderRecovery: number;
  recoveredThisMonth: number;
  urgentTasks: number;
  awaitingClient: number;
  portalRuns: number;
}

export interface TrendPoint {
  date: string;
  recovered: number;
  newDebt: number;
}

export interface AgeingBucket {
  bucket: string;
  amount: number;
  cases: number;
}

export interface StagePoint {
  stage: string;
  cases: number;
  value: number;
}

export interface Repository {
  // -- reference data ------------------------------------------------------
  getOrg(id: string): Promise<Organisation | undefined>;
  listOrganisations(): Promise<Organisation[]>;
  /**
   * Onboard a new client organisation. Rejects a duplicate client code or
   * duplicate creditor GSTIN outright. A legal-entity-name collision returns
   * `duplicate_name_warning` instead of creating a record, unless the input
   * already carries `confirmDuplicateName` + a reason (see schemas.ts).
   */
  createOrganisation(
    input: import("@/contract/schemas").CreateOrganisationInput,
    actor: MutationActor,
  ): Promise<CreateOrganisationResult>;
  getDebtor(id: string): Promise<Debtor | undefined>;
  assigneeName(id: string | null): Promise<string>;

  // -- cases ----------------------------------------------------------------
  getCase(id: string): Promise<RecoveryCase | undefined>;
  listAllCases(): Promise<RecoveryCase[]>;
  listCasesForOrg(orgId: string): Promise<RecoveryCase[]>;
  caseRows(orgId?: string): Promise<CaseRow[]>;

  // -- case sub-resources -----------------------------------------------------
  listInvoicesForCase(caseId: string): Promise<Invoice[]>;
  listCommunicationsForCase(caseId: string): Promise<Communication[]>;
  listPaymentsForCase(caseId: string): Promise<PaymentRecord[]>;
  listTasksForCase(caseId: string): Promise<WorkflowTask[]>;

  // -- cross-case lists (already client/org-filtered by the caller's session) --
  listAllCommunications(): Promise<Communication[]>;
  listAllPayments(): Promise<PaymentRecord[]>;
  openTasks(orgId?: string): Promise<WorkflowTask[]>;
  urgentQueue(orgId?: string): Promise<QueueItem[]>;

  // -- aggregates -------------------------------------------------------------
  dashboardKpis(): Promise<DashboardKpis>;
  recoveryTrend(): Promise<TrendPoint[]>;
  ageingBuckets(): Promise<AgeingBucket[]>;
  stageFunnel(): Promise<StagePoint[]>;
  clientOverview(orgId: string): Promise<ClientOverview>;

  // -- intake ---------------------------------------------------------------
  /**
   * Create a draft case from one manually entered invoice (PRD §5/§7,
   * acceptance scenarios 0/14): starts preparation automatically
   * (accept -> deterministic checks) but never activates the case --
   * activation still needs certification/validation/age-gate.
   */
  createCaseFromManualInvoice(
    organisationId: string,
    input: import("@/contract/schemas").ManualInvoiceInput,
    actor: MutationActor,
  ): Promise<{ case: RecoveryCase; invoice: Invoice; debtor: Debtor }>;
  /** Validates a bulk-import CSV against the contract without persisting anything. */
  validateBulkImport(csvText: string): Promise<ImportResult>;
  /** Re-validates, then creates a draft case per valid row (never partial-activates). */
  commitBulkImport(
    organisationId: string,
    csvText: string,
    actor: MutationActor,
  ): Promise<{ result: ImportResult; casesCreated: number }>;

  // -- mutations ------------------------------------------------------------
  /**
   * Record a receipt against a case. If `clientConfirmed` is true this also
   * runs the allocation + workflow rule (PRD §7): confirming immediately
   * cancels pending escalation, in full or in part.
   */
  recordPayment(
    input: {
      caseId: string;
      kind: PaymentRecord["kind"];
      amount: number;
      reference: string | null;
      clientConfirmed: boolean;
    },
    actor: MutationActor,
  ): Promise<{ payment: PaymentRecord; updatedCase: RecoveryCase | null }>;
  /** Client confirms an already-recorded receipt. Cancels pending escalation. */
  confirmPayment(
    paymentId: string,
    actor: MutationActor,
  ): Promise<{ payment: PaymentRecord; updatedCase: RecoveryCase }>;

  /**
   * Send the initial reminder for a case in `active` status (PRD §5/§8):
   * builds the message, runs it through the messaging adapter under the
   * retry-once-then-urgent-task policy, records the communication, and
   * advances the case (sent -> delivered -> 24h timer started, or a
   * both-channels-failed contact-correction task on adapter failure).
   */
  sendInitialReminder(
    caseId: string,
    actor: MutationActor,
  ): Promise<{ case: RecoveryCase; communication: Communication }>;

  /**
   * GST assisted-notification flow (PRD §11). Government-portal actions cap
   * at "assist": the platform prepares/validates/prefills, a human completes
   * CAPTCHA and Send, and the platform captures reference/screenshot evidence.
   */
  prepareGstNotification(
    caseId: string,
    input: import("@/contract/schemas").GstComposeInput,
    actor: MutationActor,
  ): Promise<{ case: RecoveryCase; manifestHash: string | null }>;
  /** Opens the controlled browser session; always human_action_required -- no CAPTCHA/OTP bypass. */
  openGstAssistedSession(caseId: string, actor: MutationActor): Promise<{ sessionUrl: string | null }>;
  /** Called after the operator confirms Send. Fails closed on drift (scenario 9). */
  captureGstFiling(
    caseId: string,
    staffReference: string,
    actor: MutationActor,
  ): Promise<{ case: RecoveryCase; referenceNumber: string | null }>;

  /**
   * MSME ODR seven-stage filing (PRD §12). Each stage saves/resumes
   * independently of the case's workflow status; the case only transitions
   * once submission is acknowledged (diary number + petition PDF captured).
   */
  saveMsmeStage(
    caseId: string,
    stage: import("@/contract/adapters").MsmeStage,
    payload: Record<string, unknown>,
    actor: MutationActor,
  ): Promise<{ resumeToken: string | null }>;
  /** Builds the immutable preview snapshot ahead of final submit. */
  buildMsmePreview(
    caseId: string,
    actor: MutationActor,
  ): Promise<{ previewPdfKey: string | null; previewHash: string | null }>;
  /** Called after the operator confirms final submit. Fails closed on drift. */
  captureMsmeAcknowledgement(
    caseId: string,
    actor: MutationActor,
  ): Promise<{ case: RecoveryCase; diaryNumber: string | null; petitionPdfKey: string | null }>;

  /**
   * DD / hearing tracking (PRD §12). DD preparation and the physical demand
   * draft remain human/manual; scheduling a hearing creates a calendar event
   * through the calendar adapter.
   */
  prepareDdTask(caseId: string, actor: MutationActor): Promise<{ case: RecoveryCase }>;
  scheduleHearing(
    caseId: string,
    startsAtIso: string,
    actor: MutationActor,
  ): Promise<{ case: RecoveryCase; eventId: string | null }>;

  /**
   * Staff reviews and corrects a low-confidence OCR extraction (PRD §7,
   * acceptance scenario 1). Applies the corrected fields to the invoice
   * (preserving provenance -- the original checksum/version is untouched,
   * only the extracted values are corrected) and satisfies the
   * staff-validation gate.
   */
  /** Tamper-evident-in-spirit append-only audit log (PRD §13). Newest first. */
  listAuditLog(limit?: number): Promise<import("@/lib/mock-data").AuditEntry[]>;

  /**
   * Global automation kill switch (PRD §5 "Admin owns the global kill
   * switch. Overrides ... require a reason and audit record."). Stops new
   * automated external actions; does not delete queued evidence or close cases.
   */
  getAutomationState(): Promise<{ enabled: boolean }>;
  setAutomationState(
    enabled: boolean,
    reason: string,
    actor: MutationActor,
  ): Promise<{ enabled: boolean }>;

  correctInvoiceOcr(
    caseId: string,
    invoiceId: string,
    corrections: Partial<
      Pick<
        Invoice,
        "invoiceNumber" | "invoiceDate" | "dueDate" | "taxableValue" | "taxRate" | "taxAmount" | "invoiceTotal" | "outstandingBalance"
      >
    >,
    actor: MutationActor,
  ): Promise<{ case: RecoveryCase; invoice: Invoice }>;
}
