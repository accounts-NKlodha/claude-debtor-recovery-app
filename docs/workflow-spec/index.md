---
kind: spec
title: "Workflow and State Machine"
---

# Workflow and State Machine

## Canonical flow

```mermaid
flowchart TD
  A[Portal/client/staff upload accepted] --> A1[Create/update draft + register trigger]
  A1 --> A2[Automatic scan, evidence, OCR, duplicate/completeness checks]
  A2 --> B{Exception or gated validation?}
  B -- Yes --> B1[Smallest staff/client task]
  B1 --> C{Certification + staff validation + age gate pass}
  B -- No --> C
  C -- No --> X[Correction required]
  C -- Yes --> D[Case activated]
  D --> E[Send initial reminder]
  E --> F{Delivered?}
  F -- No --> G[Contact update required]
  F -- Yes --> H[Start 24-hour calendar timer]
  H --> I{Payment/response?}
  I -- Payment confirmed --> Z[Recovered / close]
  I -- Promise --> P[Promise-to-pay tracking]
  I -- Dispute --> Q[Dispute/settlement task]
  I -- No response after 24h --> FU[Follow-up reminder due - operator sends it]
  FU --> FS[Follow-up sent - second 24-hour window]
  FS --> I2{Payment/response?}
  I2 -- Payment / promise / dispute --> Z
  I2 -- No response after 24h --> J[GST eligibility route]
  J --> K[GST notification, human-assisted launch]
  K --> L[Start 7-day calendar timer]
  L --> M{Payment/response?}
  M -- Yes --> Z
  M -- No --> N[MSME eligibility route]
  N -- Eligible --> O[MSME ODR/MSEFC seven-stage filing]
  N -- Not eligible --> R[Non-MSME/manual legal route]
  O --> S[DD + hearing tracking]
  S --> T[Order/settlement/enforcement handoff]
```

## Autonomous trigger and blocker behavior

- Any authorized portal, client or staff upload immediately creates or updates a draft case and starts malware scanning, immutable evidence registration, OCR/extraction, duplicate/completeness checks and state/task projection. No staff click is required to start preparation.
- Each successful deterministic step reevaluates prerequisites and schedules the next approved step automatically. A human task is created only for low-confidence, missing or contradictory data; client certification; staff/legal judgment; disputes, settlements or payment confirmation; physical DD/hearing work; portal drift/failure; or another expressly gated action.
- Upload alone does not activate a case or waive client certification, staff/legal determination, the 60-day overdue gate or audited override, contact requirements, confirmed-payment stop, per-client/action automation mode or the global kill switch.
- Portal preparation and prefill may run automatically. A vault-authorized credential may open the controlled session, but OTP/CAPTCHA are never stored or bypassed and final human actions remain where portal/security policy requires them. Completion of the human checkpoint automatically resumes the next deterministic step.
- Every trigger, job and transition is idempotent and reconstructable. A retryable technical failure retries once; a second failure creates an urgent exception task without duplicate messaging, filing or state advancement.
- Staff and client views show when automation started, the current step or blocker, the next scheduled action and `waiting on client|staff|portal|system` ownership.

## Timing

- IST timezone.
- Messages scheduled for 11:00 AM.
- No scheduled outbound messages on Sunday; roll to next permitted window.
- 24-hour timer begins only after successful delivery of the initial reminder.
- A follow-up WhatsApp reminder comes BEFORE any GST/MSME/statutory review: when the first 24-hour window elapses the follow-up becomes due (status stays `initial_communication_sent`, blocker "follow-up reminder due"); an operator sends it, the case moves to `follow_up_sent` and a second 24-hour window (the same rule/constant as the first) starts. Only silence after that window moves the case to GST eligibility review. All WhatsApp sends in V1 are operator-triggered; nothing sends unattended.
- Note: no scheduler in the application fires the timer events yet; "follow-up due" is therefore derived at read time (window elapsed) rather than by a background transition.
- Seven-day timer begins after the GST communication is successfully submitted/recorded; exact portal event must be confirmed.
- Internal task overdue by 24 hours escalates to admin.

