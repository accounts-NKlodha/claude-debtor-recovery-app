---
kind: spec
title: "Data Model and Import Contract"
---

# Data Model and Import Contract

## Core entities

Organisation; ClientUser; StaffUser; LegalEntity; GSTRegistration; UdyamRegistration; EnterpriseUnit; EconomicActivity; MSEFC; Debtor; DebtorRating; Case; Invoice; PurchaseOrder; LedgerSnapshot; Adjustment; Contact; Advocate; Document; DocumentVersion; WorkflowTrigger; OrchestrationRun; OrchestrationStepAttempt; PrerequisiteEvaluation; Communication; CommunicationDelivery; DebtorReply; PaymentClaim; PaymentConfirmation; PromiseToPay; Settlement; EligibilityCheck; WorkflowTask; ExternalSubmission; PortalArtifact; ClaimStatement; ClaimObjection; ClaimDeterminationPoint; DemandDraft; Hearing; CalendarEvent; FeeLedger; AuditEvent; CredentialReference; Notification.

**P0-5 (2026-09-14/15):** `WorkflowTask`, `DemandDraft` (as `dd_records`),
`Hearing` (as `case_hearings`, one row per occurrence) and
`PaymentAllocation`/`DebtorReply`'s write paths are now materialized and
durable — see `docs/workflow-durability/index.md` for what each RPC does
and what's still a schema-only placeholder (`EligibilityCheck`,
`ExternalSubmission`, `PortalArtifact`, `FeeLedger`, `Document`/
`DocumentVersion`, `Notification`, `OrchestrationRun`/
`OrchestrationStepAttempt`).

## Minimum invoice fields

Invoice number, invoice date, taxable value, tax rate, tax amount, total, balance, debtor name, debtor GSTIN, optional due date, client/legal entity, currency, source document and extraction confidence.

## Minimum debtor fields

Debtor name, mobile number, email if available, total due, GSTIN if available, address if available, source client and contact verification state.

## MSME ODR fields observed

Claimant: Udyam/enterprise/unit, entrepreneur/contact/GST/PAN, address, business type/sector/sub-sector, economic activity and MSEFC; optional authorised representative. Respondent: category, name, business description, CIN, contact, PAN/GST and address. Optional advocate: name, enrollment number, contact, office address, proof and photo. Claim statement: purchase order/agreement, terms, invoice delivery/acceptance/due/receipt details, description, objections, correspondence, determination points, limitation, jurisdiction, cause of action, principal, interest and relief. Checklist: true copies, jurisdiction, limitation and translations.

## Excel import template

Required columns:

```csv
client_code,legal_entity_name,creditor_gstin,debtor_name,debtor_gstin,debtor_mobile,debtor_email,invoice_number,invoice_date,due_date,taxable_value,tax_rate,tax_amount,invoice_total,adjustments,total_due,ledger_as_of,client_certified,group_key,notes
```

Import behavior: validate headers; normalize dates and amounts; reject row-level mandatory errors; detect duplicates; report an error file; never partially activate a case without a visible import result.

## Evidence rules

- Virus scan, version and checksum every file.
- Preserve the exact immutable version used in an external communication or filing.
- Store extraction output, confidence, human corrections and source-page/region references.
- Store portal screenshots/PDFs, submitted payload, attachment hashes, actor, timestamps, reference number and failure details.
- Store trigger/run/step correlation and causation, idempotency disposition, prerequisite/blocker result, retry outcome, next action and `waiting_on` projection so autonomous progress is reconstructable without duplicating domain effects.

## Privacy boundary

Cross-client debtor rating is internal only. Client queries must be filtered by organisation/legal entity. Raw cases from other clients must never be exposed through search, AI context, exports or links.
