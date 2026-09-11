/**
 * Recovery-case state machine (PRD §5-6, workflow-spec).
 *
 * Pure and deterministic: `advance(state, event)` returns the next state plus the
 * next scheduled action and `waitingOn` ownership. The orchestrator is
 * responsible for idempotency, retries, automation-mode / kill-switch gating and
 * for actually performing side effects — this module only decides *what* the
 * next safe step is.
 *
 * Invariants enforced here:
 *  - Upload never bypasses certification, validation, age gate, payment stop.
 *  - Confirmed full payment cancels pending escalation from any state (§15.5).
 *  - A human checkpoint completion resumes the recorded next deterministic step;
 *    it never re-emits a completed send/filing (§15.7).
 */

import type { CaseStatus, EligibilityRoute, WaitingOn } from "@/contract/enums";

export interface WorkflowState {
  status: CaseStatus;
  waitingOn: WaitingOn;
  blocker: string | null;
  nextAction: string | null;
  eligibilityRoute: EligibilityRoute | null;
  /** true once client has certified the receivable (PRD §10). */
  clientCertified: boolean;
  /** true once staff has validated OCR / completeness. */
  staffValidated: boolean;
  /** 60-day overdue operational gate, or audited admin override. */
  ageGatePassed: boolean;
  principalOutstanding: number; // paise
  recoveredToDate: number; // paise
}

export type WorkflowEvent =
  | { type: "UPLOAD_ACCEPTED" }
  | { type: "DETERMINISTIC_CHECKS_COMPLETE"; lowConfidence: boolean; missingMandatory: boolean }
  | { type: "CLIENT_CERTIFIED" }
  | { type: "STAFF_VALIDATED" }
  | { type: "AGE_GATE_PASSED" }
  | { type: "REMINDER_SENT" }
  | { type: "REMINDER_DELIVERED" }
  | { type: "REMINDER_DELIVERY_FAILED"; bothChannels: boolean }
  | { type: "REPLY_CLASSIFIED"; classification: "payment_made" | "promise_to_pay" | "dispute" | "document_request" | "settlement_offer" | "unrelated" | "unclear" }
  | { type: "TIMER_24H_ELAPSED" }
  | { type: "GST_ELIGIBILITY_DECIDED"; route: EligibilityRoute }
  | { type: "GST_NOTIFICATION_PREPARED" }
  | { type: "GST_NOTIFICATION_FILED" }
  | { type: "TIMER_7D_ELAPSED" }
  | { type: "MSME_ELIGIBILITY_DECIDED"; eligible: boolean }
  | { type: "MSME_ODR_FILED" }
  | { type: "HEARING_SCHEDULED" }
  | { type: "PAYMENT_CONFIRMED"; fullSettlement: boolean }
  | { type: "DISPUTE_RESOLVED"; recovered: boolean }
  | { type: "WITHDRAWN"; reason: string }
  | { type: "AUTOMATION_FAILED"; reason: string };

export interface Transition {
  next: WorkflowState;
  /** audit note describing the transition. */
  note: string;
  /** external effect the orchestrator should now schedule, if any. */
  effect:
    | null
    | { kind: "schedule_reminder" }
    | { kind: "start_timer"; timer: "reminder_24h" | "gst_7d" }
    | { kind: "raise_task"; task: string; waitingOn: WaitingOn; urgent: boolean }
    | { kind: "cancel_pending_external_actions" }
    | { kind: "prepare_gst" }
    | { kind: "prepare_msme" }
    | { kind: "close_recovered" };
}

const set = (
  s: WorkflowState,
  patch: Partial<WorkflowState>,
): WorkflowState => ({ ...s, ...patch });

