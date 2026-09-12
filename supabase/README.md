# Supabase schema, RLS and seed

Migration set (ordered below). **Live-verified on `lsuudervqofienqabmaz` (P0-4
Gate B, 2026-09-13):** 0001, 0002, 0004, 0005, 0006, 0007 apply cleanly via
`supabase db push` against a real Supabase project.

| File | Purpose |
| --- | --- |
| `migrations/0001_init.sql` | Enum types + core MVP tables. Money is `BIGINT` paise, timestamps `timestamptz default now()`, UUID PKs `default gen_random_uuid()`. |
| `migrations/0002_rls.sql` | `current_app_user_id()` / `current_user_role()` helpers, RLS enabled on every tenant table, staff/admin vs client policies, append-only `audit_events`. |
| `migrations/0004_tenant_consistency.sql` | Composite `(id, organisation_id)` foreign keys so a child row's `organisation_id` cannot drift from its parent's. |
| `migrations/0005_privileged_audit_writer.sql` | Closes the forgeable `audit_events` insert policy with `record_audit_event()`, a `SECURITY DEFINER` function that derives the actor from `auth.uid()`. Direct `insert` on `audit_events` is revoked from `authenticated`/`anon` -- this function is the only way to append one. |
| `migrations/0006_production_write_rpcs.sql` | `system_settings` table (backs the automation kill switch) + the atomic multi-table write RPCs every mutating `Repository` method uses (`apply_case_mutation`, `record_payment_row`, `apply_payment_confirmation`, `correct_invoice_row`, `create_case_from_invoice`, `create_organisation`, `set_automation_state`). |
| `migrations/0007_gate_b_hardening.sql` | Fixes three live-verified findings: `app_users` no longer grants ordinary staff write access (was a self-escalation-to-admin path), `apply_payment_confirmation` now locks the payment row and rejects a second confirmation (was a double-application risk), and invoice updates in that function and `correct_invoice_row` are now constrained to the target case, not just the organisation. |
| `migrations/0010_gate_b_digest_schema_fix.sql` | Fixes a live-only finding: `record_audit_event()` called `digest()` unqualified; Supabase-hosted Postgres installs `pgcrypto` into the `extensions` schema, not `public`, so every `SECURITY DEFINER` function's deliberately-pinned `search_path = public` made it unresolvable -- every RPC that writes an audit row (all of them) failed the first time any of them actually ran. Fixed by schema-qualifying the call (`extensions.digest`) rather than widening `search_path`. |

**`seed.sql` is not a migration** (see `docs/adr/0002-seed-data-is-not-a-migration.md`).
Fixed-UUID demo data for three fictional companies lives in `supabase/seed.sql`,
declared in `supabase/config.toml`. Plain `supabase db push` (the production
runbook command) never touches it; only `supabase db reset` (local Docker dev)
or `supabase db push --include-seed` (explicit opt-in on a linked project) do.
A fresh production database that only ever runs plain `db push` never receives
this data. It was previously `migrations/0003_seed.sql`; that number is now a
deliberate gap in the sequence (harmless -- a fresh database applies whatever
files exist, in order) and was reconciled on the already-migrated Gate B
project via `supabase migration repair --status reverted 0003` (bookkeeping
only, no data touched).

## Running locally

### Option A -- Supabase CLI (recommended)

```bash
# one-time
supabase init          # if supabase/config.toml is not present
supabase start         # local Postgres + Studio in Docker

# apply every migration + run seed, from scratch
supabase db reset
```

`supabase db reset` drops the local DB, replays `migrations/*.sql` in filename
order, then applies `supabase/seed.sql` (declared in `config.toml`'s
`[db.seed]`) automatically -- convenient for local dev, and inherently
production-safe since it only ever acts on a *local* database. For a linked
remote project, plain `supabase db push` never touches the seed; use
`supabase db push --include-seed` only when deliberately seeding a
non-production project. See `docs/adr/0002-seed-data-is-not-a-migration.md`
and the production allowlist in `docs/DEPLOYMENT.md`.

### Option B -- plain psql

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0001_init.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0002_rls.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0004_tenant_consistency.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0005_privileged_audit_writer.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0006_production_write_rpcs.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0007_gate_b_hardening.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0010_gate_b_digest_schema_fix.sql
# Demo/test data only -- never against a production database:
# psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/seed.sql
```

Requires Postgres 15. The only extension used is `pgcrypto` (for
`gen_random_uuid()`), which is bundled with Postgres/Supabase.

## RLS test plan -- acceptance scenario 12

> "Confirm a client cannot access another client's records, documents, rating
> or AI context."

Seed identities:

| User id (`...0000000000xx`) | Role | Orgs |
| --- | --- | --- |
| `...11` | staff | all (trusted operator) |
| `...12` | admin | all |
| `...13` | client | ACME (`...02`) only |
| `...14` | client | BHARAT (`...03`) + COMET (`...04`) |

### How to assume an identity in a test

RLS keys off `auth.uid()`. In an integration test, sign in as the seeded user
(or mint a JWT with that `sub`) and query through the anon/authenticated role.
With raw psql you can simulate it:

```sql
-- act as client ...13 (ACME only)
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000013","role":"authenticated"}', true);
```

### Assertions

1. **Cross-client rows are invisible.**
   As `...13`, `select count(*) from recovery_cases;` returns only ACME cases
   (`...31`, `...32`, `...33`) -- never BHARAT/COMET cases (`...34`..`...39`).
   `select * from debtors where organisation_id = '..0003';` returns 0 rows.

2. **Cross-client documents are invisible.**
   As `...13`, `select * from documents;` / `document_versions` never returns a
   row whose `organisation_id` is `...03` or `...04`.

3. **Multi-org client sees the union, nothing more.**
   As `...14`, `recovery_cases` returns exactly the 6 BHARAT+COMET cases and no
   ACME row.

4. **Client cannot mutate case/communication/audit rows.**
   As `...13`: `update recovery_cases set status='closed' where id='..0031';`
   affects 0 rows; `insert into communications (...) ...` is rejected by RLS;
   `update audit_events ...` and `delete from audit_events ...` are rejected
   for every role.

5. **Client write surfaces work.**
   As `...13`: `insert into documents (...)` and
   `insert into payment_records (...)` for `organisation_id = '..0002'` succeed;
   the same insert with `organisation_id = '..0003'` is rejected.

6. **Staff sees everything.**
   As `...11`, `select count(*) from recovery_cases;` returns all 9 cases.

7. **Audit append-only, and only via the privileged writer (post-0005).**
   As `...11` (staff) and `...13` (client): a direct
   `insert into audit_events (...)` is rejected outright (the insert policy was
   revoked in `0005_privileged_audit_writer.sql`) -- `select record_audit_event(...)`
   is the only way to append a row, and it derives `actor_id` from `auth.uid()`
   itself (a caller-supplied actor id in any RPC argument is not possible --
   there is no such argument). `update` / `delete` on `audit_events` fails for
   every role, staff and admin included.

8. **Global automation kill switch is admin-only (post-0006), at the database
   layer too, not just the application layer.**
   As `...11` (staff, not admin): `select set_automation_state(false, 'test');`
   is rejected (`admin session required`). As `...12` (admin):
   `select set_automation_state(false, 'test');` succeeds and is reflected in
   `select * from system_settings where key = 'automation';`, visible to both
   `...11` and `...12` (staff/admin read policy) but to neither client identity
   (`system_settings` has no client-facing policy at all -- RLS defaults to
   deny).
