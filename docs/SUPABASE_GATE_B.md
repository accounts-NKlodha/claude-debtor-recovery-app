# Supabase Gate B — execution record

Status: **CORE VERIFICATION COMPLETE, DIRECT-TABLE-WRITE AUDIT BYPASS
CLOSED (R3).** Migrations, RLS, RPCs, audit chain, and every requested
attack scenario were exercised live against a real Supabase project with
real authenticated sessions. OAuth/browser-cookie integration and
India-region residency remain open (see below) — Gate B is not the same
thing as "production-ready."

## R3: direct-table-write audit bypass — CLOSED

`0011_close_direct_write_bypass.sql` removes staff's (and, where it
existed, admin's) `FOR ALL` direct-write RLS policy on every table with
audited-RPC coverage or no current app-level write usage, replacing it with
a read-only policy, and additionally revokes INSERT/UPDATE/DELETE at the
table-grant level from `anon`/`authenticated` (defense in depth — RLS
policy alone was already sufficient, but the table-level revoke closes it
even against a future policy-authoring mistake). See that migration's
header for the full root-cause explanation and the three documented,
intentional exceptions (`documents`/`document_versions`/`payment_records`
client-insert; `notifications` recipient-scoped mark-as-read).

**Live-confirmed, 120 passing assertions, 0 failures** (full regression
suite, this session): every fully-RPC-only table denies a direct staff
INSERT; `recovery_cases`, `invoices`, `payment_records`, `organisations`,
and `app_users`/`user_organisations` (role/membership) each individually
proven: direct write denied + zero audit row produced, immediately followed
by the same business mutation succeeding through its RPC with exactly one
audit row created. Read access (staff cross-org, client tenant-scoped)
fully preserved and re-confirmed. Client document upload (the one
legitimate direct-write exception) re-confirmed still working. Every R2
regression (visibility matrix, cross-tenant attacks, self-escalation,
forged membership, all 8 RPCs, payment concurrency, transaction rollback,
audit hash chain) re-run and still passes.

## Live project

- Project ref: `lsuudervqofienqabmaz`, region **`ap-northeast-2` (Seoul)** —
  not `ap-south-1` (Mumbai), the documented target. This was the project
  already provisioned and handed over for this task; no region migration
  was performed (no in-place region migration exists; would need a fresh
  `ap-south-1` project + dump/restore). See `docs/DEPLOYMENT.md`'s
  provision section for the explicit note and what's required before real
  client data goes near this project.
- Plan: Free. Not upgraded, per instruction. No automated backups/PITR
  exist for this project — see `docs/DEPLOYMENT.md` §6a/§6b.

## Migrations applied (live-verified, 2026-09-13)

