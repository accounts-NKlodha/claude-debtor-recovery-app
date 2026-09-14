-- 0016_p05_r1_revoke_anon_from_business_rpcs.sql
-- P0-5-R1: exhaustive live function-exposure audit (see
-- docs/security-audit/p0-5-r1-rpc-exposure.md for the full inventory and
-- methodology). Queried pg_proc/has_function_privilege() directly against
-- the production Sydney project rather than trusting migration intent, per
-- the lesson from 0013 (raise_workflow_task/close_case_tasks_if_terminal
-- were reachable by anon despite `revoke ... from public`, because
-- Supabase's default privileges grant EXECUTE on new public-schema
-- functions directly to anon/authenticated, independent of PUBLIC).
--
-- Live-confirmed finding: every one of this project's 15 business/mutation
-- RPCs -- every RPC from 0005/0006/0007/0012 -- has `anon_execute = true`
-- at the grant level, for the exact same structural reason as the
-- raise_workflow_task incident. None of them is exploitable *today*: every
-- one already has an internal `auth.uid() is null` check (and a role/
-- tenant check beyond that) that correctly rejects an anonymous caller --
-- confirmed live, and by the P0-4/P0-5 security-regression suites. But
-- relying solely on an internal check, with no grant-level backstop, is
-- exactly the pattern that let raise_workflow_task/close_case_tasks_if_
-- terminal go unnoticed until a live audit found it. This migration closes
-- the same class of gap pre-emptively for every function that doesn't
-- already have it, rather than waiting for a future in-function check to
-- be weakened or refactored away.
--
-- No RPC listed below is intended to be callable by an unauthenticated
-- session -- every one requires a real `auth.uid()`. `authenticated` stays
-- granted (this Postgres project has a single shared `authenticated` role
-- for staff/admin/client alike, per 0011's own documented design; the
-- staff/admin/client/tenant distinction is enforced inside each function
-- body, not by the Postgres role).
--
-- Explicitly NOT touched here, and why:
--   * `current_app_user_id()`, `current_user_role()`, `is_staff()`,
--     `current_org_ids()` -- these are invoked directly inside RLS policy
--     USING clauses (0002_rls.sql, 20 call sites), evaluated for every
--     query against every RLS-protected table, including anon's own reads.
--     Revoking anon's EXECUTE on them would not tighten security -- it
--     would break RLS evaluation outright for anon (a permission-denied
--     error instead of the intended empty-result-set), because Postgres
--     requires the querying role to hold EXECUTE on any function a policy
--     expression references, even when embedded in the policy rather than
--     called directly. anon/authenticated access to these four is
--     required, not incidental, and each is safe to expose: all four are
--     zero-argument, keyed only to the caller's own `auth.uid()`, and can
--     never return another identity's data.
--   * `raise_workflow_task()`, `close_case_tasks_if_terminal()` -- already
--     fixed in 0013 (anon/authenticated both false, confirmed live).
--   * `p05_r1_audit_functions()` -- the ephemeral diagnostic probe used to
--     run this audit; dropped by this migration, not part of the
--     permanent schema.

revoke execute on function apply_case_mutation(uuid, jsonb, text, text, text, jsonb, uuid) from anon;
revoke execute on function apply_payment_confirmation(uuid, jsonb, jsonb, text, uuid) from anon;
revoke execute on function correct_invoice_row(uuid, jsonb, uuid, jsonb, text, uuid) from anon;
revoke execute on function create_case_from_invoice(uuid, jsonb, jsonb, jsonb, text, uuid) from anon;
revoke execute on function create_organisation(text, text, text, text, boolean, text, uuid) from anon;
revoke execute on function record_audit_event(uuid, text, text, uuid, text, jsonb) from anon;
revoke execute on function record_payment_row(uuid, payment_kind, bigint, text, uuid) from anon;
revoke execute on function set_automation_state(boolean, text, uuid) from anon;
revoke execute on function prepare_dd(uuid, jsonb, bigint, text, text, text, text, uuid) from anon;
revoke execute on function record_dd_submitted(uuid, timestamptz, uuid, text, uuid) from anon;
revoke execute on function record_debtor_reply(uuid, jsonb, channel, text, uuid, reply_classification, text, uuid) from anon;
revoke execute on function record_hearing_outcome(uuid, uuid, jsonb, hearing_status, text, text, uuid) from anon;
revoke execute on function reschedule_hearing(uuid, uuid, jsonb, timestamptz, text, text, text, uuid, text, text, uuid) from anon;
revoke execute on function resolve_workflow_task(uuid, text, uuid) from anon;
revoke execute on function schedule_hearing(uuid, jsonb, timestamptz, text, text, text, uuid, text, text, uuid) from anon;

drop function if exists p05_r1_audit_functions();
