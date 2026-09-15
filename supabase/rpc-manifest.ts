/**
 * The explicit, hand-maintained exposure policy for every application-
 * defined function in the `public` schema (P0-5-R1). This is the source of
 * truth `rpc-manifest.test.ts` checks every migration against -- it is NOT
 * derived from today's function list, so it fails loudly (an unclassified
 * function, or a mismatch between declared and actual exposure) the moment
 * a future migration adds a function without updating this file.
 *
 * Background: 0013 and 0016 both fixed functions that were reachable by
 * `anon`/`authenticated` despite a `revoke ... from public` statement,
 * because Supabase's default privileges grant EXECUTE on every new
 * public-schema function directly to `anon`/`authenticated`, independent
 * of the `PUBLIC` pseudo-role. See docs/security-audit/p0-5-r1-rpc-exposure.md
 * for the full live audit, methodology and the SQL query to re-verify
 * actual (not just declared) grants against a real database.
 *
 * Every function name found in `supabase/migrations/*.sql` MUST appear
 * here exactly once. `expectedAnonExecute`/`expectedAuthenticatedExecute`
 * describe the INTENDED final grant state after all migrations apply, in
 * filename order -- the test statically computes the actual final state
 * from every `revoke`/`grant execute on function <name>(...) from/to ...`
 * statement (default state on first `create (or replace) function` sighting
 * is `{anon: true, authenticated: true}`, matching Supabase's real default
 * privileges) and fails on any mismatch.
 *
 * This codebase never overloads a function name (every name has exactly
 * one signature, redefined via `create or replace` with the same argument
 * types across migrations) -- the manifest and test key purely by name.
 */

export type RpcClassification =
  /** RLS-policy helper: invoked directly inside a `USING`/`WITH CHECK`
   * clause (0002_rls.sql), so anon/authenticated access is REQUIRED for
   * RLS itself to evaluate for every role, not an incidental exposure.
   * Each one is zero-argument, keyed only to the caller's own auth.uid(),
   * and can never return another identity's data. */
  | "rls_helper"
  /** Intentionally callable by an authenticated application session
   * (staff, admin, or client -- this Postgres project has one shared
   * `authenticated` role for all three; the finer-grained distinction is
   * enforced inside the function body, not by the Postgres role). Performs
   * its own auth.uid()/role/tenant validation. Never callable by anon --
   * no legitimate anonymous caller exists for any business mutation or the
   * audit writer. */
  | "public_rpc"
  /** Must NEVER be directly callable through PostgREST by any role --
   * reachable only via `perform` from another SECURITY DEFINER function
   * owned by the same principal. No `grant execute` to anon OR
   * authenticated should ever exist. */
  | "internal_helper";

export type RequiredAppRole =
  | "anonymous" // safe for/needed by unauthenticated callers (RLS helpers only)
  | "authenticated_client" // any signed-in app_user, role otherwise unchecked beyond "provisioned"
  | "staff" // staff or admin (is_staff())
  | "admin" // admin only
  | "internal_only"; // never reachable via the application API at all

export interface RpcManifestEntry {
  name: string;
  classification: RpcClassification;
  expectedAnonExecute: boolean;
  expectedAuthenticatedExecute: boolean;
  requiredAppRole: RequiredAppRole;
  /** Which migration first introduced it (for traceability, not checked). */
  introducedIn: string;
  notes: string;
}

