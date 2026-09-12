-- 0004_tenant_consistency.sql
-- Composite tenant-consistency constraints (P0-2 foundation).
--
-- Problem: every child table carries its own `organisation_id` column
-- alongside a foreign key to a parent row (recovery_cases, debtors,
-- documents, communications, payment_records, invoices, orchestration_runs,
-- external_submissions). Postgres's default single-column foreign keys only
-- prove the parent row exists -- they do NOT prove the child's
-- organisation_id matches the parent's. A caller who passes their own
-- organisation_id alongside another tenant's case_id/debtor_id/etc. could
-- currently insert a row that RLS's row-level SELECT policies would still
-- surface as belonging to the wrong tenant, or that silently associates one
-- tenant's evidence/payment with another tenant's case.
--
-- Fix: promote every such parent key to a composite unique key
-- `(id, organisation_id)`, then replace the child's plain FK with a
-- composite FK on `(child_fk_column, organisation_id)`. Postgres then
-- rejects any insert/update where the child and parent organisation_id
-- values disagree -- this holds even for service-role/admin writes, and
-- even for logic bugs in application code, not just RLS-governed queries.
--
-- Scope: every table that carries both `organisation_id` and a foreign key
-- into another tenant-scoped table gets this treatment. Tables that only
-- reference `app_users` (staff identities, not tenant-scoped) are
-- unaffected -- staff act across organisations by design (PRD 4).
--
-- NULLable child FK columns (e.g. documents.case_id, workflow_tasks.case_id)
-- are unaffected when NULL: Postgres's default MATCH SIMPLE composite FK
-- semantics skip the check when any column in the FK is NULL, which is
-- correct here -- "no case link" has nothing to be consistent with.

-- ---------------------------------------------------------------------------
-- Composite unique keys on parent tables (FK targets)
-- ---------------------------------------------------------------------------

alter table recovery_cases      add constraint recovery_cases_id_org_uq      unique (id, organisation_id);
alter table debtors             add constraint debtors_id_org_uq             unique (id, organisation_id);
alter table documents           add constraint documents_id_org_uq          unique (id, organisation_id);
alter table communications      add constraint communications_id_org_uq     unique (id, organisation_id);
alter table payment_records     add constraint payment_records_id_org_uq    unique (id, organisation_id);
alter table invoices            add constraint invoices_id_org_uq           unique (id, organisation_id);
alter table orchestration_runs  add constraint orchestration_runs_id_org_uq unique (id, organisation_id);
alter table external_submissions add constraint external_submissions_id_org_uq unique (id, organisation_id);

-- ---------------------------------------------------------------------------
-- debtors(id, organisation_id) as the composite FK target
-- ---------------------------------------------------------------------------

alter table recovery_cases drop constraint recovery_cases_debtor_id_fkey;
alter table recovery_cases add constraint recovery_cases_debtor_org_fk
  foreign key (debtor_id, organisation_id) references debtors(id, organisation_id);

alter table invoices drop constraint invoices_debtor_id_fkey;
alter table invoices add constraint invoices_debtor_org_fk
  foreign key (debtor_id, organisation_id) references debtors(id, organisation_id);

alter table documents drop constraint documents_debtor_id_fkey;
alter table documents add constraint documents_debtor_org_fk
  foreign key (debtor_id, organisation_id) references debtors(id, organisation_id);

-- ---------------------------------------------------------------------------
-- recovery_cases(id, organisation_id) as the composite FK target
-- ---------------------------------------------------------------------------

alter table invoices drop constraint invoices_case_id_fkey;
alter table invoices add constraint invoices_case_org_fk
  foreign key (case_id, organisation_id) references recovery_cases(id, organisation_id)
  on delete cascade;

alter table documents drop constraint documents_case_id_fkey;
alter table documents add constraint documents_case_org_fk
  foreign key (case_id, organisation_id) references recovery_cases(id, organisation_id)
  on delete set null;

alter table communications drop constraint communications_case_id_fkey;
alter table communications add constraint communications_case_org_fk
  foreign key (case_id, organisation_id) references recovery_cases(id, organisation_id)
  on delete cascade;

alter table debtor_replies drop constraint debtor_replies_case_id_fkey;
alter table debtor_replies add constraint debtor_replies_case_org_fk
  foreign key (case_id, organisation_id) references recovery_cases(id, organisation_id)
  on delete cascade;

alter table payment_records drop constraint payment_records_case_id_fkey;
alter table payment_records add constraint payment_records_case_org_fk
  foreign key (case_id, organisation_id) references recovery_cases(id, organisation_id)
  on delete cascade;

alter table workflow_tasks drop constraint workflow_tasks_case_id_fkey;
alter table workflow_tasks add constraint workflow_tasks_case_org_fk
  foreign key (case_id, organisation_id) references recovery_cases(id, organisation_id)
  on delete cascade;