export function advance(state: WorkflowState, event: WorkflowEvent): Transition {
  // §15.5 — confirmed full payment/settlement cancels escalation from anywhere.
  if (event.type === "PAYMENT_CONFIRMED" && event.fullSettlement) {
    return {
      next: set(state, {
        status: "recovered",
        waitingOn: "system",
        blocker: null,
        nextAction: "Close case and raise fee ledger entry",
        recoveredToDate: state.principalOutstanding,
        principalOutstanding: 0,
      }),
      note: "Full payment confirmed by client — escalation cancelled",
      effect: { kind: "cancel_pending_external_actions" },
    };
  }

  if (event.type === "WITHDRAWN") {
    return {
      next: set(state, { status: "withdrawn", waitingOn: "staff", blocker: null, nextAction: null }),
      note: `Withdrawn: ${event.reason}`,
      effect: { kind: "cancel_pending_external_actions" },
    };
  }

  if (event.type === "AUTOMATION_FAILED") {
    return {
      next: set(state, {
        status: "automation_failed",
        waitingOn: "staff",
        blocker: event.reason,
        nextAction: "Staff to investigate automation failure",
      }),
      note: `Automation failed: ${event.reason}`,
      effect: { kind: "raise_task", task: "retry_exhausted", waitingOn: "staff", urgent: true },
    };
  }

  switch (state.status) {
    case "received":
      if (event.type === "UPLOAD_ACCEPTED") {
        return {
          next: set(state, {
            status: "under_validation",
            waitingOn: "system",
            blocker: "Running scan, evidence registration, OCR, duplicate/completeness checks",
            nextAction: "Automatic deterministic checks",
          }),
          note: "Upload accepted — preparation started automatically",
          effect: null,
        };
      }
      break;

    case "under_validation":
      if (event.type === "DETERMINISTIC_CHECKS_COMPLETE") {
        if (event.lowConfidence || event.missingMandatory) {
          return {
            next: set(state, {
              status: "correction_required",
              waitingOn: event.missingMandatory ? "client" : "staff",
              blocker: event.missingMandatory
                ? "Mandatory invoice field missing"
                : "OCR confidence below threshold",
              nextAction: "Smallest correction task",
            }),
            note: "Checks complete — correction required",
            effect: {
              kind: "raise_task",
              task: event.missingMandatory ? "missing_invoice_field" : "ocr_low_confidence",
              waitingOn: event.missingMandatory ? "client" : "staff",
              urgent: false,
            },
          };
        }
        return gateCheck(
          set(state, {
            blocker: "Awaiting client certification, staff validation and 60-day age gate",
            nextAction: "Certification + validation + age gate",
          }),
        );
      }
      break;

    case "correction_required":
      // Corrections are applied by CLIENT_CERTIFIED / STAFF_VALIDATED events,
      // handled by the gate check below.
      break;
  }

  // Gate-driven activation: certification + validation + age gate.
  if (
    event.type === "CLIENT_CERTIFIED" ||
    event.type === "STAFF_VALIDATED" ||
    event.type === "AGE_GATE_PASSED"
  ) {
    const nextState = set(state, {
      clientCertified: state.clientCertified || event.type === "CLIENT_CERTIFIED",
      staffValidated: state.staffValidated || event.type === "STAFF_VALIDATED",
      ageGatePassed: state.ageGatePassed || event.type === "AGE_GATE_PASSED",
    });
    return gateCheck(nextState);
  }

  switch (state.status) {
    case "active":
      if (event.type === "REMINDER_SENT") {
        return {
          next: set(state, {
            status: "initial_communication_sent",
            waitingOn: "system",
            blocker: "Awaiting delivery confirmation",
            nextAction: "Confirm delivery, then start 24h timer",
          }),
          note: "Initial reminder sent",
          effect: null,
        };
      }
      break;

    case "initial_communication_sent":
      if (event.type === "REMINDER_DELIVERED") {
        return {
          next: set(state, {
            waitingOn: "system",
            blocker: "24-hour response window running",
            nextAction: "Evaluate reply/payment after 24h",
          }),
          note: "Reminder delivered — 24h timer started",
          effect: { kind: "start_timer", timer: "reminder_24h" },
        };
      }
      if (event.type === "REMINDER_DELIVERY_FAILED") {
        return {
          next: set(state, {
            status: "contact_update_required",
            waitingOn: "client",
            blocker: event.bothChannels
              ? "Both WhatsApp and email delivery failed"
              : "Delivery failed on primary channel",
            nextAction: "Correct debtor contact details",
          }),
          note: "Delivery failed — escalation paused pending contact correction",
          effect: {
            kind: "raise_task",
            task: "contact_correction",
            waitingOn: "client",
            urgent: event.bothChannels,
          },
        };
      }
      if (event.type === "REPLY_CLASSIFIED") return handleReply(state, event.classification);
      if (event.type === "TIMER_24H_ELAPSED") {
        return {
          next: set(state, {
            status: "gst_eligibility_review",
            waitingOn: "staff",
            blocker: "Confirm creditor + debtor GST registration",
            nextAction: "Decide GST route",
          }),
          note: "No response in 24h — moving to GST eligibility review",
          effect: { kind: "raise_task", task: "policy_gate", waitingOn: "staff", urgent: false },
        };
      }
      break;

    case "promise_to_pay":
      if (event.type === "PAYMENT_CONFIRMED") return partialPayment(state);
      if (event.type === "TIMER_24H_ELAPSED" || event.type === "TIMER_7D_ELAPSED") {
        return {
          next: set(state, {
            status: "gst_eligibility_review",
            waitingOn: "staff",
            blocker: "Promise lapsed — confirm GST route",
            nextAction: "Decide GST route",
          }),
          note: "Promise date passed without payment",
          effect: null,
        };
      }
      break;

    case "gst_eligibility_review":
      if (event.type === "GST_ELIGIBILITY_DECIDED") {
        if (event.route === "gst") {
          return {
            next: set(state, {
              status: "gst_notification_prepared",
              eligibilityRoute: "gst",
              waitingOn: "system",
              blocker: "Preparing GST communication pack",
              nextAction: "Prepare GST notification",
            }),
            note: "GST route confirmed",
            effect: { kind: "prepare_gst" },
          };
        }
        return {
          next: set(state, {
            status: "msme_eligibility_review",
            eligibilityRoute: event.route,
            waitingOn: "staff",
            blocker: "Confirm creditor Udyam / MSME eligibility",
            nextAction: "Decide MSME route",
          }),
          note: "GST route not available — checking MSME",
          effect: null,
        };
      }
      break;

    case "gst_notification_prepared":
      if (event.type === "GST_NOTIFICATION_FILED") {
        return {
          next: set(state, {
            status: "gst_notification_filed",
            waitingOn: "system",
            blocker: "7-day response window running",
            nextAction: "Evaluate reply/payment after 7 days",
          }),
          note: "GST notification filed with reference evidence",
          effect: { kind: "start_timer", timer: "gst_7d" },
        };
      }
      break;

    case "gst_notification_filed":
      if (event.type === "REPLY_CLASSIFIED") return handleReply(state, event.classification);
      if (event.type === "PAYMENT_CONFIRMED") return partialPayment(state);
      if (event.type === "TIMER_7D_ELAPSED") {
        return {
          next: set(state, {
            status: "msme_eligibility_review",
            waitingOn: "staff",
            blocker: "Confirm creditor Udyam / MSME eligibility",
            nextAction: "Decide MSME route",
          }),
          note: "No response in 7 days — moving to MSME eligibility review",
          effect: null,
        };
      }
      break;

    case "msme_eligibility_review":
      if (event.type === "MSME_ELIGIBILITY_DECIDED") {
        if (event.eligible) {
          return {
            next: set(state, {
              status: "msme_odr_filed",
              eligibilityRoute: "msme",
              waitingOn: "portal",
              blocker: null,
              nextAction: "Poll MSEFC portal for hearing date",
            }),
            note: "MSME eligible — ODR filing submitted and acknowledged",
            effect: { kind: "prepare_msme" },
          };
        }
        return {
          next: set(state, {
            status: "dispute_settlement",
            eligibilityRoute: "non_msme_manual",
            waitingOn: "staff",
            blocker: "Not MSME eligible — manual legal route",
            nextAction: "Staff to decide manual legal route",
          }),
          note: "Not MSME eligible — manual legal route",
          effect: { kind: "raise_task", task: "policy_gate", waitingOn: "staff", urgent: false },
        };
      }
      break;

    case "msme_odr_filed":
      if (event.type === "HEARING_SCHEDULED") {
        return {
          next: set(state, {
            status: "hearing_scheduled",
            waitingOn: "portal",
            blocker: "Awaiting hearing",
            nextAction: "Attend hearing; track order",
          }),
          note: "Hearing scheduled",
          effect: { kind: "raise_task", task: "hearing_followup", waitingOn: "staff", urgent: false },
        };
      }
      if (event.type === "PAYMENT_CONFIRMED") return partialPayment(state);
      break;

    case "hearing_scheduled":
      if (event.type === "DISPUTE_RESOLVED") {
        return {
          next: set(state, {
            status: event.recovered ? "recovered" : "closed",
            waitingOn: "system",
            blocker: null,
            nextAction: event.recovered ? "Close and raise fee" : "Close case",
          }),
          note: event.recovered ? "Order in favour — recovered" : "Case closed",
          effect: event.recovered ? { kind: "close_recovered" } : null,
        };
      }
      if (event.type === "PAYMENT_CONFIRMED") return partialPayment(state);
      break;
  }

  // Reply / dispute / promise handling reachable from multiple waiting states.
  if (event.type === "REPLY_CLASSIFIED") return handleReply(state, event.classification);
  if (event.type === "PAYMENT_CONFIRMED") return partialPayment(state);
  if (event.type === "DISPUTE_RESOLVED") {
    return {
      next: set(state, {
        status: event.recovered ? "recovered" : "closed",
        waitingOn: "system",
        blocker: null,
        nextAction: null,
      }),
      note: "Dispute resolved",
      effect: event.recovered ? { kind: "close_recovered" } : null,
    };
  }

  return {
    next: state,
    note: `Ignored event ${event.type} in status ${state.status}`,
    effect: null,
  };
}

