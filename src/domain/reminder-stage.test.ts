import { describe, expect, it } from "vitest";
import type { Communication, Invoice, RecoveryCase } from "@/contract/types";
import {
  advancesOver, deriveInvoiceReminderStates, escalationReadiness, hasAcceptedEmailInitial, summarizeReminderStage,
} from "./reminder-stage";
import { applyReminderStage } from "./reminder";

const T0 = "2026-09-20T05:00:00Z";
const plus = (h: number) => new Date(new Date(T0).getTime() + h * 3_600_000).toISOString();
const inv = (id: string, n: string, outstanding = 100): Invoice => ({ id, caseId: "c1", invoiceNumber: n, invoiceTotal: 100, outstandingBalance: outstanding }) as Invoice;
const kase = (over: Partial<RecoveryCase> = {}): RecoveryCase => ({ id: "c1", status: "active", nextScheduledAt: null, ...over }) as RecoveryCase;
const wa = (key: string, at: string, deliveryStatus = "sent"): Communication =>
  ({ id: key, channel: "whatsapp", direction: "outbound", idempotencyKey: key, deliveryStatus, createdAt: at }) as Communication;
const A = inv("a", "A"), B = inv("b", "B"), C = inv("c", "C");

describe("deriveInvoiceReminderStates", () => {
  it("derives each invoice's stage and windows from its own accepted communications only", () => {
    const states = deriveInvoiceReminderStates({
      kase: kase({ status: "initial_communication_sent" }),
      invoices: [A, B, C],
      communications: [wa("wa:initial-reminder:c1:a", T0), wa("wa:initial-reminder:c1:b", plus(10)), wa("wa:followup-reminder:c1:a:1", plus(25))],
    });
    expect(states.map((s) => s.stage)).toEqual(["follow_up_sent", "initial_sent", "not_reminded"]);
    expect(states[0].followUpDueAt).toBe(plus(24));
    expect(states[1].followUpDueAt).toBe(plus(34));
    expect(states[0].finalWindowEndsAt).toBe(plus(49));
  });

  it("failed / queued attempts never count as a reminder", () => {
    const [s] = deriveInvoiceReminderStates({ kase: kase(), invoices: [A], communications: [wa("wa:initial-reminder:c1:a", T0, "failed"), wa("wa:initial-reminder:c1:a", T0, "queued")] });
    expect(s.stage).toBe("not_reminded");
  });

  it("an invoice with no balance is settled and needs no reminder", () => {
    expect(deriveInvoiceReminderStates({ kase: kase(), invoices: [inv("z", "Z", 0)], communications: [] })[0].stage).toBe("settled");
  });

  it("the single email stands in for the initial reminder only on a one-invoice case", () => {
    const email = { id: "e", channel: "email", direction: "outbound", idempotencyKey: "reminder-initial:email:c1:2026-09-20", deliveryStatus: "sent", createdAt: T0 } as Communication;
    expect(deriveInvoiceReminderStates({ kase: kase(), invoices: [A], communications: [email] })[0].stage).toBe("initial_sent");
    expect(deriveInvoiceReminderStates({ kase: kase(), invoices: [A, B], communications: [email] }).map((s) => s.stage)).toEqual(["not_reminded", "not_reminded"]);
    expect(hasAcceptedEmailInitial("c1", [email])).toBe(true);
    expect(hasAcceptedEmailInitial("other", [email])).toBe(false);
  });

  it("a legacy single-invoice case already in the reminder stage keeps its own recorded window", () => {
    const [s] = deriveInvoiceReminderStates({ kase: kase({ status: "initial_communication_sent", nextScheduledAt: plus(24) }), invoices: [A], communications: [] });
    expect(s.stage).toBe("initial_sent");
    expect(s.initialSource).toBe("legacy");
    expect(s.followUpDueAt).toBe(plus(24));
  });
});

describe("summarizeReminderStage / advancesOver", () => {
  const states = (comms: Communication[], invs = [A, B]) => deriveInvoiceReminderStates({ kase: kase(), invoices: invs, communications: comms });

  it("is the slowest outstanding invoice that decides the aggregate", () => {
    expect(summarizeReminderStage(states([]))!.status).toBe("active");
    expect(summarizeReminderStage(states([wa("wa:initial-reminder:c1:a", T0)]))!.status).toBe("initial_communication_sent");
    const both = [wa("wa:initial-reminder:c1:a", T0), wa("wa:initial-reminder:c1:b", T0)];
    expect(summarizeReminderStage(states([...both, wa("wa:followup-reminder:c1:a:1", plus(25))]))!.status).toBe("initial_communication_sent");
    const done = summarizeReminderStage(states([...both, wa("wa:followup-reminder:c1:a:1", plus(25)), wa("wa:followup-reminder:c1:b:1", plus(30))]))!;
    expect(done.status).toBe("follow_up_sent");
    expect(done.nextScheduledAt).toBe(plus(54)); // the LAST invoice's final window
  });

  it("returns null when nothing is outstanding", () => {
    expect(summarizeReminderStage(states([], [inv("z", "Z", 0)]))).toBeNull();
  });

  it("never regresses", () => {
    expect(advancesOver("active", "initial_communication_sent")).toBe(true);
    expect(advancesOver("initial_communication_sent", "active")).toBe(false);
    expect(advancesOver("follow_up_sent", "follow_up_sent")).toBe(false);
    expect(advancesOver("promise_to_pay", "follow_up_sent")).toBe(false);
  });
});

describe("escalationReadiness", () => {
  it("is not ready with no outstanding invoice, and lists a blocker per unresolved invoice", () => {
    expect(escalationReadiness([], new Date(T0)).ready).toBe(false);
    const s = deriveInvoiceReminderStates({ kase: kase(), invoices: [A, B], communications: [wa("wa:initial-reminder:c1:a", T0)] });
    const r = escalationReadiness(s, new Date(plus(100)));
    expect(r.ready).toBe(false);
    expect(r.blockers).toHaveLength(2);
  });
});

describe("applyReminderStage", () => {
  const sum = (comms: Communication[], invs = [A, B]) =>
    summarizeReminderStage(deriveInvoiceReminderStates({ kase: kase(), invoices: invs, communications: comms }))!;

  it("moves active -> initial_communication_sent on the first reminder and reports partial progress on a multi-invoice case", () => {
    const { updatedCase } = applyReminderStage(kase(), sum([wa("wa:initial-reminder:c1:a", T0)]), { at: new Date(T0), detail: "x" });
    expect(updatedCase.status).toBe("initial_communication_sent");
    expect(updatedCase.blocker).toMatch(/1 of 2 outstanding invoices reminded; 1 still await an initial reminder/);
  });

  it("does not reach follow_up_sent until every outstanding invoice has its follow-up", () => {
    const base = [wa("wa:initial-reminder:c1:a", T0), wa("wa:initial-reminder:c1:b", T0)];
    const partial = applyReminderStage(kase({ status: "initial_communication_sent" }), sum([...base, wa("wa:followup-reminder:c1:a:1", plus(25))]), { at: new Date(plus(25)), detail: "x" });
    expect(partial.updatedCase.status).toBe("initial_communication_sent");
    const full = applyReminderStage(kase({ status: "initial_communication_sent" }), sum([...base, wa("wa:followup-reminder:c1:a:1", plus(25)), wa("wa:followup-reminder:c1:b:1", plus(26))]), { at: new Date(plus(26)), detail: "x" });
    expect(full.updatedCase.status).toBe("follow_up_sent");
    expect(full.updatedCase.status).not.toBe("gst_eligibility_review");
  });
});