alter table orchestration_runs drop constraint orchestration_runs_case_id_fkey;
alter table orchestration_runs add constraint orchestration_runs_case_org_fk
  foreign key (case_id, organisation_id) references recovery_cases(id, organisation_id)
  on delete cascade;

alter table eligibility_checks drop constraint eligibility_checks_case_id_fkey;
alter table eligibility_checks add constraint eligibility_checks_case_org_fk
  foreign key (case_id, organisation_id) references recovery_cases(id, organisation_id)
  on delete cascade;

alter table external_submissions drop constraint external_submissions_case_id_fkey;
alter table external_submissions add constraint external_submissions_case_org_fk
  foreign key (case_id, organisation_id) references recovery_cases(id, organisation_id)
  on delete cascade;

alter table portal_artifacts drop constraint portal_artifacts_case_id_fkey;
alter table portal_artifacts add constraint portal_artifacts_case_org_fk
  foreign key (case_id, organisation_id) references recovery_cases(id, organisation_id)
  on delete cascade;

alter table calendar_events drop constraint calendar_events_case_id_fkey;
alter table calendar_events add constraint calendar_events_case_org_fk
  foreign key (case_id, organisation_id) references recovery_cases(id, organisation_id)
  on delete cascade;

alter table fee_ledger_entries drop constraint fee_ledger_entries_case_id_fkey;
alter table fee_ledger_entries add constraint fee_ledger_entries_case_org_fk
  foreign key (case_id, organisation_id) references recovery_cases(id, organisation_id)
  on delete cascade;

alter table notifications drop constraint notifications_case_id_fkey;
alter table notifications add constraint notifications_case_org_fk
  foreign key (case_id, organisation_id) references recovery_cases(id, organisation_id)
  on delete set null;

-- ---------------------------------------------------------------------------
-- documents(id, organisation_id) as the composite FK target
-- ---------------------------------------------------------------------------

alter table document_versions drop constraint document_versions_document_id_fkey;
alter table document_versions add constraint document_versions_document_org_fk
  foreign key (document_id, organisation_id) references documents(id, organisation_id)
  on delete cascade;

alter table invoices drop constraint invoices_source_document_fk;
alter table invoices add constraint invoices_source_document_org_fk
  foreign key (source_document_id, organisation_id) references documents(id, organisation_id)
  on delete set null;

-- ---------------------------------------------------------------------------
-- communications(id, organisation_id) as the composite FK target
-- ---------------------------------------------------------------------------

alter table communication_deliveries drop constraint communication_deliveries_communication_id_fkey;
alter table communication_deliveries add constraint communication_deliveries_comm_org_fk
  foreign key (communication_id, organisation_id) references communications(id, organisation_id)
  on delete cascade;

alter table debtor_replies drop constraint debtor_replies_communication_id_fkey;
alter table debtor_replies add constraint debtor_replies_comm_org_fk
  foreign key (communication_id, organisation_id) references communications(id, organisation_id)
  on delete set null;

-- ---------------------------------------------------------------------------
-- payment_records(id, organisation_id) / invoices(id, organisation_id)
-- ---------------------------------------------------------------------------

alter table payment_allocations drop constraint payment_allocations_payment_record_id_fkey;
alter table payment_allocations add constraint payment_allocations_payment_org_fk
  foreign key (payment_record_id, organisation_id) references payment_records(id, organisation_id)
  on delete cascade;

alter table payment_allocations drop constraint payment_allocations_invoice_id_fkey;
alter table payment_allocations add constraint payment_allocations_invoice_org_fk
  foreign key (invoice_id, organisation_id) references invoices(id, organisation_id);

-- ---------------------------------------------------------------------------
-- orchestration_runs(id, organisation_id) / external_submissions(id, organisation_id)
-- ---------------------------------------------------------------------------

alter table orchestration_step_attempts drop constraint orchestration_step_attempts_run_id_fkey;
alter table orchestration_step_attempts add constraint orchestration_step_attempts_run_org_fk
  foreign key (run_id, organisation_id) references orchestration_runs(id, organisation_id)
  on delete cascade;

alter table portal_artifacts drop constraint portal_artifacts_external_submission_id_fkey;
alter table portal_artifacts add constraint portal_artifacts_submission_org_fk
  foreign key (external_submission_id, organisation_id) references external_submissions(id, organisation_id)
  on delete cascade;

-- ---------------------------------------------------------------------------
-- Not covered here (documented, not a gap in the pattern -- these reference
-- app_users, which has no organisation_id; staff act across organisations
-- by design, PRD 4):
--   recovery_cases.assignee_id, documents.uploaded_by,
--   communications.reviewed_by_id, debtor_replies.reviewed_by_id,
--   payment_records.recorded_by, workflow_tasks.assignee_id,
--   eligibility_checks.evaluated_by, external_submissions.actor_id,
--   calendar_events.created_by, fee_ledger_entries.created_by,
--   document_versions.created_by, notifications.recipient_id,
--   audit_events.actor_id.
-- ---------------------------------------------------------------------------
