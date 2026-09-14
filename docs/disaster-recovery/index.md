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

**Update (2026-09-15, backup-automation task): the daily scheduled backup is
now operational.** The `DebtorRecovery-Production-Backup` Task Scheduler
task was registered by the operator, then verified and **manually triggered
through Task Scheduler itself** (not by running the script directly) — it
produced a genuinely fresh, checksum-verified production backup and
finished with Task Scheduler's own `LastTaskResult = 0` (success). See §16a
for full detail and the one real, documented limitation: this task only
runs while the registering Windows user (`NKLODHALAPTOP6\lovel`) is logged
on — see §2 for what this means for effective RPO. **Off-site encrypted
copy is still not configured** — see §15.

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
| **RPO** (max acceptable data loss) | **Operational target: ≤ 24 hours, subject to successful daily task execution.** The `DebtorRecovery-Production-Backup` scheduled task (§16a) is registered and its mechanism proven (a manually-triggered scheduled run produced a genuine, verified backup with Task Scheduler reporting success). **One real caveat, not hypothetical**: the task is configured to run only while `NKLODHALAPTOP6\lovel` is logged on (Interactive logon type, by deliberate design — see §16a for why). **A fully logged-off laptop at 23:30 will not run that day's backup.** `StartWhenAvailable` is enabled, which — per Task Scheduler's documented behavior — means a missed run is started at the next opportunity the trigger's conditions are met (e.g. shortly after the next logon) rather than skipped outright; this session did not (and could not, within one sitting) empirically reproduce a real missed-then-recovered run, so treat this as the documented behavior of a verified setting, not as separately proven. Effective RPO is therefore ≤24h **on days the operator's machine stays logged in through 23:30**, and otherwise however long the machine stays logged off. | Free plan has no PITR; a daily logical dump is the best available floor without a plan upgrade. |
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
- **Retention**: keep the last **14 daily** backups automatically, via
  `scripts/backup-retention.ps1` (run as the second action of the
  scheduled task, §16a) — implemented and tested (2026-09-15: pruned an
  isolated 16-set scratch directory down to exactly the newest 14; refused
  to run rather than prune a single remaining set to zero when misconfigured
  with `-KeepCount 0`). It only ever prunes a **complete, checksum-verified**
  set (schema + data + `.sha256`, and the files' actual hashes matching what
  the `.sha256` records), and only once at least one newer valid set already
  exists — an incomplete or checksum-mismatched set is left in place and
  excluded from the retained-count, never silently deleted.
