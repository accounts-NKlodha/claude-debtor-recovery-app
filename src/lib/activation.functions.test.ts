/**
 * Covers validateActivationGateInput (activation.functions.ts, M1 Batch 2)
 * -- the pure validation behind recordActivationGateFn: which gates are
 * recordable, and the mandatory-reason rule (every activation gate record
 * is audited, so a reason is required). Plain function, no Start runtime
 * context needed.
 */
import { describe, expect, it } from "vitest";
import { validateActivationGateInput } from "./activation.functions";

describe("validateActivationGateInput", () => {
  it("accepts client_certification with a reason", () => {
    expect(validateActivationGateInput("case-1", "client_certification", "Confirmed by phone")).toEqual({
      ok: true,
      gate: "client_certification",
      reason: "Confirmed by phone",
    });
  });

  it("accepts staff_validation with a reason", () => {
    expect(validateActivationGateInput("case-1", "staff_validation", "Docs verified")).toEqual({
      ok: true,
      gate: "staff_validation",
      reason: "Docs verified",
    });
  });

  it("rejects a missing case id", () => {
    expect(validateActivationGateInput("", "client_certification", "reason")).toEqual({
      ok: false,
      error: "Missing case.",
    });
  });

  it("rejects the 60-day age gate as recordable (it can only be derived, never recorded)", () => {
    expect(validateActivationGateInput("case-1", "age_gate", "reason")).toEqual({
      ok: false,
      error: "Unknown activation gate.",
    });
  });

  it("rejects a blank or whitespace-only reason", () => {
    expect(validateActivationGateInput("case-1", "client_certification", "")).toEqual({
      ok: false,
      error: "A reason is required (who certified / validated, and how).",
    });
    expect(validateActivationGateInput("case-1", "client_certification", "   ")).toEqual({
      ok: false,
      error: "A reason is required (who certified / validated, and how).",
    });
  });
});
