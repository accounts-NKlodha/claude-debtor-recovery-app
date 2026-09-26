# Deploying Debtrecover at `debtor.nklodha.in`

> **Hosting decision (2026-09-21):** Lovable cannot host this app (it runs TanStack Start on Cloudflare Workers, cannot import an
> existing Next.js repo, and does not support Nodemailer SMTP). Production target: **Vercel (Pro)** with `vercel.json` (region `syd1`),
> or the self-hosted Node server described below. Evidence and go-live checklist: [`docs/hosting-assessment/index.md`](hosting-assessment/index.md).

Target: self-hosted Next.js server behind the existing `nklodha.in` reverse proxy,
with Supabase for Postgres + Auth + Storage. This is the "web" target of the
same codebase that produces the Tauri desktop app.

**Region: `ap-southeast-2` (Sydney)**, business-accepted 2026-09-15 — India/
Mumbai (`ap-south-1`) residency is no longer a hard requirement for this
project. See the region-decision note below.

## 1. Provision

| Component | Action |
| --- | --- |
| DNS | `debtor.nklodha.in` A/AAAA → the app host (or CNAME to the portal load balancer) |
| Supabase | Create (or reuse) a project — region per the current business decision (`ap-southeast-2`/Sydney is accepted; see note below), subject to performance/security/contractual/compliance review at decision time. Note the project URL, `anon` key, `service_role` key, and the pooled `DATABASE_URL`. |
| Object storage | Use Supabase Storage buckets `evidence` (private) and `portal-artifacts` (private). No public buckets. |
| TLS | Terminate at the proxy; force HTTPS; HSTS on. |

> **Region decision — CLOSED / ACCEPTED (2026-09-15).** Historical record: the
> Gate B live-verification project (`lsuudervqofienqabmaz`) was provisioned in
> `ap-northeast-2` (Seoul); the project subsequently named "Mumbai Debtor
> recovery" (`igagfxgzlojqrkaawnzx`) was, despite its name, actually
> provisioned in `ap-southeast-2` (Sydney) — discovered live during the
> Mumbai bootstrap (`docs/MUMBAI_BOOTSTRAP.md`) and reported to the task
> owner before further work proceeded. Both deviated from the PRD §13/§14
> India-residency language and the `ap-south-1` target this document
> originally stated.
>
> **Business decision (2026-09-15): Sydney production hosting is explicitly
> accepted. India/Mumbai data residency is NOT a hard requirement for this
> project.** The current production Supabase project (`igagfxgzlojqrkaawnzx`)
> remains in `ap-southeast-2` and is production-accepted on residency
> grounds — **do not provision another Supabase project solely to satisfy
> India residency.** Region selection remains subject to performance,
> security, contractual and applicable compliance requirements (e.g. DPDP)
> at the time of any future decision — this closes the specific `ap-south-1`
> assumption, not all future region review. A project's display name is
> never evidence of its region; always confirm via `supabase projects list`
> (the `"region"` field).

## 2. Configure

Create `.env.production` (never commit) from `.env.example`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon>
SUPABASE_SERVICE_ROLE_KEY=<service_role>      # server only, only for createAdminClient() -- see §3a
DATABASE_URL=postgresql://...<region>...      # for migrations -- region per current business decision, see §1
NEXT_PUBLIC_APP_URL=https://debtor.nklodha.in
ADAPTER_PROFILE=mock                          # ignored for email in production -- see below; still gates whatsapp/gst/msme/etc.

# Email delivery. Production always uses a REAL adapter regardless of
# ADAPTER_PROFILE, and which one is chosen EXPLICITLY by EMAIL_PROVIDER (never
# inferred from the credentials present). Unset/unknown fails closed (no send),
# never falls back to a mock.
#
#   V1 PRODUCTION DECISION: EMAIL_PROVIDER=gmail-api for Lovable / Cloudflare Worker hosting.
#     gmail-api  = hosted / Worker production (Gmail REST API, OAuth scope gmail.send only)
#     gmail-smtp = local / self-hosted legacy only (never on Workers)
#     Lovable's native Gmail connector = FUTURE evaluation only, not used for V1: its send
#     contract (HTML/multipart, message id, limits) is not publicly documented and its
#     scopes may be broader than send-only. Revisit once verified in-project.
#   HOSTED / CLOUDFLARE WORKER PRODUCTION (Lovable etc.):  EMAIL_PROVIDER=gmail-api
#   Nodemailer/SMTP is NOT used for Worker deployment: Workers reject the TLS-to-IP
#   connection Nodemailer makes (verified in workerd), and SMTP is refused there.
EMAIL_PROVIDER=gmail-api
GOOGLE_CLIENT_ID=<oauth client id>
GOOGLE_CLIENT_SECRET=<oauth client secret -- secret manager only>
GOOGLE_REFRESH_TOKEN=<one-time consent, scope gmail.send -- secret manager only>
GMAIL_SENDER_EMAIL=<the Gmail/Workspace address that granted consent>
GMAIL_SENDER_NAME=N K Lodha & Co
# All GOOGLE_* / GMAIL_* values are server-only: never NEXT_PUBLIC_/VITE_, never logged, never committed.

