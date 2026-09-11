-- 0002_rls.sql
-- Row-Level Security for Debtrecover.
--
-- PRD 13 mapping:
--   * "Apply client-level authorization to every query, file URL, dashboard,
--      notification and AI context."  -> client policies below scope every
--      tenant table to the caller's user_organisations set.
--   * "Audit every create/change/view/download/external/admin action; make
--      logs tamper-evident."           -> audit_events: insert-only for all
--      authenticated roles, UPDATE/DELETE revoked from everyone.
--   * "Raw cases from other clients must never be exposed" (data-model privacy
--      boundary) -> client SELECT is gated by org membership; staff/admin are
--      trusted operators with cross-org access.

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

-- The app_users.id equals the Supabase auth uid for that identity.
create or replace function current_app_user_id()
returns uuid
language sql
stable
as $$
  select auth.uid();
$$;

create or replace function current_user_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from app_users where id = auth.uid();
$$;

-- True when the caller is a trusted operator (recovery-firm staff/admin).
create or replace function is_staff()
returns boolean
language sql
stable
as $$
  select current_user_role() in ('staff', 'admin');
$$;

-- Org ids the current client identity is entitled to act for (PRD 4).
create or replace function current_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organisation_id from user_organisations where user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS on every tenant-scoped table
-- ---------------------------------------------------------------------------

alter table organisations              enable row level security;
alter table user_organisations         enable row level security;
alter table debtors                    enable row level security;
alter table recovery_cases             enable row level security;
alter table invoices                   enable row level security;
alter table documents                  enable row level security;
alter table document_versions          enable row level security;
alter table communications             enable row level security;
alter table communication_deliveries   enable row level security;
alter table debtor_replies             enable row level security;
alter table payment_records            enable row level security;
alter table payment_allocations        enable row level security;
alter table workflow_tasks             enable row level security;
alter table orchestration_runs         enable row level security;
alter table orchestration_step_attempts enable row level security;
alter table eligibility_checks         enable row level security;
alter table external_submissions       enable row level security;
alter table portal_artifacts           enable row level security;
alter table calendar_events            enable row level security;
alter table fee_ledger_entries         enable row level security;
alter table notifications              enable row level security;
alter table audit_events               enable row level security;
alter table app_users                  enable row level security;

-- ---------------------------------------------------------------------------
-- app_users / organisations / user_organisations
-- ---------------------------------------------------------------------------

-- Staff/admin: full read of the identity + org directory. PRD 13 (admin action).
create policy app_users_staff_all on app_users
  for all using (is_staff()) with check (is_staff());
-- Any authenticated user may read their own identity row.
create policy app_users_self_read on app_users
  for select using (id = auth.uid());

create policy organisations_staff_all on organisations
  for all using (is_staff()) with check (is_staff());
-- Client: read only orgs they belong to.
create policy organisations_client_read on organisations
  for select using (id in (select current_org_ids()));

create policy user_organisations_staff_all on user_organisations
  for all using (is_staff()) with check (is_staff());
-- Client: read only their own membership rows.
create policy user_organisations_client_read on user_organisations
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Generic tenant tables
--   staff/admin  -> full access across every organisation
--   client       -> SELECT rows whose organisation_id is in current_org_ids()
--   client write -> only on upload / confirmation surfaces (see per-table below)
-- ---------------------------------------------------------------------------

-- Read-only for clients, full for staff.
do $$
declare t text;
begin
  foreach t in array array[
    'debtors', 'recovery_cases', 'invoices',
    'communications', 'communication_deliveries', 'debtor_replies',
    'payment_allocations', 'workflow_tasks',
    'orchestration_runs', 'orchestration_step_attempts',
    'eligibility_checks', 'external_submissions', 'portal_artifacts',
    'calendar_events', 'fee_ledger_entries'
  ]
  loop
    execute format(
      'create policy %1$s_staff_all on %1$s for all using (is_staff()) with check (is_staff());',
      t);
    execute format(
      'create policy %1$s_client_read on %1$s for select using (organisation_id in (select current_org_ids()));',
      t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Client write surfaces: uploads + confirmations only (PRD 13).
-- No client UPDATE/DELETE on cases, communications, audit.
-- ---------------------------------------------------------------------------

-- documents: staff full; client may read + insert uploads for their orgs.
create policy documents_staff_all on documents
  for all using (is_staff()) with check (is_staff());
create policy documents_client_read on documents
  for select using (organisation_id in (select current_org_ids()));
create policy documents_client_insert on documents
  for insert with check (
    current_user_role() = 'client'
    and organisation_id in (select current_org_ids())
  );

-- document_versions: same shape -- clients attach file versions to uploads.
create policy document_versions_staff_all on document_versions
  for all using (is_staff()) with check (is_staff());
create policy document_versions_client_read on document_versions
  for select using (organisation_id in (select current_org_ids()));
create policy document_versions_client_insert on document_versions
  for insert with check (
    current_user_role() = 'client'
    and organisation_id in (select current_org_ids())
  );

-- payment_records: client may report a payment (confirmation surface) + read.
create policy payment_records_staff_all on payment_records
  for all using (is_staff()) with check (is_staff());
create policy payment_records_client_read on payment_records
  for select using (organisation_id in (select current_org_ids()));
create policy payment_records_client_insert on payment_records
  for insert with check (
    current_user_role() = 'client'
    and organisation_id in (select current_org_ids())
  );

-- notifications: recipient reads/updates (mark-read) own; staff full.
create policy notifications_staff_all on notifications
  for all using (is_staff()) with check (is_staff());
create policy notifications_recipient_read on notifications
  for select using (recipient_id = auth.uid());
create policy notifications_recipient_update on notifications
  for update using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- ---------------------------------------------------------------------------
-- audit_events -- append-only, tamper-evident (PRD 13)
-- ---------------------------------------------------------------------------

-- Any authenticated caller may append an audit row.
create policy audit_events_insert_any on audit_events
  for insert to authenticated with check (true);
-- Staff/admin may read the trail; clients read only their orgs' events.
create policy audit_events_staff_read on audit_events
  for select using (is_staff());
create policy audit_events_client_read on audit_events
  for select using (organisation_id in (select current_org_ids()));

-- No UPDATE/DELETE policy exists -> both are denied by RLS for every role.
-- Belt-and-braces: hard-revoke the privileges as well.
revoke update, delete on audit_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------
-- * The service-role key bypasses RLS entirely (used by trusted server jobs:
--   orchestration workers, hash-chain writer). Application server code that
--   acts on behalf of a signed-in user must use that user's JWT, not the
--   service key, so these policies apply.
-- * "authenticated" / "anon" are the standard Supabase roles.
