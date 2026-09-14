---
kind: spec
title: "Durable Recovery Workflow Model (P0-5)"
---

# Durable Recovery Workflow Model (P0-5)

Companion to `docs/workflow-spec/index.md` (the case-status state machine)
and `docs/data-model/index.md` (the full entity list). This document covers
what P0-5 closed: which recovery-workflow actions now persist durable,
restart-surviving state (not just a case-status string and an audit-log
text note), the exact retry/idempotency semantics, and — as important —
what was deliberately left out of scope and why.

## Audit summary: what was implemented vs. incomplete before P0-5

Before this phase, `workflow_tasks`, `calendar_events`, `payment_allocations`
and `debtor_replies` all had real tables and RLS, but no repository method
or RPC ever wrote to them. Concretely:

- `workflow.ts`'s `advance()` computes a `raise_task` effect on every
  transition that needs human follow-up, but nothing turned that effect
  into a `workflow_tasks` row — the "Today" urgent queue only ever showed
  whatever a human/seed had manually inserted.
- DD preparation and hearing scheduling each updated the case status and
  wrote a single audit-log text note; no `dd_records`/`case_hearings`/
  `calendar_events` row was ever created (explicitly documented as a known
  gap in the pre-P0-5 code comments on `prepareDdTask`/`scheduleHearing`).
- `apply_payment_confirmation` computed a full per-invoice allocation
  breakdown (`allocateRecovery()`) and applied it to `invoices.outstanding_
  balance`, then discarded the breakdown — `payment_allocations` stayed
  permanently empty, and `recoveryTrend()` returned `[]` on Supabase because
  of it.
- `debtor_replies` had a full `REPLY_CLASSIFIED` handler in `workflow.ts`
  and zero callers — no action or repository method ever invoked it.

`eligibility_checks`, `external_submissions`, `portal_artifacts`,
`fee_ledger_entries`, `documents`/`document_versions`, and `notifications`
had the same "table exists, nothing writes to it" shape, but are **not**
addressed by this phase — see "Explicitly out of scope" below.

## Model, table by table

Every table below is staff/admin read-only at the RLS/grant level (matching
the closed direct-table-write bypass, `0011_close_direct_write_bypass.sql`)
— every write happens through one of the RPCs in
`supabase/migrations/0012_p0_5_workflow_durability.sql` (or its repair,
`0013_p0_5_close_internal_rpc_gap.sql`). None of these RPCs weaken RLS or
introduce a client-writable surface.

### `workflow_tasks`

| | |
|---|---|
| Created by | `raise_workflow_task()` (internal-only — see below), invoked via `perform` from `prepare_dd`, `schedule_hearing`, `record_debtor_reply` |
| Resolved by | `resolve_workflow_task()` (staff/admin, directly callable) or automatically by `close_case_tasks_if_terminal()` when the owning case reaches `recovered`/`closed`/`withdrawn`/`archived` |
| Idempotency | `raise_workflow_task()` is a no-op if an unresolved task of the same `(case_id, type)` already exists — a retried mutation never creates a duplicate task. `resolve_workflow_task()` on an already-resolved task returns it unchanged (no error, no duplicate audit row) |
| Authorization | staff/admin only; the two raise/close helpers have **no** `grant execute` to `anon`/`authenticated` at all — reachable only from inside another `SECURITY DEFINER` function (see "Live-only security finding" below) |

Task types raised map directly to `workflow.ts`'s existing `raise_task`
effects — no new task semantics were invented. Not every `raise_task`
effect currently has a caller wired to it (see "Not fully wired" below).

### `dd_records` (new table)

One row per case (`unique(case_id)`). No `not_required` flag exists — a
missing row means DD preparation hasn't started; nothing in the current
product model needs to represent "DD explicitly not required" as distinct
from "not yet reached."

| Field | Notes |
|---|---|
| `status` | `preparation_pending` → `prepared` → `submitted`. Enforced one-way: `prepare_dd()` rejects any further edit once `submitted`. |
| `amount` / `payee` / `reference` / `notes` | Nullable, fillable incrementally — a second `prepare_dd()` call updates only the fields it's given, matching operator reality (task created first, details filled as they arrive). |
| `document_id` | Present in the schema for the supporting evidence artifact; **no upload path is wired in this phase** (see "Explicitly out of scope" — the whole `documents` store is untouched). |

`prepare_dd(case_id, case, amount, payee, reference, notes, reason, expected_actor_id)`
applies the case's `DD_PREPARED` transition (via `applyDdPrepared()`, naturally
idempotent — re-calling it while already past `msefc_dd` is a no-op on the case
row) and upserts `dd_records`, raising exactly one `dd_preparation` task.
`record_dd_submitted(case_id, submitted_at, document_id, reason, expected_actor_id)`
marks it submitted and resolves the task; retried, it returns the already-
submitted row unchanged (no financial effect either way, unlike a payment
retry, so a friendly no-op — not an error — is correct here).

