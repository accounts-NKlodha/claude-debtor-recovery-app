# V1 release review (2026-09-21)

Scope: release-blocker review of the whole V1 before go-live. Evidence is live (production Supabase, read-only unless stated) or from the test suite.

## Findings

| # | Area | Finding | Severity | Status |
| --- | --- | --- | --- | --- |
| 1 | Auth | **Public Supabase signup is enabled** (`disable_signup:false`, email provider on; email confirmation still required). A stranger can create an auth user; RLS/RPCs deny them everything (no `app_users` row), but it is an unnecessary attack surface (spam, email-quota abuse). | P1 | ✋ needs the Supabase dashboard toggle (Authentication → Sign In / Providers → "Allow new users to sign up" off). Config push was rejected: it would overwrite the whole project auth config with `config.toml` defaults. |
| 2 | Grants | `anon` and `authenticated` held ALL privileges on every public table. RLS covers row access, but not TRUNCATE/TRIGGER/REFERENCES; `system_settings` (kill switch) relied only on the absence of a write policy; `documents`/`document_versions`/`payment_records` have client-role INSERT policies, so a client login could insert rows directly via PostgREST (e.g. a forged "confirmed" payment record). The app performs no direct table writes. | P1 | **Fixed: migration 0025 applied to production 2026-09-21** (hash `91f55775…ed26`; live-verified 44/44: anon has no privilege, authenticated is SELECT-only, forged payment insert / kill-switch write / TRUNCATE denied for anon, client, staff and admin, RPC mutations and RLS reads unchanged, client isolation intact, anonymous REST now 401/42501). Residual: PostgreSQL 17's `MAINTAIN` privilege (VACUUM/ANALYZE/LOCK; no data access, not exposed by PostgREST) is still granted to `authenticated` on all 27 tables — see follow-up below. |
| 3 | Backup | Scheduled backup failing: 19 Sept "Docker not running", 20 Sept run terminated (`0xC000013A`); newest backup was 18 Sept. | P1 | Fixed: `backup-database.ps1` now starts Docker Desktop and waits up to 5 min. Verified live 21 Sept: exit 0, checksums match, fresh set contains 0023/0024 objects and the UAT case. |
| 4 | Backup | No off-site copy; no restore test since the last change. | P1 (operational) | **Controlled operational exception** — see below. |
| 5 | Hosting | Lovable cannot host this app (see `docs/hosting-assessment`). | Blocker for the *Lovable* plan | Resolved by choosing Vercel Pro (or self-hosted Node). |
| 6 | Transport | No HSTS header in the app. | P2 | Added for production builds. |
| 7 | Secrets | Scanned the client-reachable build (`.next/static`, `public/`) for the real values of `AISENSY_API_KEY` and `SMTP_APP_PASSWORD`: none. No service-role key exists in env or code paths on requests. Anon key is a publishable key. `server-only` guards on AiSensy, Gmail and now the Supabase server client. | — | Pass |
| 8 | Server actions / routes | Every non-auth server action calls `authorize*Mutation`; there are no route handlers (no webhook endpoints). | — | Pass |
| 9 | Business RPCs | 23 `SECURITY DEFINER` functions, all with `search_path`; none executable by `anon` except the four RLS helpers (`is_staff`, `current_user_role`, `current_org_ids`, `current_app_user_id`), which return null/false for anon; 0025 revoked even those (applied). Internal task helpers are not executable by `authenticated`. | — | Pass |
| 10 | Audit trail | Recomputed the SHA-256 chain over all 107 audit rows: 0 hash mismatches. 10 links do not follow (created_at, id) order — all are same-transaction event pairs with identical timestamps where the UUID tiebreak differs from insertion order; every `prev_hash` points to a real row. | P2 | Not tampering. A future migration should add a monotonic sequence to the chain. |
| 11 | `record_audit_event` | Callable by any provisioned user (used by the app for audit-only writes). A client-role user could add arbitrary audit lines for their own organisation. Integrity-of-log concern, not data exposure. | P2 | Accepted for V1; revisit with the client portal. |
| 12 | Workflow | OCR confirmation used to skip client certification and the 60-day gate. | P1 | Fixed earlier (`src/domain/activation.ts`), verified in production UAT Day 1. |
| 13 | Payments | `received_on` used the UTC date. | P1 | Fixed (migration 0024 applied; verified). |
| 14 | GST/MSME/DD/hearing | Portal adapters stay mocked in production by design; production never fabricates a reference number (human-entered references only). Actions authorised, audited. | — | Pass (assisted mode) |
| 15 | Kill switch | Global automation switch enabled in prod; engine and legacy send paths honour it (tests). Writes only via `set_automation_state` RPC (after 0025, also not writable by direct table access). | — | Pass |

## Follow-up (optional hardening, needs its own approval)

* **0026 (one statement group):** `revoke maintain on all tables in schema public from authenticated;` plus `alter default privileges for role postgres in schema public revoke maintain on tables from authenticated;`. Not applied: it exceeds the approved scope of 0025 and carries no data-exposure risk.

## Controlled operational exceptions

1. **No off-site backup.** Backups are local (`D:\Projects\Claude-Debtor recovery\backups`, 5 retained sets, SHA-256 verified). A loss of this PC would lose the backups; Supabase's own platform backups remain the fallback. Action owner: business — copy `backups\` to cloud/removable storage until an automated off-site step exists.
2. **Restore not re-tested** after 0021–0025 (procedure exists in `docs/disaster-recovery`).
3. **Backup depends on this PC being on at 23:30** and Docker Desktop being installable/startable; the task runs interactive-only.
4. **No scheduler.** All WhatsApp/Gmail sends and 24h/7-day transitions are operator-triggered.
5. **Synthetic/test data remains in production** (`NKL-UATTEST1/3`, `FINAL-UAT-2026`, `MUMBAI-SMOKETEST-A/B`, and their cases/payments/communications). Cleanup is deliberately deferred until the WhatsApp lifecycle UAT (Day 2) is complete; the backup taken 21 Sept is the pre-cleanup restore point.
