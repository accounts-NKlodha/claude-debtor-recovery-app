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
import type { HearingStatus, ReplyClassification, Channel } from "@/contract/enums";
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
  /**
   * Full-replace update of a creditor organisation's UPI ID + payee name
   * (V2 WhatsApp reminder). Admin only; `reason` is required and audited
   * (`organisation.payment_details_updated`, change indicators only -- the
   * values themselves are never written to the audit log).
   */
  updateOrganisationPaymentDetails(
    organisationId: string,
    input: import("@/contract/schemas").OrganisationPaymentDetailsInput,
    actor: MutationActor,
  ): Promise<Organisation>;
  getDebtor(id: string): Promise<Debtor | undefined>;
  /**
   * Full-replace update of a debtor's mobile/email (core-workflow
   * remediation task: final UAT found no mechanism anywhere to capture or
   * correct debtor contact info, which blocked the reminder-send workflow
   * for any case created through the product's own intake paths).
   * Staff/admin only -- client must never modify debtor contact
   * information. `reason` is required and audited (`debtor.contact_updated`).
   */
  updateDebtorContact(
    debtorId: string,
    input: import("@/contract/schemas").DebtorContactInput,
    reason: string,
    actor: MutationActor,
  ): Promise<Debtor>;
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
  /** Per-invoice breakdown of every confirmed payment against this case (P0-5 §6). */
  listAllocationsForCase(caseId: string): Promise<PaymentAllocation[]>;
  /** The case's durable DD record, if DD preparation has ever started (P0-5 §4). */
  getDdRecord(caseId: string): Promise<DdRecord | undefined>;
  /** Every hearing occurrence for the case, most recent first (P0-5 §5). */
  listHearingsForCase(caseId: string): Promise<CaseHearing[]>;
  /** Inbound debtor replies recorded for this case (P0-5 §7). */
  listDebtorRepliesForCase(caseId: string): Promise<DebtorReply[]>;
  /** Per-attempt delivery telemetry for one communication, oldest first
   * (email-delivery task) -- used both to determine the next attempt
   * number and to show operators send/retry history. */
  listDeliveriesForCommunication(communicationId: string): Promise<CommunicationDelivery[]>;

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
   * Send the initial reminder for a case in `active` status (PRD §5/§8) on
   * every channel the debtor has a real address for (WhatsApp mobile,
   * email address) -- builds the message, runs each channel through its
   * adapter under the retry-once-then-urgent-task policy with a durable,
   * database-enforced idempotency key per channel (email-delivery task
   * §6/§7: a retried call never re-sends a channel that already reached a
   * terminal 'sent' state), records one `communications` row per attempted
   * channel, and advances the case once (sent -> delivered -> 24h timer
   * started) only if at least one channel succeeded, or raises a
   * contact-correction task if every attempted channel failed.
   *
   * `ambiguous` is true if any channel's prior attempt was left in an
   * unknown state (e.g. a crash between the SMTP call and persisting its
   * outcome) and required an explicit operator acknowledgement
   * (`forceRetryAfterAmbiguous`) to proceed -- see
   * docs/email-delivery/index.md's "ambiguous outcome" section.
   *
   * `warnings` lists channels that were deliberately NOT attempted and why
   * (e.g. WhatsApp skipped because the creditor's UPI details are not
   * configured) so the operator is told rather than left guessing why only
   * one channel appears. It is empty when nothing was skipped.
   */
  sendInitialReminder(
    caseId: string,
    actor: MutationActor,
    /** `invoiceId`: required to send the WhatsApp reminder when the case has several invoices (never defaults to the first). */
    options?: { forceRetryAfterAmbiguous?: boolean; invoiceId?: string | null },
  ): Promise<{ case: RecoveryCase; communications: Communication[]; ambiguous: boolean; warnings: string[] }>;

  // -- WhatsApp V1 message families (follow-up / commitment / received / closed) --
  listPromisesForCase(caseId: string): Promise<import("@/contract/types").PaymentPromise[]>;
  /**
   * Records a promise-to-pay for a case awaiting the debtor's response.
   * Preserves history (the previous active promise for the same invoice is
   * superseded, never overwritten), moves the case to `promise_to_pay` and
   * audits. Staff/admin only.
   */
  recordPaymentPromise(
    caseId: string,
    input: import("@/contract/schemas").RecordPaymentPromiseInput,
    actor: MutationActor,
  ): Promise<{ promise: import("@/contract/types").PaymentPromise; case: RecoveryCase }>;
  /**
   * Every WhatsApp message family evaluated for the case: available (with
   * the reason), unavailable (with the reason) or already sent. Includes
   * server-only send details in `entry` -- strip with toOfferView() before
   * handing to a browser component.
   */
  getWhatsAppOffers(caseId: string): Promise<import("@/domain/whatsapp-messages").WhatsAppOffer[]>;
  /**
   * Sends ONE approved WhatsApp message for ONE business event (identified
   * by `eventKey`). Eligibility is recomputed server-side; a repeat of an
   * accepted event returns `already_sent` without a second message; an
   * ambiguous prior attempt blocks unless `forceRetryAfterAmbiguous`.
   * Operator-triggered only -- nothing sends unattended.
   */
  sendWhatsAppMessage(
    caseId: string,
    input: { eventKey: string; forceRetryAfterAmbiguous?: boolean },
    actor: MutationActor,
  ): Promise<import("@/server/whatsapp-orchestrator").WhatsAppSendResult>;

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
  /**
   * Durable GST evidence for a case (session opened / filing + reference),
   * reconstructed from the recognised GST audit events. Read-only; used to
   * hydrate the GST panel after a reload.
   */
  getGstEvidence(caseId: string): Promise<import("@/domain/gst-evidence").GstEvidence>;
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
    expectedVersion?: number | null,
  ): Promise<{ resumeToken: string | null; version: number }>;
  /** The persisted Save & resume draft for a case (null = never saved). */
  getMsmeDraft(caseId: string): Promise<import("@/domain/msme-draft").MsmeDraft | null>;
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
   * DD / hearing tracking (PRD §12, P0-5 §4/§5). DD preparation and the
   * physical demand draft remain human/manual -- the platform tracks the
   * task, amount/payee/reference and submission status durably. Amount/
   * payee/reference/notes may be supplied incrementally (a later call with
   * new values updates the existing record); rejected once the DD has been
   * submitted.
   */
  prepareDdTask(
    caseId: string,
    input: { amount?: number | null; payee?: string | null; reference?: string | null; notes?: string | null },
    actor: MutationActor,
  ): Promise<{ case: RecoveryCase; dd: DdRecord }>;
  /** Marks the case's DD handed over/submitted; idempotent on retry. */
  recordDdSubmitted(
    caseId: string,
    input: { submittedAt?: string | null; documentId?: string | null },
    actor: MutationActor,
  ): Promise<DdRecord>;

  /**
   * Schedules the first hearing for a case, persisting both a `case_hearings`
   * row and a `calendar_events` row. Rejects a second call with a different
   * date while one is already scheduled -- use `rescheduleHearing`.
   */
  scheduleHearing(
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
  ): Promise<{ case: RecoveryCase; hearing: CaseHearing }>;
  /** Adjourns the current hearing and schedules a replacement occurrence (full history preserved). */
  rescheduleHearing(
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
  ): Promise<{ case: RecoveryCase; hearing: CaseHearing }>;
  /** Records a hearing's result ('completed' | 'cancelled' only); idempotent once recorded. */
  recordHearingOutcome(
    hearingId: string,
    caseId: string,
    input: { status: Extract<HearingStatus, "completed" | "cancelled">; result?: string | null; recovered: boolean },
    actor: MutationActor,
  ): Promise<{ case: RecoveryCase; hearing: CaseHearing }>;

  /**
   * Records + classifies an inbound debtor reply (P0-5 §7). No AI
   * classification in this build -- `classification` is always staff-entered.
   * Drives the same `REPLY_CLASSIFIED` workflow transition as any other
   * reply-handling path, raising the matching follow-up task.
   */
  recordDebtorReply(
    caseId: string,
    input: {
      channel: Channel;
      rawBody: string;
      communicationId?: string | null;
      classification: ReplyClassification;
    },
    actor: MutationActor,
  ): Promise<{ case: RecoveryCase; reply: DebtorReply }>;

  /** Marks a workflow task done ("workflow task completion", P0-5 §9); idempotent on retry. */
  resolveWorkflowTask(taskId: string, reason: string, actor: MutationActor): Promise<WorkflowTask>;

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

  /** The three activation gates (client certification, staff validation, 60-day age gate) as evidenced right now. */
  getActivationGates(caseId: string): Promise<import("@/domain/activation").ActivationGates>;
  /**
   * Records one activation gate by staff (audited, reason required) and
   * re-evaluates the case. Client certification is recorded here (staff
   * attests the client's certification); staff validation for cases that are
   * `under_validation` without an OCR correction. The 60-day age gate cannot
   * be recorded -- it is derived from the invoice due dates.
   */
  recordActivationGate(
    caseId: string,
    gate: "client_certification" | "staff_validation",
    reason: string,
    actor: MutationActor,
  ): Promise<{ case: RecoveryCase; gates: import("@/domain/activation").ActivationGates; activated: boolean }>;
}
