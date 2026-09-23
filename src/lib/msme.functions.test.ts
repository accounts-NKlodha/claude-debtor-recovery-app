/**
 * Covers validateMsmeStageInput (msme.functions.ts, M1 Batch 4) -- the
 * pure guard behind saveMsmeStageFn: only the seven canonical ODR stages
 * are accepted, and the payload must be a plain object (never an array,
 * null, or a primitive). Plain function, no Start runtime context needed.
 */
import { describe, expect, it } from "vitest";
import { validateMsmeStageInput } from "./msme.functions";

describe("validateMsmeStageInput", () => {
  it("rejects a missing case", () => {
    expect(validateMsmeStageInput("", "claimant", {})).toEqual({ ok: false, error: "Missing case." });
  });

  it("accepts each of the seven canonical ODR stages", () => {
    for (const stage of [
      "claimant",
      "respondent",
      "advocate",
      "statement_of_claim",
      "documents",
      "checklist",
      "preview",
    ]) {
      expect(validateMsmeStageInput("case-1", stage, { a: "b" })).toEqual({
        ok: true,
        stage,
        payload: { a: "b" },
      });
    }
  });

  it("rejects an unknown stage", () => {
    expect(validateMsmeStageInput("case-1", "not-a-real-stage", {})).toEqual({
      ok: false,
      error: "Invalid ODR stage.",
    });
  });

  it("rejects a non-object payload (array, null, primitive)", () => {
    expect(validateMsmeStageInput("case-1", "claimant", [])).toEqual({ ok: false, error: "Invalid stage data." });
    expect(validateMsmeStageInput("case-1", "claimant", null)).toEqual({ ok: false, error: "Invalid stage data." });
    expect(validateMsmeStageInput("case-1", "claimant", "a string")).toEqual({
      ok: false,
      error: "Invalid stage data.",
    });
  });
});
