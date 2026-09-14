---
kind: spec
title: "P0-5-R1: Exhaustive RPC Exposure & Grant Audit"
---

# P0-5-R1: Exhaustive RPC Exposure & Grant Audit (2026-09-15)

Triggered by the P0-5 live finding that `raise_workflow_task()` and
`close_case_tasks_if_terminal()` were reachable by an anonymous caller
despite a `revoke execute ... from public` statement in the migration that
defined them (fixed in `0013_p0_5_close_internal_rpc_gap.sql`). That
discovery meant the assumption "every other RPC is safe because it also has
`revoke ... from public`" could not be trusted without checking — this
document is that check, against the live production Sydney project
(`igagfxgzlojqrkaawnzx`), not against migration source alone.

## Root cause (applies to the whole audit, not just the two functions found in P0-5)

Supabase's project bootstrap configures default privileges that grant
`EXECUTE` on every new function created in the `public` schema **directly**
to the `anon` and `authenticated` roles — independent of the `PUBLIC`
pseudo-role. `revoke execute on function X from public` does not touch that
direct grant. The only two ways to actually deny `anon`/`authenticated`
access are:

1. an explicit `revoke execute on function X from anon, authenticated;`
   (or naming the specific role you want to exclude), or
2. relying on an in-function check (`auth.uid() is null`, `is_staff()`,
   etc.) to reject the caller at runtime.

Every RPC in this codebase already had (2). None had (1) until this audit
— which is exactly why `raise_workflow_task`/`close_case_tasks_if_terminal`
(which had neither, since they were designed to be "internal-only" via
grant omission alone) were exploitable, and why the other 15 business RPCs
were *not* exploitable today but were one refactor away from the same
class of bug.

## Methodology

A temporary, read-only diagnostic RPC (`p05_r1_audit_functions()`,
migration `0015`, applied and then dropped by `0016` — never committed as a
standing function) queried `pg_proc`/`pg_namespace`/`pg_roles` joined with
`has_function_privilege()` for `anon`, `authenticated`, `service_role` and
`postgres` against every function in the `public` schema. This reports the
**effective** privilege (accounting for default privileges, explicit
grants, and explicit revokes together) rather than re-deriving it from
migration text.

Re-run this yourself (via the Supabase Dashboard SQL Editor, or the same
temporary-RPC-and-drop pattern used here) whenever you want to confirm live
state independent of this document or the static test:

```sql
select
  n.nspname as schema,
  p.proname as name,
  pg_get_function_identity_arguments(p.oid) as args,
  p.prosecdef as security_definer,
  r.rolname as owner,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_roles r on r.oid = p.proowner
where n.nspname = 'public'
order by p.proname;
```

## Full inventory (live-confirmed, 2026-09-15, after the 0016 repair below)

All 21 application-defined functions in `public`. `service_role` is `true`
for every row — expected and out of scope: `service_role` is Supabase's own
administrative bypass role, never used by this application (explicit
project constraint: "no service-role use in application actions"), and it
inherently bypasses RLS/grants by Supabase convention regardless of any
function-level grant.

