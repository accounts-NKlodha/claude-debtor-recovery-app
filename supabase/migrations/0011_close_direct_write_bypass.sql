-- 0011_close_direct_write_bypass.sql
-- P0-4 Gate B R3: closes the live-confirmed direct-table-write audit bypass
-- (docs/SUPABASE_GATE_B.md, "Direct-table-write audit bypass" / 0007's
-- "Finding 4"). Root cause: 0002_rls.sql's generic tenant-table loop granted
-- staff (and, via app_users_admin_all from 0007, admin) `FOR ALL` directly
-- on every tenant table, alongside the audited RPCs added in 0006/0007/0010.
-- The application's own code has never issued a direct write against any of
-- these tables since P0-4 (every mutation goes through a repository method
-- that calls an RPC) -- but nothing at the database layer prevented an
-- authenticated staff/admin session from writing directly via the Data API,
-- bypassing the RPC and producing no audit_events row. Confirmed live:
-- `PATCH recovery_cases` as staff succeeded and created zero audit rows.
--
-- Fix: for every table with audited-RPC coverage (or with no current
-- write usage from the app at all), replace the staff/admin `FOR ALL`
-- policy with a `FOR SELECT` (read)-only policy, and additionally revoke
-- INSERT/UPDATE/DELETE at the table-grant level from anon/authenticated --
-- defense in depth, matching the audit_events precedent (0002/0005), so a
-- policy authoring mistake alone can't reopen the bypass. This does not
-- affect any RPC: every RPC in 0005/0006/0007/0010 is `SECURITY DEFINER`,
-- which executes with the function owner's privileges, not the caller's --
-- confirmed already working this way for audit_events since 0005.
--
-- Read access is fully preserved: staff/admin keep cross-organisation
-- SELECT on every table (PRD "broad operational access; all cases
-- visible"); client SELECT policies are untouched.
--
-- Two intentional, documented exceptions where the app-level role check
-- inside an existing policy (not the table-level grant) is what
-- discriminates staff from client -- both roles share the single Postgres
-- `authenticated` role, so a table-level revoke would break the legitimate
-- side too:
--   * documents / document_versions: `..._client_insert` already requires
--     `current_user_role() = 'client'` -- staff's role fails that check, so
--     removing `..._staff_all` alone closes staff's write path while client
--     upload (PRD "client/staff mobile upload", not yet wired into any app
--     code path either way) stays exactly as tenant/role-safe as it always
--     was. INSERT stays granted at the table level (required for the
--     client policy); UPDATE/DELETE are revoked (no policy ever allowed
--     either, for any role).
--   * payment_records: same shape -- `..._client_insert` is the client's
--     "report a payment" surface (PRD). INSERT stays granted; UPDATE/DELETE
--     revoked (the confirm-payment RPC needs neither, being SECURITY
--     DEFINER).
--   * notifications: `..._recipient_update` (mark-as-read, scoped to
--     `recipient_id = auth.uid()`) is a legitimate, tightly self-scoped,
--     low-stakes UX action with no business-state or financial effect --
--     left untouched, UPDATE grant stays. INSERT/DELETE are revoked (no
--     policy ever allowed either).
--
-- app_users / user_organisations: 0007 already made these staff-read-only.
-- This migration additionally removes ADMIN's direct write access
-- (`app_users_admin_all` -> `app_users_admin_read`) -- no currently
-- implemented app code path uses it (confirmed: no repository method or
-- server action writes app_users/user_organisations at all); ongoing
-- identity provisioning is documented in docs/ADMIN_BOOTSTRAP.md as a
-- Dashboard SQL Editor (superuser, RLS-bypassing) procedure, which this
-- change does not affect. Closes the same audit-bypass shape for admin
-- that this migration closes for staff.

-- ---------------------------------------------------------------------------
-- organisations: creation is already RPC-only (create_organisation, 0006).
-- No RPC or app code performs an UPDATE/DELETE; staff never needs direct
-- write here.
-- ---------------------------------------------------------------------------
drop policy if exists organisations_staff_all on organisations;
create policy organisations_staff_read on organisations
  for select using (is_staff());
revoke insert, update, delete on organisations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- app_users / user_organisations: remove admin's remaining direct write
-- (staff was already read-only since 0007).
-- ---------------------------------------------------------------------------
drop policy if exists app_users_admin_all on app_users;
create policy app_users_admin_read on app_users
  for select using (current_user_role() = 'admin');
revoke insert, update, delete on app_users from anon, authenticated;

drop policy if exists user_organisations_staff_all on user_organisations;
create policy user_organisations_staff_read on user_organisations
  for select using (is_staff());
revoke insert, update, delete on user_organisations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Generic tenant tables with full audited-RPC coverage (or no current write
-- usage at all): staff FOR ALL -> staff read-only, table grants revoked.
-- ---------------------------------------------------------------------------
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
    execute format('drop policy if exists %1$s_staff_all on %1$s;', t);
    execute format('create policy %1$s_staff_read on %1$s for select using (is_staff());', t);
    execute format('revoke insert, update, delete on %1$s from anon, authenticated;', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Mixed staff/client tables: staff FOR ALL -> staff read-only; client's
-- existing insert policy (already role- and tenant-scoped) is untouched.
-- INSERT stays granted at the table level (required for the client
-- policy); UPDATE/DELETE revoked (no policy ever allowed either, for any role).
-- ---------------------------------------------------------------------------
drop policy if exists documents_staff_all on documents;
create policy documents_staff_read on documents
  for select using (is_staff());
revoke update, delete on documents from anon, authenticated;

drop policy if exists document_versions_staff_all on document_versions;
create policy document_versions_staff_read on document_versions
  for select using (is_staff());
revoke update, delete on document_versions from anon, authenticated;

drop policy if exists payment_records_staff_all on payment_records;
create policy payment_records_staff_read on payment_records
  for select using (is_staff());
revoke update, delete on payment_records from anon, authenticated;

-- ---------------------------------------------------------------------------
-- notifications: staff FOR ALL -> staff read-only. recipient_read/
-- recipient_update (self-scoped mark-as-read) are untouched -- see the
-- header note on why this one stays. INSERT/DELETE revoked (no policy ever
-- allowed either, for any role); UPDATE stays granted (needed by
-- recipient_update).
-- ---------------------------------------------------------------------------
drop policy if exists notifications_staff_all on notifications;
create policy notifications_staff_read on notifications
  for select using (is_staff());
revoke insert, delete on notifications from anon, authenticated;

-- audit_events and system_settings are already fully RPC-only (0005, 0006)
-- and are not touched by this migration.
