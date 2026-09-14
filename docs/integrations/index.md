---
kind: spec
title: "Integration Contracts"
---

# Integration Contracts

## Provider-neutral adapters

### WhatsApp

Adapter operations: send template/text, send secure-link message, receive webhook, fetch delivery/read status, record provider message ID, retry/failure. Initial candidate AiSensy; provider must be replaceable.

### Gmail

Adapter operations: send email, receive/reconcile replies, preserve Message-ID/thread headers, attachments/secure links, delivery/bounce metadata. Central firm account initially. App-password use must be isolated and replaceable.

**Status: outbound send is implemented** (`src/adapters/gmail-smtp.ts`, Gmail SMTP + Google App Password, no OAuth) — see `docs/email-delivery/index.md` for the full design, secret-handling controls, idempotency and retry policy. Attachments/secure-link email and inbound reply reconciliation via this channel are not implemented (debtor replies are recorded manually today, see `docs/workflow-durability/index.md` §"debtor_replies"). Message-ID is preserved (`communications.provider_message_id`); no bounce-webhook metadata exists for plain Gmail SMTP (would need Workspace API-level integration).

### Payment

Adapter operations: create payment request if used, receive gateway webhook, store screenshot/proof, reconcile client confirmation. Gateway choice is open.

### Calendar

Create/update/cancel hearing and promise events; record event ID and timezone. Initial provider is open.

### GST portal

Launch mode: prepare/validate, open or fill browser flow, staff solves CAPTCHA, staff confirms final Send, capture screenshot/PDF/reference number. No CAPTCHA bypass. SOP sequence: login → Services → User Services → Communication Between Taxpayers → Compose → Recipient → recipient GSTIN → subject ≤50 chars → action “Payment not received”/“Others” → invoice item → remarks ≤200 chars → Send.

### MSME ODR/MSEFC

Video evidence confirms the Main Case Filing wizard: claimant/seller, respondent/buyer, optional advocate, statement of claim, documents, checklist and preview/submit confirmation. Adapter boundary: login/session, save/resume stages, field validation, document upload, final confirmation, acknowledgement, status polling/manual update, DD tracking, hearing email/calendar, adjournment and order/settlement. CAPTCHA/OTP and physical hearing/DD remain human-assisted. Post-submit acknowledgement/status and complete mandatory-document list remain unobserved.

## Failure contract

Each adapter returns: `success|retryable_failure|permanent_failure|human_action_required|drift_detected`, provider reference, safe error code, screenshot/artifact references and next action. Retry once, then create urgent task; never silently advance the case.
