-- 0001_init.sql
-- Debtrecover MVP core schema (Postgres 15 / Supabase).
--
-- Conventions:
--   * UUID primary keys, default gen_random_uuid() (pgcrypto).
--   * All money is BIGINT paise (INR only, MVP -- PRD 9). 12345 => Rs.123.45.
--   * All timestamps are timestamptz default now().
--   * Every tenant-scoped table carries organisation_id uuid not null
--     references organisations(id).
--   * Enum types mirror src/contract/enums.ts EXACTLY (order + spelling).
--
-- RLS is enabled and policed in 0002_rls.sql. Seed data in 0003_seed.sql.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enum types (canonical vocabulary -- src/contract/enums.ts)
-- ---------------------------------------------------------------------------

create type case_status as enum (
  'received',
  'under_validation',
  'correction_required',
  'active',
  'initial_communication_sent',
  'contact_update_required',
  'payment_confirmation_required',
  'promise_to_pay',
  'dispute_settlement',
  'gst_eligibility_review',
  'gst_notification_prepared',
  'gst_notification_filed',
  'msme_eligibility_review',
  'msme_odr_filed',
  'msefc_dd',
  'hearing_scheduled',
  'adjourned',
  'recovered',
  'withdrawn',
  'closed',
  'automation_failed',
  'archived'
);

create type waiting_on as enum ('system', 'client', 'staff', 'portal');

create type automation_mode as enum ('manual', 'prepare', 'assist', 'automatic');

create type channel as enum ('whatsapp', 'email', 'postal');

create type communication_direction as enum ('outbound', 'inbound');

create type delivery_status as enum (
  'queued',
  'sent',
  'delivered',
  'read',
  'bounced',
  'failed'
);

create type reply_classification as enum (
  'payment_made',
  'promise_to_pay',
  'dispute',
  'document_request',
  'settlement_offer',
  'unrelated',
  'unclear'
);

create type payment_kind as enum ('bank', 'cash', 'tds', 'settlement', 'credit_note');

create type user_role as enum ('staff', 'admin', 'client');

create type eligibility_route as enum ('gst', 'msme', 'non_msme_manual');

create type adapter_outcome as enum (
  'success',
  'retryable_failure',
  'permanent_failure',
  'human_action_required',
  'drift_detected'
);

create type task_type as enum (
  'ocr_low_confidence',
  'missing_invoice_field',
  'client_certification',
  'staff_validation',
  'contact_correction',
  'payment_confirmation',
  'dispute_resolution',
  'settlement_approval',
  'gst_portal_run',
  'msme_portal_run',
  'portal_drift',
  'dd_preparation',
  'hearing_followup',
  'retry_exhausted',
  'policy_gate'
);

-- ---------------------------------------------------------------------------
-- Identity & tenancy
-- ---------------------------------------------------------------------------

create table organisations (
  id                uuid primary key default gen_random_uuid(),
  client_code       text not null unique,
  legal_entity_name text not null,
  creditor_gstin    text,
  udyam_number      text,
  jito_member       boolean not null default false,
  is_firm           boolean not null default false, -- true = the recovery firm's own org
  created_at        timestamptz not null default now()
);

-- Application users. Mirrors an auth.users row via id (auth.uid()).
create table app_users (
  id           uuid primary key default gen_random_uuid(),
  role         user_role not null,
  email        text unique,
  mobile       text,
  display_name text not null,
  created_at   timestamptz not null default now()
);

