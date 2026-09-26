# Debtrecover

Debtor / receivables recovery platform for **N K Lodha & Co** (Lodha CFO and Data
Analytics OPC Limited). Full lifecycle: invoice intake → WhatsApp + email
reminders → GST taxpayer communication → MSME ODR filing → payment receipt &
referral, with internal and client dashboards.

One codebase ships two ways:

- **Tauri v2 desktop app** now (`npm run desktop:build`).
- **Self-hosted web** later at `https://debtor.nklodha.in` (`npm run build && npm run start`).

> **Build status.** This is an MVP foundation. Core domain logic (workflow state
> machine, scheduling, allocation, bulk import, adapter retry policy) is
> implemented and unit-tested. External providers (WhatsApp/AiSensy, Gmail, GST &
> MSME portal runners, payment gateway, calendar) run as **mock adapters** that
> honour the full failure contract. Legally-gated flows (GST assisted
> notification, MSME filing, retention/DPDP) are built in prepare/assist mode with
> live submission stubbed — see `docs/SPEC.md` §3 and `docs/open-decisions`.

## Stack

Next.js (App Router) · TypeScript · Tailwind v4 + hand-rolled shadcn-style
primitives · Framer Motion · Recharts · Supabase (Postgres + Auth + Storage +
RLS) behind a migration seam (ADR 0001) · Vitest · Playwright + axe.

## Prerequisites

- Node 24 LTS, npm 11
- (desktop) Rust toolchain + Tauri v2 system deps — <https://tauri.app/start/prerequisites/>
- (data) A Supabase project, or local `supabase` CLI / Postgres 15

## Setup

```bash
npm install
cp .env.example .env.local   # fill in Supabase URL + keys
```

Apply the database schema (see `supabase/README.md` for detail):

```bash
supabase db reset            # runs migrations 0001_init, 0002_rls, 0003_seed
# or: psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql  (then 0002, 0003)
```

## Run

| Command | What |
| --- | --- |
| `npm run dev` | Next dev server on :3000. **Safe by default**: email is mocked and WhatsApp disabled, whatever `.env.local` holds |
| `npm run tanstack:dev` | TanStack (Vite) dev server. Same safe-by-default providers |
| `npm run start` | Next production server. Same safe default: Gmail/AiSensy secrets are blanked, so nothing can be sent |
| `npm run test` | Vitest unit suite (domain, orchestrator, adapters) |
| `npm run e2e` | Playwright smoke + axe accessibility gate |
| `npm run verify` | typecheck + lint + test + build — the merge gate |
| `npm run desktop:dev` | Tauri desktop shell against the dev server |
| `npm run desktop:build` | Static export + native installers (msi/nsis/dmg/appimage/deb) |

**Live sends are opt-in per run.** The npm run commands above go through `scripts/safe-run.mjs`, which forces
mock/disabled providers and blanks `SMTP_APP_PASSWORD` / `AISENSY_API_KEY` unless the run is started with
`LIVE_COMMS_CONFIRM=I-APPROVE-LIVE-SENDS`. Real Gmail/AiSensy sends (UAT or a self-hosted production run) require
that exact variable; `.env.local` alone can never enable them. See `scripts/safe-env.mjs`.

The `.claude/settings.json` **Stop hook** runs `npm run verify` and blocks
session handoff on any failure.

## Desktop build

```bash
npm i -D @tauri-apps/cli@^2      # already in devDependencies
npx tauri icon path/to/logo.png  # generates src-tauri/icons/*
npm run desktop:build
```

`BUILD_TARGET=desktop` switches `next.config.ts` to `output: "export"`; the shell
loads the static bundle and talks to the hosted API + Supabase over HTTPS (CSP in
`src-tauri/tauri.conf.json`). During development `npm run desktop:dev` points the
window at `http://localhost:3000`.

## Deploy at debtor.nklodha.in

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Repository map

| Path | Contents |
| --- | --- |
| `src/contract/` | **Shared type contract** — enums, DTOs, adapter interfaces, zod schemas. Serialized changes only. |
| `src/domain/` | Pure logic: `workflow.ts` state machine, `scheduling.ts`, `allocation.ts`, `bulk-import.ts`, `eligibility.ts` (+ `*.test.ts`). |
| `src/orchestrator/` | `run-adapter.ts` retry-once-then-urgent-task policy. |
| `src/adapters/` | Provider-neutral adapters; `mock.ts` is the pilot default. |
| `src/lib/supabase/` | DB/auth/storage seam — the only place `@supabase/*` is imported. |
| `src/app/`, `src/components/` | Next routes + UI (internal + client surfaces). |
| `supabase/migrations/` | `0001_init` schema · `0002_rls` policies · `0003_seed` demo data. |
| `src-tauri/` | Tauri v2 desktop shell. |
| `docs/` | PRD + discovery pack, `SPEC.md`, `PLAN.md`, `adr/`, `DEPLOYMENT.md`. |
| `graphify-out/` | Generated codebase knowledge graph (`graph.html`, `graph.json`, `GRAPH_REPORT.md`). |

## Codebase map

Open `graphify-out/graph.html` in a browser. Regenerate with `graphify . --code-only`
(a post-commit hook, installed via `graphify install`, keeps it fresh).

## Security & compliance posture

RLS is the hard tenant boundary (`supabase/migrations/0002_rls.sql`) plus
app-level authz. Audit events are append-only with a hash chain. No OTP/CAPTCHA is
ever stored or bypassed; portal adapters fail closed on UI drift. Retention, DPDP
notices, and eligibility policies need counsel sign-off before pilot — tracked in
`docs/open-decisions/index.md`.
