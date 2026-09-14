# Debtrecover — Specification & Capability Map

Derived from the Master PRD + discovery pack (`docs/product-brief`, `docs/workflow-spec`,
`docs/data-model`, `docs/integrations`, `docs/security-compliance`, `docs/acceptance-plan`).
This is the build-facing spec; the PRD remains authoritative on scope.

## 1. Problem & outcome

Turn authorised invoice/ledger/debtor input into a controlled, evidence-preserving
recovery case that advances itself through safe deterministic steps and stops
visibly at every human/legal/portal gate. Targets: >70% recovery of eligible
activated receivables, 35–40 day average, 1,000 cases/employee, 95% of *eligible
preparation* actions automated (not unattended government filing).

## 2. Architecture decisions (locked)

| Area | Decision | Rationale / ref |
| --- | --- | --- |
| App | Next.js (App Router) + TypeScript, single codebase | wrapper brief |
| Ships as | Tauri v2 desktop now; self-hosted `debtor.nklodha.in` later | wrapper brief |
| Data/Auth/Storage | Supabase (Postgres + Auth + Storage + RLS) now, **behind adapter seams** for later self-host migration | Q&A decision; PRD §13/14 residency¹ |
| UI | Tailwind v4 + hand-rolled shadcn-style primitives + Framer Motion; charts via Recharts (`dataviz`) | wrapper brief |
| Money | integer paise, INR only, Indian digit grouping | PRD §9 |
| Time | store UTC, operate IST; sends at 11:00 IST, skip Sunday | PRD §5 |
| Tenancy | Postgres RLS = hard boundary + app-level authz on every query/file/AI context | PRD §13 |
| Integrations | provider-neutral adapters returning a 5-value outcome union; retry-once-then-urgent-task | PRD §16 |
| External deps this build | **mocked** (AiSensy, Gmail, GST/MSME runner, payment, calendar) | Q&A decision |
| Legally-gated flows | built in `prepare`/`assist` mode, live submission stubbed, flagged non-production | PRD §10/17/19 |

¹ **Region decision (2026-09-15):** the India/Mumbai (`ap-south-1`) residency
implied by PRD §13/14 is no longer a hard requirement for this project —
Sydney (`ap-southeast-2`) production hosting is explicitly business-accepted.
See `docs/MUMBAI_BOOTSTRAP.md` and `docs/adr/0001-stack-and-supabase-seam.md`
("Amendment — 2026-09-15"). The adapter-seam architecture itself is
unaffected and still applies regardless of region.

## 3. Capability map (modules)

Each module is a vertical slice: schema → API → UI → tests, passing the verification gate before merge.

| # | Module | Core responsibility | Key acceptance scenarios | Status in this build |
| --- | --- | --- | --- | --- |
| M0 | **Foundation** | contract types, enums, design tokens, verification gate, worktrees, graph | — | ✅ done |
| M1 | **Tenancy & identity** | orgs, users, multi-org client identity, RLS policies, staff Google allow-list / client OTP (stubbed), audit chain | 12 | ⚠️ schema + RLS authored; auth providers stubbed |
| M2 | **Intake & evidence** | upload/import, virus-scan + checksum + version (stub), OCR extract + staff confirm, duplicate/completeness checks, immutable evidence | 0,1,2 | ⚠️ bulk-import validator + OCR mock + UI; storage/scan stubbed |
| M3 | **Workflow engine** | state machine, timers (24h/7d, 11:00 IST, Sunday roll), tasks, exception queue, automation modes, kill switch, idempotency/retry | 3,4,14,15,16,18 | ✅ pure engine + tests; ⚠️ durable scheduler stubbed |
| M4 | **Balances & payments** | append-only recoveries, oldest-invoice-first allocation, partial/TDS/settlement, client confirmation cancels escalation | 7 | ✅ allocation + tests; ⚠️ persistence + UI partial |
| M5 | **Communications** | WhatsApp/email/postal tracking, unified log, delivery/read/bounce, AI reply classify + staff review, promise/dispute/settlement | 5,6 | ⚠️ adapters mocked, classifier mock, UI log; templates TBD |
| M6 | **GST assisted notification** | pack prep, field-limit validation (≤50 subj / ≤200 remarks / ≤4 attach / ≤50 records), assisted browser session, human CAPTCHA+Send, reference/screenshot capture, 7-day timer, drift → fail closed | 8,9 | ⚠️ adapter + UI + validation; **live portal stubbed — legal gate** |
| M7 | **MSME ODR filing** | seven-stage wizard (claimant/respondent/advocate/claim/documents/checklist/preview), save/resume, immutable preview + submitted snapshot, diary ID + petition PDF capture | 10 | ⚠️ adapter + wizard UI; **live portal stubbed — legal gate** |
| M8 | **DD & hearings** | DD task + tracking evidence, hearing email → calendar events/reminders, adjournment, order handoff | 11 | ⚠️ calendar adapter mock; UI minimal |
| M9 | **Dashboards** | internal exception-first queue; client overview (client-safe labels, KPIs, ageing, fees) | 12,18 | ⚠️ UI with mock data |
| M10 | **Security & ops** | tamper-evident audit everywhere, secure expiring links, backup/restore runbook, DPDP review hooks | 13 | ⚠️ audit table + chain design; runbook doc |

Legend: ✅ implemented + tested · ⚠️ partial / stubbed for external or legal reasons.

## 4. System invariants (from PRD §15) — where enforced

1. One tenant-scoped trigger + draft ref + outbox event per input; replay returns existing result → `orchestration_runs` unique on idempotency key.
2. Every transition/external action idempotent & reconstructable → `src/orchestrator/run-adapter.ts`, `orchestration_step_attempts`.
3. External-use evidence immutable, versioned, checksummed → `document_versions`, `portal_artifacts`.
4. Confirmed recoveries append-only; balances derived → `payment_records` + `allocateRecovery()`.
5. Full recovery cancels queued external actions before publishing cancellation → `advance()` `cancel_pending_external_actions` effect.
6. Portal final-submit re-checks balance, eligibility version, cancellation, automation mode → GST/MSME adapter `captureResult` precondition (documented; enforce at wiring).
7. Human checkpoint completion auto-resumes recorded next step, no duplicate send/filing → `advance()` + `run-adapter` no-retry-on-human.

## 5. Explicit non-goals for this build

Native apps, white-label, client APIs/webhooks, client user management, accounting/bank
feeds, historic migration, unattended CAPTCHA/OTP, cross-client debtor score, real
provider credentials, production deployment, live legal-eligibility enforcement.

## 6. Open items requiring owner / counsel before pilot

See `docs/open-decisions/index.md` — GST 7-day timer start event, mandatory final-submit
confirmation in autonomous mode, postal notice generation vs tracking, payment gateway &
calendar provider, statutory eligibility rules, retention period & legal-hold procedure,
debtor-rating usage, India cloud/object-storage provider, DPDP notice/retention review.