### `case_hearings` (new table)

One row **per hearing occurrence**, not per case — a reschedule inserts a
new row and marks the old one `adjourned`, so full history survives (who
adjourned what, when, and what it became). At most one row per case may be
`status = 'scheduled'` at a time; this is enforced by the RPCs, not a DB
constraint (no clean partial-unique shape for an open-ended history table).

| RPC | Behavior |
|---|---|
| `schedule_hearing(...)` | First scheduling. Idempotent on an exact-date retry (returns the existing row); a *different* date while one is open is rejected — the caller must use `reschedule_hearing` instead of silently overwriting. Also inserts the matching `calendar_events` row and raises `hearing_followup`. |
| `reschedule_hearing(...)` | Marks the current `scheduled` occurrence `adjourned`, inserts a new `scheduled` occurrence linked via `rescheduled_from_id`, inserts a new `calendar_events` row. Rejects a hearing that isn't currently `scheduled`. `hearing_followup` stays open across a reschedule — the same operator work is still pending. |
| `record_hearing_outcome(...)` | `completed` or `cancelled` only (not `scheduled`/`adjourned` — those go through the two RPCs above). Resolves `hearing_followup`, applies the case's `DISPUTE_RESOLVED`-equivalent transition (`applyHearingOutcome()`, which now also stamps `closedAt` — see the fix note below), and sweeps every other open task on the case if the resulting status is terminal. Idempotent: a hearing already in a terminal status returns unchanged on a retry — a genuine correction (wrong result recorded) is out of scope for this phase; that would need its own explicit "amend" path, deliberately not built here. |

New `WorkflowEvent`s `HEARING_ADJOURNED` and a new `"adjourned"` case-status
handler were added to `workflow.ts` to make this representable without any
implicit, UI-only state (the `adjourned` status already existed in
`case_status` and in `workflow-spec/index.md`'s status list — it had simply
never been reachable).

**Fix found during this phase**: `applyHearingOutcome()` did not stamp
`closedAt` the way `applyConfirmedPayment()` does on full settlement —
caught live during Supabase verification (a "recovered via hearing" case
would never show a close timestamp). Fixed in `src/domain/hearing.ts`
before this migration was finalized.

### `payment_allocations` (existing table, newly written)

`apply_payment_confirmation()` (in `0007_gate_b_hardening.sql`, replaced
again here) now inserts one row per invoice actually touched by the
confirmed payment, using the exact per-invoice `applied` amount already
computed by `allocateRecovery()` — the same computation that was already
happening, just not persisted before. New guards:

- the sum of `applied` amounts cannot exceed the payment's own `amount`
  (checked before any row is written);
- each invoice's resulting `outstanding_balance` cannot go negative;
- `insert ... on conflict (payment_record_id, invoice_id) do nothing` as
  defence in depth against a duplicate row — though the existing `for
  update` row lock + already-confirmed guard (0007) means a genuine retry
  never reaches the allocation loop a second time; this is belt-and-braces,
  not the primary protection.
- on full settlement (case reaches a terminal status), every other open
  task on the case is swept closed via the same
  `close_case_tasks_if_terminal()` helper `apply_case_mutation` uses.