- **Monthly preservation is a manual procedure, not automated logic** — kept
  simple deliberately, per this task's own guidance to prefer a documented
  manual step over fragile auto-detection: on or after the 1st of each
  month, copy that day's verified backup set (all three files —
  `*-schema.sql`, `*-data.sql`, `*.sha256`) into `backups\monthly-archive\`
  (create it if absent; it is covered by the same `/backups/` `.gitignore`
  entry). Keep the last **6** monthly-archive sets; delete older ones by
  hand. This directory is intentionally outside the daily-retention script's
  scope, so daily pruning can never touch a monthly archive copy.
- **Encryption**: the dump files contain password hashes and business
  data — encrypt before any off-site copy (7-Zip AES-256, or `age`/`gpg`
  per the existing `docs/DEPLOYMENT.md` §6 guidance). Local-machine-only
  copies inside `.\backups\` (already outside git) are acceptable
  unencrypted for same-day operational use, but the off-site copy must be
  encrypted.
- **Off-site location — not yet configured, human action required.**
  Checked this machine (2026-09-15) for any existing off-site sync tooling
  (`rclone`, `azcopy`, `aws` CLI, `gdrive`, `rsync`, `7z`) — **none are
  installed**. Per this task's explicit instruction, no destination or tool
  has been invented or assumed. What *is* ready: `.\backups\` is
  deterministic, gitignored, and every complete set carries its own
  `.sha256` for verification after any copy — so whatever destination is
  chosen, copying and verifying it is a simple, safe operation once the
  operator picks one. Acceptable destination properties (per this task):
  encrypted, separate from the production Supabase project, not GitHub, not
  inside this repository, access restricted to appropriate firm personnel —
  Google Drive was already named as an acceptable *secondary* copy in
  `docs/DEPLOYMENT.md` §6, but no account/folder has actually been
  configured or verified working. **This remains an explicit, open
  operator task** — see §21 (Failure visibility) and the final report's
  off-site status.
- **Deletion/rotation**: delete backups older than the retention window
  above at the same time a new one is confirmed good (verify the new
  backup's checksum/size before deleting the oldest one it replaces —
  never delete-then-verify) — this is exactly what `backup-retention.ps1`
  does.

## 16. Automation decision

**Windows Task Scheduler, running the existing backup script as the current
Windows user.** Reasoning:

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
- **Rejected**: running the task as `SYSTEM`, or in "run whether user is
  logged on or not" mode. Both were considered and rejected — see §16a.

### 16a. Authentication audit & unattended-execution hardening (2026-09-15)

**How the backup script authenticates**: confirmed live via `cmdkey /list`
that the Supabase CLI's access-token session is stored in Windows
Credential Manager under `LegacyGeneric:target=Supabase CLI:supabase`,
scoped to the Windows user who ran `supabase login` (on this machine:
`lovel`). `supabase db dump --linked` uses this session — **no database
password, access token, or service-role key is ever an input to the
backup script.**

**Why the task must run as that same logged-on user, not as `SYSTEM` or via
a stored password**: Credential Manager entries like this are reliably
readable by a process running in that user's own logged-on session. The
two alternatives were both rejected:
- `SYSTEM` has no access to `lovel`'s Credential Manager store at all — the
  scheduled backup would fail every single run with an opaque auth error,
  which is exactly the "appears healthy while silently failing" failure
  mode item 2 warned against. **Not used, for this reason** — not merely
  "to avoid bypassing an auth problem," but because it would concretely
  break the mechanism this task is trying to operationalize.
- "Run whether user is logged on or not" (Task Scheduler's `Password`/`S4U`
  logon type) requires Windows to store and later unlock that user's
  **Windows account password** to load their profile non-interactively —
  a materially more sensitive credential than anything this backup
  mechanism otherwise touches, and registering it requires Task Scheduler
  to prompt for that password interactively (plus typically elevation).
  This is exactly the "security-sensitive user-context choice" the task
  instructed to stop and ask about rather than decide unilaterally — see
  the installer script's own header comment and the human stop point below.

**Chosen**: `install-backup-task.ps1` registers the task to run as the
current Windows user with logon type `Interactive` ("run only when user is
logged on"), standard (not elevated) privileges. This works as long as the
registering user stays logged on (a locked screen still counts as logged
on) through the scheduled time — sufficient for a single-operator machine
left signed in overnight; **not** sufficient if the machine is regularly
signed out or shut down before the scheduled time. If unattended-while-
logged-off execution is ever required, that is a separate, deliberate
decision needing its own review — not something to introduce silently.

**A real bug found and fixed by testing the literal unattended command
(task item 7), not just running the script interactively**: both
`backup-database.ps1` and `backup-retention.ps1` used `$PSScriptRoot`
inside their parameter block's *default value* expressions
(`[string]$OutputDir = (Join-Path $PSScriptRoot "..\backups")`). Confirmed
live (`_psroot_test2.ps1` reproduction, since removed) that `$PSScriptRoot`
is empty during parameter default-value evaluation when a script is
invoked non-interactively via `powershell.exe -NoProfile -NonInteractive
-File ... ` with a mandatory parameter present — even though it becomes
populated moments later in the script's own body. This ran without error
every time in this session's earlier interactive/dot-sourced testing (P0-5
through the prior disaster-recovery task), which is exactly why unattended
testing under the real invocation form matters — it would have made the
very first scheduled run fail immediately with `Join-Path : Cannot bind
argument to parameter 'Path' because it is an empty string.` **Fixed**: both
scripts now resolve `$PSScriptRoot`-dependent defaults in the script body
(guarded by `$PSBoundParameters.ContainsKey(...)`), not in the param block.

**Other unattended-execution hardening made to `backup-database.ps1`**
(see the script's own header comment for full detail):
- **No install-prompt risk**: the Supabase CLI is now pinned as an exact
  `devDependency` (`supabase@2.117.0`) in `package.json`, so `npx supabase`
  resolves deterministically to `node_modules/.bin/supabase` with no
  network install or interactive "ok to proceed?" prompt possible.
- **Concurrency safety**: a named Mutex
  (`Global\DebtorRecovery-Backup-Database`) wraps the whole run. A second
  invocation started while one is already in progress fails fast (within
  5s) with a clear message instead of interleaving writes — tested live by
  holding the mutex externally and confirming a concurrent script
  invocation is rejected in ~5.5s with exit code 1.
- **Durable, secret-free logging**: every run appends timestamped lines to
  `backups\backup-log.txt` (start, per-file outcome, completion with sizes
  and checksums, or failure reason) — see §20 (Logging) and §21 (Failure
  visibility).
- **Checksums are now written to disk**, not just printed:
  `backups\<...>.sha256`, alongside each schema/data pair — needed so an
  unattended run leaves durable, independently-verifiable proof, and so
  `backup-retention.ps1` can verify a set before ever counting or pruning it.

**Real unattended test performed (2026-09-15, exact literal command Task
Scheduler will run)**:

```
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "D:\Projects\Claude-Debtor recovery\scripts\backup-database.ps1" -ProjectRef igagfxgzlojqrkaawnzx
```

Result: exit code 0, a fresh schema file (132,558 bytes) and data file
(52,896 bytes) produced, a `.sha256` checksum file written and
independently re-verified (`sha256sum` outside the script matched exactly),
no secret of any kind in console output or the log file. `backup-
retention.ps1` was run immediately after (as the scheduled task's second
action will) and correctly identified 1 valid, checksum-verified set with
nothing yet eligible for pruning (below the 14-set threshold), while
correctly leaving an older, pre-hardening backup set (which predates the
`.sha256` sidecar file and is therefore "incomplete" by this script's
definition) in place rather than deleting it.

**Retention edge cases tested in an isolated scratch directory (not the
real backups folder)**: 16 synthetic checksum-valid sets pruned down to
exactly the newest 14, oldest 2 deleted; a single-set directory with
`-KeepCount 0` correctly **refused** to run (`No files deleted`, exit code
1) rather than ever pruning to zero.

### 16b. Scheduled task registered and proven (2026-09-15)

The operator ran `.\scripts\install-backup-task.ps1 -ProjectRef
igagfxgzlojqrkaawnzx` themselves (the registration step this tooling
deliberately does not perform on its own). Verified configuration
(`Get-ScheduledTask` / `Get-ScheduledTaskInfo`) exactly matches what the
installer requests — nothing silently different:

| Property | Value |
|---|---|
| Task name | `DebtorRecovery-Production-Backup` |
| Trigger | Daily, `StartBoundary = 2026-09-15T23:30:00+05:30`, `DaysInterval = 1` |
| Principal | `UserId = lovel`, `LogonType = Interactive`, `RunLevel = Limited` (standard, not elevated) |
| `MultipleInstances` | `IgnoreNew` (Task-Scheduler-level no-overlap, on top of the script's own Mutex, §16a) |
| `StartWhenAvailable` | `True` |
| `RestartCount` / `RestartInterval` | 3 / 15 minutes |
| `ExecutionTimeLimit` | 2 hours |
| Action 1 | `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "D:\Projects\Claude-Debtor recovery\scripts\backup-database.ps1" -ProjectRef igagfxgzlojqrkaawnzx`, working directory `D:\Projects\Claude-Debtor recovery` |
| Action 2 | same form, `backup-retention.ps1`, no arguments |

No secret appears in any of the above — only the (non-secret) project ref
and file paths.

**Manually triggered through Task Scheduler itself** (`Start-ScheduledTask
-TaskName 'DebtorRecovery-Production-Backup'`), not by running the backup
script directly — this specifically proves the *registered task*, not just
the script in isolation, produces a real backup. The run took longer than
the earlier direct-command test (≈3 minutes, vs. this run's ≈3m12s from
`04:24:08` start to `04:27:20` completion — normal variance for a live
network dump to the Sydney project, confirmed by watching the transient
`pg_dump` container's own log stream through the data, table by table,
rather than assuming success from a stalled file size).

**Result**: Task Scheduler's own `Get-ScheduledTaskInfo.LastTaskResult`
reported `0` (success) and `State` returned to `Ready`. A **new** backup
set was produced — timestamp `20260915-042409`, distinct from both the
earlier `20260915-025315` (prior disaster-recovery task) and
`20260915-040424` (this task's own direct-command test) sets already
present in `.\backups\`:

| | Schema file | Data file |
|---|---|---|
| Size | 132,558 bytes | 52,896 bytes |
| SHA-256 (from the `.sha256` sidecar) | `7D690A24...B9F2FCAB1` | `ADB5DAAC...638B08B7D3A` |
| Independently re-verified | `sha256sum` run outside the script against both files — **matched exactly** | matched exactly |

`backup-log.txt` recorded the full lifecycle for this run (`Backup run
starting` → `Backup complete` with sizes/checksums → the retention step's
own three log lines, run automatically as the task's second action,
finding 2 valid sets and pruning nothing, since 2 « 14). No secret of any
kind appears anywhere in the log. The backup content itself was spot-
checked live via the transient dump container's log stream while it ran
(the same `auth.users`/`auth.identities`/`auth.sessions`/`audit_events`
tables verified in the original disaster-recovery task) — confirming this
is genuinely the production data, not a stub.

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

## 20. Logging

Every `backup-database.ps1` and `backup-retention.ps1` run appends
timestamped, plain-text lines to `backups\backup-log.txt` (gitignored,
alongside the backups themselves — never committed, machine-local). One
file answers, for any given day:

- **When a backup started**: `<timestamp> Backup run starting for project
  <ref>`.
- **When it completed, and whether it succeeded**: `<timestamp> Backup
  complete. schema=<bytes> bytes data=<bytes> bytes checksum_file=<name>
  sha256_schema=<hash> sha256_data=<hash>` on success; `<timestamp>
  FAILURE: <reason>` on any failure path (Docker not running, wrong
  project linked, dump command failed, output file missing/empty).
- **Generated backup filenames**: logged explicitly at both start
  (`schema=... data=...`) and completion.
- **Checksum verification result**: the SHA-256 of each file is logged at
  completion, and `backup-retention.ps1` logs a `FAILED checksum
  verification` line for any set whose files no longer match their
  recorded `.sha256` (and refuses to delete or count that set — §15).

**Never logged, by construction** — none of these are ever inputs to
either script, so there is nothing to accidentally log: the database
password, the Supabase access token, the service-role key, the Gmail SMTP
App Password, or any connection string containing a secret. The log
contains only: timestamps, the project ref (not secret), filenames, byte
sizes, and SHA-256 checksums (a checksum is a one-way hash of the backup
content, not a secret itself).

## 21. Failure visibility

How an operator checks whether a given day's scheduled backup succeeded,
without any notification service (explicitly out of scope for this task):

1. **Task Scheduler**: open Task Scheduler → Task Scheduler Library → find
   `DebtorRecovery-Production-Backup`. Check the **Last Run Result**
   column: `0x0` (technically `(0)` / "The operation completed
   successfully") means the task's actions ran without Windows itself
   reporting a launch failure. **This alone does not prove the backup
   succeeded** — a script can exit non-zero and Task Scheduler still
   reports the task as having run; always cross-check with the log (next
   step).
2. **`backups\backup-log.txt`**: find the most recent `Backup run
   starting` line and confirm it is followed by a `Backup complete` line
   (success) rather than `FAILURE:` (failure) or nothing at all (the run
   never got that far, or is still in progress/hung).
3. **`backups\` directory itself**: confirm a schema file, data file, and
   `.sha256` file exist with today's date/timestamp in the filename, and
   that the schema/data files' sizes are non-zero and roughly consistent
   with prior runs (a schema file dramatically smaller than usual, e.g.
   near-zero bytes, indicates a problem even if the script reported
   success).
4. **What counts as a failed or missing backup**: no new timestamped set
   for the expected day; a `FAILURE:` log line; a `.sha256` file whose
   recorded hash doesn't match the actual file (run
   `Get-FileHash -Algorithm SHA256` on the file and compare); or the Task
   Scheduler entry itself missing/disabled.

A monthly check that `supabase login`'s stored session is still valid is
also worth doing (§16a) — a backup can start failing not because anything
in this repository changed, but because the underlying CLI session
expired or was revoked; the log's `FAILURE:` line for a Docker/auth-shaped
error is the signal to check that first.
