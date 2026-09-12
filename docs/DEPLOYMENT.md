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

## 2. Configure

Create `.env.production` (never commit) from `.env.example`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon>
SUPABASE_SERVICE_ROLE_KEY=<service_role>      # server only
DATABASE_URL=postgresql://...ap-south-1...    # for migrations
NEXT_PUBLIC_APP_URL=https://debtor.nklodha.in
ADAPTER_PROFILE=mock                          # switch to "live" once providers are provisioned
```

## 3. Database

```bash
psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
psql "$DATABASE_URL" -f supabase/migrations/0002_rls.sql
# 0003_seed is demo data — run ONLY in staging, never production
psql "$DATABASE_URL" -f supabase/migrations/0004_tenant_consistency.sql
psql "$DATABASE_URL" -f supabase/migrations/0005_privileged_audit_writer.sql
```

Verify RLS with the plan in `supabase/README.md` (acceptance scenario 12: a client
identity cannot read another organisation's rows).

### Authentication (P0-1/P0-2 foundation)

Code-side (`src/lib/auth/`, `src/proxy.ts`) is complete and unit-tested
(`src/lib/auth/context.test.ts`) without needing a live project. What's still
required before staff/client sign-in actually works in production:

1. In the Supabase project's Auth settings, enable the **Google** OAuth
   provider and set the redirect URL to `https://debtor.nklodha.in/auth/callback`.
2. Register that provider + redirect URL as an OAuth client in Google Cloud
   Console; put the client ID/secret into Supabase's Google provider config
   (not into this app's env — Supabase holds them).
3. Build the actual `/sign-in` "Continue with Google" action and the
   `/auth/callback` route handler that exchanges the OAuth code for a
   session (`supabase.auth.exchangeCodeForSession`) — both are stubbed out
   pending these credentials; see `src/app/sign-in/page.tsx`.
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

- Enable Supabase daily PITR backups (retained in-region).
- Nightly `pg_dump` (encrypted, age/gpg) to a second India-region bucket.
- Weekly **restore test** into a scratch project; confirm one full case audit
  trail reconstructs (acceptance scenario 13).
- Google Drive secondary copy is allowed but is **not** the sole evidence store.

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
