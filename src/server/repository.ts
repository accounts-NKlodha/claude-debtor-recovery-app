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
}