-- Multi-org client identities: which orgs a client user may act for (PRD 4).
create table user_organisations (
  user_id         uuid not null references app_users(id) on delete cascade,
  organisation_id uuid not null references organisations(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (user_id, organisation_id)
);
create index user_organisations_org_idx on user_organisations(organisation_id);

-- ---------------------------------------------------------------------------
-- Debtors & cases
-- ---------------------------------------------------------------------------

create table debtors (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id),
  name             text not null,
  mobile           text,
  email            text,
  gstin            text,
  address          text,
  contact_verified boolean not null default false,
  total_due        bigint not null default 0, -- paise
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index debtors_org_idx on debtors(organisation_id);
create index debtors_org_name_idx on debtors(organisation_id, lower(name));
create index debtors_org_gstin_idx on debtors(organisation_id, gstin);
create index debtors_org_mobile_idx on debtors(organisation_id, mobile);

create table recovery_cases (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references organisations(id),
  debtor_id              uuid not null references debtors(id),
  status                 case_status not null default 'received',
  automation_mode        automation_mode not null default 'prepare',
  waiting_on             waiting_on not null default 'system',
  automation_started_at  timestamptz,
  current_step           text not null default 'intake',
  blocker                text,
  next_scheduled_action  text,
  next_scheduled_at      timestamptz,
  eligibility_route      eligibility_route,
  principal_outstanding  bigint not null default 0, -- paise
  recovered_to_date      bigint not null default 0, -- paise
  assignee_id            uuid references app_users(id),
  group_key              text,
  created_at             timestamptz not null default now(),
  activated_at           timestamptz,
  closed_at              timestamptz
);
create index recovery_cases_org_idx on recovery_cases(organisation_id);
create index recovery_cases_org_status_idx on recovery_cases(organisation_id, status);
create index recovery_cases_status_idx on recovery_cases(status);
create index recovery_cases_next_scheduled_at_idx on recovery_cases(next_scheduled_at)
  where next_scheduled_at is not null;
create index recovery_cases_debtor_idx on recovery_cases(debtor_id);
create index recovery_cases_assignee_idx on recovery_cases(assignee_id);
create index recovery_cases_group_key_idx on recovery_cases(organisation_id, group_key);

create table invoices (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references organisations(id),
  case_id                uuid not null references recovery_cases(id) on delete cascade,
  debtor_id              uuid not null references debtors(id),
  invoice_number         text not null,
  invoice_date           date not null,
  due_date               date,
  taxable_value          bigint not null default 0, -- paise
  tax_rate               numeric(5,2) not null default 0, -- percent, e.g. 18
  tax_amount             bigint not null default 0, -- paise
  invoice_total          bigint not null default 0, -- paise
  outstanding_balance    bigint not null default 0, -- paise
  currency               text not null default 'INR',
  source_document_id     uuid,
  extraction_confidence  numeric(4,3), -- 0..1
  created_at             timestamptz not null default now(),
  unique (organisation_id, case_id, invoice_number)
);
create index invoices_org_idx on invoices(organisation_id);
create index invoices_case_idx on invoices(case_id);
create index invoices_debtor_idx on invoices(debtor_id);

-- ---------------------------------------------------------------------------
-- Documents & evidence
-- ---------------------------------------------------------------------------

create table documents (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id),
  case_id          uuid references recovery_cases(id) on delete set null,
  debtor_id        uuid references debtors(id),
  kind             text not null,          -- invoice | ledger | po | portal_pdf | dd | ...
  title            text not null,
  current_version  integer not null default 1,
  uploaded_by      uuid references app_users(id),
  created_at       timestamptz not null default now()
);
create index documents_org_idx on documents(organisation_id);
create index documents_case_idx on documents(case_id);

create table document_versions (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id),
  document_id      uuid not null references documents(id) on delete cascade,
  version          integer not null,
  storage_path     text not null,          -- private bucket key; never a public URL
  checksum_sha256  text not null,
  byte_size        bigint not null default 0,
  mime_type        text,
  virus_scanned    boolean not null default false,
  virus_scan_clean boolean,
  is_immutable     boolean not null default false, -- exact version used in a filing/comm
  extraction_json  jsonb,
  extraction_confidence numeric(4,3),
  corrections_json jsonb,
  source_region_json jsonb,               -- source page / region references
  created_by       uuid references app_users(id),
  created_at       timestamptz not null default now(),
  unique (document_id, version)
);
create index document_versions_org_idx on document_versions(organisation_id);
create index document_versions_document_idx on document_versions(document_id);

alter table invoices
  add constraint invoices_source_document_fk
  foreign key (source_document_id) references documents(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Communications
-- ---------------------------------------------------------------------------

create table communications (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references organisations(id),
  case_id              uuid not null references recovery_cases(id) on delete cascade,
  channel              channel not null,
  direction            communication_direction not null,
  template_key         text,
  template_version     integer,
  subject              text,
  body                 text not null,
  provider_message_id  text,
  thread_ref           text,
  delivery_status      delivery_status not null default 'queued',
  has_secure_link      boolean not null default false,
  reply_classification reply_classification,
  reviewed_by_id       uuid references app_users(id),
  created_at           timestamptz not null default now(),
  delivered_at         timestamptz
);
create index communications_org_idx on communications(organisation_id);
create index communications_case_idx on communications(case_id);
create index communications_org_status_idx on communications(organisation_id, delivery_status);
create index communications_thread_ref_idx on communications(thread_ref);

-- Per-attempt delivery telemetry for an outbound communication.
create table communication_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references organisations(id),
  communication_id    uuid not null references communications(id) on delete cascade,
  attempt             integer not null default 1,
  status              delivery_status not null default 'queued',
  provider            text,
  provider_message_id text,
  error_detail        text,
  occurred_at         timestamptz not null default now(),
  unique (communication_id, attempt)
);
create index communication_deliveries_org_idx on communication_deliveries(organisation_id);
create index communication_deliveries_comm_idx on communication_deliveries(communication_id);

