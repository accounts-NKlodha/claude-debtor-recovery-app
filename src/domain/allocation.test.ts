import { describe, expect, it } from "vitest";
import { allocateRecovery } from "./allocation";

const invoices = [
  { id: "b", invoiceDate: "2025-03-01", outstandingBalance: 10_000_00 },
  { id: "a", invoiceDate: "2025-01-15", outstandingBalance: 5_000_00 },
  { id: "c", invoiceDate: "2025-03-01", outstandingBalance: 2_000_00 },
];

describe("allocateRecovery (oldest invoice first)", () => {
  it("applies to the earliest invoice date first", () => {
    const out = allocateRecovery(invoices, 6_000_00);
    expect(out.allocations[0]).toEqual({ invoiceId: "a", applied: 5_000_00, balanceAfter: 0 });
    expect(out.allocations[1]).toEqual({ invoiceId: "b", applied: 1_000_00, balanceAfter: 9_000_00 });
    expect(out.totalApplied).toBe(6_000_00);
    expect(out.unapplied).toBe(0);
  });

  it("breaks same-date ties by stable invoice id", () => {
    const out = allocateRecovery(invoices, 5_000_00 + 10_000_00 + 1_00);
    // a (Jan) fully, then b before c (same date, id 'b' < 'c').
    expect(out.allocations.map((a) => a.invoiceId)).toEqual(["a", "b", "c"]);
    expect(out.allocations[2].applied).toBe(1_00);
  });

  it("reports unapplied surplus when payment exceeds outstanding", () => {
    const out = allocateRecovery(invoices, 20_000_00);
    expect(out.totalApplied).toBe(17_000_00);
    expect(out.unapplied).toBe(3_000_00);
  });

  it("skips already-settled invoices", () => {
    const out = allocateRecovery(
      [
        { id: "a", invoiceDate: "2025-01-01", outstandingBalance: 0 },
        { id: "b", invoiceDate: "2025-02-01", outstandingBalance: 1_000_00 },
      ],
      500_00,
    );
    expect(out.allocations).toHaveLength(1);
    expect(out.allocations[0].invoiceId).toBe("b");
  });

  it("rejects negative amounts", () => {
    expect(() => allocateRecovery(invoices, -1)).toThrow();
  });
});
