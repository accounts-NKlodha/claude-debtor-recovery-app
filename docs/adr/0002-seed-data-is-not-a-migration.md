# ADR 0002 — Seed/demo data is not a migration

- Status: accepted
- Date: 2026-09-13

## Context

P0-4 Gate B (first-ever live execution of the migration chain against a real
Supabase project) surfaced that `supabase/migrations/0003_seed.sql` — fixed-UUID
demo data for three fictional companies (Acme Traders, Bharat Steel Industries,
Comet Logistics LLP) — was a numbered migration file. `supabase db push`, the
command `docs/DEPLOYMENT.md`'s production runbook uses, applies every migration
file with no way to exclude one. `docs/DEPLOYMENT.md` already said "0003_seed is
demo data — run ONLY in staging, never production," but nothing in the
architecture actually enforced that: it was an instruction to remember, not a
structural guarantee. Excluding it from a push required manually moving the
file out of `supabase/migrations/` before running the command and back
afterward — exactly the kind of manual step that gets skipped under deploy
pressure.

## Decision

Seed/demo data is not a migration. It lives in `supabase/seed.sql`, declared
in `supabase/config.toml`'s `[db.seed]` section — Supabase CLI's dedicated,
separate mechanism for exactly this case:

- `supabase db reset` (local Docker dev) applies it automatically — convenient
  for local development, and inherently never touches a remote/production
  project (it resets a *local* database).
- `supabase db push --include-seed` applies it to a **linked** project —
  requires a human to explicitly type the extra flag.
- Plain `supabase db push` — the command in `docs/DEPLOYMENT.md`'s production
  runbook — **never** touches `seed.sql`. A fresh production database that
  only ever runs `supabase db push` will never receive this data, structurally,
  not by convention.

`supabase/migrations/0003_seed.sql` no longer exists; its content moved
verbatim (plus two data bugs fixed — see `supabase/seed.sql`'s header) to
`supabase/seed.sql`. Migration numbering for a fresh database is now
0001, 0002, 0004, 0005, 0006, 0007 — the gap at 0003 is harmless; `db push`
against a database with no prior history applies whatever migration files
exist in filename order, and a missing number is not an error.

## Consequences

- The **live Gate B project** (`lsuudervqofienqabmaz`) already has
  `0003_seed.sql` recorded in its migration history from before this decision
  — that history entry is left in place deliberately. Rewriting an
  already-applied migration's history on a live project is the "reckless
  rewrite" this project's conventions explicitly avoid, and the actual data
  it inserted is harmless, clearly-fictional test fixture data on a project
  that exists for Gate B verification. `supabase migration list --linked`
  against this project will show `0003` as remote-only (no matching local
  file) going forward — an expected, inert state, not an error condition;
  it does not block future migrations.
- Any **new** database (a fresh production project, or a new
  staging/pre-prod project) that runs `supabase db push` from this point
  forward never sees 0003 as a migration at all, at any step, with no manual
  exclusion required.
- Seeding a genuine staging/demo environment (not production) is still
  possible and intentional: `supabase db push --include-seed --project-ref <staging-ref>`.
- `supabase/README.md`'s RLS test plan, which references these seeded fixed
  UUIDs, is unaffected — it now points at `supabase/seed.sql` instead of a
  migration file.