-- Inbound debtor replies, linked to the outbound they answer where known.
create table debtor_replies (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references organisations(id),
  case_id                uuid not null references recovery_cases(id) on delete cascade,
  communication_id       uuid references communications(id) on delete set null,
  channel                channel not null,
  raw_body               text not null,
  classification         reply_classification,
  classification_confidence numeric(4,3),
  reviewed_by_id         uuid references app_users(id),
  reviewed_at            timestamptz,
  received_at            timestamptz not null default now()
);
create index debtor_replies_org_idx on debtor_replies(organisation_id);
create index debtor_replies_case_idx on debtor_replies(case_id);

-- ---------------------------------------------------------------------------
-- Payments (append-only records; allocations are a derived projection -- 15.4)
-- ---------------------------------------------------------------------------

create table payment_records (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id),
  case_id          uuid not null references recovery_cases(id) on delete cascade,
  kind             payment_kind not null,
  amount           bigint not null, -- paise
  received_on      date not null,
  reference        text,
  client_confirmed boolean not null default false,
  recorded_by      uuid references app_users(id),
  created_at       timestamptz not null default now()
);
create index payment_records_org_idx on payment_records(organisation_id);
create index payment_records_case_idx on payment_records(case_id);

create table payment_allocations (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references organisations(id),
  payment_record_id  uuid not null references payment_records(id) on delete cascade,
  invoice_id         uuid not null references invoices(id),
  amount             bigint not null, -- paise
  created_at         timestamptz not null default now(),
  unique (payment_record_id, invoice_id)
);
create index payment_allocations_org_idx on payment_allocations(organisation_id);
create index payment_allocations_invoice_idx on payment_allocations(invoice_id);

-- ---------------------------------------------------------------------------
-- Workflow tasks & orchestration
-- ---------------------------------------------------------------------------

create table workflow_tasks (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id),
  case_id          uuid references recovery_cases(id) on delete cascade,
  type             task_type not null,
  title            text not null,
  waiting_on       waiting_on not null default 'staff',
  assignee_id      uuid references app_users(id),
  urgent           boolean not null default false,
  due_at           timestamptz,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index workflow_tasks_org_idx on workflow_tasks(organisation_id);
create index workflow_tasks_case_idx on workflow_tasks(case_id);
create index workflow_tasks_open_idx on workflow_tasks(organisation_id, resolved_at)
  where resolved_at is null;
create index workflow_tasks_due_at_idx on workflow_tasks(due_at) where resolved_at is null;

-- One autonomous execution of a workflow trigger against a case.
create table orchestration_runs (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references organisations(id),
  case_id             uuid not null references recovery_cases(id) on delete cascade,
  trigger_key         text not null,
  correlation_id      text not null,
  causation_id        text,
  idempotency_key     text,
  idempotency_disposition text, -- new | duplicate_ignored | replayed
  status              text not null default 'running', -- running | succeeded | failed | blocked
  waiting_on_projection waiting_on,
  next_action         text,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  unique (organisation_id, idempotency_key)
);
create index orchestration_runs_org_idx on orchestration_runs(organisation_id);
create index orchestration_runs_case_idx on orchestration_runs(case_id);
create index orchestration_runs_correlation_idx on orchestration_runs(correlation_id);

create table orchestration_step_attempts (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references organisations(id),
  run_id              uuid not null references orchestration_runs(id) on delete cascade,
  step_key            text not null,
  attempt             integer not null default 1,
  outcome             adapter_outcome,
  prerequisite_result jsonb,       -- prerequisite / blocker evaluation
  retry_after         timestamptz,
  detail_json         jsonb,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  unique (run_id, step_key, attempt)
);
create index orchestration_step_attempts_org_idx on orchestration_step_attempts(organisation_id);
create index orchestration_step_attempts_run_idx on orchestration_step_attempts(run_id);

