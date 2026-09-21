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
  DdStatus,
  DeliveryStatus,
  EligibilityRoute,
  HearingStatus,
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
  upi_id: Nullable<string>;
  upi_payee_name: Nullable<string>;
  created_at: string;
}

/** Mirrors an auth.users row via id (auth.uid()) -- see supabase/migrations/0001_init.sql. */
export interface AppUserRow {
  id: string;
  role: UserRole;
  email: Nullable<string>;
  mobile: Nullable<string>;
  display_name: string;
  created_at: string;
}

/** Multi-org client identities (PRD §4). */
export interface UserOrganisationRow {
  user_id: string;
  organisation_id: string;
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
  idempotency_key: Nullable<string>;
  created_at: string;
  delivered_at: Nullable<string>;
}

export interface CommunicationDeliveryRow {
  id: string;
  organisation_id: string;
  communication_id: string;
  attempt: number;
  status: DeliveryStatus;
  adapter_outcome: Nullable<AdapterOutcome>;
  provider: Nullable<string>;
  provider_message_id: Nullable<string>;
  error_detail: Nullable<string>;
  occurred_at: string;
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

/** Global settings, key-value (supabase/migrations/0006_production_write_rpcs.sql).
 * Currently one row, key='automation' -- backs the automation kill switch.
 * Readable by staff/admin directly; writable only via set_automation_state(). */
export interface SystemSettingsRow {
  key: string;
  value_json: Record<string, unknown>;
  updated_at: string;
  updated_by: Nullable<string>;
}

export interface PaymentAllocationRow {
  id: string;
  organisation_id: string;
  payment_record_id: string;
  invoice_id: string;
  amount: number; // paise
  created_at: string;
}

export interface DdRecordRow {
  id: string;
  organisation_id: string;
  case_id: string;
  status: DdStatus;
  amount: Nullable<number>; // paise
  payee: Nullable<string>;
  reference: Nullable<string>;
  prepared_at: Nullable<string>;
  submitted_at: Nullable<string>;
  document_id: Nullable<string>;
  notes: Nullable<string>;
  created_by: Nullable<string>;
  created_at: string;
  updated_at: string;
}

export interface CaseHearingRow {
  id: string;
  organisation_id: string;
  case_id: string;
  calendar_event_id: Nullable<string>;
  forum: Nullable<string>;
  authority: Nullable<string>;
  case_reference: Nullable<string>;
  assigned_staff_id: Nullable<string>;
  scheduled_at: string;
  status: HearingStatus;
  result: Nullable<string>;
  rescheduled_from_id: Nullable<string>;
  notes: Nullable<string>;
  created_by: Nullable<string>;
  created_at: string;
  updated_at: string;
}

export interface CalendarEventRow {
  id: string;
  organisation_id: string;
  case_id: Nullable<string>;
  kind: string;
  title: string;
  starts_at: string;
  ends_at: Nullable<string>;
  location: Nullable<string>;
  notes: Nullable<string>;
  created_by: Nullable<string>;
  created_at: string;
}

export interface DebtorReplyRow {
  id: string;
  organisation_id: string;
  case_id: string;
  communication_id: Nullable<string>;
  channel: Channel;
  raw_body: string;
  classification: Nullable<ReplyClassification>;
  classification_confidence: Nullable<number>;
  reviewed_by_id: Nullable<string>;
  reviewed_at: Nullable<string>;
  received_at: string;
}

export interface PaymentPromiseRow {
  id: string;
  organisation_id: string;
  case_id: string;
  invoice_id: Nullable<string>;
  promised_on: string;
  promised_amount: Nullable<number>;
  status: "active" | "superseded";
  source_reply_id: Nullable<string>;
  supersedes_id: Nullable<string>;
  recorded_by_id: string;
  created_at: string;
  superseded_at: Nullable<string>;
}

interface TableShape<Row, InsertOptional extends keyof Row> {
  Row: Row;
  Insert: WithDefaults<Row, InsertOptional>;
  Update: Partial<Row>;
}

export interface Database {
  public: {
    Tables: {
      organisations: TableShape<OrganisationRow, "id" | "created_at" | "jito_member" | "is_firm" | "upi_id" | "upi_payee_name">;
      app_users: TableShape<AppUserRow, "id" | "created_at">;
      user_organisations: TableShape<UserOrganisationRow, "created_at">;
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
        "id" | "created_at" | "delivery_status" | "has_secure_link" | "idempotency_key"
      >;
      communication_deliveries: TableShape<
        CommunicationDeliveryRow,
        "id" | "status" | "occurred_at" | "attempt"
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
      system_settings: TableShape<SystemSettingsRow, "updated_at" | "updated_by">;
      payment_allocations: TableShape<PaymentAllocationRow, "id" | "created_at">;
      dd_records: TableShape<DdRecordRow, "id" | "status" | "created_at" | "updated_at">;
      case_hearings: TableShape<CaseHearingRow, "id" | "status" | "created_at" | "updated_at">;
      calendar_events: TableShape<CalendarEventRow, "id" | "created_at">;
      debtor_replies: TableShape<DebtorReplyRow, "id" | "received_at">;
      payment_promises: TableShape<PaymentPromiseRow, "id" | "created_at" | "status" | "superseded_at">;
    };
    Views: Record<string, never>;
    Functions: {
      /** supabase/migrations/0005_privileged_audit_writer.sql -- the only
       * supported way to append an audit_events row. Derives actor_id from
       * auth.uid() server-side; the caller-supplied args carry no actor
       * field, so attribution cannot be forged from the client. */
      record_audit_event: {
        Args: {
          p_organisation_id: string | null;
          p_action: string;
          p_entity: string;
          p_entity_id: string | null;
          p_reason: string | null;
          p_metadata_json: Record<string, unknown> | null;
        };
        Returns: AuditEventRow;
      };
      /** supabase/migrations/0006_production_write_rpcs.sql -- admin-only;
       * checked inside the function (current_user_role() = 'admin'), not
       * just at the application layer. */
      set_automation_state: {
        Args: { p_enabled: boolean; p_reason: string; p_expected_actor_id?: string | null };
        Returns: { enabled: boolean };
      };
      /** Updates one recovery_cases row, optionally inserts one
       * communications row, and audits it -- atomically. p_case carries the
       * full post-transition case object (every RecoveryCase field always
       * present, computed by the matching src/domain/*.ts pure function). */
      apply_case_mutation: {
        Args: {
          p_case_id: string;
          p_case: Record<string, unknown>;
          p_action: string;
          p_entity: string;
          p_reason: string | null;
          p_communication?: Record<string, unknown> | null;
          p_expected_actor_id?: string | null;
        };
        Returns: RecoveryCaseRow;
      };
      record_payment_row: {
        Args: {
          p_case_id: string;
          p_kind: string;
          p_amount: number;
          p_reference: string | null;
          p_expected_actor_id?: string | null;
        };
        Returns: PaymentRecordRow;
      };
      apply_payment_confirmation: {
        Args: {
          p_payment_id: string;
          p_case: Record<string, unknown>;
          p_invoice_updates: { id: string; outstandingBalance: number }[];
          p_reason: string | null;
          p_expected_actor_id?: string | null;
        };
        Returns: RecoveryCaseRow;
      };
      correct_invoice_row: {
        Args: {
          p_invoice_id: string;
          p_corrections: Record<string, unknown>;
          p_case_id: string;
          p_case: Record<string, unknown>;
          p_reason: string | null;
          p_expected_actor_id?: string | null;
        };
        Returns: InvoiceRow;
      };
      create_case_from_invoice: {
        Args: {
          p_organisation_id: string;
          p_debtor: Record<string, unknown>;
          p_case: Record<string, unknown>;
          p_invoice: Record<string, unknown>;
          p_reason: string | null;
          p_expected_actor_id?: string | null;
        };
        Returns: { case: RecoveryCaseRow; invoice: InvoiceRow; debtor: DebtorRow };
      };
      /** Admin-only (checked inside the function); inserts + audits the new
       * organisation atomically -- see 0006_production_write_rpcs.sql. */
      create_organisation: {
        Args: {
          p_client_code: string;
          p_legal_entity_name: string;
          p_creditor_gstin: string | null;
          p_udyam_number: string | null;
          p_jito_member: boolean;
          p_reason: string | null;
          p_expected_actor_id?: string | null;
        };
        Returns: OrganisationRow;
      };
      /** Admin-only (checked inside the function); full-replace update of the
       * creditor's UPI ID/payee name, audited with change indicators only --
       * see 0022_organisation_upi_payment_details.sql. */
      update_organisation_payment_details: {
        Args: {
          p_organisation_id: string;
          p_upi_id: string | null;
          p_upi_payee_name: string | null;
          p_reason: string;
          p_expected_actor_id?: string | null;
        };
        Returns: OrganisationRow;
      };
      /** Internal-only in Postgres (no grant to `authenticated`) -- not
       * called directly from the client; listed here only so its shape is
       * documented alongside the RPCs that invoke it via `perform`. */
      resolve_workflow_task: {
        Args: { p_task_id: string; p_reason: string | null; p_expected_actor_id?: string | null };
        Returns: WorkflowTaskRow;
      };
      prepare_dd: {
        Args: {
          p_case_id: string;
          p_case: Record<string, unknown>;
          p_amount: number | null;
          p_payee: string | null;
          p_reference: string | null;
          p_notes: string | null;
          p_reason: string | null;
          p_expected_actor_id?: string | null;
        };
        Returns: { case: RecoveryCaseRow; dd: DdRecordRow };
      };
      record_dd_submitted: {
        Args: {
          p_case_id: string;
          p_submitted_at: string | null;
          p_document_id: string | null;
          p_reason: string | null;
          p_expected_actor_id?: string | null;
        };
        Returns: DdRecordRow;
      };
      schedule_hearing: {
        Args: {
          p_case_id: string;
          p_case: Record<string, unknown>;
          p_scheduled_at: string;
          p_forum: string | null;
          p_authority: string | null;
          p_case_reference: string | null;
          p_assigned_staff_id: string | null;
          p_notes: string | null;
          p_reason: string | null;
          p_expected_actor_id?: string | null;
        };
        Returns: { case: RecoveryCaseRow; hearing: CaseHearingRow; calendarEvent?: CalendarEventRow };
      };
      reschedule_hearing: {
        Args: {
          p_hearing_id: string;
          p_case_id: string;
          p_case: Record<string, unknown>;
          p_new_scheduled_at: string;
          p_forum: string | null;
          p_authority: string | null;
          p_case_reference: string | null;
          p_assigned_staff_id: string | null;
          p_notes: string | null;
          p_reason: string | null;
          p_expected_actor_id?: string | null;
        };
        Returns: { case: RecoveryCaseRow; hearing: CaseHearingRow; calendarEvent: CalendarEventRow };
      };
      record_hearing_outcome: {
        Args: {
          p_hearing_id: string;
          p_case_id: string;
          p_case: Record<string, unknown>;
          p_status: HearingStatus;
          p_result: string | null;
          p_reason: string | null;
          p_expected_actor_id?: string | null;
        };
        Returns: { case: RecoveryCaseRow; hearing: CaseHearingRow };
      };
      record_debtor_reply: {
        Args: {
          p_case_id: string;
          p_case: Record<string, unknown>;
          p_channel: Channel;
          p_raw_body: string;
          p_communication_id: string | null;
          p_classification: ReplyClassification;
          p_reason: string | null;
          p_expected_actor_id?: string | null;
        };
        Returns: { case: RecoveryCaseRow; reply: DebtorReplyRow };
      };
      /** Staff/admin; records a promise-to-pay, superseding (not overwriting) the prior active one -- see 0023. */
      record_payment_promise: {
        Args: {
          p_case_id: string;
          p_invoice_id: string | null;
          p_promised_on: string;
          p_promised_amount: number | null;
          p_source_reply_id: string | null;
          p_case: Record<string, unknown> | null;
          p_reason: string;
          p_expected_actor_id?: string | null;
        };
        Returns: { promise: PaymentPromiseRow; case: RecoveryCaseRow };
      };
      begin_communication_send: {
        Args: {
          p_case_id: string;
          p_channel: Channel;
          p_idempotency_key: string;
          p_template_key: string | null;
          p_template_version: number | null;
          p_subject: string | null;
          p_body: string;
          p_reason: string | null;
          p_expected_actor_id?: string | null;
        };
        Returns: { communication: CommunicationRow; isNew: boolean };
      };
      begin_delivery_attempt: {
        Args: {
          p_communication_id: string;
          p_attempt: number;
          p_reason: string | null;
          p_expected_actor_id?: string | null;
          p_force_after_ambiguous?: boolean;
        };
        Returns: { blocked: boolean; blockedReason: string | null; delivery: CommunicationDeliveryRow };
      };
      complete_delivery_attempt: {
        Args: {
          p_delivery_id: string;
          p_status: DeliveryStatus;
          p_adapter_outcome: AdapterOutcome | null;
          p_provider_message_id: string | null;
          p_error_detail: string | null;
          p_case_id: string;
          p_case: Record<string, unknown> | null;
          p_reason: string | null;
          p_provider: string;
          p_expected_actor_id?: string | null;
        };
        Returns: { delivery: CommunicationDeliveryRow; communication: CommunicationRow; case: RecoveryCaseRow };
      };
    };
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
      dd_status: DdStatus;
      hearing_status: HearingStatus;
    };
  };
}
