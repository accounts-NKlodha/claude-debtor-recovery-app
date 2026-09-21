import { describe, expect, it } from "vitest";
import { advance, initialState, type WorkflowState } from "./workflow";

function drive(state: WorkflowState, events: Parameters<typeof advance>[1][]) {
  let s = state;
  const notes: string[] = [];
  for (const e of events) {
    const t = advance(s, e);
    s = t.next;
    notes.push(t.note);
  }
  return { state: s, notes };
}

describe("workflow state machine", () => {
  it("upload alone never activates a case (gates hold)", () => {
    const { state } = drive(initialState(100_000_00), [
      { type: "UPLOAD_ACCEPTED" },
      { type: "DETERMINISTIC_CHECKS_COMPLETE", lowConfidence: false, missingMandatory: false },
    ]);
    expect(state.status).not.toBe("active");
    expect(state.blocker).toMatch(/certification/i);
  });

  it("advances to active only after certification + validation + age gate", () => {
    const t1 = drive(initialState(100_000_00), [
      { type: "UPLOAD_ACCEPTED" },
      { type: "DETERMINISTIC_CHECKS_COMPLETE", lowConfidence: false, missingMandatory: false },
      { type: "CLIENT_CERTIFIED" },
      { type: "STAFF_VALIDATED" },
    ]);
    expect(t1.state.status).toBe("under_validation"); // age gate still missing

    const final = advance(t1.state, { type: "AGE_GATE_PASSED" });
    expect(final.next.status).toBe("active");
    expect(final.effect).toEqual({ kind: "schedule_reminder" });
  });

  it("low OCR confidence raises a staff task", () => {
    const t = advance(
      { ...initialState(1), status: "under_validation" },
      { type: "DETERMINISTIC_CHECKS_COMPLETE", lowConfidence: true, missingMandatory: false },
    );
    expect(t.next.status).toBe("correction_required");
    expect(t.effect).toMatchObject({ kind: "raise_task", task: "ocr_low_confidence" });
  });

  it("starts the 24h timer only after delivery", () => {
    const active: WorkflowState = { ...initialState(1), status: "initial_communication_sent" };
    const noTimerYet = advance(active, { type: "REMINDER_SENT" });
    expect(noTimerYet.effect).toBeNull();
    const delivered = advance(active, { type: "REMINDER_DELIVERED" });
    expect(delivered.effect).toEqual({ kind: "start_timer", timer: "reminder_24h" });
  });

  it("pauses escalation when both channels fail", () => {
    const s: WorkflowState = { ...initialState(1), status: "initial_communication_sent" };
    const t = advance(s, { type: "REMINDER_DELIVERY_FAILED", bothChannels: true });
    expect(t.next.status).toBe("contact_update_required");
    expect(t.next.waitingOn).toBe("client");
    expect(t.effect).toMatchObject({ task: "contact_correction", urgent: true });
  });

  it("confirmed full payment cancels escalation from any state", () => {
    for (const status of ["gst_notification_filed", "msme_odr_filed", "hearing_scheduled"] as const) {
      const t = advance(
        { ...initialState(50_000_00), status, principalOutstanding: 50_000_00 },
        { type: "PAYMENT_CONFIRMED", fullSettlement: true },
      );
      expect(t.next.status).toBe("recovered");
      expect(t.next.principalOutstanding).toBe(0);
      expect(t.effect).toEqual({ kind: "cancel_pending_external_actions" });
    }
  });

  it("24h silence after the initial reminder makes the follow-up due but does NOT jump to GST review", () => {
    const s: WorkflowState = { ...initialState(1), status: "initial_communication_sent" };
    const t = advance(s, { type: "TIMER_24H_ELAPSED" });
    expect(t.next.status).toBe("initial_communication_sent");
    expect(t.next.waitingOn).toBe("staff");
    expect(t.next.blocker).toMatch(/follow-up reminder due/i);
    expect(t.effect).toBeNull();
  });

  it("an operator-sent follow-up moves to follow_up_sent and starts the second 24h window", () => {
    const s: WorkflowState = { ...initialState(1), status: "initial_communication_sent" };
    const t = advance(s, { type: "FOLLOW_UP_SENT" });
    expect(t.next.status).toBe("follow_up_sent");
    expect(t.next.waitingOn).toBe("system");
    expect(t.effect).toEqual({ kind: "start_timer", timer: "reminder_24h" });
  });

  it("GST eligibility review only follows silence AFTER the follow-up, then routes to GST prep", () => {
    let s: WorkflowState = { ...initialState(1), status: "initial_communication_sent" };
    s = advance(s, { type: "TIMER_24H_ELAPSED" }).next;
    s = advance(s, { type: "FOLLOW_UP_SENT" }).next;
    s = advance(s, { type: "TIMER_24H_ELAPSED" }).next;
    expect(s.status).toBe("gst_eligibility_review");
    const decided = advance(s, { type: "GST_ELIGIBILITY_DECIDED", route: "gst" });
    expect(decided.next.status).toBe("gst_notification_prepared");
    expect(decided.effect).toEqual({ kind: "prepare_gst" });
  });

  it("a reply or a confirmed payment during the follow-up window is handled like any waiting state", () => {
    const s: WorkflowState = { ...initialState(100_00), status: "follow_up_sent", principalOutstanding: 100_00 };
    expect(advance(s, { type: "REPLY_CLASSIFIED", classification: "promise_to_pay" }).next.status).toBe("promise_to_pay");
    expect(advance(s, { type: "REPLY_CLASSIFIED", classification: "payment_made" }).next.status).toBe("payment_confirmation_required");
    expect(advance(s, { type: "PAYMENT_CONFIRMED", fullSettlement: true }).next.status).toBe("recovered");
  });

  it("GST 7-day timer starts only after filing", () => {
    const prepared: WorkflowState = { ...initialState(1), status: "gst_notification_prepared" };
    const filed = advance(prepared, { type: "GST_NOTIFICATION_FILED" });
    expect(filed.next.status).toBe("gst_notification_filed");
    expect(filed.effect).toEqual({ kind: "start_timer", timer: "gst_7d" });
  });

  it("falls through GST -> MSME -> manual", () => {
    let s: WorkflowState = { ...initialState(1), status: "gst_notification_filed" };
    s = advance(s, { type: "TIMER_7D_ELAPSED" }).next;
    expect(s.status).toBe("msme_eligibility_review");
    const notEligible = advance(s, { type: "MSME_ELIGIBILITY_DECIDED", eligible: false });
    expect(notEligible.next.status).toBe("dispute_settlement");
    expect(notEligible.next.eligibilityRoute).toBe("non_msme_manual");
  });

  it("a scheduled hearing can be adjourned, then rescheduled back to hearing_scheduled", () => {
    const s: WorkflowState = { ...initialState(1), status: "hearing_scheduled", waitingOn: "portal" };
    const adjourned = advance(s, { type: "HEARING_ADJOURNED" });
    expect(adjourned.next.status).toBe("adjourned");
    expect(adjourned.next.waitingOn).toBe("portal");
    expect(adjourned.effect).toBeNull(); // hearing_followup task stays the operative one

    const rescheduled = advance(adjourned.next, { type: "HEARING_SCHEDULED" });
    expect(rescheduled.next.status).toBe("hearing_scheduled");
  });

  it("confirmed full payment / dispute resolution also apply from adjourned", () => {
    const adjourned: WorkflowState = { ...initialState(50_000_00), status: "adjourned", principalOutstanding: 50_000_00 };
    const paid = advance(adjourned, { type: "PAYMENT_CONFIRMED", fullSettlement: true });
    expect(paid.next.status).toBe("recovered");

    const resolved = advance(adjourned, { type: "DISPUTE_RESOLVED", recovered: false });
    expect(resolved.next.status).toBe("closed");
  });

  it("dispute reply opens a staff resolution task", () => {
    const s: WorkflowState = { ...initialState(1), status: "initial_communication_sent" };
    const t = advance(s, { type: "REPLY_CLASSIFIED", classification: "dispute" });
    expect(t.next.status).toBe("dispute_settlement");
    expect(t.effect).toMatchObject({ task: "dispute_resolution" });
  });

  it("automation failure raises an urgent task", () => {
    const t = advance(initialState(1), { type: "AUTOMATION_FAILED", reason: "portal drift" });
    expect(t.next.status).toBe("automation_failed");
    expect(t.effect).toMatchObject({ urgent: true });
  });
});