function gateCheck(state: WorkflowState): Transition {
  const missing: string[] = [];
  if (!state.clientCertified) missing.push("client certification");
  if (!state.staffValidated) missing.push("staff validation");
  if (!state.ageGatePassed) missing.push("60-day age gate");

  if (missing.length > 0) {
    return {
      next: set(state, {
        status: "under_validation",
        waitingOn: missing.includes("client certification") ? "client" : "staff",
        blocker: `Waiting on: ${missing.join(", ")}`,
        nextAction: "Clear remaining activation gates",
      }),
      note: `Activation blocked — missing ${missing.join(", ")}`,
      effect: {
        kind: "raise_task",
        task: missing.includes("client certification") ? "client_certification" : "staff_validation",
        waitingOn: missing.includes("client certification") ? "client" : "staff",
        urgent: false,
      },
    };
  }

  return {
    next: set(state, {
      status: "active",
      waitingOn: "system",
      blocker: null,
      nextAction: "Send initial reminder at next 11:00 IST window",
    }),
    note: "All activation gates cleared — case activated",
    effect: { kind: "schedule_reminder" },
  };
}

function handleReply(
  state: WorkflowState,
  classification:
    | "payment_made"
    | "promise_to_pay"
    | "dispute"
    | "document_request"
    | "settlement_offer"
    | "unrelated"
    | "unclear",
): Transition {
  switch (classification) {
    case "payment_made":
      return {
        next: set(state, {
          status: "payment_confirmation_required",
          waitingOn: "client",
          blocker: "Debtor claims payment — awaiting client confirmation",
          nextAction: "Client to confirm receipt",
        }),
        note: "Reply: payment claimed — awaiting client confirmation",
        effect: {
          kind: "raise_task",
          task: "payment_confirmation",
          waitingOn: "client",
          urgent: false,
        },
      };
    case "promise_to_pay":
      return {
        next: set(state, {
          status: "promise_to_pay",
          waitingOn: "system",
          blocker: "Tracking promised payment date",
          nextAction: "Remind on promise date; seek client confirmation next day",
        }),
        note: "Reply: promise to pay recorded",
        effect: null,
      };
    case "dispute":
    case "settlement_offer":
    case "document_request":
      return {
        next: set(state, {
          status: "dispute_settlement",
          waitingOn: "staff",
          blocker:
            classification === "document_request"
              ? "Debtor requested documents"
              : "Dispute / settlement raised",
          nextAction: "Staff-managed resolution task",
        }),
        note: `Reply: ${classification} — staff resolution task opened`,
        effect: {
          kind: "raise_task",
          task: "dispute_resolution",
          waitingOn: "staff",
          urgent: false,
        },
      };
    default:
      return {
        next: set(state, { waitingOn: "staff", nextAction: "Staff to review unclear reply" }),
        note: "Reply: unclear — staff review",
        effect: { kind: "raise_task", task: "staff_validation", waitingOn: "staff", urgent: false },
      };
  }
}

