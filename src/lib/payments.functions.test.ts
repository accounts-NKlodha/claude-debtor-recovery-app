/**
 * Covers validateRecordPaymentInput (payments.functions.ts, M1 Batch 4) --
 * the pure guard behind recordPaymentFn: explicit case selection is
 * mandatory (no silent/automatic case selection is ever introduced), and
 * rupees -> paise conversion via the shared moneyToPaise schema. Plain
 * function, no Start runtime context needed.
 */
import { describe, expect, it } from "vitest";
import { validateRecordPaymentInput } from "./payments.functions";

describe("validateRecordPaymentInput", () => {
  it("rejects a missing case -- explicit Organisation -> Case selection is mandatory", () => {
    expect(validateRecordPaymentInput("", "1000")).toEqual({
      ok: false,
      error: "Select an organisation and case before recording a receipt.",
    });
  });

  it("converts human-entered rupees (with thousands separators) to integer paise", () => {
    expect(validateRecordPaymentInput("case-1", "1,25,000")).toEqual({ ok: true, amount: 12_500_000 });
    expect(validateRecordPaymentInput("case-1", "125000.50")).toEqual({ ok: true, amount: 12_500_050 });
  });

  it("rejects a zero or negative amount", () => {
    expect(validateRecordPaymentInput("case-1", "0")).toEqual({
      ok: false,
      error: "Enter an amount greater than zero.",
    });
  });

  it("rejects a non-numeric amount", () => {
    expect(validateRecordPaymentInput("case-1", "not-a-number")).toEqual({
      ok: false,
      error: "Enter a valid amount, e.g. 1,25,000.",
    });
  });
});
