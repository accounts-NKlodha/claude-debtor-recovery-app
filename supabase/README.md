# Supabase schema, RLS and seed

Migration set (applies cleanly in order):

| File | Purpose |
| --- | --- |
| `migrations/0001_init.sql` | Enum types + core MVP tables. Money is `BIGINT` paise, timestamps `timestamptz default now()`, UUID PKs `default gen_random_uuid()`. |
| `migrations/0002_rls.sql` | `current_app_user_id()` / `current_user_role()` helpers, RLS enabled on every tenant table, staff/admin vs client policies, append-only `audit_events`. |
| `migrations/0003_seed.sql` | Deterministic demo data with fixed UUIDs (`00000000-0000-0000-0000-0000000000xx`). |

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
order, then runs `seed.sql` if configured. To have the CLI auto-run the seed,
point `[db.seed]` in `supabase/config.toml` at `migrations/0003_seed.sql`, or
just run it manually (Option B).

### Option B -- plain psql

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres

psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
psql "$DATABASE_URL" -f supabase/migrations/0002_rls.sql
psql "$DATABASE_URL" -f supabase/migrations/0003_seed.sql
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

7. **Audit append-only.**
   As `...11` (staff) and `...13` (client): `insert into audit_events` with a
   valid `hash` succeeds; `update` / `delete` on `audit_events` fails for both.
