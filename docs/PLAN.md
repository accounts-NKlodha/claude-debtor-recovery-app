# Debtrecover — Ordered Implementation Plan

Each task is an independently-testable vertical slice. `[gate]` = must pass
`npm run verify` (typecheck + lint + test + build) before merge. Parallel-safe
tasks share no files; shared-contract edits are serialized.

## Phase 0 — Setup ✅

- [x] 0.1 Scaffold Next.js App Router + TS + Tailwind v4 `[gate]`
- [x] 0.2 Shared contract `src/contract/*` (enums, DTOs, adapter interfaces, zod) `[gate]`
- [x] 0.3 Design tokens in `globals.css` (Linear/Stripe palette, semantic status)
- [x] 0.4 `.claude/agents/*` (opus planner, sonnet schema/api/ui/integrations, haiku docs)
- [x] 0.5 `.claude/settings.json` Stop hook → `scripts/verify-gate.mjs`
- [x] 0.6 `graphify install` + initial `graphify . --code-only` (`graphify-out/`). Worktree helper at `scripts/new-slice-worktree.sh`; this session's parallel subagents ran in-tree with **disjoint path ownership** (schema → `supabase/` + `src/lib/supabase/`; UI → `src/components/` + `src/app/`) rather than separate worktrees.
- [x] 0.7 Mock adapter set + `runAdapter` retry policy `[gate]`

## Phase 1 — Design

- [x] 1.1 Primitive inventory locked (button/card/badge/table/tabs/sheet/dialog/status-pill/empty-state) + new shared primitives (PageHeader eyebrow/hero, SpotlightCard, ChipFilterRow) added while revamping against the owner-approved wireframes at `C:\Users\lovel\.traycer\epics\2db606ba-873f-4fe0-8c3d-769517a768c0\artifacts\ui-ux-approval-gate`
- [x] 1.2 Key-screen layouts revamped against the wireframes: Today, Cases, Case detail, Client overview, Communications, GST, MSME. Payments/Intake still on the older layout (functional, header-only polish applied).
- [x] 1.3 App shell + navigation: nav badge counts wired to live data; relabeled `/gst`↔`/msme` (were mislabeled "Portal runs"/"DD-Hearings" regardless of content). Responsive 320/768/1024/1440 not formally re-verified after the revamp.

## Phase 2 — Build (parallel where marked ∥)

- [ ] 2.1 ∥ **M1 Tenancy/RLS**: migrations `0001_init` / `0002_rls` / `0003_seed`; `current_app_user_id()`, client-org policies; audit append-only. Test: client cannot read another org (scenario 12) `[gate]`
- [x] 2.2 ∥ **M9 Dashboards UI**: `/today` exception queue, `/cases` table, `/cases/[id]` detail with automation-state panel, `/client` overview `[gate]`
- [x] 2.2b **Repository seam**: `src/server/repository.ts` interface + `MemoryRepository` (default, tested) + `SupabaseRepository` (type-checked, not live-verified) + `getRepo()` factory. Every page reads through it instead of `@/lib/mock-data` directly `[gate]`
- [x] 2.3a **M2 Intake — manual + bulk**: manual invoice form and bulk CSV commit both create real draft cases through `createDraftCase()`; live-tested end-to-end. Tests: scenarios 0,2 `[gate]`
- [x] 2.3b **M2 Intake — OCR correction**: OCR review screen + low-confidence correction flow, live-tested end-to-end on case-4. Test: scenario 1 — scanned/photo upload capture itself (vs. manual entry) still not wired (no Storage)
- [ ] 2.4 **M3 Workflow API**: persist `orchestration_runs`/`step_attempts`, wire `advance()` to a job runner (pg-boss-style interface, in-memory impl for pilot), timer scheduling. Tests: scenarios 3,4,14,15,16 `[gate]`
- [x] 2.5 **M4 Payments**: record payment + `allocateRecovery` persistence, client-confirm toggle → cancel escalation. Test: scenario 7 `[gate]` — end-to-end through `/payments` → `applyConfirmedPayment` → `advance()`, live-tested in browser (not just unit tests)
- [x] 2.6a **M5 Communications — initial send**: send via adapter + `runAdapter`, unified log UI. Live-tested end-to-end (active → sent → delivered → 24h timer, or both-channels-failed → contact_update_required) `[gate]`
- [ ] 2.6b **M5 Communications — remaining**: real delivery webhooks (currently simulated immediately, no live provider), reply classify + staff review queue UI. Tests: scenario 6
- [x] 2.7 **M6 GST**: compose form with live field-limit counters, pack prepare, assisted-session + human-confirm + capture, drift → urgent task (drift path unit-tested via run-adapter.test.ts; happy path live-tested end-to-end). Tests: scenarios 8,9 `[gate]`
- [x] 2.8 **M7 MSME**: seven-stage wizard, save/resume, immutable preview snapshot. Test: scenario 10 `[gate]` — live-tested end-to-end including a workflow.ts bug fix found via live testing (stale blocker/waiting-on on the filed transition)
- [x] 2.9 **M8 DD/Hearings**: DD task + hearing → calendar event, live-tested end-to-end; closed a gap where `msefc_dd` was unreachable in the state machine. Test: scenario 11 `[gate]` — DD evidence *upload* (image storage) still open, see 2.10
- [x] 2.10a **M10 Security — audit log + kill switch**: real Audit page (`/audit`) reading the append-only log every mutation this session writes to; global automation kill switch (`/clients`) with required-reason enforcement, live-tested. `[gate]`
- [ ] 2.10b **M10 Security — remaining**: hash-chaining audit entries (fields exist, not yet chained), secure expiring document links, backup/restore runbook, per-client automation-mode editing. Test: scenario 13

## Phase 3 — Ship

- [ ] 3.1 Tauri desktop build (`npm run desktop:build`); icons via `npx tauri icon`
- [ ] 3.2 `docs/DEPLOYMENT.md` — self-host at `debtor.nklodha.in` (reverse proxy, Supabase project, env, migrations, backups)
- [ ] 3.3 `shipping-and-launch` pre-launch checklist; pilot controls (admin-only, synthetic cases, manual fallback everywhere)
- [ ] 3.4 `/code-review` each merged slice; apply findings; `security-and-hardening` on M1/M5/M6/M7/M10

## Verification gate (every `[gate]`)

`npm run verify` == `tsc --noEmit` && `eslint` && `vitest run` && `next build`.
Stop hook blocks handoff on any failure.
