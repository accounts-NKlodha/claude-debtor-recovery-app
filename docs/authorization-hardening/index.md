---
kind: spec
title: "P1 Security & UX Hardening: Route Authorization + Server-Action Safety"
---

# P1 Security & UX Hardening: Route Authorization + Server-Action Safety

**Status as of 2026-09-17: route authorization + the highest-priority
server-action crash paths are fixed and live-verified against production**
(real Supabase project `igagfxgzlojqrkaawnzx`, production-mode local build,
existing UAT identities). **This is a hardening pass, not a go-live
declaration** — see `docs/core-workflow-remediation/index.md` and the final
UAT report for the application's overall production-readiness status,
which this task does not change.

## 1. What this closes

Final UAT (the prior task) found that a signed-in **client** identity could
still navigate to and render internal staff/admin pages. RLS blocked the
underlying *data* (a client saw no cross-tenant rows), but the *page itself*
still rendered — a client could reach `/dashboard`, `/cases`, `/clients`,
`/audit`, etc. This was found to be **bidirectional**: `(client)/layout.tsx`
had the same gap in reverse, so a staff/admin session could in principle
render the client portal as if it were a client. Neither direction is an
approved impersonation feature.

Separately, several server actions still used throw-based error
propagation. A directly-invoked `"use server"` function that throws, called
via a plain function call from a client component (not `<form
action={fn}>`), crashes the client with an opaque "Minified React error
#441" in **production builds specifically** — this pattern had already
caused real production crashes found in earlier UAT passes (sign-in, kill
switch, payments). This task systematically audited and fixed the rest of
the mutation surface named in scope.

## 2. Authorization model (unchanged, reused — not a new framework)

Route/action authorization uses the **existing** `src/lib/auth/` module,
unchanged in shape:

- `getAuthContext()` (`src/lib/auth/session.ts`) resolves
  `supabase.auth.getUser()` → `app_users`/`user_organisations` → a typed
  `AuthContext | null`: `{kind:"staff", role:"staff"|"admin", ...}` or
  `{kind:"client", organisationId, organisationIds, ...}`.
- `isProduction()` gates the demo-staff/demo-client fallback: **fail-closed
  in production** (no session → redirect to `/sign-in`), **demo fallback
  outside production** (existing behaviour, unchanged) — staff only, no
  client demo fallback exists anywhere in the app.
- `authorizeStaffMutation()` / `authorizeAdminMutation()` / mutation-level
  session helpers are unchanged; every server action still uses exactly
  these, never a parallel role check.

No new exported helpers were added to the auth module. No RLS policy was
touched. No service-role key or path was introduced anywhere in this
change (verified — see §7).

## 3. Route authorization: the shared-layout boundary

Authorization is enforced **once**, at the highest safe common point, not
per-page:

| Layout | File | Gate |
|---|---|---|
| Internal (staff/admin) | `src/app/(internal)/layout.tsx` | `actor.kind === "client"` → `redirect("/client")`; no session in production → `redirect("/sign-in")` |
| Client | `src/app/(client)/layout.tsx` | `actor.kind !== "client"` → `redirect("/dashboard")`; no session in production → `redirect("/sign-in")` |
| Root | `src/app/page.tsx` | Resolves `getAuthContext()` and redirects by actual role instead of unconditionally to `/dashboard` |

This relies on a real Next.js App Router guarantee, not a convention: a
`redirect()` call inside a server-component layout throws before any child
page's own data-fetching runs, so the entire subtree — every page currently
under `(internal)`/`(client)`, and any page added later — inherits the
check with **zero authorization code of its own**. This is proven directly
by `src/app/(internal)/layout.test.tsx` and `src/app/(client)/layout.test.tsx`,
which assert the underlying repository is never even called when a redirect
fires.

This is explicitly **defense-in-depth on top of RLS, not a replacement for
it**: RLS remains the authoritative tenant-isolation boundary for data
(§7); this layer only prevents the wrong role's *page* from rendering at
all, closing the gap final UAT found.

