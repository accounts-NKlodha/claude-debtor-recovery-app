/**
 * Covers decideReminderOutcome (reminders.functions.ts, M1 Batch 2) -- the
 * pure classification logic behind sendInitialReminderFn's most important
 * business rule: a "sent" outcome is only returned when the durable
 * delivery result actually says "sent", never merely because the
 * repository call didn't throw. Plain function, no createServerFn wrapper,
 * so no Start runtime context is needed (see tanstack-shell.guard.test.ts
 * for why this extraction pattern exists).
 */
import { describe, expect, it } from "vitest";
import { decideReminderOutcome } from "./reminders.functions";

describe("decideReminderOutcome", () => {
  it("returns ambiguous when the repository result is ambiguous, regardless of channel status", () => {
    const result = decideReminderOutcome({
      communications: [{ deliveryStatus: "sent", channel: "email" }],
      ambiguous: true,
      warnings: ["a warning"],
    });
    expect(result).toEqual({ kind: "ambiguous", warnings: ["a warning"] });
  });

  it("returns sent with the successful channels when at least one channel sent", () => {
    const result = decideReminderOutcome({
      communications: [
        { deliveryStatus: "sent", channel: "email" },
        { deliveryStatus: "failed", channel: "whatsapp" },
      ],
      ambiguous: false,
      warnings: [],
    });
    expect(result).toEqual({ kind: "sent", channels: ["email"], warnings: [] });
  });

  it("returns failed with the failed channels when nothing sent", () => {
    const result = decideReminderOutcome({
      communications: [{ deliveryStatus: "failed", channel: "email" }],
      ambiguous: false,
      warnings: ["WhatsApp skipped: no UPI details configured"],
    });
    expect(result).toEqual({
      kind: "failed",
      channels: ["email"],
      warnings: ["WhatsApp skipped: no UPI details configured"],
    });
  });

  it("returns failed (not sent) when the communications list is empty", () => {
    const result = decideReminderOutcome({ communications: [], ambiguous: false, warnings: [] });
    expect(result).toEqual({ kind: "failed", channels: [], warnings: [] });
  });
});
