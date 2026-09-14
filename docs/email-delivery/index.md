---
kind: spec
title: "Production Email Delivery — Gmail SMTP"
---

# Production Email Delivery — Gmail SMTP + Google App Password

Implements the missing `email` channel of the initial reminder (the
`AdapterSet.email` slot existed since the original adapter registry but was
always backed by the mock — see the audit below). **This does not use
Google OAuth.** Authentication is a single Gmail account's App Password
over SMTP — a completely separate concern from the staff sign-in OAuth
discussed in `docs/DEPLOYMENT.md`'s Authentication section, which this task
does not touch. Google OAuth is not used anywhere in this email-delivery
implementation, in V1 or otherwise.

## 1. Email-flow audit (before this task)

- **Reminders**: `sendInitialReminder` (one repository method, one server
  action `sendInitialReminderAction`) was the only reminder flow — no
  repeated/follow-up reminder action existed.
- **`communications`**: inserted atomically with the case-status update via
  `apply_case_mutation`'s `p_communication` param, always *after* the
  adapter call resolved. No idempotency primitive existed — a retried call
  would insert a second row and could re-invoke the adapter.
- **`communication_deliveries`**: had a full schema (attempt, status,
  provider, provider_message_id, error_detail, unique per (communication,
  attempt)) designed for exactly this, but no code path ever wrote to it —
  confirmed dead in the P0-5 audit.
- **Provider abstraction**: already existed and was well-designed —
  `MessagingAdapter` (`src/contract/adapters.ts`), `AdapterResult` with a
  five-value `AdapterOutcome` (`success | retryable_failure |
  permanent_failure | human_action_required | drift_detected`), and
  `runAdapter()`'s retry-once-then-urgent-task policy
  (`src/orchestrator/run-adapter.ts`). An `email` slot existed in
  `AdapterSet` from the start, backed by `mockGmail` — nothing ever called
  it (`getAdapters().email.send` had zero call sites before this task).
- **SMTP/email packages**: none installed. `nodemailer@10.0.10` added
  (the version with no CVEs open at the time; 6.x had several, see the
  commit).
- **Mock-only**: yes, entirely — WhatsApp too (still true; only email
  gained a real provider in this task).
- **Retry behavior**: `runAdapter()`'s single-retry-then-give-up policy
  already existed and is reused unchanged. What was missing was any
  *durable* record of an attempt independent of that in-process retry.
- **Provider/message IDs**: `communications.provider_message_id` was
  populated from the adapter result, but never durably tied to a specific
  *attempt* (no `communication_deliveries` row).
- **Failed sends**: surfaced only as a case status change
  (`contact_update_required`) and an audit-log text note — no operator
  view of "this specific send attempt failed, here's why, here's whether
  retry is safe."

## 2. Provider boundary

`MessagingAdapter` (unchanged interface) — `send()` returns `AdapterResult`,
never throws for a domain-level outcome, never exposes a secret to its
caller. The real implementation, `src/adapters/gmail-smtp.ts`
(`gmailSmtp`), is a drop-in replacement for `mockGmail` at the exact same
interface — no call-site change anywhere in `src/domain/` or
`src/server/repositories/*` needed to know Gmail-specific detail. Swapping
to a different provider later (SendGrid, SES, Workspace API) means writing
one new file implementing `MessagingAdapter` and changing one line in
`src/adapters/index.ts`.

## 3. Gmail SMTP configuration & fail-closed validation

`src/lib/config/email.ts` (`getEmailConfig()`) mirrors
`src/lib/config/production.ts`'s pattern exactly: validates every required
variable is present and well-formed, throws `EmailConfigError` naming only
*which* variable is wrong, never the value. Required:

| Variable | Purpose |
|---|---|
| `SMTP_HOST` | e.g. `smtp.gmail.com` |
| `SMTP_PORT` | `465` (implicit TLS) or `587` (STARTTLS) — `secure` is derived from this, not separately configured |
| `SMTP_USER` | the Gmail address authenticating |
| `SMTP_APP_PASSWORD` | the Google App Password (16 lowercase letters, spaces optional) — **the one secret** |
| `SMTP_FROM_ADDRESS` | sender address (may be the same as `SMTP_USER`) |
| `SMTP_FROM_NAME` | optional, defaults to `"N K Lodha & Co"` |

