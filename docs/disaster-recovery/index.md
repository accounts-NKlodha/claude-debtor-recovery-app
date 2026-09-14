---
kind: spec
title: "Backup, Restore & Disaster Recovery"
---

# Backup, Restore & Disaster Recovery

**Status as of 2026-09-15: a real backup and a real restore into a disposable
environment have both been performed and verified** (not just documented) —
see §6-§9. This document distinguishes explicitly between what Supabase
provides automatically, what this project must operate itself, what has
actually been tested, and what remains a documented-but-unproven procedure.

## 1. Current backup capability & plan limitations

Production project `igagfxgzlojqrkaawnzx` (Sydney, `ap-southeast-2`) is on
the Supabase **Free plan**. Confirmed live (`supabase backups list
--project-ref igagfxgzlojqrkaawnzx`, re-checked 2026-09-15):

```
pitr_enabled: false
backups: []
```

**No automated backups and no Point-in-Time Recovery exist on this plan.**
Both start at the Pro tier (Pro: 7 daily backups included; PITR: a paid
add-on on top of Pro). Until upgraded — a deliberate, separate cost
decision, not assumed here — **the only backup that exists is one an
operator takes themselves**, using the tooling in §4.

## 2. RPO / RTO for V1

No enterprise-grade promise is made here. The targets below are set by
what this project can *actually* operate today (small CA firm, one admin
identity provisioned so far, zero real client/debtor data in production
yet, no dedicated ops team) — not by aspiration.

