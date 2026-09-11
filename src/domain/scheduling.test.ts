import { describe, expect, it } from "vitest";
import {
  gstTimerDeadline,
  isOverdueForAdminEscalation,
  istParts,
  nextSendWindow,
  reminderTimerDeadline,
} from "./scheduling";

/** IST is UTC+5:30. 11:00 IST == 05:30 UTC. */
describe("nextSendWindow", () => {
  it("returns today 05:30 UTC when called before the slot on a weekday", () => {
    // 2026-02-10 is a Tuesday. 04:00 UTC == 09:30 IST (before 11:00 IST).
    const from = new Date("2026-02-10T04:00:00Z");
    const win = nextSendWindow(from);
    expect(win.toISOString()).toBe("2026-02-10T05:30:00.000Z");
    expect(istParts(win).hour).toBe(11);
  });

  it("rolls to next day when called after the slot", () => {
    // 2026-02-10T08:00:00Z == 13:30 IST (after 11:00 IST) -> Wed 11:00 IST.
    const win = nextSendWindow(new Date("2026-02-10T08:00:00Z"));
    expect(win.toISOString()).toBe("2026-02-11T05:30:00.000Z");
  });

  it("skips Sunday IST and rolls to Monday", () => {
    // 2026-02-14 is Saturday. After slot -> Sunday, which must roll to Monday.
    const win = nextSendWindow(new Date("2026-02-14T08:00:00Z"));
    expect(istParts(win).weekday).toBe(1); // Monday
    expect(win.toISOString()).toBe("2026-02-16T05:30:00.000Z");
  });

  it("rolls a Sunday-morning call to Monday", () => {
    // 2026-02-15 is Sunday. 02:00 UTC == 07:30 IST Sunday.
    const win = nextSendWindow(new Date("2026-02-15T02:00:00Z"));
    expect(istParts(win).weekday).toBe(1);
  });
});

describe("timers", () => {
  it("24h reminder timer starts from delivery", () => {
    const d = new Date("2026-02-10T05:30:00Z");
    expect(reminderTimerDeadline(d).toISOString()).toBe("2026-02-11T05:30:00.000Z");
  });

  it("GST 7-day timer is 7 calendar days", () => {
    const d = new Date("2026-02-10T05:30:00Z");
    expect(gstTimerDeadline(d).toISOString()).toBe("2026-02-17T05:30:00.000Z");
  });

  it("admin escalation triggers at exactly 24h overdue", () => {
    const due = new Date("2026-02-10T00:00:00Z");
    expect(isOverdueForAdminEscalation(due, new Date("2026-02-10T23:59:00Z"))).toBe(false);
    expect(isOverdueForAdminEscalation(due, new Date("2026-02-11T00:00:00Z"))).toBe(true);
  });
});
