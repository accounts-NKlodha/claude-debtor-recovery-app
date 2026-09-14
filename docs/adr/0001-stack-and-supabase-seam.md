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

## Amendment — 2026-09-15

The "pilot data home" above assumed `ap-south-1` (Mumbai); the project actually
provisioned for production during the Mumbai bootstrap turned out to be
`ap-southeast-2` (Sydney) instead (see `docs/MUMBAI_BOOTSTRAP.md`). Business
decision: **Sydney hosting is explicitly accepted; India/Mumbai data residency
is not a hard requirement for this project.** The PRD §13/§14 residency
language quoted in Context above is retained as the historical record of what
was originally specified — it is superseded by this business decision, not
deleted from the record. Region selection remains subject to performance,
security, contractual and applicable compliance requirements at the time of
any future decision; this amendment closes the *specific* ap-south-1
assumption, not all future region review. Do not provision another Supabase
project solely to satisfy India residency absent a new instruction to do so.
The migration-seam decision above (adapter isolation, no scattered `supabase`
imports) is unaffected and still applies regardless of region.