Reversal/reallocation is **not** implemented — `payment_records` is
append-only by design (0002's comment: "allocations are a derived
projection"), and a wrong allocation would need an explicit correction
mechanism, deliberately not built in this phase (no product requirement for
it was found in the PRD/acceptance plan).

### `debtor_replies` (existing table, newly written)

`record_debtor_reply(case_id, case, channel, raw_body, communication_id,
classification, reason, expected_actor_id)` is staff-only — **no AI
classification is wired in this build** (per this task's explicit
instruction); `classification_confidence` stays `null` and
`reviewed_by_id`/`reviewed_at` are always the recording staff member,
because a human always made the call. Drives the exact same
`REPLY_CLASSIFIED` transition `workflow.ts` already had fully implemented
and tested — this closes a "fully built, never called" gap, not a new
domain rule. Raises `payment_confirmation` (on `payment_made`),
`dispute_resolution` (on `dispute`/`settlement_offer`/`document_request`),
or `staff_validation` (on `unclear`) — idempotent via the same
open-task dedup as every other task-raising path.

## Case-state invariants added

- **Closed case ⇒ no open tasks.** `close_case_tasks_if_terminal()` is
  invoked from `apply_case_mutation`, `apply_payment_confirmation`, and
  `record_hearing_outcome` whenever the resulting status is `recovered`,
  `closed`, `withdrawn`, or `archived` — every still-open `workflow_tasks`
  row for that case is resolved in the same transaction, with one audit row
  if (and only if) it actually closed something.
- **DD/hearing records are one-way once terminal.** `prepare_dd()` refuses
  further edits once `submitted`; `record_hearing_outcome()` is a no-op
  retry once `completed`/`cancelled` rather than allowing a silent
  overwrite.
- **A confirmed payment's allocations can never exceed the payment amount,
  and an invoice's balance can never go negative** — checked inside
  `apply_payment_confirmation()` before any row is written.

These are enforced in the RPCs (the same transaction as the mutation
itself), not the application layer — a direct Data-API write couldn't
bypass them even if the 0011 table-grant closure were ever misconfigured.

## Live-only security finding (found and fixed in this phase)

`raise_workflow_task()` and `close_case_tasks_if_terminal()` were designed
as internal-only helpers — callable via `perform` from another RPC, never
directly — with their only stated protection being the omission of `grant
execute ... to authenticated` (only `revoke ... from public` was present,
matching what looked like the working pattern elsewhere in this codebase).

Live verification against the production Sydney project proved that
assumption wrong: Supabase's project bootstrap grants `EXECUTE` on every
new `public`-schema function directly to `anon` and `authenticated`,
independent of the `PUBLIC` pseudo-role — `revoke ... from public` does not
touch that grant. An anonymous PostgREST call to `raise_workflow_task`
executed far enough to hit a `NOT NULL` constraint (proof it ran, not
merely "was attempted"); a call to `close_case_tasks_if_terminal` returned
success. Neither function had an internal `auth.uid()`/`is_staff()` check
to fall back on, unlike every other RPC in this codebase.

**This is why every other RPC here (0005 onward) has always paired `revoke
... from public` with an explicit in-function auth check** — that check,
not the grant, is the actual enforcement layer; the revoke is defense in
depth for callers not covered by Supabase's default-privilege grant. The
two internal helpers were missing the primary layer entirely.

Fixed in `0013_p0_5_close_internal_rpc_gap.sql`: both functions now
`revoke ... from public, anon, authenticated` explicitly (the real fix) and
carry the same `auth.uid() is null` / `is_staff()` checks as every other
RPC (defense in depth, in case a future grant change reopens the surface).
No data was exposed or corrupted — the anonymous `raise_workflow_task` call
never committed (constraint violation rolled it back), and the
`close_case_tasks_if_terminal` call was made against a non-existent
`case_id` during verification, matching zero rows. Re-verified clean after
the fix (22/22 security-regression checks, including this one, passing).

## Explicitly out of scope (and why)

| Area | Why not this phase |
|---|---|
| `orchestration_runs` / `orchestration_step_attempts` | No async job engine exists in this product today — every mutation is a synchronous, authenticated-session RPC call, not a durable background run. Building run/step tracking for an orchestration engine that doesn't exist would be speculative machinery, not durability. `ADR 0001` already defers a durable-job-queue (pg-boss) to the self-host milestone. |
| `eligibility_checks` | `assessEligibility()` is pure, tested, and genuinely unused by any repository method — persisting its output is a materially separate feature (an eligibility audit trail) not named in this task's required steps. |
| `external_submissions` / `portal_artifacts` | GST/MSME filing references currently live on `recovery_cases` fields + audit-log text; capturing portal screenshots/PDFs as evidence is the same scale of work as the evidence store below and was not in scope. |
| `documents` / `document_versions` | The entire evidence-upload path (virus scan, checksum, immutable versioning) is unwired at the application layer — a separate, large effort. `dd_records.document_id` and the DD/hearing "supporting documents" fields exist in the schema for when it lands, but nothing uploads to them yet. |
| `fee_ledger_entries` | `estimateSuccessFee()` remains a live display-only computation (`billed: 0` hard-coded) — billing/invoicing the recovery fee is a separate product decision, not touched here. |
| `notifications` | No repository method or action writes to it; in-app notification delivery is unbuilt, unrelated to workflow durability. |
| GST/MSME `AUTOMATION_FAILED` wiring | `applyGstAutomationFailed`/`applyMsmeAutomationFailed` exist but nothing currently calls them with a real adapter failure (the adapters are mocked and return success in this build) — no live gap to close yet. |
| Full task-type coverage (`settlement_approval`, `gst_portal_run`, `msme_portal_run`, `portal_drift`) | These `task_type` enum values have no corresponding `raise_task` effect anywhere in `workflow.ts` today — inventing new effects to use them would be adding unrequested business logic, not closing a gap. |

## Repository parity

`MemoryRepository` implements every method above with matching semantics
(idempotency, terminal-status task sweep, one-way DD/hearing state) against
`src/lib/mock-data.ts`'s in-memory arrays — see
`src/server/repositories/memory.workflow-durability.test.ts`. No
capability exists in one backend and not the other.