**Selection is fail-closed exactly like the data layer**
(`src/adapters/index.ts`): in production, `email` is *always* the real
`gmailSmtp` adapter, regardless of `ADAPTER_PROFILE` — forgetting to set
that variable in production must never silently degrade to fake sends.
Outside production, `ADAPTER_PROFILE=live` opts a developer into the real
adapter (for the one-off live-send test below); the default outside
production stays the mock. `getEmailConfig()` is called lazily, on first
send, not at import time or app startup — importing `gmail-smtp.ts` never
throws; only sending through it can, and only when the real adapter is
actually selected.

### App Password handling controls (verified)

- Server-only: `src/lib/config/email.ts` and `src/adapters/gmail-smtp.ts`
  both `import "server-only"` — any accidental client-component import
  fails the Next.js build. Confirmed: `npx next build` succeeds, and the
  built client bundle (`.next/static/**/*.js`) contains zero occurrences of
  `nodemailer`, `SMTP_APP_PASSWORD`, `gmailSmtp`, or `smtp.gmail.com`.
- Never `NEXT_PUBLIC_*` — none of the six variables above are.
- Never persisted in Supabase — no migration, table, or RPC argument ever
  carries it; `communication_deliveries.error_detail` is always one of a
  fixed set of non-sensitive codes (`SMTP_AUTH_FAILED`,
  `SMTP_CONNECTION_ETIMEDOUT`, ...), never the raw SMTP transcript.
- Never logged — `gmail-smtp.ts`'s error classifier (`classifySendError`)
  reads only `err.code`/`err.responseCode`, never `err.message` or
  `err.response` (nodemailer does not guarantee those are free of
  transcript fragments).
- Never returned from an API/server action — `AdapterResult`'s shape
  (`outcome`, `providerRef`, `errorCode`, `nextAction`) has no field that
  could carry it, and every field is built from a fixed vocabulary.
- Never included in exception text — `getEmailConfig()`'s own thrown
  messages name only the variable, never its value (unit-tested,
  `src/lib/config/email.test.ts`).
- Never added to fixtures, never committed, never in docs — this document
  contains no real credential; `.env.local` (gitignored) is where an
  operator enters it, never a committed file.

## 4. Durable delivery model

Reuses the existing schema (`communications`, `communication_deliveries`)
rather than inventing new tables, plus one additive migration
(`0018_email_delivery.sql`, repaired live by `0019` — see §11):

- `communications.idempotency_key` (new, unique, nullable) — the durable
  send-intent key, format `reminder-initial:<channel>:<caseId>:<date>`.
- `communication_deliveries.adapter_outcome` (new, nullable, reuses the
  existing `adapter_outcome` enum) — the retryable/terminal classification
  `delivery_status` alone doesn't carry (`delivery_status` stays `queued` →
  `sent` | `failed`; `adapter_outcome` carries which of the five
  `AdapterOutcome` values produced that).