-- ---------------------------------------------------------------------------
-- Eligibility, external submissions, portal artifacts
-- ---------------------------------------------------------------------------

create table eligibility_checks (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id),
  case_id          uuid not null references recovery_cases(id) on delete cascade,
  route            eligibility_route not null,
  passed           boolean,
  reasons_json     jsonb,       -- rule id -> pass/fail + explanation
  evaluated_by     uuid references app_users(id),
  evaluated_at     timestamptz not null default now()
);
create index eligibility_checks_org_idx on eligibility_checks(organisation_id);
create index eligibility_checks_case_idx on eligibility_checks(case_id);

create table external_submissions (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references organisations(id),
  case_id           uuid not null references recovery_cases(id) on delete cascade,
  route             eligibility_route not null,
  target            text not null,        -- gst_portal | msme_samadhaan | ...
  outcome           adapter_outcome,
  reference_number  text,
  submitted_payload jsonb,
  attachment_hashes jsonb,
  actor_id          uuid references app_users(id),
  failure_detail    text,
  submitted_at      timestamptz not null default now()
);
create index external_submissions_org_idx on external_submissions(organisation_id);
create index external_submissions_case_idx on external_submissions(case_id);

create table portal_artifacts (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references organisations(id),
  case_id               uuid references recovery_cases(id) on delete cascade,
  external_submission_id uuid references external_submissions(id) on delete cascade,
  artifact_type         text not null,    -- screenshot | pdf | receipt
  storage_path          text not null,    -- private bucket key
  checksum_sha256       text not null,
  captured_at           timestamptz not null default now()
);
create index portal_artifacts_org_idx on portal_artifacts(organisation_id);
create index portal_artifacts_case_idx on portal_artifacts(case_id);
create index portal_artifacts_submission_idx on portal_artifacts(external_submission_id);

-- ---------------------------------------------------------------------------
-- Calendar, fees, notifications
-- ---------------------------------------------------------------------------

create table calendar_events (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id),
  case_id          uuid references recovery_cases(id) on delete cascade,
  kind             text not null,         -- hearing | dd | reminder | follow_up
  title            text not null,
  starts_at        timestamptz not null,
  ends_at          timestamptz,
  location         text,
  notes            text,
  created_by       uuid references app_users(id),
  created_at       timestamptz not null default now()
);
create index calendar_events_org_idx on calendar_events(organisation_id);
create index calendar_events_case_idx on calendar_events(case_id);
create index calendar_events_starts_at_idx on calendar_events(starts_at);

create table fee_ledger_entries (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id),
  case_id          uuid references recovery_cases(id) on delete cascade,
  entry_type       text not null,         -- accrual | invoice | receipt | writeoff
  description      text not null,
  amount           bigint not null,       -- paise, signed
  occurred_on      date not null default current_date,
  created_by       uuid references app_users(id),
  created_at       timestamptz not null default now()
);
create index fee_ledger_entries_org_idx on fee_ledger_entries(organisation_id);
create index fee_ledger_entries_case_idx on fee_ledger_entries(case_id);

create table notifications (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id),
  recipient_id     uuid not null references app_users(id) on delete cascade,
  case_id          uuid references recovery_cases(id) on delete set null,
  kind             text not null,
  title            text not null,
  body             text,
  read_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index notifications_org_idx on notifications(organisation_id);
create index notifications_recipient_idx on notifications(recipient_id, read_at);

-- ---------------------------------------------------------------------------
-- Audit trail -- append-only, tamper-evident hash chain (PRD 13)
-- ---------------------------------------------------------------------------

create table audit_events (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid references organisations(id),   -- null for cross-org/system events
  actor_id         uuid references app_users(id),
  actor_role       text not null,                       -- user_role value or 'system'
  action           text not null,                       -- create | update | view | download | external | admin
  entity           text not null,
  entity_id        uuid,
  reason           text,
  metadata_json    jsonb,
  prev_hash        text,                                -- hash of the previous row in the chain
  hash             text not null,                       -- hash(prev_hash || canonical(payload))
  created_at       timestamptz not null default now()
);
create index audit_events_org_idx on audit_events(organisation_id);
create index audit_events_entity_idx on audit_events(entity, entity_id);
create index audit_events_created_at_idx on audit_events(created_at);
