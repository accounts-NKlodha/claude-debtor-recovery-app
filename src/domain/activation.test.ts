import { describe, expect, it } from "vitest";
import type { Invoice, RecoveryCase } from "@/contract/types";
import { activationEvidenceFrom, applyActivationGates, evaluateActivationGates, evaluateAgeGate } from "./activation";

const NOW = new Date("2026-09-21T06:00:00Z"); // 11:30 IST
const inv = (number: string, due: string | null, outstanding = 100): Pick<Invoice, "invoiceNumber" | "dueDate" | "outstandingBalance"> => ({
  invoiceNumber: number,
  dueDate: due,
  outstandingBalance: outstanding,
});
const kase = (status: RecoveryCase["status"]): RecoveryCase =>
  ({ id: "c1", status, waitingOn: "staff", blocker: null, nextScheduledAction: null, eligibilityRoute: null, principalOutstanding: 100, recoveredToDate: 0 }) as RecoveryCase;

describe("evaluateAgeGate (60 IST calendar days past the due date)", () => {
  it("passes at exactly 60 days and fails at 59", () => {
    expect(evaluateAgeGate([inv("A", "2026-07-23")], NOW)).toMatchObject({ passed: true, daysOverdue: 60 });
    expect(evaluateAgeGate([inv("A", "2026-07-24")], NOW)).toMatchObject({ passed: false, daysOverdue: 59 });
  });
  it("uses the IST date: 01:30 IST on 21 Sep counts the 21st, not the UTC 20th", () => {
    const early = new Date("2026-09-20T20:00:00Z");
    expect(evaluateAgeGate([inv("A", "2026-07-23")], early).daysOverdue).toBe(60);
  });
  it("the LEAST overdue outstanding invoice decides; settled invoices are ignored", () => {
    const r = evaluateAgeGate([inv("OLD", "2026-01-01"), inv("NEW", "2026-09-01"), inv("PAID", "2026-09-20", 0)], NOW);
    expect(r).toMatchObject({ passed: false, daysOverdue: 20 });
    expect(r.detail).toMatch(/NEW/);
  });
  it("a missing due date can never pass", () => {
    const r = evaluateAgeGate([inv("A", null)], NOW);
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/no due date/);
  });
  it("nothing outstanding cannot pass", () => {
    expect(evaluateAgeGate([inv("A", "2026-01-01", 0)], NOW).passed).toBe(false);
  });
});

describe("activationEvidenceFrom", () => {
  it("reads gate evidence for this case and its invoices only", () => {
    const entries = [
      { action: "ocr.corrected", entityId: "inv-1" },
      { action: "case.client_certified", entityId: "other-case" },
    ];
    expect(activationEvidenceFrom(entries, "c1", ["inv-1"])).toEqual({ clientCertified: false, staffValidated: true });
    expect(activationEvidenceFrom([...entries, { action: "case.client_certified", entityId: "c1" }], "c1", ["inv-1"])).toEqual({
      clientCertified: true,
      staffValidated: true,
    });
    expect(activationEvidenceFrom([], "c1", [])).toEqual({ clientCertified: false, staffValidated: false });
  });
});

describe("applyActivationGates drives the workflow gate check with real gate state", () => {
  const gates = (o: Partial<{ c: boolean; s: boolean; a: boolean }>) =>
    evaluateActivationGates({
      invoices: [inv("A", o.a === false ? "2026-09-01" : "2026-07-15")],
      evidence: { clientCertified: o.c ?? false, staffValidated: o.s ?? false },
      now: NOW,
    });

  it("all three gates -> active", () => {
    const g = gates({ c: true, s: true, a: true });
    expect(g.missing).toEqual([]);
    expect(applyActivationGates(kase("under_validation"), g)).toMatchObject({ activated: true, updatedCase: { status: "active" } });
  });
  it.each([
    ["client certification", { c: false, s: true, a: true }],
    ["staff validation", { c: true, s: false, a: true }],
    ["60-day age gate", { c: true, s: true, a: false }],
  ])("missing %s -> stays under_validation and names the missing gate", (label, o) => {
    const out = applyActivationGates(kase("under_validation"), gates(o));
    expect(out.activated).toBe(false);
    expect(out.updatedCase.status).toBe("under_validation");
    expect(out.updatedCase.blocker).toContain(label);
  });
  it("no gate at all leaves the case unchanged", () => {
    const k = kase("correction_required");
    expect(applyActivationGates(k, gates({ c: false, s: false, a: false })).updatedCase).toBe(k);
  });
  it.each(["active", "initial_communication_sent", "recovered", "promise_to_pay"] as const)("a %s case is never re-gated", (status) => {
    const k = kase(status);
    const out = applyActivationGates(k, gates({ c: true, s: true, a: true }));
    expect(out.updatedCase).toBe(k);
    expect(out.activated).toBe(false);
  });
});
