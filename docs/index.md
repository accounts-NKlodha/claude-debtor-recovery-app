---
kind: story
title: "Debtor Recovery Platform — Orchestrator Handoff Pack"
status: 1
---

# Debtor Recovery Platform — Orchestrator Handoff Pack (Revised)

Prepared 29 August 2026 and revised after review of the MSME ODR filing video. This pack is discovery output only. It authorizes no external filing, credential use, CAPTCHA bypass, or production deployment.

## Read in this order

1. [Product brief](product-brief)
2. [Workflow and state machine](workflow-spec)
3. [Data model and import contract](data-model)
4. [Integration contracts](integrations)
5. [Security and compliance](security-compliance)
6. [Acceptance and pilot plan](acceptance-plan)
7. [Open decisions and evidence requests](open-decisions)

## Existing context

- [Discovery workbook](../debtor-recovery-platform-discovery)
- [Consolidated requirements v0.2](../debtor-recovery-platform-requirements)
- Existing portal mentioned by owner: `internal.nklodha.in`, with a Debt Recovery tab. Repository/access not yet provided.
- GST SOP source: `C:\Users\lovel\OneDrive\Desktop\SOP For GST Communication between taxpayer.pdf`
- [MSME ODR video analysis](../msme-odr-video-analysis)
- MSME source video: `C:\Users\lovel\Downloads\E_filing_New.mp4`

## Hard constraints

- Single firm initially: Lodha CFO and Data Analytics OPC Limited.
- India-hosted primary data.
- Responsive web/PWA; low-bandwidth/mobile use.
- Client sees only its own cases and can upload invoice/ledger/debtor data.
- Internal staff operate cases; admin has global controls.
- Government portals are browser-based with CAPTCHA/OTP; launch mode is human-assisted.
- MSME ODR Main Case Filing visibly has seven stages: claimant/seller, respondent/buyer, advocate, statement of claim, documents, checklist and preview.
- No OTP storage. Any credential vault requires explicit security approval.
- Do not implement statutory/legal assumptions that are not validated by counsel and the supplied portal SOPs.

## Handoff instruction

The next agent should inspect this pack, request the existing portal repository, validate the open decisions, then propose 2–3 architecture approaches and a phased implementation plan. It must not start coding until the owner approves the design and the GST/MSME portal boundaries are confirmed.
