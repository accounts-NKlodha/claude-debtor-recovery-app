# Changelog

All notable changes to Debtrecover. Format loosely follows Keep a Changelog;
versions follow semver once past 0.x.

## [0.1.0] - V1 production release (2026-09)

### Added
- WhatsApp V1 via the AiSensy Campaign API: Initial and Follow-up reminders, Commitment reminder,
  Payment Received and Payment Closed confirmations (5 approved V2 templates: 8/8/7/6/5 variables),
  operator-triggered, business-event idempotency keys, durable communication + delivery records,
  invoice-level reminder stage (multi-invoice cases), promise-to-pay records (`payment_promises`),
  conservative "Total Amount Paid" rule, amount variables sent with one leading space.
- Case activation gates: client certification (recorded by staff, audited), staff validation, derived 60-day age gate.
- Organisation UPI / payee payment details (admin-only).
- Migrations 0021-0025 (delivery provider param, UPI details, follow-up stage + promises, IST payment business date, least-privilege table grants).
- Hosting assessment (`docs/hosting-assessment`): Lovable cannot host this Next.js/Nodemailer app; Vercel (Pro) or the documented self-hosted Node server can.

### Fixed
- Payment `received_on` was the UTC date (wrong 00:00-05:30 IST); it is now the IST business date.
- OCR confirmation used to skip client certification and the 60-day age gate.
- Backup task now starts Docker Desktop itself instead of failing when it is not running.
- HSTS header on production builds; `server-only` guard on the Supabase server client.

### Security
- Migration 0025: `anon` has no table/sequence privileges; `authenticated` is SELECT-only (all writes go through SECURITY DEFINER RPCs);
  RLS helper functions are not executable by `anon`; new tables/functions no longer inherit those grants.

## [Unreleased]

### Added
- Next.js App Router + TypeScript + Tailwind v4 scaffold.
- Shared type contract (`src/contract/`): workflow enums, domain DTOs,
  provider-neutral adapter interfaces, zod validation schemas.
- Domain logic with unit tests: recovery-case state machine (`workflow.ts`),
  IST send-window / timer scheduling, oldest-invoice-first recovery allocation,
  bulk CSV import validator, route-eligibility assessment.
- Orchestrator adapter-execution policy: retry-once-then-single-urgent-task.
- Mock adapter set (WhatsApp, Gmail, OCR, reply classifier, GST portal, MSME
  portal, calendar, payment gateway) honouring the five-value failure contract.
- Supabase schema (`0001_init`), RLS policies (`0002_rls`), demo seed (`0003_seed`);
  DB/auth/storage seam in `src/lib/supabase/`.
- UI: design tokens, shadcn-style primitives, app shell, internal + client
  screens (Today queue, Cases, Case detail, Communications, Intake, GST, MSME,
  Payments, Client overview) against mock data.
- Tauri v2 desktop shell; dual build target via `BUILD_TARGET=desktop`.
- Playwright + axe smoke/accessibility gate.
- `.claude/` agents (opus/sonnet/haiku) + Stop-hook verification gate.
- Docs: `SPEC.md`, `PLAN.md`, ADR 0001, `DEPLOYMENT.md`, `supabase/README.md`.
- graphify codebase graph (`graphify-out/`) + post-commit refresh hook.

### Not yet implemented / stubbed
- Real integration providers; live GST/MSME portal submission (legal gate).
- Durable job scheduler (pg-boss) — in-process interface only.
- Staff Google allow-list / client OTP auth providers.
- Virus scanning, object-storage wiring, secure expiring links.
- Retention/DPDP workflows pending counsel review.
