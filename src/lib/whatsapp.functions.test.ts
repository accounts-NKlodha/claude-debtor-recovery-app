/**
 * Covers parsePromisedAmountPaise (whatsapp.functions.ts, M1 Batch 2) --
 * the rupees-string -> integer-paise conversion behind
 * recordPaymentPromiseFn. Plain function, no Start runtime context needed.
 */
import { describe, expect, it } from "vitest";
import { parsePromisedAmountPaise } from "./whatsapp.functions";

describe("parsePromisedAmountPaise", () => {
  it("treats a blank amount as valid 'no amount promised' (null)", () => {
    expect(parsePromisedAmountPaise("")).toEqual({ ok: true, value: null });
    expect(parsePromisedAmountPaise(undefined)).toEqual({ ok: true, value: null });
    expect(parsePromisedAmountPaise(null)).toEqual({ ok: true, value: null });
    expect(parsePromisedAmountPaise("   ")).toEqual({ ok: true, value: null });
  });

  it("converts rupees to integer paise", () => {
    expect(parsePromisedAmountPaise("25000")).toEqual({ ok: true, value: 2_500_000 });
    expect(parsePromisedAmountPaise("250.50")).toEqual({ ok: true, value: 25_050 });
  });

  it("strips thousands-separator commas before parsing", () => {
    expect(parsePromisedAmountPaise("1,25,000")).toEqual({ ok: true, value: 12_500_000 });
  });

  it("rejects zero or negative amounts", () => {
    expect(parsePromisedAmountPaise("0")).toEqual({ ok: false, error: "Promised amount must be greater than zero" });
    expect(parsePromisedAmountPaise("-500")).toEqual({ ok: false, error: "Promised amount must be greater than zero" });
  });

  it("rejects non-numeric input", () => {
    expect(parsePromisedAmountPaise("not-a-number")).toEqual({
      ok: false,
      error: "Promised amount must be greater than zero",
    });
  });
});
