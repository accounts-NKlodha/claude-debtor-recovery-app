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
import type { CaseRow, ClientOverview, QueueItem } from "@/lib/mock-data";

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

  // -- intake -------------------------------------------------------------
  bulkImport(fileName: string): Promise<ImportResult>;

  // -- mutations ------------------------------------------------------------
  /**
   * Record a receipt against a case. If `clientConfirmed` is true this also
   * runs the allocation + workflow rule (PRD §7): confirming immediately
   * cancels pending escalation, in full or in part.
   */
  recordPayment(input: {
    caseId: string;
    kind: PaymentRecord["kind"];
    amount: number;
    reference: string | null;
    clientConfirmed: boolean;
  }): Promise<{ payment: PaymentRecord; updatedCase: RecoveryCase | null }>;
  /** Client confirms an already-recorded receipt. Cancels pending escalation. */
  confirmPayment(paymentId: string): Promise<{ payment: PaymentRecord; updatedCase: RecoveryCase }>;

  /**
   * Send the initial reminder for a case in `active` status (PRD §5/§8):
   * builds the message, runs it through the messaging adapter under the
   * retry-once-then-urgent-task policy, records the communication, and
   * advances the case (sent -> delivered -> 24h timer started, or a
   * both-channels-failed contact-correction task on adapter failure).
   */
  sendInitialReminder(caseId: string): Promise<{ case: RecoveryCase; communication: Communication }>;

  /**
   * GST assisted-notification flow (PRD §11). Government-portal actions cap
   * at "assist": the platform prepares/validates/prefills, a human completes
   * CAPTCHA and Send, and the platform captures reference/screenshot evidence.
   */
  prepareGstNotification(
    caseId: string,
    input: import("@/contract/schemas").GstComposeInput,
  ): Promise<{ case: RecoveryCase; manifestHash: string | null }>;
  /** Opens the controlled browser session; always human_action_required -- no CAPTCHA/OTP bypass. */
  openGstAssistedSession(caseId: string): Promise<{ sessionUrl: string | null }>;
  /** Called after the operator confirms Send. Fails closed on drift (scenario 9). */
  captureGstFiling(
    caseId: string,
    staffReference: string,
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
  ): Promise<{ resumeToken: string | null }>;
  /** Builds the immutable preview snapshot ahead of final submit. */
  buildMsmePreview(caseId: string): Promise<{ previewPdfKey: string | null; previewHash: string | null }>;
  /** Called after the operator confirms final submit. Fails closed on drift. */
  captureMsmeAcknowledgement(
    caseId: string,
  ): Promise<{ case: RecoveryCase; diaryNumber: string | null; petitionPdfKey: string | null }>;

  /**
   * DD / hearing tracking (PRD §12). DD preparation and the physical demand
   * draft remain human/manual; scheduling a hearing creates a calendar event
   * through the calendar adapter.
   */
  prepareDdTask(caseId: string): Promise<{ case: RecoveryCase }>;
  scheduleHearing(
    caseId: string,
    startsAtIso: string,
  ): Promise<{ case: RecoveryCase; eventId: string | null }>;
}