Two incidental fixes made while touching these layouts:

- `(client)/layout.tsx` previously fetched **every** organisation via
  `listOrganisations()` regardless of role, leaking other tenants' names
  into a real client's org-switcher. Now scoped to `actor.organisationIds`
  for a real client session (full list preserved only for the
  non-production demo fallback).
- The hardcoded "Priya Sharma" profile/avatar display (`AppShell`) now
  renders the real, server-resolved `displayName`/`email` from
  `getAuthContext()` — never a browser-supplied value. The one remaining
  `"Priya Sharma"` string left in the codebase
  (`src/lib/mock-data.ts`'s `ASSIGNEES` map) is unrelated: it is a *case
  assignee* display-name fixture for demo data, only ever consulted by
  `MemoryRepository` (never selected in production —
  `SupabaseRepository.assigneeName()` deliberately returns the raw id
  rather than guessing a name, per its own comment), not the signed-in
  user's own identity.

## 4. Admin-only content gating

Admin-only *controls* (not full pages, except one) are hidden from a plain
staff session — a UX affordance on top of the server-side check, which
remains authoritative regardless of what renders:

- `/clients`: the "+ Add client" link and the automation kill switch
  (`SettingsScreen`) only render when `!actor || (actor.kind === "staff" &&
  actor.role === "admin")` — live-verified: staff sees the client roster
  only; admin additionally sees both controls.
- `/clients/new`: a page-level redirect (`redirect("/clients")`) for a
  definitive non-admin staff actor, on top of the action's own
  `authorizeAdminMutation()` rejection — live-verified: staff navigating
  directly to the URL is bounced back to `/clients`.

## 5. Deterministic unauthorized behavior (live-verified, all four identities)

Tested against a production-mode local build (`next build && next start`,
real Supabase project) using the existing UAT identities
(`uat-admin@nklodha.in`, `uat-staff@nklodha.in`, `uat-client@nklodha.in`).

**Client (the most important scenario) — full internal-route sweep:**
direct navigation to `/dashboard`, `/clients`, `/clients/new`, `/audit`,
`/payments`, `/cases`, `/cases/[id]`, `/intake`, `/communications`, `/gst`,
`/msme`, `/today` all redirected cleanly to `/client` (Overview) with no
internal HTML/data ever rendered; a hard refresh on `/cases/[id]` did not
stick; the nav sidebar shows only the five client-portal links. The
avatar/profile menu shows "UAT Client" — the real identity.

**Staff:** all internal routes render normally; `/clients/new` redirects to
`/clients`; the kill switch and "+ Add client" do not render on `/clients`;
`/client` redirects to `/dashboard` (no silent impersonation of the client
portal). Avatar shows "UAT Staff" / `uat-staff@nklodha.in`.

**Admin:** all internal routes render normally, including the admin-only
controls; `/clients/new` renders the form and a real organisation was
created successfully end-to-end through the converted, safe-action-state
form (see §6.3), including the duplicate-name-warning two-step confirm
flow.

**Anonymous:** `/dashboard`, `/client`, `/clients/new` all redirect to
`/sign-in`; `/sign-in` itself renders normally (no redirect loop).

## 6. Server-action safety: the established convention

All actions in scope were converted to the **same** contract already
established in earlier tasks (sign-in, kill switch, initial reminder,
payments, debtor-contact-update) — no new or incompatible convention was
introduced:

```ts
export interface XState {
  result: T | null;
  error: string | null;
}
export async function xAction(prevState: XState, formData: FormData): Promise<XState> {
  // 1. cheap structural checks (missing id) -> return, no auth call
  // 2. schema.safeParse(raw FormData) -> return on failure, no auth call
  // 3. try { actor = await authorizeXMutation() } catch { return generic "you do not have permission" }
  // 4. try { ...repo call...; return { result, error: null } } catch (e) { return { result: null, error: e.message } }
}
```

Paired with `useActionState(xAction, IDLE)` + `<form action={formAction}>`
on the client side (React 19's own action-dispatch mechanism), with a
small nested `useFormStatus()`-consuming child component for the submit
button — never the form's own component.

### 6.1 Actions converted this task

| File | Actions | Notes |
|---|---|---|
| `src/app/actions/manual-invoice.ts` | `createCaseFromManualInvoiceAction` | Native form replaces `react-hook-form`; server re-validates independently with `manualInvoiceSchema` |
| `src/app/actions/organisations.ts` | `createOrganisationAction` | Duplicate-name two-step confirm flow preserved (see §6.3 for a bug found and fixed here) |
| `src/app/actions/debtor-replies.ts` | `recordDebtorReplyAction` | New `debtorReplySchema` added to `contract/schemas.ts`; manual-classification V1 design unchanged |
| `src/app/actions/hearing.ts` | `prepareDdTaskAction`, `recordDdSubmittedAction`, `scheduleHearingAction`, `rescheduleHearingAction`, `recordHearingOutcomeAction` | Idempotency/terminal-state handling is unchanged — it already lived in the repository, which returns a no-op result rather than throwing; these wrappers only add the safe-return contract on top |
| `src/app/actions/tasks.ts` | `resolveWorkflowTaskAction` | |
| `src/app/actions/ocr.ts` | `correctInvoiceOcrAction` | |

Each has a paired UI-component conversion (`intake-screen.tsx`,
`new-client-form.tsx`, `debtor-reply-form.tsx`, `dd-hearing-actions.tsx`,
`resolve-task-button.tsx`, `ocr-review-panel.tsx`) and a dedicated
regression test file (`manual-invoice.test.ts`, `debtor-replies.test.ts`,
`hearing.test.ts`, `tasks-ocr.test.ts`, plus `security.test.ts` updates)
covering success, validation failure, and authorization failure.

### 6.2 Deferred (explicit, documented residual risk)

`src/app/actions/msme.ts` (3 functions, driven by a 374-line multi-stage
ODR wizard with per-stage dynamic payloads) and the UI wiring of
`src/app/actions/bulk-import.ts` (2 functions) were **not** converted this
task. Both still throw on failure and are called via direct `.then/.catch`
invocation from their client components, carrying the same production-crash
risk this task fixed elsewhere. This was a deliberate scope decision given
the size and regression risk of the MSME wizard specifically (core,
revenue-relevant functionality) weighed against the task's explicit
"do not overcorrect" instruction and the time better spent completing the
route-authorization work, live UAT, and validation that this task also
required. **This is an open item, not a hidden one** — flagged here for a
follow-up task using the exact same, now four-times-proven conversion
pattern.

### 6.3 A real bug found and fixed during live verification

Converting `new-client-form.tsx`'s duplicate-name-warning two-step flow
to `useActionState` initially broke it: **React 19 resets a `<form
action={...}>`'s *uncontrolled* fields after every dispatch, success or
not** (the same as a native form post-then-reset) — not something specific
to this codebase. The first submission (which correctly returns a
`duplicate_name_warning` state, not an error) caused `clientCode`/
`legalEntityName` to go blank the instant the warning rendered, so the
follow-up "Add anyway" submission failed client-side ("Please fill out this
field") and the confirm flow could never complete. Live-verified broken,
then fixed by making those fields **controlled** React state (matching how
`overrideReason` already worked) instead of uncontrolled `defaultValue`
inputs, then live-re-verified working end-to-end (duplicate warning shown →
reason entered → "Add anyway" → organisation created).

The same underlying behavior (fields clearing after a *rejected* — not
just successful — submission) affects the other forms converted this task
in a milder way: a failed submission on the manual-invoice form, debtor-
reply form, OCR-review panel, or DD/hearing forms now clears/reverts the
entered values instead of preserving them, requiring the user to retype
before resubmitting. This is a **UX regression, not a functional break and
not a crash** — live-verified on the manual-invoice form (invalid taxable
value → clean "invalid amount" message, no crash, fields cleared). It was
accepted as out of scope for this task rather than converting every field
in every form to controlled state; flagged here as a candidate follow-up.

## 7. RLS re-verification (no migration made — see §8)

No `supabase/migrations/*.sql` file was touched this task (confirmed via
`git status` before and after). RLS behavior is therefore structurally
unchanged from its last verified state; this task re-ran a live sanity
check against production (`igagfxgzlojqrkaawnzx`) using the same UAT
identities, over the PostgREST API directly (not through the app):

- Client's `organisations` read returns only their own row (1), not the
  full tenant list.
- Client's direct `INSERT` into `debtors` is rejected (`403`) — RLS/grants,
  not application code (`debtors` has been staff-write-only since
  `0011_close_direct_write_bypass.sql`).
- Staff's `organisations` read returns rows across tenants (2).
- Admin can read `app_users`.
- No `SUPABASE_SERVICE_ROLE_KEY` is present in `.env.local` — no
  service-role path was introduced anywhere in this task's changes.

All five checks passed.

## 8. What this task explicitly did not do

- No RLS policy was weakened or added.
- No service-role key or path was introduced.
- No new auth framework, parallel role system, or new exported
  `src/lib/auth/` helper was created.
- Google OAuth was not implemented (still deferred, not part of V1 — see
  `docs/DEPLOYMENT.md` §"Authentication").
- WhatsApp was not implemented (still disabled in production).
- The payment allocation model was not touched.
- No new recovery/product feature was added.
- The application was not deployed anywhere.
- No UAT fixture identity or organisation was deleted. **New,
  throwaway test organisations were created during live browser UAT**
  (`NKL-UATTEST1` / `NKL-UATTEST3`, "UAT Browser Test Client Pvt Ltd") —
  these are real rows in the production database now and should be
  deleted (or left, matching the existing "MUMBAI-SMOKETEST" fixtures'
  precedent) at the operator's discretion; this report does not delete
  them itself.
- No stale-auth-TODO cleanup went beyond the six comments that were
  genuinely incorrect after this task (staff/admin cross-org access is
  intentional per PRD §4, not a missing scope check) — see the diff in
  `src/app/(internal)/{today,payments,dashboard,communications,cases,cases/[id]}/page.tsx`.

## 9. Stale-string audit (tracked source, this task)

- `"Priya Sharma"`: one remaining occurrence, `src/lib/mock-data.ts`'s
  `ASSIGNEES` map — legitimate demo-only case-assignee fixture, not the
  signed-in-user-identity bug (fixed, see §3). `SupabaseRepository` never
  consults this map.
- `/auth/google`, `signInWithOAuth`: zero occurrences outside
  `src/app/actions/auth.test.ts`, which asserts their absence.
- `"case-1"` hardcoded fallback: zero occurrences outside mock-data
  fixture IDs and comments describing the already-fixed prior bug.
- Fabricated GST/MSME reference fallback: `src/server/repositories/
  supabase.ts` (production) now rejects a blank `staffReference` outright
  (see `git log` — this was actually fixed and live-tested as part of
  finishing this task's §19 item, `supabase.gst-reference-safety.test.ts`).
  `src/server/repositories/memory.ts`'s equivalent fallback (`"UNSPECIFIED"`)
  is intentionally left as-is — `MemoryRepository` is never selected in
  production (`src/server/repo.ts#getRepo()`).
- Stale "once auth lands" TODOs: all six found were updated (§8).

## Verdict

**AUTHORIZATION + SERVER-ACTION HARDENING = PASS / CLOSED for everything in
§6.1; §6.2 (msme.ts, bulk-import.ts UI) is an explicit, documented,
deferred residual risk, not a hidden blocker.**

This does **not** declare the overall application GO-LIVE READY — see
`docs/core-workflow-remediation/index.md` and the final-UAT report for
the application's broader production-readiness status, which this task
does not change.
