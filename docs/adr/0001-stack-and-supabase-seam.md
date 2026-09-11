# ADR 0001 — Stack, and a migration seam around Supabase

- Status: accepted
- Date: 2026-09-11

## Context

The wrapper brief fixes Next.js (App Router) + TypeScript + Tauri v2 + Supabase.
PRD §13/§14 require India-resident primary data, "no third-party data routers",
and name a NestJS/Drizzle/pg-boss stack with Postgres RLS as the hard boundary.
These are in tension.

## Decision

1. Build on **Next.js App Router + Supabase now** to ship the Tauri desktop app
   fast (single codebase, route handlers + server actions as the `/api` surface).
2. Keep **seams** so a later move to self-hosted infra at `debtor.nklodha.in` is
   configuration, not a rewrite:
   - All DB/auth/storage access goes through `src/lib/supabase/*` factories and
     typed query modules — no `supabase` import scattered through features.
   - `src/contract/adapters.ts` isolates every external provider.
   - `src/orchestrator/*` owns idempotency/retry independent of any queue product;
     the durable-job interface can be backed by pg-boss when self-hosted.
   - Postgres RLS is authored as plain SQL migrations (`supabase/migrations/*`),
     portable to any Postgres.
3. **Next 16** (installed by `create-next-app`) is used rather than pinning 15;
   the App Router API used here is common to both.

## Consequences

- Hosted Supabase in `ap-south-1` (Mumbai) is the pilot data home; the residency
  and "own infra" question in PRD §13 is deferred to the self-host milestone and
  flagged in `docs/open-decisions`.
- No feature code may `import { createClient } from "@supabase/*"` directly.
- Auth providers (staff Google allow-list, client OTP) are stubbed in this build;
  the seam is `src/lib/supabase/server.ts` + route middleware.
