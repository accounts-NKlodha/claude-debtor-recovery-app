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
- **Ordinary staff still cannot elevate themselves.** This procedure
  doesn't touch that guarantee — `0007`'s `app_users_admin_all` /
  `app_users_staff_read` policies stay exactly as they are. This runbook is
  the one sanctioned exception, exercised outside RLS entirely (via the
  Dashboard's own privileged connection), not a hole in RLS.
- **Does not require weakening RLS.** The Dashboard SQL Editor (and direct
  `psql` access with the database password) already bypasses RLS by design
  — that is Supabase's own project-owner channel, separate from the
  `anon`/`authenticated` roles the application and its users connect as. No
  policy change is needed or made to run this.

## Procedure

1. **Prerequisite:** the intended admin must already have a real
   `auth.users` row. Once Google OAuth is configured
   (`docs/DEPLOYMENT.md` §"Authentication"), have them sign in once through
   the app — they'll land at `/sign-in?error=access` (correct: they aren't
   provisioned yet) but a real `auth.users` row now exists for their email.
   Before OAuth is configured (e.g. for the very first admin during initial
   setup), a project owner may instead create the identity directly via
   Supabase Dashboard → Authentication → Users → **Add user**, with
   **Auto Confirm User** checked.

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
Every additional `app_users` row is provisioned the same way — an admin (or
project owner) inserting the row, now that an admin identity exists to do it
through a to-be-built admin-facing provisioning action, or via the same
Dashboard SQL Editor path as step 3 above in the interim. Building an actual
in-app "invite/provision user" admin action is future work (not part of
Gate B, not started here) — track it as a follow-up rather than assuming the
Dashboard path is the permanent mechanism for routine staff onboarding.