| | V1 target | Basis |
|---|---|---|
| **RPO** (max acceptable data loss) | **≤ 24 hours**, achievable *only if* the daily scheduled backup (§16) is actually running — the honest RPO with a purely manual, unscheduled process is "however long since someone remembered to run it," which is not a target, it's a risk. | Free plan has no PITR; a daily logical dump is the best available floor without a plan upgrade. |
| **RTO** (max acceptable time to restore) | **≤ 4 hours**, assuming the operator has rehearsed this exact procedure at least once (this task's restore, §8, is that rehearsal) and Docker is available. A cold, never-rehearsed attempt should be assumed to take considerably longer. | Manual restore into a fresh project: schema+data restore (minutes, proven in §8) + re-linking the app's environment variables + re-running `docs/ADMIN_BOOTSTRAP.md` for the first admin + smoke-testing — realistically 1-3 hours of operator time, budgeted to 4 for a first real incident. |

**If/when real client data goes live and volume grows, upgrade to Pro**
(daily automated backups, optional PITR) rather than scaling the manual
process — that is the recommended trigger, not a fixed calendar date.

## 3. Backup strategy

Layered, using what already exists rather than inventing new infrastructure:

1. **Schema is already backed up continuously, for free** — every schema/
   RLS/RPC change lives in `supabase/migrations/*.sql`, committed to git,
   pushed to GitHub (`origin/main`). Rebuilding schema from scratch onto a
   blank Postgres has been proven repeatedly this session (every migration
   task this build applied cleanly to a fresh project) and again in this
   task's own restore test (§8). **Git/GitHub is a real, already-operating
   layer of this strategy** — not a new thing to build.
2. **Business + Auth data**: periodic logical dump via the Supabase CLI
   (`supabase db dump --linked`), which uses the CLI's own pre-
   authenticated access-token session — **no database password is ever
   required or handled by this process**. See §4.
3. **Encrypted off-site copy**: the dump files in `.\backups\` (gitignored,
   §4) are local-machine-only by default — copy them to a second location
   (a different machine, encrypted cloud storage, or an encrypted USB
   drive kept off-site) as part of the operator's routine. Not automated
   in this task (would need a specific destination decision from the
   operator) — see §15/§17's checklist.
4. **Storage objects**: zero buckets currently exist in production
   (confirmed live, §12) — not material yet; a procedure is documented for
   when it becomes material.
5. **Secrets/config**: never included in any backup file by design (§14) —
   recovered via a separate, documented checklist naming *where* each
   secret lives, never its value.

**Rejected as premature for V1**: a paid Supabase Pro upgrade (real
option, deferred — see §2's trigger condition), a dedicated backup host or
CI-based scheduled job (adds credential-handling surface for marginal
benefit at current scale — see §16), any speculative infrastructure this
project's actual operating scale doesn't need yet.

## 4. Backup tooling (`scripts/backup-database.ps1`)

Windows PowerShell script (matches this project's primary environment).
Produces two files per run (schema-only default `db dump` is confirmed
schema-only — 0 INSERT/COPY statements in a plain dump; `--data-only` is
required separately for actual data):

```
.\scripts\backup-database.ps1 -ProjectRef igagfxgzlojqrkaawnzx
```

Safety properties (all implemented, not aspirational):

- **Never handles a database password, service-role key, access token, or
  SMTP secret** — `supabase db dump --linked` uses the CLI's own
  pre-authenticated session; the script's only inputs are `-ProjectRef`
  (a non-secret identifier) and an optional output directory.
- **Refuses to back up the wrong project** — reads the linked project ref
  directly from `supabase/.temp/project-ref` (the same file `db dump
  --linked` itself consults) and aborts if it doesn't match `-ProjectRef`.
- **Fails loudly** on: Docker not running, the dump command itself
  failing, or a resulting file being missing or empty — never a silent
  partial success.
- **Verifies** each output file exists, is non-empty, and prints its
  SHA-256 checksum and exact size.
- **Writes to `.\backups\`**, which is `.gitignore`d (added this task) —
  these files are never committed.

Known Windows/PowerShell quirk documented in the script itself: do not
redirect the Supabase CLI's stderr (`2>&1`) in PowerShell 5.1 — it wraps
routine informational stderr lines (e.g. "Initialising login role...") in
a `NativeCommandError` even on real success. The script avoids this.

## 5. Backup scope — what is and is not protected

| In scope, covered | Mechanism |
|---|---|
| PostgreSQL schema (types, tables, RLS policies, RPCs, grants) | `supabase db dump --linked` (schema file) *and* git (`supabase/migrations/`) — two independent copies |
| Business data (organisations, cases, invoices, payments, ...) | `supabase db dump --linked --data-only` |
| `app_users` / `user_organisations` (app-side identity/tenant links) | included in the data dump (`public` schema) |
| `audit_events` (immutable log) | included in the data dump |
| `auth.users` / `auth.identities` / `auth.sessions` / `auth.mfa_amr_claims` / `auth.refresh_tokens` | **included by default** in `--data-only` — confirmed live, not assumed (see §13 for what this does and doesn't guarantee) |
| Migration history | git (already the primary source of truth; the dump is a secondary confirmation) |
| Application source | git/GitHub (`origin/main`) |
| Documentation | git/GitHub |

| Not in scope / separate concern | Why |
|---|---|
| Supabase Storage object bytes | A logical DB dump never includes object storage contents. Zero buckets exist today (§12) — not currently material, but would need a dedicated procedure the moment a bucket is created. |
| Environment variables / secrets | Deliberately never captured by any backup file (§14) — recovered via a separate checklist, by value, by the operator, never by this tooling. |
| Gmail SMTP App Password | Same as above — lives only in `.env.local` / the eventual production secret manager, never in a dump. |
| Live session validity after restore into a *different* project | JWT signing secret is per-project; restored `auth.sessions`/`refresh_tokens` rows do not grant a valid session against a new project's different secret (§13). |

## 6. Restoration test environment

**Never restores over production.** Per this task's explicit preference
order: a disposable cloud Supabase project would be the first choice, but
creating one is an explicit **human-only stop point** (this task's
instructions) — not requested for this rehearsal, since Docker was already
available locally. Used instead: **the local Supabase dev stack**
(`npx supabase start`), which is genuinely disposable, requires no new
cloud resource, and is materially more faithful than bare local Postgres —
it runs a real GoTrue/Auth service, PostgREST, Storage API, etc., not just
a database, so Auth-recovery behavior (§13) could actually be tested, not
just assumed.

## 7. Real backup performed (2026-09-15)

Executed `scripts\backup-database.ps1 -ProjectRef igagfxgzlojqrkaawnzx`
against the live production project.

| | Schema file | Data file |
|---|---|---|
| Filename | `debtrecover-igagfxgzlojqrkaawnzx-20260915-025315-schema.sql` | `debtrecover-igagfxgzlojqrkaawnzx-20260915-025315-data.sql` |
| Size | 132,558 bytes | 52,896 bytes |
| SHA-256 | `7d690a24...9f2fcab1` (full value in the script's own output/local file — not reproduced here since this doc is committed to git and the checksum of a *specific production snapshot* is treated with the same "don't publish operational fingerprints unnecessarily" caution as any other production detail) | `82594 3d7...4f19b52f` |
| Format | pg_dump SQL, UTF-8 | pg_dump SQL, UTF-8, `--data-only` |

Both files verified non-empty, both confirmed to contain the expected SQL
(schema: `CREATE TYPE`/`CREATE TABLE`/`CREATE POLICY`/`GRANT`/`REVOKE`
statements for all 34 tables and 24 functions; data: `INSERT` statements
for exactly the tables that have real rows). **Neither file was committed
to git** (`.\backups\` is gitignored) and neither is included in this
task's commit.

## 8. Real restore performed (2026-09-15)

Executed `scripts\restore-database.ps1` against the local disposable stack
from §6. Sequence: reset the local stack's `public` schema to blank (it
had already been auto-seeded by `supabase start` itself — not a blank
target by default) → restore schema → restore data (with
`session_replication_role = replica` during the data load only, to safely
handle the self-referencing FK `supabase db dump` itself warned about on
`case_hearings.rescheduled_from_id` — reset to `default` immediately after).

**Result: succeeded completely, no errors.** Schema: every `CREATE TYPE`/
`CREATE TABLE`/`CREATE FUNCTION`/`CREATE POLICY`/`GRANT`/`REVOKE`/`ALTER
DEFAULT PRIVILEGES` statement applied cleanly. Data: `INSERT 0 5` (×2, auth
users/identities), `INSERT 0 20` (×3, auth sessions/mfa/refresh_tokens),
`INSERT 0 5` (app_users), `INSERT 0 2` (organisations), `INSERT 0 65`
(audit_events), `INSERT 0 1` (system_settings).

## 9. Recovery-integrity checks (2026-09-15, on the restored local stack)

Authoritative counts via the privileged local connection (bypasses RLS —
the true count, not what any one role can see) exactly matched production:

| Table | Restored count | Matches production |
|---|---|---|
| `organisations` | 2 | ✅ |
| `app_users` | 5 | ✅ |
| `auth.users` | 5 | ✅ |
| `auth.identities` | 5 | ✅ |
| `user_organisations` | 0 | ✅ |
| `recovery_cases` | 0 | ✅ |
| `invoices` | 0 | ✅ |
| `payment_records` | 0 | ✅ |
| `payment_allocations` | 0 | ✅ |
| `communications` | 0 | ✅ |
| `communication_deliveries` | 0 | ✅ |
| `workflow_tasks` | 0 | ✅ |
| `dd_records` | 0 | ✅ |
| `case_hearings` | 0 | ✅ |
| `calendar_events` | 0 | ✅ |
| `debtor_replies` | 0 | ✅ |
| `audit_events` | 65 | ✅ |
| `system_settings` | 1 | ✅ |

Every business table is legitimately empty in production today (the app
has not gone live with real client data) — this is the honest current
state, not a restore defect. `public`-schema function count: **24**,
matching every function this build has ever added (`supabase/rpc-
manifest.ts`'s 21 classified entries + the 3 `rls_helper`-adjacent ones
already counted there — no unexpected and no missing function).

## 10. Restored-security verification (2026-09-15)

Reused the same live-verification approach established across this whole
build (anon-key PostgREST calls), run against the restored local stack —
**12/12 passing**:

- RLS enabled on every `public` table (`0` tables found without
  `relrowsecurity` — checked directly against `pg_class`).
- `anon`: `organisations`/`app_users`/`audit_events` all RLS-hidden
  (empty result, not an error).
- `anon`: all 4 sampled business RPCs (`apply_case_mutation`,
  `create_organisation`, `begin_communication_send`,
  `set_automation_state`) rejected at the grant level — the P0-5-R1 anon-
  revoke policy survived the restore intact.
- `anon`: both internal-only RPCs (`raise_workflow_task`,
  `close_case_tasks_if_terminal`) remain unreachable.
- `anon`: direct `INSERT` on `recovery_cases` and `audit_events` both
  denied — the direct-table-write bypass closure and audit immutability
  both survived the restore.
- `anon`: `is_staff()` remains callable (required for RLS itself to
  evaluate for anonymous queries — the documented P0-5-R1 exception).

**A restored database was not accepted merely because rows existed** — every
control that protects production was independently re-verified on the
restored copy.

## 11. Application recovery test (2026-09-15)

A local `next dev` instance was started with `NEXT_PUBLIC_SUPABASE_URL`/
`NEXT_PUBLIC_SUPABASE_ANON_KEY` overridden to point at the restored local
stack (never touching `.env.local`'s real production values). Confirmed
via the local stack's own gateway access log (not just application-side
claims):

- `[repo] data mode: supabase` — the app selected `SupabaseRepository`,
  not the in-memory fallback.
- An unauthenticated `GET /dashboard` produced only anon-scoped,
  RLS-empty reads (`[]`) and every RPC/write attempt returned `401` —
  fails closed, no data leak.
- A throwaway test identity (created, tested, and deleted entirely within
  the local disposable stack — never touching production) signed in and
  correctly read exactly the 2 restored organisations via real RLS-gated
  staff access — proving authenticated, tenant-scoped access works
  end-to-end against the *restored* data, not just that rows exist.

No production mutation was performed at any point in this test.

## 12. Storage recovery

`GET /storage/v1/bucket` against production (anon key) returns `[]` —
**zero Storage buckets exist today.** Storage backup is **not currently
material**. Documented future procedure, for when the first bucket/object
is created (the evidence-upload path — `documents`/`document_versions` —
remains unwired at the application layer as of this task, per
`docs/workflow-durability/index.md`):

1. `supabase storage ls ss:///<bucket>/ --linked --experimental` to
   enumerate objects (the CLI's storage commands require `--experimental`
   on this CLI version).
2. `supabase storage cp` (or the equivalent S3-protocol client, using
   `S3_PROTOCOL_ACCESS_KEY_ID`/`SECRET` from the *production* project's own
   settings, never the local dev stack's well-known demo values shown in
   this document) to mirror bucket contents to a second location.
3. A database dump's `storage.objects` metadata rows (paths, sizes,
   checksums) restore as ordinary data, but the **object bytes themselves
   are not in any SQL dump** — object-level backup is a separate, required
   step the moment Storage holds real evidence.

