# Deploying Debtrecover at `debtor.nklodha.in`

Target: self-hosted Next.js server behind the existing `nklodha.in` reverse proxy,
with Supabase (Mumbai `ap-south-1`) for Postgres + Auth + Storage. This is the
"web" target of the same codebase that produces the Tauri desktop app.

## 1. Provision

| Component | Action |
| --- | --- |
| DNS | `debtor.nklodha.in` A/AAAA → the app host (or CNAME to the portal load balancer) |
| Supabase | Create project in **`ap-south-1`**. Note the project URL, `anon` key, `service_role` key, and the pooled `DATABASE_URL`. |
| Object storage | Use Supabase Storage buckets `evidence` (private) and `portal-artifacts` (private). No public buckets. |
| TLS | Terminate at the proxy; force HTTPS; HSTS on. |

> **P0-4 Gate B region note:** the live project used for Gate B live-verification
> (`lsuudervqofienqabmaz`) was provisioned in **`ap-northeast-2` (Seoul)**, not
> `ap-south-1` (Mumbai). This was the region already selected when the project
> was created for this task; per the task's own instruction, **no region
> migration was performed during Gate B** (that's a separate, deliberate
> operation — Supabase has no in-place region migration, only
> dump-and-restore into a new `ap-south-1` project). This is a genuine
> deviation from the PRD §13/§14 India-residency requirement and the
> `ap-south-1` target above, and is **not resolved** by anything in this
> document. Before real client data goes live: either provision a fresh
> `ap-south-1` project and restore into it (see §6b's dump/restore
> procedure), or get an explicit decision that Seoul is acceptable
> (it very likely is not, given the residency requirement) — do not treat
> the Gate B project as production-ready as-is on residency grounds alone.

## 2. Configure

Create `.env.production` (never commit) from `.env.example`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon>
SUPABASE_SERVICE_ROLE_KEY=<service_role>      # server only, only for createAdminClient() -- see §3a
DATABASE_URL=postgresql://...ap-south-1...    # for migrations
NEXT_PUBLIC_APP_URL=https://debtor.nklodha.in
ADAPTER_PROFILE=mock                          # switch to "live" once providers are provisioned
```

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are the only two
variables the production data layer requires (see §3a) — both are `NEXT_PUBLIC_*`
and therefore bundled into client JS by design (the anon key is meant to be public;
RLS is what makes that safe). `SUPABASE_SERVICE_ROLE_KEY` is **not** a production
data-layer requirement: it backs `createAdminClient()` only
(`src/lib/supabase/server.ts`), which no ordinary staff/client request path calls
(confirmed by `src/app/actions/security.test.ts`'s regression guard) — set it only
if/when a genuinely admin-only, RLS-bypassing job is added, and never let it
reach `NEXT_PUBLIC_*`.

## 3. Database

Recommended: `supabase link --project-ref <ref>` then `supabase db push`
(applies every file in `supabase/migrations/` in order; **never** touches
`supabase/seed.sql` — see §3b). Equivalent via psql:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0001_init.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0002_rls.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0004_tenant_consistency.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0005_privileged_audit_writer.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0006_production_write_rpcs.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0007_gate_b_hardening.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0010_gate_b_digest_schema_fix.sql
# Never against production: supabase/seed.sql (demo/test fixtures only -- see §3b)
```

