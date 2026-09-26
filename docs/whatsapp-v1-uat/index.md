# WhatsApp V1 — controlled production UAT plan

Status (2026-09-21): **Day 1 PASSED** (case activated through the real gates; one Initial Reminder accepted by AiSensy 19:17:59.916 IST and physically confirmed). **Day 2 pending** the genuine 24-hour rule: Follow-up eligible from 2026-09-22 19:17:59.916 IST, then Promise, Commitment, Payment, Received, Final payment, Closed. Synthetic data only, client `NKL-UATTEST1`.
Recipient = the user-controlled test number the user already approved. It is typed by the human into the
intake form; it is never stored in this repo, code, docs, logs or chat.

## 0. Pre-flight facts (verified read-only)

| Item | Result |
|---|---|
| Production project | `igagfxgzlojqrkaawnzx` "Mumbai Debtor recovery" (matches app URL) |
| Migrations | 0001–0023 applied; 0023 PASS/CLOSED |
| `AISENSY_CAMPAIGN_PAYMENT_REMINDER_INITIAL_V2` | SET |
| `AISENSY_CAMPAIGN_PAYMENT_REMINDER_FOLLOWUP_V2` | SET |
| `AISENSY_CAMPAIGN_PAYMENT_COMMITMENT_REMINDER_V2` | SET |
| `AISENSY_CAMPAIGN_PAYMENT_RECEIVED_CONFIRMATION_V2` | SET |
| `AISENSY_CAMPAIGN_PAYMENT_CLOSED_CONFIRMATION_V2` | SET |
| `AISENSY_API_KEY` | SET (value never printed) |
| `WHATSAPP_PROVIDER` | `aisensy` |
| `ADAPTER_PROFILE` / `DATA_PROFILE` | `live` / `supabase` (Gmail adapter is live -> debtor MUST have no email) |
| Registry parameter counts | 8 / 8 / 7 / 6 / 5 (initial / follow-up / commitment / received / closed) |
| Global automation kill switch | `enabled: true` |
| `NKL-UATTEST1` org | exists (`7b6f6239-6aae-4a23-9a13-4e1f343c9afe`), **no UPI ID / payee set**, no cases |
| Legacy `AISENSY_CAMPAIGN_PAYMENT_REMINDER_INITIAL` (no `_V2`) | present, unused by V1 code; harmless |

## 1. Where the UAT runs (decision needed)

The V1 code is uncommitted (HEAD `212c149`), so it is not deployed. The only place it can run is the local build
(`npm run build && LIVE_COMMS_CONFIRM=I-APPROVE-LIVE-SENDS npm run start`, `NODE_ENV=production`, the explicit live-send approval) using `.env.local`, which already points at the production
Supabase and the live AiSensy key. That is the runtime this plan assumes. Committing/deploying is a separate,
unapproved step.

## 2. Follow-up timing method (no weakening, no timestamp edits)

The follow-up offer is available only when `now >= (this invoice's initial reminder accepted time) + 24h`.
Options considered:

* **Chosen: real 24 hours.** Two-day UAT. Day 1 sends the initial reminder; Day 2 (>= 24h later) sends everything else.
  No code change, no config change, no timestamp change, no shortened window, no SQL.
* Rejected: env/feature flag to shorten the window (weakens a production control); editing
  `communications.created_at` (manipulates production evidence and the audit hash chain); a UAT-only code path.
* Complementary evidence that does not touch production:
  * Day 1 negative gate: right after the initial send, the Follow-up card must show *unavailable* with
    "this invoice's 24-hour response window runs until <date>". Screenshot it.
  * The clock-dependent logic is already proven with injected time in
    `memory.multi-invoice-reminders.test.ts` / `reminder-stage.test.ts` (24h, per-invoice windows).

Operator rule: perform Day 2 at least ~15 minutes after the exact 24h mark, not at the edge.

## 3. Constraints that protect the UAT's truthfulness

