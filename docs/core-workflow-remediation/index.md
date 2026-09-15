---
kind: spec
title: "Core Workflow Remediation: Debtor Contact + Payment Case Selection"
---

# Core Workflow Remediation: Debtor Contact + Payment Case Selection

**Status as of 2026-09-15: both blockers fixed and live-verified end-to-end
against production** (real case, real contact update, real Gmail send,
real payment + allocation) — not documentation alone. This closes the two
P0/P1 findings from the final-UAT NO-GO: no mechanism existed to capture or
correct debtor contact info, and the standalone payment form could fall
back to a hardcoded, nonexistent `"case-1"`.

## 1. Debtor contact capture (intake)

`debtors.mobile`/`debtors.email` have existed since the very first schema
migration — no new columns were added. What was missing was entirely at
the application layer: no intake path ever collected them.

- **Manual intake** (`/intake` → Manual invoice): now has optional "Debtor
  email" and "Debtor mobile" fields, validated if supplied (email format;
  Indian mobile format, tolerant of `+91`/spaces/hyphens), never required.
  A case can still be created with neither — see §3.
- **Bulk CSV import**: `debtor_email`/`debtor_mobile` were already
  mandatory *header* columns in `BULK_IMPORT_COLUMNS` and the sample
  template (`docs/debtor-recovery-import-template.csv`) — the commit path
  simply never read the cell values. Now wired through; both may be blank
  per row. A malformed (non-blank) value produces a row-level error
  (`bad_email`/`bad_mobile`) exactly like every other column, never a
  silent drop or a fabricated value.
- **Existing-debtor reuse** (both paths funnel through the same
  `create_case_from_invoice` RPC, which matches an existing debtor by name
  within the organisation before creating a new one): if the matched
  debtor already has a value for a field, an incoming value is never used
  to overwrite it — only a currently-`null` field gets backfilled. No
  "conflicting contact info" hard-reject exists; this backfill-only rule
  is the deliberately simple, safe behavior chosen over building one.

## 2. Debtor contact correction (after the fact)

Case detail (`/cases/[id]`) now shows an **Edit contact details** panel
next to the reminder-send action whenever the case is `active`. Staff/admin
can set or clear email/mobile at any time — not only at intake.

Server-side: a new RPC, `update_debtor_contact`
(`supabase/migrations/0020_debtor_contact_update.sql`), is the *only* way
to write `debtors.email`/`debtors.mobile` — `debtors` has been staff-
read-only via RLS since `0011_close_direct_write_bypass.sql`, so a
SECURITY DEFINER function was required, matching every other production
write path in this codebase (`auth.uid()` check, expected-actor
consistency check, `is_staff()` check, pinned `search_path`, no dynamic
SQL, anon EXECUTE revoked — live-verified: an anon call returns `401
permission denied for function update_debtor_contact`). Full-replace
semantics: whatever the form submits becomes the new value, including
`null` to clear a field — there is no partial-merge ambiguity since the
form is always pre-filled with the current values.

**Client can never reach this** — the action calls the same
`authorizeStaffMutation()` every other staff-only mutation in this app
uses; a client session is rejected with a generic "You do not have
permission..." message, never a specific reason. Admin uses the identical
path (the existing role model already treats admin as a superset of
staff for operational actions).

## 3. Reminder eligibility

The case-detail contact panel distinguishes exactly three states, matching
the approved product decision that **email is the only channel that
currently delivers a real production reminder** (Gmail is real; WhatsApp
is disabled in production — see the prior final-UAT task):

| State | Message shown |
|---|---|
| Email present | "Email on file — reminder can be sent through Gmail." |
| Email missing, mobile present | "Email required for automated reminder. WhatsApp is not enabled in production." |
| Both missing | "Debtor contact details required before reminder can be sent." |

A case may exist indefinitely without contact info — creation is never
blocked on it (§1) — but `sendInitialReminder` continues to refuse to send
without it, now with an "Edit contact details" action right next to the
refusal instead of a dead end.

## 4. Live end-to-end verification (2026-09-15)

Using the existing synthetic UAT case from the prior task (`UAT Synthetic
Debtor (delete after acceptance)`, no contact info on file):

1. Opened the case — confirmed "Debtor contact details required before
   reminder can be sent." with no crash.
2. Clicked **Edit contact details**, entered `accounts@nklodha.in` (the
   approved UAT address), saved.
3. Confirmed immediately: the panel updated to "Email on file — reminder
   can be sent through Gmail.", and an `audit_events` row was independently
   verified via REST — `action: "debtor.contact_updated"`, `actor_id`
   matching the real signed-in staff UUID exactly, and
   `metadata_json: {"emailChanged": true, "mobileChanged": false}` — no
   raw email/mobile value anywhere in the audit row.
