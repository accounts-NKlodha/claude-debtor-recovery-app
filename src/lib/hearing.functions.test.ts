/**
 * Covers validateHearingDate (hearing.functions.ts, M1 Batch 2) -- the
 * pure date validation behind scheduleHearingFn. Plain function, no Start
 * runtime context needed.
 */
import { describe, expect, it } from "vitest";
import { validateHearingDate } from "./hearing.functions";

describe("validateHearingDate", () => {
  it("accepts a valid ISO-parseable date/time and normalizes it to ISO", () => {
    const result = validateHearingDate("2026-10-15T10:30");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new Date(result.iso).getTime()).toBe(new Date("2026-10-15T10:30").getTime());
    }
  });

  it("rejects an empty string", () => {
    expect(validateHearingDate("")).toEqual({ ok: false, error: "A valid hearing date/time is required." });
  });

  it("rejects an unparseable date string", () => {
    expect(validateHearingDate("not-a-date")).toEqual({ ok: false, error: "A valid hearing date/time is required." });
  });
});
