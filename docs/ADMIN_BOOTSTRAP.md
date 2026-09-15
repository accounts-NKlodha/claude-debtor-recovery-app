# First-admin bootstrap (manual, one-time, per environment)

This is a documented **runbook**, not automation. It exists because of a
deliberate design constraint found and closed during P0-4 Gate B: ordinary
staff must never be able to write `app_users` (that was the exact
self-escalation-to-admin hole `0007_gate_b_hardening.sql` closes — see
`docs/DEPLOYMENT.md` §3c). That constraint is correct and permanent, but it
means nothing inside the application, and no RLS-governed API call, can ever
create the very first admin. Something outside RLS has to do it once, by
hand, per environment (once per Supabase project — production, staging, any
Gate-B-style test project).

## Why this is not a migration

A migration file replays automatically on every fresh database via
`supabase db push`. Encoding a real person's UUID/email into one would mean:

- that identity gets hardcoded into permanent, committed schema history —
  every future clone of this repo would carry a specific person's identity;
- a stale migration could silently re-run against the wrong environment;
- there is no way for a migration file to "know" who the first admin of a
  brand-new environment should be — that is an operational decision a human
  makes at provisioning time, not a fact about the schema.

## Invariants this procedure preserves

- **Cannot be rerun casually.** It is a manual SQL statement a human
  deliberately types into the Supabase Dashboard's SQL Editor (or `psql`
  with the database password) — never part of `supabase db push`,
  `next build`, or any deploy script. There is nothing to "accidentally"
  trigger.
- **Cannot silently create or elevate admins.** It requires two things no
  ordinary user or attacker has: (a) a real Supabase Auth identity for the
  intended admin (created via the real sign-in flow or an explicit,
  audited Dashboard action), and (b) Supabase project owner/admin access to
  run SQL outside the app's RLS-governed API surface. Neither is reachable
  through the application.
- **No real UUIDs/emails/passwords in committed migrations.** This
  procedure is a doc with a *template* statement; the operator fills in the
  real values by hand, in the Dashboard, and nothing from that session gets
  committed to the repository.
- **Ordinary staff still cannot elevate themselves -- and, as of
  `0011_close_direct_write_bypass.sql`, an ordinary admin session cannot
  write `app_users` directly either** (`app_users_admin_all` was replaced
  with `app_users_admin_read`; both staff and admin are read-only on
  `app_users` through the application's own authenticated session). This
  runbook is the *only* sanctioned way to write that table at all, and it
  is exercised entirely outside RLS (via the Dashboard's own privileged
  connection), not a hole in RLS.
- **Does not require weakening RLS.** The Dashboard SQL Editor (and direct
  `psql` access with the database password) already bypasses RLS by design
  — that is Supabase's own project-owner channel, separate from the
  `anon`/`authenticated` roles the application and its users connect as. No
  policy change is needed or made to run this.

## Procedure

1. **Prerequisite:** the intended admin must already have a real
   `auth.users` row. V1 authentication is Supabase email + password (not
   Google OAuth — see `docs/DEPLOYMENT.md` §"Authentication"; OAuth was
   removed from the codebase entirely during final UAT). A project owner
   creates the identity via Supabase Dashboard → Authentication → Users →
   **Add user**, with **Auto Confirm User** checked, setting a password the
   admin will use to sign in at `/sign-in`. Signing in before step 3 below
   lands at `/sign-in?error=access` (correct: not provisioned yet), but
   confirms the `auth.users` row is real and the password works.

2. In the Supabase Dashboard, go to **Authentication → Users**, find that
   person by email, and copy their **User UID**.

3. In the Dashboard's **SQL Editor**, run (filling in the real UUID/email —
   never save this as a saved snippet with real values, never commit it
   anywhere):

   ```sql
   insert into app_users (id, role, email, display_name)
   values ('<uuid-from-step-2>', 'admin', '<their email>', '<their display name>')
   on conflict (id) do update set role = 'admin';
   ```

   This runs as the Dashboard's own privileged Postgres connection, which
   bypasses RLS the same way any migration does — no policy is weakened,
   permanently or temporarily, to allow it.

4. Confirm: have that person sign in again. They should land at `/dashboard`
   (staff/admin landing) rather than being rejected, and admin-only actions
   (organisation creation, the automation kill switch) should succeed for
   them and be rejected for a plain staff account.

## Provisioning every subsequent staff/client identity

Once at least one admin exists, `docs/DEPLOYMENT.md`'s existing guidance
still applies: there is no self-serve signup by design (PRD access model).
As of `0011_close_direct_write_bypass.sql`, there is no ordinary
authenticated-session write path to `app_users`/`user_organisations` at
all, for any role -- the Dashboard SQL Editor procedure in step 3 above
(a project owner, using Supabase's privileged connection, not the
application) is the *only* mechanism until an in-app "invite/provision
user" admin action is built. That action is future work (not part of Gate
B, not started here, and deliberately not restored as a workaround for
this task) — track it as a follow-up rather than treating the Dashboard
path as the permanent mechanism for routine staff onboarding.