* Debtor **email left blank** -> no Gmail is ever attempted (email adapter is live).
* Debtor **GSTIN left blank** -> intake stops at `correction_required` (the app's only OCR-review path). Confirming the
  corrected fields is the **staff-validation** gate only; the case then waits in `under_validation` for **client
  certification**, which the operator records on the case page (audited, reason required). The 60-day age gate is derived
  from the invoice due date (68 days overdue here). The case activates only when all three hold. (Caveat C1 is fixed: see the
  pre-UAT fixes section.)
* Payment dates are IST business dates. The app-side fix is in the build; the database side requires **migration 0024**
  (draft, not applied) which must be applied and verified BEFORE Stage 4 (Day 2). Until then, record payments only after
  05:30 IST.
* One active WhatsApp at a time; after every send wait for the on-screen result, never double-click.
* Do not touch the seven-day/24h timers, GST/MSME features, existing UAT data or other organisations.

## 4. Synthetic data

| Field | Value |
|---|---|
| Client | `NKL-UATTEST1` — "UAT Browser Test Client Pvt Ltd" (appears as the creditor name in messages) |
| Org UPI ID / payee name | **human-supplied** synthetic values (approval item A2), entered on the Client page |
| Debtor name | `UAT Test Debtor` |
| Debtor mobile | the approved test number (typed by the human) |
| Debtor email / GSTIN | blank / blank |
| Invoice number | `UAT-WA-V1-001` |
| Invoice date / due date | 2026-06-15 / 2026-07-15 (>60 days overdue, truthfully) |
| Taxable / rate / tax / total / outstanding | ₹21,186.44 / 18% / ₹3,813.56 / **₹25,000.00 / ₹25,000.00** |

Invoice total equals the sum of the payments that will be recorded through the app (₹10,000 + ₹15,000, both `bank`),
and nothing was paid before intake, so the Total Amount Paid rule is satisfied truthfully (see Stage 5).

## 5. Stages

Legend: **HP** = human confirmation point (the human must approve before the operator clicks send).
Audit events are read from `audit_events`; communications from `communications` + `communication_deliveries`.
Nothing is asserted "delivered": AiSensy HTTP acceptance = `sent` only; the human confirms receipt on the phone.

### Stage 0 — Setup (Day 1, no WhatsApp)

1. Admin (admin-only action) -> Clients -> `NKL-UATTEST1` -> Payment details: save the human-approved synthetic UPI ID + payee name.
   Records: `organisations.upi_id/upi_payee_name`; audit `organisation.payment_details_updated` (values not in metadata).
2. Intake -> manual invoice for `NKL-UATTEST1` with the data above.
   Records: debtor, case, invoice. Audit `case.created_from_intake`. Case -> `correction_required`
   (blocker "Mandatory invoice field missing", because GSTIN is blank).
3. Case page -> "Confirm corrected fields" (same values). Audit `ocr.corrected` (staff-validation evidence). Case -> `under_validation`,
   waiting on the client ("Waiting on: client certification"); the Activation gates card shows certification open, staff
   validation recorded, age gate 68 days.
3b. Case page -> Activation gates -> "Record client certification" with the human's attestation as the reason
   (e.g. "Synthetic UAT client certification, approved by <name>"). Audit `case.client_certified`; case -> `active`.
   **Expect:** `principal_outstanding = 2500000` paise, invoice `outstanding_balance = 2500000`, `invoice_total = 2500000`.
4. **HP-0:** human confirms the mobile shown on the case page is the approved number (it is displayed unmasked to the logged-in operator — redact it from any screenshot or evidence), UPI/payee are the approved
   synthetic values, and the WhatsApp panel shows Initial **available**, all other cards unavailable with reasons.

### Stage 1 — Initial Reminder (Day 1)

| | |
|---|---|
| Records/actions | Case page -> WhatsApp panel -> Initial reminder -> Send. Server recomputes eligibility from `wa:initial-reminder:{case}:{invoice}`. |
| Eligibility | live provider on; kill switch on; mobile normalises to `+91…`; UPI+payee set; campaign var set; case `active`; invoice outstanding > 0; no accepted initial for this invoice. |
| Campaign / template | `AISENSY_CAMPAIGN_PAYMENT_REMINDER_INITIAL_V2` / `payment_reminder_initial_v2` |
| Variables (8) | 1 `UAT Test Debtor` · 2 `UAT-WA-V1-001` · 3 `25,000` · 4 `15 July 2026` · 5 `25,000` · 6 `UAT Browser Test Client Pvt Ltd` · 7 UPI (approved) · 8 payee (approved). No `₹`. |
| Transition | `active` -> `initial_communication_sent` (aggregate = the only invoice reminded); `next_scheduled_at` = send time + 24h. |
| Records | 1 `communications` row, `channel=whatsapp`, `idempotency_key=wa:initial-reminder:{case}:{inv}`, `template_key=payment_reminder_initial_v2`, `delivery_status=sent`; 1 `communication_deliveries` row, `provider=aisensy`, `provider_message_id` NULL (none is fabricated). Audit: `communication.queued`, `communication.delivery_attempted`, `reminder.sent`. **No email row.** |
| Idempotency evidence | (a) immediately reload: Initial card shows **Sent (accepted, delivery not confirmed)**, Send disabled; (b) SQL: exactly one row with that key; (c) AiSensy dashboard/phone: exactly one message. |
| Negative gate | Follow-up card unavailable: "response window runs until <T+24h>" (screenshot). |
| **HP-1** | Human approves before Send (sees the rendered body and the recipient on screen — redact the number in any evidence); afterwards confirms on the phone: one message, values correct, order/wording per approved template. |

### Stage 2 — Follow-up Reminder (Day 2, >= T+24h)

| | |
|---|---|
| Eligibility | case `initial_communication_sent`; invoice initial accepted >= 24h ago; no accepted follow-up for the invoice; outstanding > 0. |
| Campaign / template | `AISENSY_CAMPAIGN_PAYMENT_REMINDER_FOLLOWUP_V2` / `payment_reminder_followup_v2` |
| Variables (8) | same order/values as Stage 1 (outstanding still `25,000`; no payment yet). |
| Transition | `initial_communication_sent` -> `follow_up_sent` (all outstanding invoices — here the only one — followed up); `next_scheduled_at` = follow-up time + 24h (final window). **Not** `gst_eligibility_review`. |
| Records | key `wa:followup-reminder:{case}:{inv}:1`; `template_key=payment_reminder_followup_v2`; delivery `provider=aisensy`, `sent`; audit `communication.queued`, `communication.delivery_attempted`, `reminder.followup_sent`. |
| Idempotency | reload -> **Sent**; SQL one row with that key; double-click test is NOT performed on production (covered by tests); phone shows one message. |
| **HP-2** | Human approves send; confirms receipt. |

### Stage 3 — Promise ₹10,000 + Commitment Reminder (Day 2)

1. Case page -> Record promise: date = **today (IST)**, amount ₹10,000, invoice `UAT-WA-V1-001`, no source reply.
   RPC `record_payment_promise` (caller = staff/admin; date within today..+180d; amount <= outstanding).
   Records: 1 `payment_promises` row `status=active`; audit `promise.recorded` (metadata has `amountRecorded:true`, **no amount**).
   Case `follow_up_sent` -> `promise_to_pay`; `next_scheduled_at` = promised date 11:00 IST.
   **HP-3a:** human confirms the recorded promise (date/amount) before sending.
2. Send Commitment reminder.

| | |
|---|---|
| Eligibility | case `promise_to_pay`; one active promise; promised date >= today IST; invoice outstanding > 0; not already sent for that promise id. Reason shown: "The promised payment date is today." |
| Campaign / template | `AISENSY_CAMPAIGN_PAYMENT_COMMITMENT_REMINDER_V2` / `payment_commitment_reminder_v2` |
| Variables (7) | 1 `UAT Test Debtor` · 2 `UAT-WA-V1-001` · 3 promised date (`<today> <Month> 2026`) · 4 `10,000` · 5 creditor name · 6 UPI · 7 payee |
| Transition | none (case stays `promise_to_pay`). |
| Records | key `wa:commitment-reminder:{promiseId}`; `template_key=payment_commitment_reminder_v2`; audit queued + delivery_attempted (no case audit). |
| Idempotency | reload -> Sent; one row with that key. A later re-promise would create a new id/key (history kept, tested). |
| **HP-3b** | Human approves send; confirms receipt. |

### Stage 4 — Partial payment ₹10,000 + Payment Received (Day 2, after 05:30 IST)

1. Payments -> `NKL-UATTEST1` -> case -> kind `bank`, amount ₹10,000, reference `UAT-WA-V1-PAY1`, client-confirmed = yes.
   Records: `payment_records` (kind bank, `client_confirmed=true`, `received_on`= today), `payment_allocations` (₹10,000 -> the invoice),
   invoice `outstanding_balance = 1500000`; case `principal_outstanding = 1500000`, `status = payment_confirmation_required`.
   Audit `payment.recorded`, `payment.confirmed`. **HP-4a:** human confirms the ledger before sending.
2. Send Payment Received.

| | |
|---|---|
| Eligibility | confirmed payment with an allocation; not the invoice-settling payment (balance remains). Payment Closed shown unavailable: "An outstanding balance of ₹15,000 remains." |
| Campaign / template | `AISENSY_CAMPAIGN_PAYMENT_RECEIVED_CONFIRMATION_V2` / `payment_received_confirmation_v2` |
| Variables (6) | 1 `UAT Test Debtor` · 2 creditor name · 3 `UAT-WA-V1-001` · 4 `10,000` · 5 received date · 6 `15,000` |
| Transition | none. |
| Records | key `wa:payment-received:{paymentId}:{invoiceId}`; audit queued + delivery_attempted. |
| Idempotency | reload -> Sent; one row with that key. |
| **HP-4b** | Human approves send; confirms receipt. |

### Stage 5 — Final payment ₹15,000 + Payment Closed (Day 2)

1. Record kind `bank`, ₹15,000, reference `UAT-WA-V1-PAY2`, client-confirmed = yes.
   Records: 2nd payment + allocation; invoice `outstanding_balance = 0`; case `principal_outstanding = 0`, `status = recovered`, `closed_at` set.
   Audit `payment.recorded`, `payment.confirmed` ("Full payment confirmed by client").
2. Send Payment Closed.

| | |
|---|---|
| Eligibility (Total Amount Paid rule) | single-invoice case; `recovered`; outstanding 0; **all allocations are `bank`/`cash` and sum exactly to the invoice total** (10,000 + 15,000 = 25,000 = `invoice_total`) -> reliable. Payment Received for the ₹15,000 payment is suppressed (never both). Exactly one Closed offer, key `wa:payment-closed:{case}:{inv}:{finalPaymentId}`. |
| Campaign / template | `AISENSY_CAMPAIGN_PAYMENT_CLOSED_CONFIRMATION_V2` / `payment_closed_confirmation_v2` |
| Variables (5) | 1 `UAT Test Debtor` · 2 creditor name · 3 `UAT-WA-V1-001` · 4 `25,000` · 5 settlement date |
| Transition | none (already `recovered`). |
| Records | key `wa:payment-closed:...`; audit queued + delivery_attempted. |
| Idempotency | reload -> Sent; one row with that key. |
| **HP-5** | Human approves send; confirms receipt and that "Total Amount Paid ₹25,000" is truthful (all recorded through the app, nothing pre-intake). |

Final tally expected: **5 WhatsApp communications** (one per key above), 5 `communication_deliveries` (`provider=aisensy`),
0 emails, 0 `payment_promises` other than the single active one, case `recovered`, invoice balance 0.

## 6. Evidence pack (read-only SQL after each stage)

Communications by case (key, template_key, delivery_status, channel), deliveries (provider, provider_message_id NULL, status),
`audit_events` for the case (chronological), `payment_promises`, `payment_records` + `payment_allocations`, invoice balance,
case status. Plus the AiSensy dashboard message list (5 messages) and the human's phone confirmation per HP.

## 7. Stop conditions (abort, do not improvise)

Any send that shows a rejected/ambiguous result; a variable that differs from the tables above; a second message
for one key; any email row; a status transition different from the table; kill switch flipped; an unexpected recipient.
On an ambiguous result do NOT retry blindly; report first (retry needs the explicit operator override).

## 8. Caveats / findings

* **C1 (FIXED, code-only):** OCR confirmation used to skip client certification and the 60-day age gate (workflow gap, not intended
  design). Now gate state is derived from evidence (`src/domain/activation.ts`). No migration.
* **F2 (FIXED in code; DB fix = draft migration 0024, not applied):** `record_payment_row` used `current_date` (UTC) for `received_on`;
  now the IST date.
* **Post-UAT security-hardening review item (no change now):** `authenticated` (and, on older tables, `anon`) hold broad
  table privileges (`TRUNCATE`, `TRIGGER`, `REFERENCES`, and `SELECT` for `anon`) across the public schema, including the new
  `payment_promises`. This is platform-wide default-privilege behaviour and RLS still guards row access, but the table-level grants
  should be reviewed and minimised. Tracked in `docs/security-audit/post-uat-grants-review.md`.
* After UAT: the synthetic case/payments/promise remain (no cleanup without approval).