| Concept the task asked for | Where it lives |
|---|---|
| queued/prepared | `communications.delivery_status = 'queued'` (set by `begin_communication_send`, before any SMTP call) |
| sending | `communication_deliveries.status = 'queued'` for the current attempt (set by `begin_delivery_attempt`, before the SMTP call) |
| sent | both rows' `status = 'sent'`, `adapter_outcome = 'success'` |
| failed retryable / failed terminal | `communication_deliveries.status = 'failed'`, `adapter_outcome = 'retryable_failure' \| 'permanent_failure'` |
| provider message ID | `communications.provider_message_id` / `communication_deliveries.provider_message_id` (Gmail's `Message-ID`) |
| attempt count | `communication_deliveries.attempt`, one row per attempt, `unique(communication_id, attempt)` |
| last attempted at / sent at | `communication_deliveries.occurred_at` / `communications.delivered_at` |
| last error classification | `communication_deliveries.error_detail` (always a fixed, sanitized code) |
| next retry at | **not implemented** — see §7 (retry policy) |

## 5. Idempotency design

**Never rely on button-disable/React state/in-memory locks alone** — every
layer is database-enforced:

1. `begin_communication_send()` acquires the durable row **before** any
   SMTP call, keyed by `idempotency_key`. Idempotent under real
   concurrency (not just single-request retries): `select` → `insert ...
   on conflict (idempotency_key) do nothing` → re-`select` if the insert
   affected zero rows. Whichever concurrent caller's insert wins gets
   `isNew = true`; every other caller (this request retried, or a genuinely
   concurrent second request) sees the winner's row.
2. If that row already reached `delivery_status = 'sent'`, the caller
   **never calls SMTP at all** — short-circuit, return the existing state.
   This is what makes a retried `sendInitialReminderAction` call safe.
3. `begin_delivery_attempt()` records that an attempt is starting, again
   **before** the SMTP call, via a second durable row
   (`communication_deliveries`, `unique(communication_id, attempt)`).
4. `complete_delivery_attempt()` persists the definitive outcome; idempotent
   once the targeted attempt is no longer `'queued'` (a retried completion
   call is a no-op, not a second audit row or a second case-state update).

Attempt numbers are determined by the caller reading
`listDeliveriesForCommunication()` (`existing.length + 1`) rather than
being trusted as caller-supplied truth from a stale client — the
`unique(communication_id, attempt)` constraint is the actual backstop
either way.

## 6. Retry policy

Two distinct layers, deliberately not merged:

- **In-process, automatic, exactly once**: `runAdapter()`'s existing
  policy — a `retryable_failure` is retried once with the same
  idempotency key, inside the *same* `sendReminderChannel()` call. Unit-
  tested (`memory.email-delivery.test.ts`, "retries once automatically").
- **Cross-request, manual, operator-triggered**: nothing automatic exists
  beyond that. A case left `active` after a failed/ambiguous send is
  itself the retry mechanism — clicking "Send initial reminder" again is a
  safe, explicit, human-initiated retry, protected by the idempotency
  design above. **No scheduler/cron was added** — this product has no
  background job runner anywhere (`docs/workflow-durability/index.md`'s
  orchestration-tables decision applies here too); building one
  speculatively for email retry alone would be exactly the "speculative
  machinery" the task told us to avoid. This is a deliberate decision, not
  an oversight.

Classification (`src/adapters/gmail-smtp.ts`, `classifySendError`):

| Retryable | Terminal |
|---|---|
| `ECONNECTION`, `ETIMEDOUT`, `ESOCKET`, `ECONNRESET`, `EDNS` (network) | `EAUTH` (bad credentials — config problem, never auto-retried) |
| SMTP 4xx response | `EENVELOPE`, SMTP 5xx response, a resolved send whose sole recipient nodemailer reports as `rejected` |
| unrecognized error (safe default) | malformed/empty recipient (checked before any SMTP call at all) |

## 7. Ambiguous-outcome handling (the unavoidable distributed-transaction problem)

**SMTP success + database failure cannot be made impossible** without
two-phase commit across Gmail and Postgres, which plain SMTP does not
support (no provider-side idempotency key, unlike some transactional email
APIs). What this design does instead: make it **unlikely** and **operator-
visible**, per the task's explicit framing.

- Unlikely: `begin_delivery_attempt()` persists *before* the SMTP call, and
  `complete_delivery_attempt()` persists the result *immediately* after —
  the crash window is the SMTP round-trip plus one DB write, not the whole
  request.
- Detectable: if a crash happens inside that window, the attempt row is
  left `status = 'queued'` with no matching completion. The *next* call for
  that communication (`begin_delivery_attempt()` again) finds the latest
  attempt still `'queued'` and **refuses to start a new one** —
  `{blocked: true, blockedReason: "...its outcome is unknown..."}`.
- Operator-visible: the repository surfaces this as `ambiguous: true` on
  the `sendInitialReminder()` result; the case is left `active` (neither
  advanced nor failed); the UI (`SendReminderButton`) shows a distinct
  warning banner with an explicit "Retry anyway" action that sets
  `forceRetryAfterAmbiguous: true` — a deliberate, logged, operator
  decision, never an automatic one.

## 8. Recipient validation & tenant consistency

- `gmail-smtp.ts` rejects an empty/malformed `to` before ever reading SMTP
  config or touching the network (`INVALID_RECIPIENT`, `permanent_failure`).
- The recipient is always `debtor.email`, read server-side from the case's
  own debtor row — never a browser-supplied override. No CC/BCC is
  implemented (out of scope, not audited since it doesn't exist).
- `begin_communication_send()` derives `organisation_id` from
  `recovery_cases` server-side (never a client-supplied value), matching
  every other RPC's tenant-consistency pattern.
- No mass emailing: `sendInitialReminder` sends to exactly one recipient
  (the one case's one debtor), same as before this task.

## 9. Email content

Reuses `buildReminderMessage()` unchanged (same wording as the existing
WhatsApp reminder). New: `buildReminderSubject()` — deterministic (no
timestamp/random content), so the same logical reminder always produces
the same subject (idempotency/audit requirement). HTML body is the text
body with newlines converted to `<br>` and HTML-escaped (`escapeHtml()`) —
no template redesign, a safe text alternative (`text:`) is always sent
alongside `html:`. No internal notes, staff-only data, or configuration
values appear in the message (unchanged from the existing template, which
already only names the client/invoice/amount).

## 10. Workflow integration

`sendInitialReminder` now attempts every channel the debtor has a real
address for (WhatsApp if `mobile`, email if `email`), each independently
idempotent (§5). The case advances (`active` → `initial_communication_sent`
→ 24h timer, via the existing `applyReminderSent`/`applyReminderDelivered`)
**only if at least one channel succeeded**; it moves to
`contact_update_required` only if *every attempted* channel failed
terminally; it stays `active` (safe to retry) if any channel's outcome is
ambiguous. A failed send never falsely advances the case — verified in
`memory.email-delivery.test.ts`.

**Known limitation, not fixed by this task**: WhatsApp has no real
provider yet (still `mockWhatsApp`, which always "succeeds" outside its
deterministic test-key triggers). In production, if email is genuinely
broken (misconfigured or Gmail rejects every attempt) but WhatsApp's mock
reports success, the case would still advance — the mock's fake success
would mask a real email failure at the case-status level. The underlying
`communications`/`communication_deliveries` records remain accurate either
way (email's real failure is fully recorded); only the aggregate case
transition is affected. This is a pre-existing architectural gap (WhatsApp
was never made production-ready by any prior task) surfaced, not
introduced, by making email real — building a real WhatsApp adapter is out
of scope here.

## 11. Live-only finding, found and fixed during this task

`complete_delivery_attempt()`'s first version (`0018`) called
`apply_case_mutation(...)` as a *nested* RPC call, capturing its composite
`recovery_cases` return into a local variable (`select
apply_case_mutation(...) into v_case`). Live-confirmed against the
production Sydney project: this failed with `invalid input syntax for
type uuid`, while calling `apply_case_mutation` directly (not nested)
worked correctly. Root cause not pursued further; fixed in
`0019_email_delivery_fix_nested_call.sql` by inlining the same
`recovery_cases` update every other RPC in this codebase already uses,
rather than the novel nested-composite-return pattern. No behavior
change versus the original design — same case-state update, same audit
event, different SQL mechanism. `complete_delivery_attempt` was also
redesigned before that point to never touch case state at all (`p_case:
null` always, from every caller) — the case transition is computed once,
by the TypeScript layer, after every channel has been attempted, via one
direct (non-nested) `apply_case_mutation` call — see §10.

## 12. Operator recovery after a failed or ambiguous send

- **Failed (terminal)**: the case is in `contact_update_required`; correct
  the debtor's email/mobile, then the case needs to return to `active`
  before a resend is possible (existing case-status gate, unchanged).
- **Failed (retryable) or a mix that didn't reach "every channel
  failed"**: the case stays `active` — click "Send initial reminder" again.
  Each channel's own idempotency key means an already-succeeded channel is
  never re-sent; only the still-failed channel gets a new attempt.
- **Ambiguous**: the UI shows a distinct warning with a "Retry anyway"
  button (`forceRetryAfterAmbiguous`). Before using it, check
  `communication_deliveries` for that communication (staff-readable) and,
  ideally, the debtor's inbox/sent folder awareness — there is no
  automatic way to know whether Gmail actually sent the ambiguous attempt.

## 13. Deployment variables (production secret manager, not `.env.local` in production)

Same six variables as §3. `SMTP_APP_PASSWORD` must be entered directly
into the production secret manager when this ships — never committed,
never placed in a build-time `.env` file checked into any repository.
