# Changelog

All notable changes to Debtrecover. Format loosely follows Keep a Changelog;
versions follow semver once past 0.x.

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