export const RPC_MANIFEST: RpcManifestEntry[] = [
  {
    name: "current_app_user_id",
    classification: "rls_helper",
    expectedAnonExecute: true,
    expectedAuthenticatedExecute: true,
    requiredAppRole: "anonymous",
    introducedIn: "0002_rls.sql",
    notes: "select auth.uid() -- returns only the caller's own id.",
  },
  {
    name: "current_user_role",
    classification: "rls_helper",
    expectedAnonExecute: true,
    expectedAuthenticatedExecute: true,
    requiredAppRole: "anonymous",
    introducedIn: "0002_rls.sql",
    notes: "SECURITY DEFINER, but keyed only to auth.uid() -- returns only the caller's own role.",
  },
  {
    name: "is_staff",
    classification: "rls_helper",
    expectedAnonExecute: true,
    expectedAuthenticatedExecute: true,
    requiredAppRole: "anonymous",
    introducedIn: "0002_rls.sql",
    notes: "current_user_role() in ('staff','admin') for the caller only.",
  },
  {
    name: "current_org_ids",
    classification: "rls_helper",
    expectedAnonExecute: true,
    expectedAuthenticatedExecute: true,
    requiredAppRole: "anonymous",
    introducedIn: "0002_rls.sql",
    notes: "Org ids the caller's own client identity may act for.",
  },
  {
    name: "record_audit_event",
    classification: "public_rpc",
    expectedAnonExecute: false,
    expectedAuthenticatedExecute: true,
    requiredAppRole: "authenticated_client",
    introducedIn: "0005_privileged_audit_writer.sql",
    notes: "auth.uid() is null check + must be a provisioned app_user; tenant check for client callers.",
  },
  {
    name: "set_automation_state",
    classification: "public_rpc",
    expectedAnonExecute: false,
    expectedAuthenticatedExecute: true,
    requiredAppRole: "admin",
    introducedIn: "0006_production_write_rpcs.sql",
    notes: "Global automation kill switch -- admin session required, checked inside the function.",
  },
  {
    name: "apply_case_mutation",
    classification: "public_rpc",
    expectedAnonExecute: false,
    expectedAuthenticatedExecute: true,
    requiredAppRole: "staff",
    introducedIn: "0006_production_write_rpcs.sql",
    notes: "Generic case-patch + optional communication + audit, atomically.",
  },
  {
    name: "record_payment_row",
    classification: "public_rpc",
    expectedAnonExecute: false,
    expectedAuthenticatedExecute: true,
    requiredAppRole: "staff",
    introducedIn: "0006_production_write_rpcs.sql",
    notes: "Records a payment receipt.",
  },
  {
    name: "apply_payment_confirmation",
    classification: "public_rpc",
    expectedAnonExecute: false,
    expectedAuthenticatedExecute: true,
    requiredAppRole: "staff",
    introducedIn: "0006_production_write_rpcs.sql",
    notes: "Row-locked, already-confirmed guard (0007); persists payment_allocations (0012).",
  },
  {
    name: "correct_invoice_row",
    classification: "public_rpc",
    expectedAnonExecute: false,
    expectedAuthenticatedExecute: true,
    requiredAppRole: "staff",
    introducedIn: "0006_production_write_rpcs.sql",
    notes: "Staff OCR correction, case-scoped (0007).",
  },
  {
    name: "create_case_from_invoice",
    classification: "public_rpc",
    expectedAnonExecute: false,
    expectedAuthenticatedExecute: true,
    requiredAppRole: "staff",
    introducedIn: "0006_production_write_rpcs.sql",
    notes: "Find-or-create debtor + case + invoice, atomically.",
  },
  {
    name: "create_organisation",
    classification: "public_rpc",
    expectedAnonExecute: false,
    expectedAuthenticatedExecute: true,
    requiredAppRole: "admin",
    introducedIn: "0006_production_write_rpcs.sql",
    notes: "Client onboarding -- admin session required, checked inside the function.",
  },
  {
    name: "close_case_tasks_if_terminal",
    classification: "internal_helper",
    expectedAnonExecute: false,
    expectedAuthenticatedExecute: false,
    requiredAppRole: "internal_only",
    introducedIn: "0012_p0_5_workflow_durability.sql",
    notes: "Auto-resolves open tasks when a case reaches a terminal status. Fixed in 0013 (was reachable by anon).",
  },
  {
    name: "raise_workflow_task",
    classification: "internal_helper",
    expectedAnonExecute: false,
    expectedAuthenticatedExecute: false,
    requiredAppRole: "internal_only",
    introducedIn: "0012_p0_5_workflow_durability.sql",
    notes: "Idempotent task creation. Fixed in 0013 (was reachable by anon, no internal check either).",
  },
  {
    name: "resolve_workflow_task",
    classification: "public_rpc",
    expectedAnonExecute: false,
    expectedAuthenticatedExecute: true,
    requiredAppRole: "staff",
    introducedIn: "0012_p0_5_workflow_durability.sql",
    notes: "Marks a task done; idempotent no-op if already resolved.",
  },
  {
    name: "prepare_dd",
    classification: "public_rpc",
    expectedAnonExecute: false,
    expectedAuthenticatedExecute: true,
    requiredAppRole: "staff",
    introducedIn: "0012_p0_5_workflow_durability.sql",
    notes: "Upserts dd_records; rejects further edits once submitted.",
  },
  {
    name: "record_dd_submitted",
    classification: "public_rpc",
    expectedAnonExecute: false,
    expectedAuthenticatedExecute: true,
    requiredAppRole: "staff",
    introducedIn: "0012_p0_5_workflow_durability.sql",
    notes: "Marks DD submitted; idempotent no-op on retry.",
  },
  {
    name: "schedule_hearing",
    classification: "public_rpc",
    expectedAnonExecute: false,
    expectedAuthenticatedExecute: true,
    requiredAppRole: "staff",
    introducedIn: "0012_p0_5_workflow_durability.sql",
    notes: "Inserts case_hearings + calendar_events; idempotent on exact-date retry.",
  },
  {
    name: "reschedule_hearing",
    classification: "public_rpc",
    expectedAnonExecute: false,
    expectedAuthenticatedExecute: true,
    requiredAppRole: "staff",
    introducedIn: "0012_p0_5_workflow_durability.sql",
    notes: "Adjourns current occurrence, inserts a new one; full history preserved.",
  },
  {
    name: "record_hearing_outcome",
    classification: "public_rpc",
    expectedAnonExecute: false,
    expectedAuthenticatedExecute: true,
    requiredAppRole: "staff",
    introducedIn: "0012_p0_5_workflow_durability.sql",
    notes: "completed | cancelled only; idempotent once terminal.",
  },
  {
    name: "record_debtor_reply",
    classification: "public_rpc",
    expectedAnonExecute: false,
    expectedAuthenticatedExecute: true,
    requiredAppRole: "staff",
    introducedIn: "0012_p0_5_workflow_durability.sql",
    notes: "Records + classifies an inbound reply; drives REPLY_CLASSIFIED.",
  },
  {
    name: "begin_communication_send",
    classification: "public_rpc",
    expectedAnonExecute: false,
    expectedAuthenticatedExecute: true,
    requiredAppRole: "staff",
    introducedIn: "0018_email_delivery.sql",
    notes: "Acquires the durable send-intent row before any SMTP call; idempotent via idempotency_key unique constraint.",
  },
  {
    name: "begin_delivery_attempt",
    classification: "public_rpc",
    expectedAnonExecute: false,
    expectedAuthenticatedExecute: true,
    requiredAppRole: "staff",
    introducedIn: "0018_email_delivery.sql",
    notes: "Records an attempt is starting, before the SMTP call; blocks a new attempt when the prior one is ambiguous (queued, never completed) unless explicitly forced.",
  },
  {
    name: "complete_delivery_attempt",
    classification: "public_rpc",
    expectedAnonExecute: false,
    expectedAuthenticatedExecute: true,
    requiredAppRole: "staff",
    introducedIn: "0018_email_delivery.sql",
    notes: "Persists the definitive attempt outcome, updates the communication + case state, audits; idempotent once already completed.",
  },
  {
    name: "update_debtor_contact",
    classification: "public_rpc",
    expectedAnonExecute: false,
    expectedAuthenticatedExecute: true,
    requiredAppRole: "staff",
    introducedIn: "0020_debtor_contact_update.sql",
    notes: "Full-replace update of debtors.email/mobile; client must never reach this (staff/admin only, checked inside the function).",
  },
];