# SELF-HOSTED NODE ONLY (legacy, docs/email-delivery/index.md): EMAIL_PROVIDER=gmail-smtp
# plus the SMTP_* variables below (Gmail SMTP + Google App Password). Not for Workers.
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=<gmail address>
SMTP_APP_PASSWORD=<google app password -- enter only in the secret manager>
SMTP_FROM_ADDRESS=<gmail address>
SMTP_FROM_NAME=N K Lodha & Co
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

### Authentication (final-UAT go-live task, 2026-09-15)

**V1 authentication is Supabase email + password.** An earlier design
targeted Google OAuth as the sign-in mechanism; it was never actually
configured for any real environment (no Google Cloud client, no Supabase
provider settings — the old text below described what OAuth setup *would*
require, not something completed) and has since been **removed from the
codebase entirely**, not merely deferred behind a flag — there is no
`/auth/google` or `/auth/callback` route, and no `signInWithOAuth` call
anywhere in `src/`. This was found and corrected during final UAT: the
sign-in page rendered only a non-functional "Continue with Google" button,
meaning no one could sign in through the browser UI in any environment.

Live-verified end-to-end during that UAT (real production Supabase project,
`igagfxgzlojqrkaawnzx`): a throwaway admin, staff, and client identity each
signed in via `src/app/actions/auth.ts#signInAction`
(`supabase.auth.signInWithPassword`), landed on the correct surface
(`/dashboard` for staff/admin, `/client` for client), and sign-out
(`signOutAction`) genuinely cleared the session (re-visiting `/dashboard`
afterward redirected back to `/sign-in`). Invalid credentials and an
unprovisioned identity both produce the same generic
"Invalid email or password." — no account-existence disclosure.

What's required to make a real staff/client identity usable in production:

1. Create the person's Supabase Auth identity (Dashboard → Authentication →
   Users → **Add user**, with **Auto Confirm User** checked — there is no
   self-serve signup flow by design, PRD access model) with a password they
   choose or a reset link you send them separately.
2. Provision matching `app_users` / `user_organisations` rows — see
   `docs/ADMIN_BOOTSTRAP.md` for the exact SQL Editor procedure (the only
   sanctioned way to write those tables; no ordinary authenticated session,
   staff or admin, can write them itself).
3. Confirm: an unauthenticated request to any internal/client route
   redirects to `/sign-in` (enforced by `src/proxy.ts`), and a signed-in
   client only ever sees their own organisation's data (enforced by RLS +
   `src/lib/auth/session.ts#resolveClientOrganisationId`) — both verified
   live during the same UAT pass.

`NEXT_PUBLIC_APP_URL` is no longer read by the application (it was only
ever used to build the OAuth redirect origin) — safe to leave set or unset;
not required for sign-in to function.

**Route-level authorization (authorization + server-action hardening task,
2026-09-17).** Authentication alone (above) only proves *someone* signed in;
it does not prove they were shown the surface for their own role. Final UAT
found a signed-in client could still navigate to and render internal
staff/admin pages (RLS blocked the underlying data, but the page itself
still rendered). This is now closed at the shared layout level — see
`docs/authorization-hardening/index.md` for the full route/action inventory,
the authorization model, and the live/browser verification evidence.

## 4. Build & run

```bash
npm ci
npm run verify           # gate: typecheck + lint + test + build
npm run build
LIVE_COMMS_CONFIRM=I-APPROVE-LIVE-SENDS NODE_ENV=production npm run start   # listens on :3000
```

`npm run start` is safe by default (scripts/safe-run.mjs blanks the Gmail/AiSensy secrets and disables WhatsApp), so
a production host that must really send email/WhatsApp has to set `LIVE_COMMS_CONFIRM=I-APPROVE-LIVE-SENDS` in its
process environment (systemd unit / pm2 ecosystem file) as a deliberate, reviewable step. Without it the app runs
but cannot send. This applies to the self-hosted Node path only; a hosted platform runs its own start command with
its own environment variables.

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

**Full disaster-recovery procedure, RPO/RTO targets, security-after-restore
verification, and Auth-recovery findings are documented in
[disaster-recovery/index.md](disaster-recovery/index.md) — this section is a
short pointer plus the headline facts.**

- On the Free plan, use manual off-site logical backups; do not assume daily
  managed backups or PITR are included. Paid backup upgrades require a separate
  cost decision. A database dump does not contain Storage object bytes.