Apply in this exact numeric order — later migrations reference functions/tables
the earlier ones create (`0006` calls `record_audit_event` from `0005`; `0004`'s
composite foreign keys assume `0001`'s tables exist as originally shaped).

**Live-verified (P0-4 Gate B, 2026-09-13):** this exact chain (0001, 0002, 0004,
0005, 0006, 0007) applies cleanly via `supabase db push` against a real
Supabase project (`lsuudervqofienqabmaz`) — not merely type-checked. Two data
bugs in what was then `0003_seed.sql` were found and fixed during that first
live execution (see `supabase/seed.sql`'s header and
`docs/adr/0002-seed-data-is-not-a-migration.md`).

Verify RLS with the plan in `supabase/README.md` (acceptance scenario 12: a client
identity cannot read another organisation's rows).

### 3b. Seed/demo data is opt-in, never automatic (P0-4 Gate B)

`supabase/seed.sql` (fixed-UUID demo data for three fictional companies) is
**not** a migration — plain `supabase db push` never applies it. It only runs
via `supabase db reset` (local Docker dev) or the explicit
`supabase db push --include-seed` flag. A fresh production database that only
ever runs plain `db push`, per this section, never receives it. See
`docs/adr/0002-seed-data-is-not-a-migration.md` for the full rationale (this
used to be `migrations/0003_seed.sql`, a real migration file with no
structural way to exclude it — found and fixed during Gate B).

### 3c. First-admin bootstrap is a documented manual step, not a migration

There is no automated path from "empty `app_users` table" to "first admin" —
by design. `0007_gate_b_hardening.sql` restricts `app_users` writes to
existing admins only (closing a staff-self-escalation hole found live during
Gate B), which means the very first admin cannot be created through the app
or through RLS-governed access at all. See `docs/ADMIN_BOOTSTRAP.md` for the
exact, human-executed, one-time procedure. Do not encode this in a migration
file — a migration replays automatically on every fresh database and would
either hardcode a real person's identity into permanent schema history or
have to guess who the first admin should be, neither of which is acceptable.

### 3a. Production data-layer invariant (P0-4)

`src/server/repo.ts#getRepo()` enforces: **production either uses a correctly
configured `SupabaseRepository`, or throws** — `NODE_ENV=production` is never, by
itself, enough to select `MemoryRepository`, there is no fallback from a failed
Supabase configuration check or a failed Supabase client initialization back to
memory, and an explicit `DATA_PROFILE=memory` override (a non-production
convenience for local smoke tests) is ignored entirely in production. Configuration
is validated by `src/lib/config/production.ts#getProductionDataConfig()`, which
also rejects a malformed URL and a service-role key accidentally placed in the
`NEXT_PUBLIC_SUPABASE_ANON_KEY` slot (that variable is bundled into client JS).
None of this can be tested against real Supabase infrastructure in this
environment — regression tests for the fail-closed logic itself live in
`src/server/repo.test.ts` and `src/lib/config/production.test.ts`.

Every `Repository` mutation method is implemented in `SupabaseRepository`
(`src/server/repositories/supabase.ts`) against the RPCs in
`0006_production_write_rpcs.sql` — no method returns fake/default success or
silently no-ops; an RPC failure surfaces as a rejected promise. See the P0-4 audit
report (session history) for the full method-by-method parity matrix and the
transaction/atomicity classification of each multi-table write. **Not yet
verified**: any of this actually executing against a live Supabase project, real
RLS enforcement against real JWTs, or concurrency behavior under real load — these
remain go-live gates, not something code compiling or unit tests passing can prove.

### Authentication (P0-1/P0-2 foundation)

Code-side (`src/lib/auth/`, `src/proxy.ts`) is complete and unit-tested
(`src/lib/auth/context.test.ts`) without needing a live project. What's still
required before staff/client sign-in actually works in production:

1. In Supabase Auth URL configuration, set Site URL to
   `https://debtor.nklodha.in` and allow the exact app callback
   `https://debtor.nklodha.in/auth/callback`.
2. In Google Cloud, create a Web application OAuth client. Its authorized
   redirect URI is `https://<project-ref>.supabase.co/auth/v1/callback`
   (copy the exact value from Supabase), **not the app callback above**.
   Configure only the OpenID, email and profile scopes required for sign-in.
   Put the Google client ID/secret in Supabase's Google provider settings,
   never in app public environment variables.
3. Code now implements the sign-in POST and PKCE callback exchange. Set
   `NEXT_PUBLIC_APP_URL` to the trusted HTTPS app origin. Sign-in rejects
   cross-origin POSTs; callbacks ignore forwarded host headers and reject
   external return destinations. Unprovisioned identities are signed out;
   clients land at `/client`, staff/admin at `/dashboard`. Google configuration
   and a real browser sign-in still require live verification.
4. Provision real `app_users` / `user_organisations` rows for every staff
   member and client contact (there is no self-serve signup flow by design —
   PRD access model).
5. Once (1)-(4) exist, set `NODE_ENV=production` and confirm: an
   unauthenticated request to any internal/client route redirects to
   `/sign-in` (enforced today by `src/proxy.ts`), and a signed-in client
   only ever sees their own organisation's data (enforced by RLS + 
   `src/lib/auth/session.ts#resolveClientOrganisationId`).

## 4. Build & run

```bash
npm ci
npm run verify           # gate: typecheck + lint + test + build
npm run build
NODE_ENV=production npm run start   # listens on :3000
```

Run under a process manager (systemd/pm2). Proxy `debtor.nklodha.in` → `127.0.0.1:3000`,
forwarding `X-Forwarded-Proto` and the real client IP.

### Reverse proxy (nginx sketch)

```nginx
server {
  server_name debtor.nklodha.in;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
  }
  client_max_body_size 25m;   # invoice PDFs / scans
}
```

## 5. Background work

The workflow scheduler (11:00 IST sends, 24h/7d timers, task escalation) needs a
durable runner. MVP ships an in-process interface; for production back it with
`pg-boss` on the same Postgres (`DATABASE_URL`) or a small worker process running
`node scripts/worker.mjs` (to be added in M3). It must run in a single instance or
with advisory-lock leader election to preserve idempotency invariants.

## 6. Backups (PRD §13)

- On the Free plan, use manual off-site logical backups; do not assume daily
  managed backups or PITR are included. Paid backup upgrades require a separate
  cost decision. A database dump does not contain Storage object bytes.
- Nightly `pg_dump` (encrypted, age/gpg) to a second India-region bucket.
- Weekly **restore test** into a scratch project; confirm one full case audit
  trail reconstructs (acceptance scenario 13).
- Google Drive secondary copy is allowed but is **not** the sole evidence store.

### 6a. Free-plan limitation, confirmed (P0-4 Gate B, 2026-09-13)

Supabase's Free plan includes **no automated backups and no Point-in-Time
Recovery (PITR)** — both start at the Pro tier (Pro: 7 daily backups
included; PITR: a paid add-on on top of Pro). This project
(`lsuudervqofienqabmaz`) is on the Free plan; per this task's explicit
instruction, the plan was **not** upgraded to test this. Until upgraded (a
deliberate, separate cost decision — see the go-live gates below), the
*only* backup that exists is one you take yourself.

### 6b. Manual backup procedure (two options)

**Option A — Supabase CLI, no raw DB password needed:**

```bash
supabase db dump --linked -f backup-$(date +%Y%m%d).sql
```

Uses the same access-token session as `supabase link`/`db push` (no
`--password` prompt). **Requires Docker Desktop running locally** — the CLI
runs `pg_dump` inside a container. This was not runnable in the automated
Gate B environment (no Docker daemon available there); this exact command
was not executed end-to-end during Gate B for that reason, not because of
any credential restriction — run it yourself wherever Docker is available
to actually validate the dump.

**Option B — direct `pg_dump`, requires the database password:**

```bash
pg_dump "$DATABASE_URL" -f backup-$(date +%Y%m%d).sql --no-owner --no-privileges
```

Get `DATABASE_URL` (with password) from Supabase Dashboard → Project
Settings → Database → Connection string. Needs `pg_dump` installed locally
(matching the project's Postgres major version — 17, per this project's
`database.version`).

**Restore test** (either option's output), into a **scratch** project —
never restore over a live one to "test":

```bash
psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f backup-YYYYMMDD.sql
```

Then confirm row counts and one full case's audit trail
(`audit_events` filtered by `entity_id`) reconstruct correctly — this is
acceptance scenario 13. **Not executed in Gate B** (would require
provisioning a second scratch project); documented here as the exact
procedure to run before go-live, not claimed as verified.

A database dump does **not** include Supabase Storage object bytes (invoice
scans, portal screenshots) — those need a separate `storage.objects` +
bucket-contents backup once Storage buckets are actually in use (not yet,
per this build's scope).

## 7. Go-live gates (do not skip)

- [ ] Counsel sign-off: retention period + legal-hold procedure, DPDP notice &
      deletion workflow, GST/MSME browser-automation position, debtor profiling.
- [ ] Real provider adapters implemented + credentials vaulted (envelope
      encryption, JIT lease, rotation, revocation, audit) — then `ADAPTER_PROFILE=live`.
- [ ] Staff Google allow-list configured; client OTP provider wired (no OTP stored).
- [ ] Security review (`security-and-hardening`) on auth, PII, external APIs.
- [ ] Admin-only pilot with synthetic/redacted cases; manual fallback verified at
      every step; kill switch tested.

## 8. Desktop distribution

`npm run desktop:build` produces installers under
`src-tauri/target/release/bundle/`. Sign them (Windows: code-signing cert; macOS:
notarize) before distributing to staff. The desktop app points at
`https://debtor.nklodha.in` — deploy the web target first.

## Gate B execution status

See [SUPABASE_GATE_B.md](SUPABASE_GATE_B.md) for the current evidence and
remaining gates. No live verification should be inferred from a successful build.

Official configuration references:
- https://supabase.com/docs/guides/auth/social-login/auth-google
- https://supabase.com/docs/guides/platform/backups
