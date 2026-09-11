/**
 * Hand-written `Database` type stub for the Supabase JS client.
 *
 * This is NOT generated -- it is a curated subset covering the tables the app
 * reads today. Field meanings mirror src/contract/types.ts (money is integer
 * paise; timestamps are ISO-8601 strings). Regenerate/extend with
 * `supabase gen types typescript` once a project is linked.
 */

import type {
  AdapterOutcome,
  AutomationMode,
  CaseStatus,
  Channel,
  CommunicationDirection,
  DeliveryStatus,
  EligibilityRoute,
  PaymentKind,
  ReplyClassification,
  TaskType,
  UserRole,
  WaitingOn,
} from "@/contract/enums";

type Nullable<T> = T | null;

/** Common helper: an Insert type where columns with DB defaults are optional. */
type WithDefaults<Row, OptionalKeys extends keyof Row> = Omit<Row, OptionalKeys> &
  Partial<Pick<Row, OptionalKeys>>;

export interface OrganisationRow {
  id: string;
  client_code: string;
  legal_entity_name: string;
  creditor_gstin: Nullable<string>;
  udyam_number: Nullable<string>;
  jito_member: boolean;
  is_firm: boolean;
  created_at: string;
}

export interface DebtorRow {
  id: string;
  organisation_id: string;
  name: string;
  mobile: Nullable<string>;
  email: Nullable<string>;
  gstin: Nullable<string>;
  address: Nullable<string>;
  contact_verified: boolean;
  total_due: number; // paise
  created_at: string;
  updated_at: string;
}

export interface RecoveryCaseRow {
  id: string;
  organisation_id: string;
  debtor_id: string;
  status: CaseStatus;
  automation_mode: AutomationMode;
  waiting_on: WaitingOn;
  automation_started_at: Nullable<string>;
  current_step: string;
  blocker: Nullable<string>;
  next_scheduled_action: Nullable<string>;
  next_scheduled_at: Nullable<string>;
  eligibility_route: Nullable<EligibilityRoute>;
  principal_outstanding: number; // paise
  recovered_to_date: number; // paise
  assignee_id: Nullable<string>;
  group_key: Nullable<string>;
  created_at: string;
  activated_at: Nullable<string>;
  closed_at: Nullable<string>;
}

export interface InvoiceRow {
  id: string;
  organisation_id: string;
  case_id: string;
  debtor_id: string;
  invoice_number: string;
  invoice_date: string; // date
  due_date: Nullable<string>;
  taxable_value: number; // paise
  tax_rate: number; // percent
  tax_amount: number; // paise
  invoice_total: number; // paise
  outstanding_balance: number; // paise
  currency: string;
  source_document_id: Nullable<string>;
  extraction_confidence: Nullable<number>; // 0..1
  created_at: string;
}

export interface CommunicationRow {
  id: string;
  organisation_id: string;
  case_id: string;
  channel: Channel;
  direction: CommunicationDirection;
  template_key: Nullable<string>;
  template_version: Nullable<number>;
  subject: Nullable<string>;
  body: string;
  provider_message_id: Nullable<string>;
  thread_ref: Nullable<string>;
  delivery_status: DeliveryStatus;
  has_secure_link: boolean;
  reply_classification: Nullable<ReplyClassification>;
  reviewed_by_id: Nullable<string>;
  created_at: string;
  delivered_at: Nullable<string>;
}

export interface WorkflowTaskRow {
  id: string;
  organisation_id: string;
  case_id: Nullable<string>;
  type: TaskType;
  title: string;
  waiting_on: WaitingOn;
  assignee_id: Nullable<string>;
  urgent: boolean;
  due_at: Nullable<string>;
  resolved_at: Nullable<string>;
  created_at: string;
}

export interface PaymentRecordRow {
  id: string;
  organisation_id: string;
  case_id: string;
  kind: PaymentKind;
  amount: number; // paise
  received_on: string; // date
  reference: Nullable<string>;
  client_confirmed: boolean;
  recorded_by: Nullable<string>;
  created_at: string;
}

export interface AuditEventRow {
  id: string;
  organisation_id: Nullable<string>;
  actor_id: Nullable<string>;
  actor_role: UserRole | "system";
  action: string;
  entity: string;
  entity_id: Nullable<string>;
  reason: Nullable<string>;
  metadata_json: Nullable<Record<string, unknown>>;
  prev_hash: Nullable<string>;
  hash: string;
  created_at: string;
}

interface TableShape<Row, InsertOptional extends keyof Row> {
  Row: Row;
  Insert: WithDefaults<Row, InsertOptional>;
  Update: Partial<Row>;
}

export interface Database {
  public: {
    Tables: {
      organisations: TableShape<OrganisationRow, "id" | "created_at" | "jito_member" | "is_firm">;
      debtors: TableShape<
        DebtorRow,
        "id" | "created_at" | "updated_at" | "contact_verified" | "total_due"
      >;
      recovery_cases: TableShape<
        RecoveryCaseRow,
        | "id"
        | "created_at"
        | "status"
        | "automation_mode"
        | "waiting_on"
        | "current_step"
        | "principal_outstanding"
        | "recovered_to_date"
      >;
      invoices: TableShape<
        InvoiceRow,
        | "id"
        | "created_at"
        | "currency"
        | "taxable_value"
        | "tax_rate"
        | "tax_amount"
        | "invoice_total"
        | "outstanding_balance"
      >;
      communications: TableShape<
        CommunicationRow,
        "id" | "created_at" | "delivery_status" | "has_secure_link"
      >;
      workflow_tasks: TableShape<
        WorkflowTaskRow,
        "id" | "created_at" | "waiting_on" | "urgent"
      >;
      payment_records: TableShape<
        PaymentRecordRow,
        "id" | "created_at" | "client_confirmed"
      >;
      audit_events: TableShape<AuditEventRow, "id" | "created_at">;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      case_status: CaseStatus;
      waiting_on: WaitingOn;
      automation_mode: AutomationMode;
      channel: Channel;
      communication_direction: CommunicationDirection;
      delivery_status: DeliveryStatus;
      reply_classification: ReplyClassification;
      payment_kind: PaymentKind;
      user_role: UserRole;
      eligibility_route: EligibilityRoute;
      adapter_outcome: AdapterOutcome;
      task_type: TaskType;
    };
  };
}
