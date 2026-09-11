import { describe, expect, it } from "vitest";
import { createDraftCase, runIntakeChecks, type IntakeInvoiceInput } from "./intake";

const complete: IntakeInvoiceInput = {
  debtorName: "Beta Traders",
  debtorGstin: "29BBBBB1111B1Z5",
  invoiceNumber: "INV-100",
  invoiceDate: "2026-06-01",
  taxableValue: 100_000_00,
  taxRate: 18,
  taxAmount: 18_000_00,
  invoiceTotal: 118_000_00,
  outstandingBalance: 118_000_00,
};

describe("runIntakeChecks", () => {
  it("passes a complete invoice", () => {
    expect(runIntakeChecks(complete)).toEqual({ missingMandatory: false, missingFields: [] });
  });

  it("flags a missing GSTIN", () => {
    const { missingMandatory, missingFields } = runIntakeChecks({ ...complete, debtorGstin: null });
    expect(missingMandatory).toBe(true);
    expect(missingFields).toContain("debtorGstin");
  });
});

describe("createDraftCase (acceptance scenarios 0, 14)", () => {
  it("an upload alone starts preparation but never activates the case", () => {
    const { state, transitions } = createDraftCase(complete.outstandingBalance, complete);
    expect(transitions.map((t) => t.next.status)).toEqual(["under_validation", "under_validation"]);
    expect(state.status).toBe("under_validation");
    expect(state.blocker).toMatch(/certification|validation|age gate/i);
    expect(state.waitingOn).not.toBe("system"); // stops visibly, waiting on a human gate
  });

  it("a missing-mandatory-field upload creates a correction task instead", () => {
    const { state } = createDraftCase(0, { ...complete, invoiceNumber: "" });
    expect(state.status).toBe("correction_required");
    expect(state.waitingOn).toBe("client");
  });
});
