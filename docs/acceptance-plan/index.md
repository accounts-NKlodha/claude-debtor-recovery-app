---
kind: spec
title: "Acceptance and Pilot Plan"
---

# Acceptance and Pilot Plan

## Must-pass scenarios

0. Submit one authorized phone-photo upload and verify that draft creation, trigger registration, virus scan, immutable evidence registration, extraction and completeness/duplicate checks begin without a staff start click. Replay the same trigger and verify no duplicate draft, job or evidence side effect.
1. Upload phone photo, OCR it, correct fields, checksum/version the source.
2. Import 50-row Excel with valid rows, duplicate rows and malformed rows; produce row-level report.
3. Route ordinary, GST-ineligible, GST-eligible, MSME-eligible and MSME-ineligible cases correctly.
4. Send at 11:00 IST, roll Sunday sends, start timer only after delivery.
5. Handle failed WhatsApp/email delivery and request corrected contacts.
6. Classify payment, promise, dispute and document-request replies; staff approves drafts.
7. Record client-confirmed full/partial/TDS payment and cancel pending escalation immediately.
8. Prepare GST filing with field-length validation; staff completes CAPTCHA and final Send; capture reference/screenshots/PDF.
9. Simulate portal drift and verify fail-closed alert/urgent task behavior.
10. Prepare all seven MSME ODR stages, save/resume each stage, validate field limits and produce a preview snapshot.
11. Create DD task, upload DD/tracking evidence and generate hearing calendar reminder. **P0-5 status:** DD task creation/tracking (amount/payee/reference/status) and hearing calendar reminders (`case_hearings` + `calendar_events`, reschedule/adjournment, outcome recording) are live-verified durable (`docs/workflow-durability/index.md`). "Upload DD/tracking evidence" is not implemented — the schema has a `document_id` slot on `dd_records` for it, but the whole evidence-upload path is out of scope for this phase.
12. Confirm client cannot access another client’s records, documents, rating or AI context.
13. Restore backup and reconstruct one complete case audit trail. **DR task status (2026-09-15):** a real production backup and a real restore into a disposable local environment were both performed and verified — schema, all 34 tables, 24 functions, RLS, and every row (including 65/65 `audit_events`) restored intact and matched production exactly; restored-database security (RLS/tenant isolation/RPC grants/audit immutability) re-verified 12/12 pass; a local app instance served real RLS-scoped data from the restored database. Production has no real case data yet, so no case-linked audit trail exists to reconstruct as a concrete example — the mechanism is proven, re-run with a real case once one exists. Full detail: `docs/disaster-recovery/index.md`.
14. Let a high-confidence synthetic intake advance through every approved deterministic preparation step, then stop visibly at client certification, staff validation, 60-day or legal-policy gates without waiving them.
15. Complete a human checkpoint and verify the workflow resumes automatically from the recorded next step rather than requiring a second start action.
16. Inject one retryable failure and then a repeat failure: the first retries once, the second produces one urgent assigned exception task and no duplicate message, filing or transition.
17. Use an approved test vault credential reference to reach a controlled portal checkpoint, verify OTP/CAPTCHA remain unstored and unbypassed, then resume automatically after the operator completes the gated step.
18. At every journey state, verify the UI identifies automation start/current step, blocker/prerequisite, next scheduled action and whether it is waiting on client, staff, portal or system.

## Pilot controls

- Admin-only pilot first; use redacted/synthetic cases where possible.
- Keep manual communication and portal filing available at every step.
- No unattended government filing during pilot.
- Review automation errors weekly before widening per-client automation.
- Record recovery rate, time-to-recovery, staff minutes/case, delivery rate, OCR correction rate, portal failure rate and automation completion rate.
- Review autonomous-run exception rates, duplicate-prevention evidence and time spent waiting on each actor before widening per-client/action modes.