| Function | SECURITY DEFINER | anon EXECUTE | authenticated EXECUTE | Classification | Required app role |
|---|---|---|---|---|---|
| `current_app_user_id()` | no | **true** | true | RLS helper | anonymous (required) |
| `current_user_role()` | yes | **true** | true | RLS helper | anonymous (required) |
| `is_staff()` | no | **true** | true | RLS helper | anonymous (required) |
| `current_org_ids()` | yes | **true** | true | RLS helper | anonymous (required) |
| `record_audit_event(...)` | yes | false | true | Public RPC | authenticated (provisioned app_user) |
| `set_automation_state(...)` | yes | false | true | Public RPC | admin |
| `apply_case_mutation(...)` | yes | false | true | Public RPC | staff |
| `record_payment_row(...)` | yes | false | true | Public RPC | staff |
| `apply_payment_confirmation(...)` | yes | false | true | Public RPC | staff |
| `correct_invoice_row(...)` | yes | false | true | Public RPC | staff |
| `create_case_from_invoice(...)` | yes | false | true | Public RPC | staff |
| `create_organisation(...)` | yes | false | true | Public RPC | admin |
| `close_case_tasks_if_terminal(...)` | yes | false | false | Internal helper | internal only |
| `raise_workflow_task(...)` | yes | false | false | Internal helper | internal only |
| `resolve_workflow_task(...)` | yes | false | true | Public RPC | staff |
| `prepare_dd(...)` | yes | false | true | Public RPC | staff |
| `record_dd_submitted(...)` | yes | false | true | Public RPC | staff |
| `schedule_hearing(...)` | yes | false | true | Public RPC | staff |
| `reschedule_hearing(...)` | yes | false | true | Public RPC | staff |
| `record_hearing_outcome(...)` | yes | false | true | Public RPC | staff |
| `record_debtor_reply(...)` | yes | false | true | Public RPC | staff |

The machine-checked source of truth for this table is
[`supabase/rpc-manifest.ts`](../../supabase/rpc-manifest.ts) — see below.

### Why the four RLS helpers keep `anon EXECUTE = true` (not a residual gap)

`current_app_user_id()`, `current_user_role()`, `is_staff()` and
`current_org_ids()` are invoked directly inside RLS policy `USING` clauses
(`0002_rls.sql`, 20 call sites) — evaluated for **every** query against
every RLS-protected table, including an anonymous caller's own reads.
Postgres requires the querying role to hold `EXECUTE` on any function a
policy expression references, even when the function is only reached via
the policy rather than called directly — revoking `anon`'s `EXECUTE` on
these would not tighten anything; it would break RLS evaluation for `anon`
entirely (a `permission denied for function` error on every query instead
of the intended empty result set). Confirmed live: revoking here was not
attempted (the risk of an outage was judged not worth testing against
production), but the mechanism is standard, well-documented Postgres
behavior, and all four functions are safe to expose regardless — each is
zero-argument and keyed only to the caller's own `auth.uid()`, so no
identity's data but the caller's own can ever be returned through them.

## SECURITY DEFINER audit result

Every `SECURITY DEFINER` function (17 of the 21 — all but the two plain
`is_staff()`/`current_app_user_id()` SQL helpers) was checked against:

- **fixed `search_path`**: `set search_path = public` on all 17 — confirmed
  by grepping every `create (or replace) function` block; this is also the
  exact property that caused (and was fixed by) the `0010` `digest()`
  resolution bug, so it has been under direct scrutiny already.
- **trusted actor from `auth.uid()`**: every business RPC calls
  `auth.uid()` itself for the actor, and where a caller-supplied
  `p_expected_actor_id` argument exists, it is used only as an *optional
  identity-mismatch check* (`p_expected_actor_id is distinct from
  auth.uid()` → reject) — never as the actor value written to
  `audit_events`/`recorded_by`/`created_by`/`reviewed_by_id`. No function
  accepts a caller-supplied actor id as authoritative.
- **role checks**: every `public_rpc` has an explicit `is_staff()` or
  `current_user_role() = 'admin'` check before any mutation; `internal_helper`
  functions (post-0013) have the same `is_staff()` check as defense in
  depth even though they're also grant-blocked now.
- **organisation/tenant consistency**: mutation RPCs derive
  `organisation_id` from the row being mutated (`select organisation_id
  from recovery_cases where id = p_case_id`), never from a client-supplied
  argument that could name a different org; `record_audit_event` additionally
  checks a `client`-role caller is a member of the org they're auditing
  against.
- **no caller-controlled privilege escalation**: `app_users`/
  `user_organisations` have no RPC write path at all (`docs/ADMIN_BOOTSTRAP.md`
  remains the only mechanism); no RPC here writes either table.
- **no dynamic SQL**: none of these functions build or `execute` a SQL
  string from any parameter (the one place dynamic SQL exists at all,
  `0011`'s `do $$ ... execute format(...) $$` loop over a fixed, hardcoded
  table-name array, takes no external input).
