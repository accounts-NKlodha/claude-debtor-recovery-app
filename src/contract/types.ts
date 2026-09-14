/**
 * Domain DTOs shared between API responses and UI. These mirror DB rows but are
 * the API contract — the DB schema may hold more columns than are exposed.
 * Money is stored and transported as integer paise (INR only, MVP — PRD §9).
 */

import type {
  AutomationMode,
  CaseStatus,
  Channel,
  CommunicationDirection,
  DdStatus,
  DeliveryStatus,
  EligibilityRoute,
  HearingStatus,
  PaymentKind,
  ReplyClassification,
  TaskType,
  UserRole,
  WaitingOn,
} from "./enums";

export type UUID = string;
/** Integer paise. 12345 => ₹123.45 */
export type Paise = number;
/** ISO-8601 UTC timestamp. */
export type Timestamp = string;

export interface Organisation {
  id: UUID;
  clientCode: string;
  legalEntityName: string;
  creditorGstin: string | null;
  udyamNumber: string | null;
  jitoMember: boolean;
  createdAt: Timestamp;
}

export interface AppUser {
  id: UUID;
  role: UserRole;
  email: string | null;
  mobile: string | null;
  displayName: string;
  /** client users only: orgs this identity may act for (PRD §4). */
  organisationIds: UUID[];
}

export interface Debtor {
  id: UUID;
  organisationId: UUID;
  name: string;
  mobile: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  contactVerified: boolean;
  totalDue: Paise;
}

export interface Invoice {
  id: UUID;
  caseId: UUID;
  organisationId: UUID;
  debtorId: UUID;
  invoiceNumber: string;
  invoiceDate: string; // date only
  dueDate: string | null;
  taxableValue: Paise;
  taxRate: number; // percent, e.g. 18
  taxAmount: Paise;
  invoiceTotal: Paise;
  outstandingBalance: Paise;
  sourceDocumentId: UUID | null;
  extractionConfidence: number | null; // 0..1
}

export interface RecoveryCase {
  id: UUID;
  organisationId: UUID;
  debtorId: UUID;
  status: CaseStatus;
  automationMode: AutomationMode;
  waitingOn: WaitingOn;
  /** when automated processing first started (PRD §6). */
  automationStartedAt: Timestamp | null;
  currentStep: string;
  /** the exact safe prerequisite/blocker holding the case, human-readable. */
  blocker: string | null;
  nextScheduledAction: string | null;
  nextScheduledAt: Timestamp | null;
  eligibilityRoute: EligibilityRoute | null;
  principalOutstanding: Paise;
  recoveredToDate: Paise;
  assigneeId: UUID | null;
  groupKey: string | null;
  createdAt: Timestamp;
  activatedAt: Timestamp | null;
  closedAt: Timestamp | null;
}

export interface Communication {
  id: UUID;
  caseId: UUID;
  organisationId: UUID;
  channel: Channel;
  direction: CommunicationDirection;
  templateKey: string | null;
  templateVersion: number | null;
  subject: string | null;
  body: string;
  providerMessageId: string | null;
  threadRef: string | null;
  deliveryStatus: DeliveryStatus;
  hasSecureLink: boolean;
  replyClassification: ReplyClassification | null;
  reviewedById: UUID | null;
  createdAt: Timestamp;
  deliveredAt: Timestamp | null;
}

export interface PaymentRecord {
  id: UUID;
  caseId: UUID;
  organisationId: UUID;
  kind: PaymentKind;
  amount: Paise;
  receivedOn: string;
  reference: string | null;
  clientConfirmed: boolean;
  /** append-only; allocations are a derived projection (invariant §15.4). */
  createdAt: Timestamp;
}

export interface WorkflowTask {
  id: UUID;
  caseId: UUID | null;
  organisationId: UUID;
  type: TaskType;
  title: string;
  waitingOn: WaitingOn;
  assigneeId: UUID | null;
  urgent: boolean;
  dueAt: Timestamp | null;
  resolvedAt: Timestamp | null;
  createdAt: Timestamp;
}

export interface PaymentAllocation {
  id: UUID;
  organisationId: UUID;
  paymentRecordId: UUID;
  invoiceId: UUID;
  amount: Paise;
  createdAt: Timestamp;
}

export interface DdRecord {
  id: UUID;
  organisationId: UUID;
  caseId: UUID;
  status: DdStatus;
  amount: Paise | null;
  payee: string | null;
  reference: string | null;
  preparedAt: Timestamp | null;
  submittedAt: Timestamp | null;
  documentId: UUID | null;
  notes: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CaseHearing {
  id: UUID;
  organisationId: UUID;
  caseId: UUID;
  calendarEventId: UUID | null;
  forum: string | null;
  authority: string | null;
  caseReference: string | null;
  assignedStaffId: UUID | null;
  scheduledAt: Timestamp;
  status: HearingStatus;
  result: string | null;
  rescheduledFromId: UUID | null;
  notes: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface DebtorReply {
  id: UUID;
  organisationId: UUID;
  caseId: UUID;
  communicationId: UUID | null;
  channel: Channel;
  rawBody: string;
  classification: ReplyClassification | null;
  classificationConfidence: number | null;
  reviewedById: UUID | null;
  reviewedAt: Timestamp | null;
  receivedAt: Timestamp;
}

export interface AuditEvent {
  id: UUID;
  organisationId: UUID | null;
  actorId: UUID | null;
  actorRole: UserRole | "system";
  action: string;
  entity: string;
  entityId: UUID | null;
  reason: string | null;
  /** tamper-evident chain (PRD §13). */
  prevHash: string | null;
  hash: string;
  createdAt: Timestamp;
}

/** Row of the bulk-import CSV (data-model spec). */
export interface BulkImportRow {
  client_code: string;
  legal_entity_name: string;
  creditor_gstin: string;
  debtor_name: string;
  debtor_gstin: string;
  debtor_mobile: string;
  debtor_email: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  taxable_value: string;
  tax_rate: string;
  tax_amount: string;
  invoice_total: string;
  adjustments: string;
  total_due: string;
  ledger_as_of: string;
  client_certified: string;
  group_key: string;
  notes: string;
}

export interface ImportRowError {
  rowNumber: number;
  column: string | null;
  code: string;
  message: string;
}

export interface ImportResult {
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  errorRows: number;
  errors: ImportRowError[];
  /** never partially activate: caller decides to commit the valid set. */
  preview: Array<{ rowNumber: number; debtorName: string; invoiceNumber: string; totalDue: Paise }>;
}