4. Clicked **Send initial reminder** on the *same case, no recreation* —
   it succeeded via real Gmail SMTP: case advanced to "Initial reminder
   sent", timeline recorded "Sent email — sent", the 24h response-window
   timer started. This is the literal blocker from the prior NO-GO,
   proven closed, not inferred.

## 5. Payment case/invoice selection

`payments-screen.tsx`'s "Record a receipt" form previously had no case
selector at all — `rows[0]?.caseId ?? "case-1"` silently targeted a
demo-only id whenever no receipts already existed to infer a case from
(i.e. always, for any case's first-ever payment in a real environment).
Searched the full codebase for `"case-1"` and equivalent fallbacks — this
was the only production-code occurrence (every other match was a test
fixture or `MemoryRepository`'s demo dataset, both legitimate).

Replaced with an explicit cascading selector: **Organisation → Recovery
case**, populated from real data (`listOrganisations()` /
`listAllCases()`), with the case dropdown correctly empty/disabled until
an organisation is chosen and correctly scoped to only that organisation's
cases (live-verified: selecting the org with zero cases shows zero case
options, not another organisation's case). The selected case's open
invoices are shown as **read-only context** underneath — informational
only, since `payment_records` has no `invoice_id` column at all;
allocation across invoices happens separately, at confirmation time, via
the existing FIFO logic already in `src/domain/allocation.ts`
(`apply_payment_confirmation`). This UI change does not introduce a second
allocation model — it makes the existing one visible, per the task's own
instruction not to invent one.

**Server-side validation was already structurally correct and required no
RPC changes**: `record_payment_row` derives `organisation_id` from the
`case_id` row itself (never accepts one as a parameter) and rejects an
unknown `case_id` outright — so a forged/cross-org organisation id was
never actually accepted, even before this fix. The UI gap was real (no way
to *pick* a case correctly), but the RPC-level trust boundary was already
correct; this remediation closes the UI gap without touching the RPC.

### Live end-to-end verification (2026-09-15)

Same UAT case, starting from **zero prior payments** (the explicit
regression scenario required): selected Org A → the one real case →
recorded a ₹50,000 bank receipt (`UAT-PAYMENT-TEST-001`) → confirmed it.
Result, independently verified via REST:
- `payment.recorded` and `payment.confirmed` audit events, both attributed
  to the real signed-in staff actor.
- `payment_allocations`: exactly one row, `amount: 5000000` (paise),
  correctly linking the payment to the case's one invoice.
- The invoice's outstanding balance correctly dropped from ₹1,18,000.00 to
  ₹68,000.00 — exactly the payment amount, no more, no less.
- Case status transitioned to `payment_confirmation_required`.

Also fixed in the same pass: the "Amount (₹)" field's rupees-to-paise
conversion (`moneyToPaise`, already used everywhere else money is
hand-entered in this app) had been dropped when the form was rewritten —
caught before commit by inspecting the recorded amount, not assumed
correct.

## 6. Production-crash fix (actions touched this task)

Three actions touched by this remediation used the same "throw across the
server-action boundary" pattern the prior final-UAT task found crashes the
client with an opaque React error in production (not in dev, where errors
render correctly — this is why it wasn't caught earlier). Converted to the
same `useActionState`/return-state-not-throw pattern already established
for sign-in/kill-switch/send-reminder:

- `updateDebtorContactAction` (new — built safely from the start).
- `recordPaymentAction` / `confirmPaymentAction` — the latter's rejection
  path is not hypothetical: `apply_payment_confirmation` genuinely raises
  on a double-confirm (a real, reachable case — a double-click, or two
  staff confirming the same receipt), so this was a live risk, not
  defensive-only hardening.

`createCaseFromManualInvoiceAction` (manual intake) was **not** converted
— it is gated by `react-hook-form` + `zodResolver`, which prevents an
invalid submission from ever reaching the server action at all, so the
realistic throw surface is materially smaller (session expiry / a genuine
backend error) than the other three. Converting it would require a
disproportionate rewrite of a working form's validation UX for a lower-
probability path. Documented here as a known, accepted, narrower residual
risk rather than silently expanded scope — per this task's own instruction
not to perform the full application-wide sweep.

## 7. What remains explicitly out of scope

Per this task's instructions, **not** touched even though related:
missing page-level role gates on internal routes (separate remediation),
the remaining server-action throw-pattern instances outside what this task
directly touched, the hardcoded "Priya Sharma" profile display, GST/MSME's
server-side reference-number fallback, and stale TODO comments. See the
prior final-UAT report for the full list.

**This remediation does not make the application go-live ready.**
Production hosting still does not exist (confirmed in the prior task via
DNS lookup — unrelated to anything fixed here) and was explicitly out of
scope for this task ("Do not begin deployment").