- **internal helper cannot be abused independently**: `raise_workflow_task`/
  `close_case_tasks_if_terminal` are now grant-blocked from both `anon` and
  `authenticated` (0013) *and* carry their own `auth.uid()`/`is_staff()`
  checks (defense in depth) — even a future accidental re-grant would still
  require a real staff/admin session to do anything through them.
- **audit event behavior**: every function that performs a material
  business mutation calls `record_audit_event` (directly or via `perform`)
  in the same transaction as the mutation — confirmed present in all 15
  `public_rpc` entries.

No violations found beyond the two already fixed in 0013.

## Unintended exposures found and fixed by this review

| Function | Finding | Fix |
|---|---|---|
| `raise_workflow_task`, `close_case_tasks_if_terminal` | Already found and fixed in P0-5 itself (`0013`) — reachable by `anon` with no internal check at all. Re-confirmed live as fixed by this audit. | (no new action; re-verified) |
| All 15 `public_rpc` functions (`0005`/`0006`/`0007`/`0012`) | `anon EXECUTE = true` at the grant level on every one — not exploitable today (every one has a correct internal `auth.uid()`/role check), but the exact same *structural* gap as the incident above: a grant-level backstop was absent, relying solely on the in-function check. | `0016_p05_r1_revoke_anon_from_business_rpcs.sql`: explicit `revoke execute ... from anon` on all 15, `authenticated` left intact. |

No other unintended exposure was found. The four RLS helpers' `anon`
access is required, not a gap (see above).

## Permanent regression guard

[`supabase/rpc-manifest.ts`](../../supabase/rpc-manifest.ts) is the
explicit, hand-maintained policy: every function's classification
(`rls_helper` / `public_rpc` / `internal_helper`), required application
role, and expected `anon`/`authenticated` EXECUTE state.
[`supabase/rpc-manifest.test.ts`](../../supabase/rpc-manifest.test.ts)
statically parses every migration file (in the same filename order
`supabase db push` applies them), computes the resulting grant state for
every function found (`create`/`create or replace function` seeds the
Supabase-default `{anon: true, authenticated: true}` the first time a name
is seen; every `revoke`/`grant execute on function ... from/to ...`
thereafter updates it in file order), and fails if:

- a function exists in migrations with no manifest entry (no unclassified
  function can pass silently);
- a manifest entry names a function no migration actually defines (stale
  entry);
- any function's computed final `anon`/`authenticated` state doesn't match
  its manifest-declared expectation;
- any `internal_helper` declares `anon`/`authenticated` execute at all;
- any `public_rpc` declares `anon` execute at all;
- any `public_rpc`/`internal_helper`'s latest definition lacks `SECURITY
  DEFINER`.

This runs in plain `npx vitest run` (`supabase/**/*.test.ts` was added to
`vitest.config.mts`'s `include`), needs no database connection, and was
verified to actually catch a regression (a revoke statement was deliberately
removed from `0016` during this review, the test failed with a precise
diagnostic naming the function and the mismatch, then the file was restored
and the suite passed again).

**What this guard cannot see**, by design (it is static, not live): default
privileges granted by something *other than* a migration file (e.g. a
manual Dashboard change, or a future Supabase platform default change).
That is exactly what the live SQL query at the top of this document is
for — re-run it periodically, and always before a go-live milestone.

## P0-5 table re-verification (direct-write bypass)

Re-confirmed live, staff and anon, on all 6 P0-5 tables (`workflow_tasks`,
`dd_records`, `case_hearings`, `calendar_events`, `payment_allocations`,
`debtor_replies`): direct `INSERT` denied for both roles, `SELECT` still
works for staff (read preserved), `SELECT` returns empty (not an error) for
anon. `calendar_events` specifically had not been re-tested since the
original P0-4 closure (it predates P0-5) — confirmed still covered by
`0011`'s generic staff-read-only/grant-revoke loop, unaffected by any P0-5
or P0-5-R1 change.