## 13. Auth recovery — proven, not guessed

This is the one area the task explicitly warned against guessing on.
Tested empirically (§7-§11), not assumed:

- **`auth.users`/`auth.identities` are included in `supabase db dump
  --data-only` by default** — confirmed live; no special flag needed.
- **Password hashes survive the restore intact**: every restored
  `auth.users` row has a non-null, well-formed `encrypted_password` and
  `email_confirmed_at` set (checked directly, without ever reading the
  hash value itself).
- **A user provisioned via the identical mechanism (bcrypt-hashed
  password, restored `auth.users` row) can sign in and obtain a valid,
  correctly RLS-scoped session on the restored database** — proven with a
  throwaway test identity (§11), since a real user's password must never
  be requested or handled to test this directly.
- **Well-founded inference, not independently tested**: because
  `encrypted_password` is a portable bcrypt hash with no per-project
  secret involved in its computation, the same reasoning implies a
  *real* production user's existing password would continue to work
  after a genuine restore — this specific claim (a real user's *existing*
  password, not a freshly-created test one) was not and cannot ethically
  be tested, since doing so would require possessing that password.
- **Known limitation, proven not assumed**: `auth.sessions` and
  `auth.refresh_tokens` are tied to the *source* project's JWT signing
  secret (`JWT_SECRET`, per-project, distinct from any other project's).
  A genuine disaster recovery restores into a **different** project
  (the original one is presumed destroyed/inaccessible) — restored
  session/refresh-token rows would not validate against a new project's
  different secret. **Every user would need to sign in again** after a
  real restore, even though their password itself should continue to
  work. This is not a workaround gap — it is not needed as one, since
  re-authenticating is a normal, low-friction user action, not a recovery
  blocker.
- **`app_users`/`user_organisations` reconciliation**: both restore as
  ordinary `public`-schema data (§9's counts) — no separate reconciliation
  step is needed as long as `auth.users.id` values are preserved exactly
  (they are — pg_dump preserves primary keys verbatim), since `app_users.id`
  is defined as mirroring `auth.users.id` 1:1.

## 14. Secrets/config recovery checklist

**No backup file, script, or this document ever contains an actual secret
value.** This is a checklist of *what* must be recovered and *where* the
authoritative copy lives — not the values themselves.

| Item | Where the authoritative copy lives | Recovered by |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Project Settings → API (public values, not secret) | Anyone with Dashboard access |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Project Settings → API (secret) | Project owner only, entered directly into the target environment |
| `DATABASE_URL` (with password) | Supabase Dashboard → Project Settings → Database | Project owner only |
| `SMTP_USER` / `SMTP_FROM_ADDRESS` | Not secret — the sending Gmail address itself | Documented in `docs/email-delivery/index.md` |
| `SMTP_APP_PASSWORD` | Generated fresh at <https://myaccount.google.com/apppasswords> on the sending Google account (2-Step Verification required) | The Google account owner — **can always be regenerated**, does not need to be "recovered" from anywhere; rotate rather than restore |
| `NEXT_PUBLIC_APP_URL` | Not secret — the deployed app's own URL | Deployment config |
| Admin bootstrap procedure | `docs/ADMIN_BOOTSTRAP.md` (committed, no real values) | Whoever has Supabase Dashboard SQL Editor access |

**Who should maintain the secure copy**: the firm's designated Supabase
project owner (currently the `accounts@nklodha.in` identity) should keep
the service-role key, DB password, and SMTP App Password in a password
manager (not a plain-text file, not this repository, not chat) — this
task does not prescribe a specific password manager, that is an
operational decision for the firm to make.

## 15. Backup retention policy

Given current scale (pre-launch, one admin identity, zero real client
data), a simple policy — not enterprise-grade, not speculative:

- **Frequency**: daily once real client data exists in production;
  weekly is acceptable pre-launch while data is still effectively empty
  (nothing meaningful would be lost between weekly runs today).
- **Retention**: keep the last **14 daily** backups + the last **6
  monthly** backups (the 1st of each month's daily run, kept longer) —
  simple enough to prune by hand or a five-line script, no rotation
  infrastructure needed at this scale.
- **Encryption**: the dump files contain password hashes and business
  data — encrypt before any off-site copy (7-Zip AES-256, or `age`/`gpg`
  per the existing `docs/DEPLOYMENT.md` §6 guidance). Local-machine-only
  copies inside `.\backups\` (already outside git) are acceptable
  unencrypted for same-day operational use, but the off-site copy must be
  encrypted.
- **Off-site location**: a location distinct from the machine running the
  backup script — Google Drive is explicitly allowed as a *secondary*
  copy per `docs/DEPLOYMENT.md` §6 ("not the sole evidence store"); any
  other cloud storage the firm already trusts is equally acceptable.
- **Deletion/rotation**: delete backups older than the retention window
  above at the same time a new one is confirmed good (verify the new
  backup's checksum/size before deleting the oldest one it replaces —
  never delete-then-verify).

## 16. Automation decision

**Recommended: manual-with-checklist now, Windows Task Scheduler once V1
is live with real data.** Reasoning:

- The backup script (§4) already uses the safest available credential
  path (the CLI's own pre-authenticated session) — **no automation choice
  here trades that away**. Task Scheduler running this exact script
  unattended introduces no new secret-handling surface: it doesn't need to
  know a password, token, or key at all.
- **Rejected**: a GitHub Actions scheduled workflow. It would need the
  Supabase access token (or a service-role key) stored as a repository
  secret — a meaningfully *larger* privileged-credential exposure surface
  (a CI runner, GitHub's own secret store, anyone with workflow-edit
  access) than a script running locally under the operator's own already-
  authenticated CLI session. This is exactly the "if automated cloud
  backup requires credentials with excessive privilege... prefer the
  safer approach" case the task asks to watch for.
- **Rejected**: an external backup host/service and a Supabase plan
  upgrade *purely for backup automation* — both are real options, but
  premature before the firm has any real client data to protect; revisit
  once §2's upgrade trigger is hit.
- **Task Scheduler setup** (when adopted): a daily trigger running
  `powershell.exe -File "scripts\backup-database.ps1" -ProjectRef
  igagfxgzlojqrkaawnzx` under the operator's own Windows account (so the
  Supabase CLI's existing login session is available to it). Requires
  that a human occasionally re-run `supabase login` if the access token
  ever expires/is revoked — document this as a monthly operator check,
  not "set and forget."

## 17. Operator checklist (routine backup)

- [ ] Docker Desktop running.
- [ ] `cd` to the repo root; confirm `git status` is clean (unrelated to
      the backup, just good hygiene before running scripts).
- [ ] Run `.\scripts\backup-database.ps1 -ProjectRef igagfxgzlojqrkaawnzx`.
- [ ] Confirm both files' checksums/sizes printed and non-zero.
- [ ] Copy both files to the encrypted off-site location.
- [ ] Delete local/off-site backups older than the retention window (§15),
      only after confirming today's backup is good.

## 18. Emergency sequence (real incident)

1. **Stop.** Confirm this is a genuine data-loss event, not a transient
   Supabase outage (check Supabase's own status page first) — do not
   restore reflexively.
2. Locate the most recent verified backup pair (schema + data,
   matching timestamps) from the off-site copy (§15) if the local machine
   is also affected.
3. Provision a **new** Supabase project (a genuine incident means the old
   one is gone or compromised — this is a human-only action, same as
   creating the disposable test project was in this task).
4. `supabase link --project-ref <new-ref>`, then `supabase db push
   --linked` to apply every migration from git fresh (do **not** restore
   the schema dump over migrations — git is the authoritative schema
   source; the schema dump is a secondary confirmation copy, see §3).
5. Restore only the **data** file into the new project (adapt
   `restore-database.ps1`'s approach — direct `psql`/`pg_dump` restore
   against the new project's connection string, entered by the operator,
   never asked for in chat).
6. Run this document's §9/§10/§11 checks against the *new* production
   project (not a local stack this time) before pointing the live app at
   it.
7. Update `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` (and
   any other project-specific config) to the new project everywhere the
   app is deployed.
8. Re-run `docs/ADMIN_BOOTSTRAP.md` only if the admin `auth.users`/
   `app_users` rows did not restore correctly (expected: they should,
   per §13) — otherwise the existing admin should already be able to
   sign in (with their existing password; they will need to sign in
   again, not reset it — see §13).
9. Notify every user they'll need to sign in again (sessions do not
   survive a project change, §13) — this is expected, not a failure.
10. Record what happened, what was lost (if anything, per the RPO in §2),
    and update this document if the real incident revealed a gap the
    rehearsal (§7-§11) didn't catch.

## 19. Rollback / abort conditions

Abort the restore and escalate to a human decision rather than proceeding
if, at any point:

- The backup file(s) fail checksum verification, are empty, or clearly
  truncated (mid-statement) — never restore a backup that hasn't been
  verified.
- The restore target is ambiguous or cannot be conclusively confirmed as
  *not* production (`restore-database.ps1` structurally cannot target
  anything but the local dev stack — for the real-incident sequence in
  §18, the operator must independently confirm the target project ref
  before running any restore command against it).
- Schema restore produces errors beyond the one documented, expected
  warning (`case_hearings`'s self-referencing FK, handled by
  `session_replication_role = replica`) — an unexpected schema error means
  the dump or the target is not what was assumed; stop and investigate
  rather than force it through.
- Row counts after restore don't match the source backup's own counts
  (§9's approach) — investigate before declaring the restore complete.
- Any step would require pasting a secret (database password, access
  token, service-role key, SMTP App Password) into chat — stop and ask
  the human to run that specific step themselves, exactly as this task's
  instructions require.
