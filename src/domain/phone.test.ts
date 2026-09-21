import { describe, expect, it } from "vitest";
import { normalizeIndianMobile } from "./phone";

describe("normalizeIndianMobile", () => {
  it("normalizes a bare 10-digit number", () => {
    expect(normalizeIndianMobile("9876543210")).toEqual({ destination: "+919876543210" });
  });

  it("normalizes an already-+91-prefixed number", () => {
    expect(normalizeIndianMobile("+919876543210")).toEqual({ destination: "+919876543210" });
  });

  it("normalizes a 91-prefixed number without a plus", () => {
    expect(normalizeIndianMobile("919876543210")).toEqual({ destination: "+919876543210" });
  });

  it("strips spaces and hyphens before normalizing", () => {
    expect(normalizeIndianMobile("+91 98765-43210")).toEqual({ destination: "+919876543210" });
    expect(normalizeIndianMobile("98765 43210")).toEqual({ destination: "+919876543210" });
  });

  it("rejects a number that is too short", () => {
    expect(normalizeIndianMobile("12345")).toBeNull();
  });

  it("rejects a number starting with a digit below 6", () => {
    expect(normalizeIndianMobile("5876543210")).toBeNull();
  });

  it("rejects an explicit non-India country code rather than mis-routing it", () => {
    expect(normalizeIndianMobile("+14155552671")).toBeNull();
  });

  it("rejects null/undefined/empty input", () => {
    expect(normalizeIndianMobile(null)).toBeNull();
    expect(normalizeIndianMobile(undefined)).toBeNull();
    expect(normalizeIndianMobile("")).toBeNull();
    expect(normalizeIndianMobile("   ")).toBeNull();
  });

  it("rejects an ambiguous 11-digit string rather than guessing which digit to drop", () => {
    expect(normalizeIndianMobile("98765432101")).toBeNull();
  });
});
