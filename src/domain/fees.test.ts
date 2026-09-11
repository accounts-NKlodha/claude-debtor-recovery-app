import { describe, expect, it } from "vitest";
import { estimateSuccessFee, successFeeRate } from "./fees";

describe("success fee policy (audit P1-5: was hard-coded at 8%)", () => {
  it("is 10% for a standard client", () => {
    expect(successFeeRate(false)).toBe(0.1);
    expect(estimateSuccessFee(10_00_000, false)).toBe(1_00_000);
  });

  it("is 5% for an eligible early JITO-member client", () => {
    expect(successFeeRate(true)).toBe(0.05);
    expect(estimateSuccessFee(10_00_000, true)).toBe(50_000);
  });
});
