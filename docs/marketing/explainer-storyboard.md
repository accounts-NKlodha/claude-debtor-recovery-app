# Debtrecover explainer — storyboard v2 (mid-fidelity, NKL Design Language)

Beat sheet for a ~80-second motion-graphics explainer aimed at CA firms.
Mid-fidelity frames (960×540, themed with the firm's NKL Design Language) live on the design canvas:
<https://claude.ai/artifact/9DeVwsWDvABAktPhe2NJQE>

**Pitch the film must land:** you already hold the data; say yes, upload, and the
app chases, files and briefs you. You attend one hearing and earn professional fees.

**Copy rules:** never mention % of recovery or no-upfront pricing; no real client
names (use "Favorite Client"); figures on screen are illustrative round numbers.

**On-screen effort split:** CA = 1 ask + 1 upload + 1 hearing. App = 4 automatic
steps (WhatsApp reminders, GST communication, MSME complaint, hearing brief).

| # | Scene | Time | On screen | Voice-over |
|---|-------|------|-----------|------------|
| 1 | Hook | 0:00–0:05 | Tally sundry-debtors ledger, overdue column pulses, ₹ total ticks up | Every CA already holds the one thing debt recovery needs: the data. Most of it just sits there. |
| 2 | The opportunity | 0:05–0:12 | Ledger + GST returns + invoices → Debtrecover → client paid + professional fees; chips: you advise, client asks you to handle it, app executes | You already see which debtors are overdue. Advise the client to file GST and MSME complaints, and when they ask you to handle it, that advice becomes a new engagement with professional fees. |
| 3 | The engagement | 0:12–0:18 | WhatsApp chat: CA advises filing GST + MSME complaints; client asks "Can you do it for me?"; CA: "Yes."; authorisation card flips to received | Step one. You advise your client to file GST and MSME complaints against the debtor. They ask: can you do it for me? You say yes. That is the whole of their involvement. |
| 4 | CA uploads data | 0:18–0:26 | App "New case" dropzone; invoices/CSV drop in; debtor table fills; "Start recovery" | Step two. Drag in the invoices or the ledger export. The app reads them, builds the case, and you press start. |
| 5 | App takes over | 0:26–0:34 | Autopilot toggle ON; pipeline Reminders → GST → MSME → Hearing brief; solid = auto, dashed = CA | Step three. The app does the heavy lifting: reminders, then GST, then MSME, on a fixed clock, with every action on record. |
| 6 | WhatsApp reminders | 0:34–0:42 | Phone with Day 0 / 7 / 14 messages, read ticks, payment link | Reminders go out on WhatsApp and email. Polite, timed, tracked. Nobody in your office types a word. |
| 7 | GST communication | 0:42–0:50 | GST portal taxpayer-communication form auto-fills; SENT stamp with reference | No response? The app drafts the GST taxpayer communication, portal-ready. One review, one click, and the notice sits in the buyer's own GST account. |
| 8 | MSME complaint | 0:50–0:58 | MSME Samadhaan form; evidence chips fly in; interest (3× bank rate) counts up; FILED stamp | Still unpaid? An MSME delayed-payment complaint goes in, with the reminder log, the GST reference and the statutory interest already computed. |
| 9 | Hearing brief | 0:58–1:08 | Calendar ping, WhatsApp ping, one-page brief slides up: facts, amount, timeline, what to say, objections | The one step that needs you: the hearing. The day before, the app sends a one-page brief. What happened, what is owed, and exactly what to say. |
| 10 | Outcome + CTA | 1:08–1:20 | Firm dashboard: recovered, cases, fee earned; "Payment received"; headline "Existing data. New revenue. No chasing."; Book a demo | Payment lands. Your client is paid. You earn professional fees, from data you already had. Debtrecover. Book a demo. |

## Brand applied: NKL Design Language (firm design system)

Ink on ivory, white working surfaces, brass only on the brand tile and selected
details, IBM Plex Sans for UI, IBM Plex Mono for invoice numbers and GSTINs,
6–8 px corners, muted status colours (success / warning / destructive / info).
Primary actions are ink, never brass. WhatsApp mockups keep WhatsApp's own
colours. Note: the shipped app still uses the indigo Geist theme in
`src/app/globals.css`; aligning the product UI to NKL is a separate decision.

## Open items before animation

- Pick one real (anonymised) case so the ₹ blanks and day counts become real numbers.
- Confirm reminder cadence (0/7/14) and GST/MSME trigger days (21/30) against `docs/SPEC.md`.
- Decide whether scene 7 shows one-click "Send" or an explicit CA review step (legally gated flows run in prepare/assist mode today).
- Character illustrations (scenes 1, 5, 9) and portal emblems (7, 8) are still tinted placeholders.
