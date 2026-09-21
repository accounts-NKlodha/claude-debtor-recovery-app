/**
 * Case activation gates (PRD §7; workflow-spec: "Upload alone does not
 * activate a case or waive client certification, staff/legal determination,
 * the 60-day overdue gate ...").
 *
 * A case becomes `active` only when ALL THREE gates hold:
 *   1. client certification  -- the client certified the debt (recorded by staff, audited);
 *   2. staff validation      -- staff confirmed the extracted invoice data (OCR confirmation
 *                               or an explicit validation record, audited);
 *   3. 60-day age gate       -- every outstanding invoice is at least 60 days past its due
 *                               date (IST calendar days). Derived from the data, never asserted.
 *
 * History: `caseToWorkflowState` reports the three gates as already cleared
 * because it is only correct for a case that is ALREADY past activation. The
 * OCR-confirmation path reused it for `correction_required` cases, so
 * confirming the fields skipped certification and the age gate entirely.
 * This module is the honest pre-activation bridge: gate state is derived
 * from durable evidence (audit events + invoice dates) and fed to the same
 * `advance()` gate check the workflow already defines.
 *
 * Persistence: no new columns. A gate's evidence is the append-only audit
 * event that recorded it (`ocr.corrected` / `case.staff_validated` on an
 * invoice or the case, `case.client_certified` on the case).
 */

import type { Invoice, RecoveryCase } from "@/contract/types";
import { istBusinessDate, istDaysBetween } from "./scheduling";
import { advance, caseToWorkflowState, transitionToCasePatch, type WorkflowEvent } from "./workflow";

export const AGE_GATE_DAYS = 60;

/** Statuses in which the activation gates are still being cleared. */
export const PRE_ACTIVATION_STATUSES = ["received", "under_validation", "correction_required"] as const;
export const isPreActivation = (status: string) => (PRE_ACTIVATION_STATUSES as readonly string[]).includes(status);

/** Audit actions that evidence each gate. */
export const STAFF_VALIDATION_ACTIONS = ["ocr.corrected", "case.staff_validated"] as const;
export const CLIENT_CERTIFICATION_ACTIONS = ["case.client_certified"] as const;
export const ACTIVATION_EVIDENCE_ACTIONS = [...STAFF_VALIDATION_ACTIONS, ...CLIENT_CERTIFICATION_ACTIONS] as const;

export interface ActivationEvidence {
  clientCertified: boolean;
  staffValidated: boolean;
}

/** Reads gate evidence from audit entries about this case or its invoices. */
export function activationEvidenceFrom(
  entries: { action: string; entityId: string | null }[],
  caseId: string,
  invoiceIds: string[],
): ActivationEvidence {
  const relevant = new Set([caseId, ...invoiceIds]);
  const about = entries.filter((e) => e.entityId !== null && relevant.has(e.entityId));
  return {
    clientCertified: about.some((e) => (CLIENT_CERTIFICATION_ACTIONS as readonly string[]).includes(e.action)),
    staffValidated: about.some((e) => (STAFF_VALIDATION_ACTIONS as readonly string[]).includes(e.action)),
  };
}

export interface AgeGateResult {
  passed: boolean;
  /** Days overdue of the LEAST overdue outstanding invoice (null when undeterminable). */
  daysOverdue: number | null;
  detail: string;
}

/** Every outstanding invoice must be >= 60 IST calendar days past its due date. */
export function evaluateAgeGate(invoices: Pick<Invoice, "invoiceNumber" | "dueDate" | "outstandingBalance">[], now: Date): AgeGateResult {
  const outstanding = invoices.filter((i) => i.outstandingBalance > 0);
  if (outstanding.length === 0) return { passed: false, daysOverdue: null, detail: "no invoice has an outstanding balance" };
  const missingDue = outstanding.find((i) => !i.dueDate);
  if (missingDue) {
    return { passed: false, daysOverdue: null, detail: `invoice ${missingDue.invoiceNumber} has no due date, so its age cannot be established` };
  }
  const today = istBusinessDate(now);
  const days = outstanding.map((i) => ({ i, d: istDaysBetween(i.dueDate!.slice(0, 10), today) }));
  const least = days.reduce((a, b) => (b.d < a.d ? b : a));
  const passed = least.d >= AGE_GATE_DAYS;
  return {
    passed,
    daysOverdue: least.d,
    detail: passed
      ? `${least.d} days overdue (${AGE_GATE_DAYS} required)`
      : `invoice ${least.i.invoiceNumber} is only ${Math.max(least.d, 0)} days overdue (${AGE_GATE_DAYS} required)`,
  };
}

export interface ActivationGates {
  clientCertified: boolean;
  staffValidated: boolean;
  ageGatePassed: boolean;
  daysOverdue: number | null;
  ageDetail: string;
  /** Human labels of the gates still open. */
  missing: string[];
}

export function evaluateActivationGates(input: {
  invoices: Pick<Invoice, "invoiceNumber" | "dueDate" | "outstandingBalance">[];
  evidence: ActivationEvidence;
  now: Date;
}): ActivationGates {
  const age = evaluateAgeGate(input.invoices, input.now);
  const missing: string[] = [];
  if (!input.evidence.clientCertified) missing.push("client certification");
  if (!input.evidence.staffValidated) missing.push("staff validation");
  if (!age.passed) missing.push("60-day age gate");
  return {
    clientCertified: input.evidence.clientCertified,
    staffValidated: input.evidence.staffValidated,
    ageGatePassed: age.passed,
    daysOverdue: age.daysOverdue,
    ageDetail: age.detail,
    missing,
  };
}

/**
 * Runs the case through the workflow's own gate check with the REAL gate
 * state. Only pre-activation cases are touched: a case that has already
 * moved on keeps its status (correcting an invoice later must never reset a
 * case to `active`).
 */
export function applyActivationGates(
  kase: RecoveryCase,
  gates: Pick<ActivationGates, "clientCertified" | "staffValidated" | "ageGatePassed" | "missing">,
): { updatedCase: RecoveryCase; note: string; activated: boolean } {
  if (!isPreActivation(kase.status)) {
    return { updatedCase: kase, note: `Activation gates not re-evaluated -- case is already "${kase.status.replace(/_/g, " ")}"`, activated: false };
  }
  let state = {
    ...caseToWorkflowState(kase),
    clientCertified: false,
    staffValidated: false,
    ageGatePassed: false,
  };
  const events: WorkflowEvent[] = [];
  if (gates.clientCertified) events.push({ type: "CLIENT_CERTIFIED" });
  if (gates.staffValidated) events.push({ type: "STAFF_VALIDATED" });
  if (gates.ageGatePassed) events.push({ type: "AGE_GATE_PASSED" });
  if (events.length === 0) {
    return { updatedCase: kase, note: `Activation blocked -- missing ${gates.missing.join(", ")}`, activated: false };
  }
  let note = "";
  for (const event of events) {
    const t = advance(state, event);
    state = t.next;
    note = t.note;
  }
  return { updatedCase: { ...kase, ...transitionToCasePatch(state) }, note, activated: state.status === "active" };
}