`0001_init.sql`, `0002_rls.sql`, `0004_tenant_consistency.sql`,
`0005_privileged_audit_writer.sql`, `0006_production_write_rpcs.sql`,
`0007_gate_b_hardening.sql`, `0010_gate_b_digest_schema_fix.sql`,
`0011_close_direct_write_bypass.sql` — applied via `supabase db push
--linked`, confirmed via `supabase migration list` (local matches remote
for every one; `supabase db push --linked --dry-run` reports "Remote
database is up to date"; `supabase db push --linked --include-seed
--dry-run` correctly shows it would apply `supabase/seed.sql` and
nothing else -- confirming a fresh production database that only ever runs
plain `db push` never receives demo data, structurally, not by convention).

`supabase/seed.sql` (formerly `migrations/0003_seed.sql` — see
`docs/adr/0002-seed-data-is-not-a-migration.md`) was applied once, manually,
via `db push --include-seed`, to get realistic multi-org demo data
(Acme/Bharat/Comet) for the RLS test matrix. Two real data bugs in it were
found and fixed on this, its first-ever live execution (a malformed
`recovery_cases` VALUES row, and two rows using the invalid enum value
`waiting_on = 'debtor'`).

**Bugs found and fixed only because this was actually run live** (impossible
to catch statically):
1. `0003`'s malformed VALUES row and invalid `waiting_on` enum values (above).
2. `record_audit_event()` called `digest()` unqualified; Supabase installs
   `pgcrypto` into the `extensions` schema, not `public`, and every
   `SECURITY DEFINER` function here pins `search_path = public` — so every
   RPC that writes an audit row (i.e. all of them) failed outright the first
   time any of them ran. Fixed in `0010` by schema-qualifying the call
   (`extensions.digest`), preserving the pinned search_path rather than
   widening it.
3. `getAutomationState()`'s error message claimed the `system_settings` row
   was "missing" when RLS was actually just hiding it from an unauthenticated
   caller — fixed to say that honestly (`src/server/repositories/supabase.ts`).

Two more critical issues were found **statically**, before any live test ran,
by a prior session that prepared this Gate B attempt without live
credentials, and fixed here in `0007_gate_b_hardening.sql` (see that file's
header for the full rationale) — then **live-confirmed fixed** in this
session's test matrix below:
4. `app_users` granted ordinary staff full write access via `is_staff()`,
   permitting a staff session to `UPDATE app_users SET role='admin'` on
   itself, bypassing every admin-only RPC gate.
5. `apply_payment_confirmation` had no already-confirmed guard — a retried
   or racing confirmation would double-apply the same payment.
6. Invoice updates in `apply_payment_confirmation`/`correct_invoice_row`
   constrained only `organisation_id`, not `case_id`.

## Test identities (live, real Supabase Auth)

Created via Supabase Dashboard (Authentication → Users → Add user, Auto
Confirm), email/password auth (Google OAuth is not yet configured — see
below):

| Email | Real `auth.users` UUID | `app_users.role` | Org membership |
| --- | --- | --- | --- |
| `gate-b-staff@nklodha.in` | `bbfbec7b-2d5f-4f51-a925-bb7c5fbbaa7e` | staff | (staff: cross-org by design) |
| `gate-b-admin@nklodha.in` | `925ca808-2754-4733-a5dc-26a66c67fcc1` | admin | (admin: cross-org by design) |
| `gate-b-client-a@nklodha.in` | `d970c9b2-de52-4705-84dc-5cb7585561a1` | client | Acme Traders (`...0002`) |
| `gate-b-client-b@nklodha.in` | `d30a4370-c9f7-427d-a0ba-f482994ee079` | client | Bharat Steel (`...0003`) |

The `app_users`/`user_organisations` rows binding these real identities to
roles/orgs were inserted via a **temporary, non-committed migration file**
(applied via `supabase db push`, then deleted locally and its bookkeeping
entry marked `reverted` via `supabase migration repair`) — per this task's
explicit instruction, this is a Gate-B-only pattern and **not** the sanctioned
production user-provisioning mechanism; see `docs/ADMIN_BOOTSTRAP.md` for
that.

## What remains in the live database (deliberately not deleted)

- **The 4 identities above** (`auth.users` + `app_users` + `user_organisations`
  rows) — left in place for potential further testing. Delete via Dashboard
  → Authentication → Users (removes the `auth.users` row; `app_users` has no
  cascade-on-delete-auth-user trigger, so its row needs a separate manual
  delete via the Dashboard SQL Editor, e.g.
  `delete from app_users where id = '<uuid>';` per identity, plus the
  matching `user_organisations` rows for the two client identities).
- **Test-created business rows**: several payments (`gate-b-*-test` /
  `r3-*` references), a couple of documents, and a few case/invoice field
  corrections created across the R2 and R3 test matrices, all on Acme's
  seed cases. Harmless, clearly labeled, on fictional demo data.
- **Test-created audit_events rows** (`gate_b.*`/`r3.*`-prefixed actions and
  reasons): these **cannot** be deleted (audit_events has no delete policy
  for any role, by design — confirmed live: not even admin could delete one
  during testing) and **should not** be deleted even if a superuser path
  existed, since that would defeat the append-only guarantee this whole
  system exists to provide. They remain, correctly, as a permanent record.
- **Two test organisations**: `client_code = 'GATEB-OK'` (R2) and one
  `GATEB-R3-*`-coded org (R3, created to re-prove `create_organisation`
  still works post-hardening). Both are **permanently stuck** on this
  project for the same reason:

  **Cleanup semantics, stated precisely** (distinguishing the two senses of
  "can't delete"):
  - *Deletion is prohibited through the normal application/audit rules*:
    no RLS policy, for any role including admin, permits deleting an
    `audit_events` row, and `organisations` cannot be deleted while any
    `audit_events` row still references it (`audit_events_organisation_id_fkey`,
    a real foreign key) — reproduced live by an actual attempted cleanup
    migration that failed with `SQLSTATE 23503`. This is the *intended*,
    correct behavior of this schema, not a bug or an oversight: it makes
    it structurally impossible for an audit trail to reference a deleted
    organisation.
  - *Deletion is technically possible only via privileged DB
    administration* — a superuser session (the Dashboard SQL Editor, or a
    migration) could `DELETE FROM audit_events WHERE ...` before deleting
    the organisation, exactly like any other DDL/DML this project's
    migrations already perform with elevated privilege. This was
    **deliberately not done**: erasing audit rows to tidy up a test
    project is exactly the kind of "delete inconvenient audit history"
    action the whole system exists to make hard, and doing it here — even
    for harmless fictional test data — would set precedent for treating
    the append-only guarantee as negotiable. If this project's test data
    ever needs a full wipe, the correct procedure is provisioning a fresh
    Supabase project and re-running the (production) migration chain, not
    surgically deleting rows from this one.

  Recognizable by name ("Gate B RPC Test Org", "R3 Regression Org") and
  client code prefix (`GATEB-*`).

None of this affects a fresh production database in any way — it is entirely
contained to this one live Gate B project. See `docs/DEPLOYMENT.md` for the
production provisioning path, which starts from an empty database and never
touches any of the above.

## Live-verified test matrix — R2 baseline (2026-09-13, real sessions, real HTTP calls — not mocks)

(This section is the original R2 record, re-run and still passing after
R3's hardening — see "R3: direct-table-write audit bypass — CLOSED" above
for the additional R3-specific test matrix and its own pass count.)

61 assertions across 8 test scripts, 0 failures (after fixing two of this
session's own test-script bugs — two assertions initially expected HTTP 401
where PostgREST correctly returns 403 for an RLS-policy denial; the denial
itself was correct both times, only the expected status code in the test was
wrong):

1. **Visibility matrix** (9/9): staff/admin see all 4 orgs + 9 cases; Client
   A sees exactly Acme (1 org, 3 cases); Client B sees exactly Bharat;
   anonymous sees nothing.
2. **Cross-tenant attacks** (8/8): Client A's SELECT/INSERT/UPDATE/DELETE
   against Bharat's organisation/case/invoice/debtor/payment rows all denied
   (0 rows visible or affected); Client A's own-org writes still work.
3. **Staff self-escalation + forged membership** (7/7): staff cannot change
   their own or any other `app_users.role` (0 rows affected either way, role
   confirmed unchanged after the attempt); staff cannot INSERT a forged admin
   identity; Client A cannot INSERT a `user_organisations` row granting
   themselves Bharat access; admin retains full `app_users` access
   (confirms the fix is a real role split, not a blanket lockout).
4. **All 8 production RPCs** (14/14): `record_audit_event` (actor always
   `auth.uid()`, a client raising an event for a foreign org denied),
   `create_organisation` (admin-only), `set_automation_state` (admin-only,
   round-tripped disable/enable), `record_payment_row` (staff-only),
   `apply_case_mutation` (staff), `correct_invoice_row` (the `0007` case_id
   fix live-confirmed by attempting a cross-case correction).
5. **Payment double-confirmation + real concurrency** (6/6): sequential
   double-confirm rejected, balance increased exactly once; two
   **simultaneous** (`Promise.all`) confirmation calls on the same payment —
   exactly one succeeds, balance increased exactly once (proves the row
   lock, not just an ordering assumption).
6. **Transaction rollback on forced failure** (6/6): an invalid enum forced
   mid-`apply_payment_confirmation` (after the payment-row UPDATE already
   ran) rolled back that earlier write too — `client_confirmed` stayed
   `false`; same proof for `create_case_from_invoice` (forced failure after
   the debtor INSERT left no orphaned debtor and no case).
7. **Direct-table-write audit bypass — exact residual exposure** (4/4):
   confirmed live — a staff session can `PATCH` `recovery_cases` directly via
   the Data API (succeeds, 0 audit_events rows created); the same change via
   `apply_case_mutation` does audit correctly. **This gap is real and
   unfixed** — see `0007`'s "Finding 4" note; closing it fully means
   revisiting `0002`'s staff `FOR ALL` policies, a larger RLS redesign
   flagged as a follow-up decision, not fixed here.
8. **Audit hash chain** (7/7): `prev_hash`/`hash` link correctly across
   sequential events; UPDATE/DELETE denied on `audit_events` for staff *and*
   admin; direct INSERT (bypassing `record_audit_event`) denied for staff
   (table-level GRANT revoked, not just RLS).

## Authentication / OAuth status

- Real Supabase Auth (email/password) sign-in, JWT issuance, and
  JWT-scoped RLS enforcement: **live-verified**, extensively, above.
- Google OAuth: **not configured** (Google Cloud OAuth client + Supabase
  provider settings are a Dashboard/Google Console step outside this
  session's scope — see `docs/DEPLOYMENT.md`'s Authentication section).
  The app's OAuth code (`src/app/auth/google`, `src/app/auth/callback`,
  `src/lib/auth/oauth.ts`) is written, unit-tested (12 tests, mocked
  Supabase client — open-redirect, CSRF-origin, fail-closed-on-unprovisioned
  checks) but not live-browser-tested, honestly, because OAuth isn't
  configured. Not faked.
- Real Next.js **cookie-based** SSR session (`@supabase/ssr`, what
  `src/lib/auth/session.ts#getAuthContext()` reads in a real browser):
  confirmed the app correctly renders an empty/fail-closed state for an
  unauthenticated session against the live project (`[repo] data mode:
  supabase` log confirmed `SupabaseRepository` selected, no data leak, no
  crash, even with real Acme/Bharat/Comet data now present). A full
  authenticated **browser** round trip was deliberately **not** attempted by
  hand-crafting `@supabase/ssr`'s cookie format — the risk of a subtly wrong
  implementation producing a false "it works" or false "it's broken" result
  outweighed the value, given OAuth (the real path) isn't configured yet
  anyway. This remains an explicit gap, not a claimed pass.

## Remaining human/account steps (unchanged in kind from the prior session's note)

Google Cloud OAuth client setup, an explicit India-region residency
decision (stay on Seoul vs. provision fresh in Mumbai and cut over), and a
Supabase plan upgrade (if automated backups/PITR are wanted before real
go-live) all remain human decisions outside this session's scope.
