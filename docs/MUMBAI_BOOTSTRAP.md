# Mumbai production Supabase bootstrap — execution record (2026-09-13/14)

Companion to `docs/SUPABASE_GATE_B.md` (the Seoul project's equivalent
record). Documents the bootstrap of the project named **"Mumbai Debtor
recovery"** (ref `igagfxgzlojqrkaawnzx`) from a clean state against the
approved production architecture (baseline `a1a60f6`).

## Critical finding: not actually in Mumbai

Despite its display name and its intended purpose, `supabase projects list`
and `supabase backups list` both report this project's actual region as
**`ap-southeast-2` (Sydney, Australia)** — not `ap-south-1` (Mumbai). This
was discovered before any migrations were applied and reported to the task
owner immediately; the technical bootstrap was continued anyway (the work is
valid and reusable regardless of region), but **this is a hard blocker
against India data-residency** (PRD §13/§14) and against calling this
project production-ready. See the region note in `docs/DEPLOYMENT.md` §1.

A project's display name is never evidence of its region — the Seoul project
from Gate B had no "Seoul" in its name either. Always confirm with
`supabase projects list` (the `"region"` field) at creation time, before any
data is loaded.

## What was done

1. **Link:** `supabase link --project-ref igagfxgzlojqrkaawnzx` — no
   password prompt (uses the CLI's access-token session, not a DB password).
2. **Migration history:** remote was completely empty (fresh project).
   `db push --dry-run` confirmed it would apply exactly the 8 real,
   committed migrations and no seed.
3. **Apply:** `supabase db push --linked --yes` applied all 8 migrations
   (`0001, 0002, 0004, 0005, 0006, 0007, 0010, 0011`) successfully **on the
   first attempt, with zero errors** — unlike Seoul, which needed 3
   additional live-discovered fixes along the way (0007's hardening fixes,
   0010's digest-schema fix, 0011's audit-bypass fix). This validates that
   the migration chain is now genuinely production-solid.
4. **Seed:** never applied. `db push` (without `--include-seed`) never
   touches `supabase/seed.sql`; the dry-run's `"seeds":[]` confirmed this
   before the real push.
5. **Schema/RLS/RPC/grant verification (anon key, unauthenticated):** all 24
   tables exist and return empty; all 8 RPCs exist and reject unauthenticated
   callers with `"no authenticated caller"` (no digest-schema error — the
   0010 fix is baked in from the start); anonymous direct INSERT on
   `organisations`, `recovery_cases`, `audit_events` all correctly denied at
   the table-grant level (`permission denied for table ...`), confirming
   0011's protections are active on a clean deploy — no vulnerability window
   ever existed here.
6. **Admin bootstrap:** followed `docs/ADMIN_BOOTSTRAP.md` exactly. The task
   owner created the `accounts@nklodha.in` identity via Dashboard →
   Authentication → Users → Add user (Auto Confirm), then ran the
   documented `insert into app_users (...) on conflict (id) do update set
   role = 'admin'` statement themselves in the Dashboard SQL Editor — never
   automated via `db push`, matching that document's explicit design
   rationale ("never part of `supabase db push`, `next build`, or any
   deploy script"). Verified via a read-only SELECT the task owner ran
   themselves: `role=admin, email=accounts@nklodha.in,
   display_name=Rohit Lodha`.
7. **Authenticated security smoke-test matrix:** four disposable, clearly
   labeled test identities (`mumbai-smoketest-{staff,admin,clienta,
   clientb}@nklodha.in`, Auto Confirm, shared temporary password) were
   created by the task owner via Dashboard — never the real admin account.
   Their `app_users` rows (and, for the two client identities,
   `user_organisations` links) were provisioned via an ephemeral migration
   file (written, pushed, then deleted and reconciled with `supabase
   migration repair --status reverted <version>` — same convention as the
   Gate B digest-schema probe), since 0011 deliberately leaves no ordinary
   authenticated-session write path to either table. 36 checks, all passed:
   - Anonymous denial (SELECT returns empty, RPCs reject, direct INSERT
     denied).
   - Staff read access (6 representative tables, all 200).
   - Staff direct-table-write denial (`recovery_cases`, `organisations`
     direct INSERT; admin-only RPC called by staff — all rejected).
   - Staff self-escalation denial (direct `PATCH app_users` role change
     rejected).
   - Admin-only operations: `create_organisation` (×2, admin succeeds,
     produces exactly one `audit_events` row each, `actor_id` correctly
     derived from `auth.uid()`); `set_automation_state` (admin succeeds,
     staff rejected with "admin session required").
   - Client tenant isolation: two temporary orgs
     (`MUMBAI-SMOKETEST-{A,B}`), two clients, each sees only their own
     org/case; an explicit cross-org filter returns empty (RLS-hidden, not
     an error); admin direct-write to `app_users` denied; client
     direct-write to `recovery_cases` denied; client INSERT on `documents`
     into their own org still works (preserved exception), into a foreign
     org is denied.
   - Audited RPC success: `create_case_from_invoice` (×2, one per org),
     `record_payment_row`, `apply_payment_confirmation` — all succeed as
     staff.
   - Payment confirmation retry protection: a second
     `apply_payment_confirmation` call on the same payment id is rejected
     with "payment ... is already confirmed -- refusing to re-apply"
     (0007's row-lock guard).
8. **Cleanup:** an ephemeral migration deleted all smoke-test business data
   (`payment_records`, `invoices`, `recovery_cases`, `debtors`, `documents`,
   `user_organisations`), then was deleted and reconciled the same way.
   **Permanent residual (cannot be deleted, by design):** the 4 smoke-test
   `app_users` rows and the 2 `MUMBAI-SMOKETEST-{A,B}` `organisations` rows
   remain — `audit_events.actor_id` and `.organisation_id` both reference
   them via foreign key, and `audit_events` has no delete path for any role
   (append-only, tamper-evident hash chain, matching the Gate B "GATEB-OK"
   precedent). Final residual state, verified via an authenticated staff
   read: `organisations: 2, app_users: 5 (1 real admin + 4 smoke-test),
   user_organisations: 0, debtors: 0, recovery_cases: 0, invoices: 0,
   payment_records: 0, documents: 0, audit_events: 8`.
9. **Next.js live connection:** `.env.local` pointed at the Mumbai URL/anon
   key; `next dev` logged `[repo] data mode: supabase` on first request
   (the mode can only resolve to `"supabase"` from those same two env
   vars); `/dashboard` returned "unauthorized" for an unauthenticated
   request, not real data.
10. **Google OAuth:** not configured. Not attempted, per the task's explicit
    instruction not to configure it without existing credentials.
11. **Backup/restore:** `supabase backups list --project-ref
    igagfxgzlojqrkaawnzx` → `pitr_enabled: false, backups: []`. No
    point-in-time recovery, no snapshots exist yet — same Free-tier finding
    as Seoul (see `docs/DEPLOYMENT.md` §6a/§6b for the manual-backup
    procedure).

## Remaining user-only steps

- **Resolve the region blocker** (see above) before any real client data is
  loaded — this project cannot be called production-ready on residency
  grounds regardless of how clean the technical bootstrap is.
- Delete the four Supabase Auth test users (`mumbai-smoketest-{staff,admin,
  clienta,clientb}@nklodha.in`) via Dashboard → Authentication → Users. Their
  `app_users` rows will remain permanently (see above) — this is expected
  and does not grant them any access once their Auth identity is gone (RLS
  keys off `auth.uid()`, which no longer resolves to any session).
- Configure Google OAuth when credentials are available.
- Decide on and implement an off-site backup procedure before go-live (Free
  plan has no automated backups/PITR).