- Repeatable tooling exists: [`scripts/backup-database.ps1`](../scripts/backup-database.ps1)
  and [`scripts/restore-database.ps1`](../scripts/restore-database.ps1) —
  both tested for real (see 6a below), not just documented.
- **Daily scheduled backup is operational** (2026-09-15): the
  `DebtorRecovery-Production-Backup` Windows Task Scheduler task
  ([`scripts/install-backup-task.ps1`](../scripts/install-backup-task.ps1) +
  [`scripts/backup-retention.ps1`](../scripts/backup-retention.ps1)) was
  registered by the operator (a deliberate human-approval step, not
  self-registered — production-credential-adjacent automation goes through
  review here) and proven by manually triggering the *registered task*
  itself through Task Scheduler: `LastTaskResult = 0`, a genuine new
  checksum-verified backup produced. Runs daily at 23:30 IST **only while
  the operator stays logged on** — see
  [disaster-recovery/index.md](disaster-recovery/index.md) §2 and §16a-§16b
  for the full detail and that limitation. **Off-site encrypted copy is
  still not configured** — see that doc's §15.
- Weekly-or-better **restore test** into a disposable environment; confirm
  one full case audit trail reconstructs (acceptance scenario 13).
- Google Drive secondary copy is allowed but is **not** the sole evidence store.

### 6a. Free-plan limitation — confirmed, and a real backup/restore now proven (2026-09-15)

Supabase's Free plan includes **no automated backups and no Point-in-Time
Recovery (PITR)** — both start at the Pro tier (Pro: 7 daily backups
included; PITR: a paid add-on on top of Pro). Production
(`igagfxgzlojqrkaawnzx`, Sydney) is on the Free plan; re-confirmed live via
`supabase backups list` during the disaster-recovery task
(`pitr_enabled: false`, `backups: []`). Until upgraded (a deliberate,
separate cost decision), the *only* backup that exists is one an operator
takes themselves.

Unlike the Gate B note below it (P0-4, 2026-09-13, project
`lsuudervqofienqabmaz`), which could not exercise this end-to-end because no
Docker daemon was available in that automated environment, the
disaster-recovery task (2026-09-15) **did** run it for real: a live backup
of production, a full restore into a disposable local Supabase stack,
integrity checks (every restored row count matched production exactly),
security-after-restore checks (12/12 pass — RLS, tenant isolation, anon
RPC/table-write denial, audit immutability all intact post-restore), and an
application recovery test (a local app instance served real, RLS-scoped
data from the restored database). See
[disaster-recovery/index.md](disaster-recovery/index.md) §7-§11 for the full
results, checksums, and exact counts.

### 6b. Manual backup procedure (two options)

**Option A — Supabase CLI, no raw DB password needed — now the recommended, tested path:**

```powershell
.\scripts\backup-database.ps1 -ProjectRef igagfxgzlojqrkaawnzx
```

Wraps two `supabase db dump --linked` calls (schema, then `--data-only` —
a single plain dump is schema-only, confirmed live) using the same
access-token session as `supabase link`/`db push` (no `--password`
prompt). **Requires Docker Desktop running locally** — the CLI runs
`pg_dump` inside a container. Verifies both output files are non-empty and
prints their SHA-256 checksums. See
[disaster-recovery/index.md](disaster-recovery/index.md) §4 for the script's
safety properties (never handles a password/token/key, refuses to back up
the wrong project).

**Option B — direct `pg_dump`, requires the database password:**

```bash
pg_dump "$DATABASE_URL" -f backup-$(date +%Y%m%d).sql --no-owner --no-privileges
```

Get `DATABASE_URL` (with password) from Supabase Dashboard → Project
Settings → Database → Connection string. Needs `pg_dump` installed locally
(matching the project's Postgres major version — 17, per this project's
`database.version`). Not the tested path (Option A was used for the real
test) — kept documented as a fallback if the Supabase CLI/Docker path is
unavailable.

**Restore**, into a **disposable** environment — never restore over a live
one:

```powershell
.\scripts\restore-database.ps1 -SchemaFile <path> -DataFile <path>
```

Restores into the local `supabase start` dev stack only (the script has no
parameter for a remote target, by design — it cannot be pointed at
production even by mistake). For restoring into a genuinely new production
project during a real incident, see the emergency sequence in
[disaster-recovery/index.md](disaster-recovery/index.md) §18. Confirm row
counts and one full case's audit trail (`audit_events` filtered by
`entity_id`) reconstruct correctly — this is acceptance scenario 13,
**now executed and passing** (2026-09-15) — see
[disaster-recovery/index.md](disaster-recovery/index.md) §9.

A database dump does **not** include Supabase Storage object bytes (invoice
scans, portal screenshots) — those need a separate `storage.objects` +
bucket-contents backup once Storage buckets are actually in use (confirmed
zero buckets exist as of 2026-09-15, not yet material — see
[disaster-recovery/index.md](disaster-recovery/index.md) §12).

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