## Case statuses

Received; Under validation; Correction required; Active; Initial communication sent; Contact update required; Payment confirmation required; Promise to pay; Dispute/settlement; GST eligibility review; GST notification prepared; GST notification filed; MSME eligibility review; MSME ODR filed; MSEFC/DD; Hearing scheduled; Adjourned; Recovered; Withdrawn; Closed; Automation failed; Archived.

## Rules

- Staff can pause, resume, extend, skip, restart, correct or advance a case only with a reason.
- Deterministic approved steps advance without a recurring staff start/continue action; staff interventions are explicit exceptions, overrides or gates.
- New invoices added after seven elapsed days create a new case.
- Grouped versus separate invoices is an operator choice; grouped is normal.
- Payment/settlement confirmation requires client confirmation before stopping escalation.
- Confirmed payment immediately cancels pending actions.
- Failure of both message channels pauses escalation and alerts staff/client for corrected contact details.
- Government action fails closed on changed UI, missing expected fields or missing receipt.

## DD, hearing and adjournment (P0-5)

The `Adjourned` status listed above is now reachable: a scheduled hearing
that doesn't conclude moves to `Adjourned` (`waiting_on: portal`, blocker
"Hearing adjourned — awaiting next date"), and a subsequent
`HEARING_SCHEDULED` event from `Adjourned` returns the case to `Hearing
scheduled` with the new date. Each hearing occurrence (not each case) is
its own durable record, so a reschedule preserves full history rather than
overwriting the prior date. See `docs/workflow-durability/index.md` for the
full model, including exactly which follow-up tasks get raised/resolved at
each step and the retry/idempotency guarantees.

## MSME ODR stages observed in video

Claimant/Seller Details → Respondent/Buyer Details → Advocate Details (optional) → Statement of Claim → Documents → Checklist → Preview/Submit confirmation. Each stage should support save/resume and the final submitted snapshot should be immutable.

## Invoice-level reminder stage vs case status (WhatsApp live path)

WhatsApp reminders are per invoice; the case status is a single field. Source of truth is the durable communication history (`wa:initial-reminder:{case}:{invoice}`, `wa:followup-reminder:{case}:{invoice}:1`); the case status is a derived aggregate (`src/domain/reminder-stage.ts`):

- `active` — no outstanding invoice reminded yet.
- `initial_communication_sent` — at least one reminded, but some outstanding invoice still lacks its initial or follow-up.
- `follow_up_sent` — every outstanding invoice has had both. Only then can GST/MSME escalation be considered, after each invoice's final 24h window (`escalationReadiness`).

Each invoice has its own 24h windows. The single case-level email is sent at most once. Settled invoices drop out of the aggregate. Payment Closed states "Total Amount Paid" only when bank/cash payments recorded here sum exactly to the invoice total; otherwise it is unavailable and Payment Received is offered.

## Activation gates (pre-activation cases)

A case becomes `active` only when client certification, staff validation and the 60-day age gate all hold (`src/domain/activation.ts`).
- **Staff validation:** the OCR "confirm corrected fields" action, or an explicit `case.staff_validated` record for an `under_validation` case.
- **Client certification:** recorded by staff with a mandatory reason (`case.client_certified`). Certification recorded while the case still awaits correction is kept and honoured by the later OCR confirmation.
- **60-day age gate:** derived, never recorded. Every outstanding invoice must be at least 60 IST calendar days past its due date; a missing due date fails the gate. The spec's "audited override" is not implemented.
- Evidence is the append-only audit event; no schema change. Cases already past activation are never re-gated (correcting an invoice later does not reset the status).

## Business dates

Payment, promise and "today" dates are IST calendar dates (`istBusinessDate`), never the UTC date. `record_payment_row` stamps `received_on` with the IST date (migration 0024).