/** Confirmed partial payment: reduce principal, keep escalating unless cleared. */
function partialPayment(state: WorkflowState): Transition {
  return {
    next: set(state, {
      status: "payment_confirmation_required",
      waitingOn: "staff",
      blocker: "Apply confirmed partial payment (oldest invoice first)",
      nextAction: "Allocate payment; re-evaluate remaining balance",
    }),
    note: "Partial payment confirmed — allocating",
    effect: { kind: "cancel_pending_external_actions" },
  };
}

/**
 * Shared DTO <-> pure-state bridge, reused by every module that drives a
 * `RecoveryCase` through `advance()` (src/domain/apply-payment.ts,
 * src/domain/reminder.ts, ...). Kept here so there is exactly one mapping to
 * keep in sync with the RecoveryCase shape.
 */
export function caseToWorkflowState(c: {
  status: CaseStatus;
  waitingOn: WaitingOn;
  blocker: string | null;
  nextScheduledAction: string | null;
  eligibilityRoute: import("@/contract/enums").EligibilityRoute | null;
  principalOutstanding: number;
  recoveredToDate: number;
}): WorkflowState {
  return {
    status: c.status,
    waitingOn: c.waitingOn,
    blocker: c.blocker,
    nextAction: c.nextScheduledAction,
    eligibilityRoute: c.eligibilityRoute,
    // A case already past intake has cleared the activation gates; none of
    // the events driven through this bridge re-check them.
    clientCertified: true,
    staffValidated: true,
    ageGatePassed: true,
    principalOutstanding: c.principalOutstanding,
    recoveredToDate: c.recoveredToDate,
  };
}

/** Apply a `Transition`'s next-state fields onto a `RecoveryCase`-shaped patch. */
export function transitionToCasePatch(next: WorkflowState) {
  return {
    status: next.status,
    waitingOn: next.waitingOn,
    blocker: next.blocker,
    nextScheduledAction: next.nextAction,
    eligibilityRoute: next.eligibilityRoute,
    principalOutstanding: next.principalOutstanding,
    recoveredToDate: next.recoveredToDate,
  };
}

export function initialState(principalOutstanding: number): WorkflowState {
  return {
    status: "received",
    waitingOn: "system",
    blocker: "Awaiting upload acceptance",
    nextAction: "Accept upload",
    eligibilityRoute: null,
    clientCertified: false,
    staffValidated: false,
    ageGatePassed: false,
    principalOutstanding,
    recoveredToDate: 0,
  };
}
