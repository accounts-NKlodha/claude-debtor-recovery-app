/**
 * Confirmed-recovery allocation (PRD §7 "Balance and payment rules", invariant §15.4).
 * - Oldest invoice first: invoice_date ascending, then stable invoice id.
 * - Confirmed recoveries are append-only; balances are a derived projection.
 * - Interest / cost allocation stays out of this function (manual until approved).
 */

export interface AllocatableInvoice {
  id: string;
  invoiceDate: string; // YYYY-MM-DD
  outstandingBalance: number; // paise
}

export interface Allocation {
  invoiceId: string;
  applied: number; // paise
  balanceAfter: number; // paise
}

export interface AllocationOutcome {
  allocations: Allocation[];
  /** paise that could not be applied (payment exceeded total outstanding). */
  unapplied: number;
  totalApplied: number;
}

export function allocateRecovery(
  invoices: AllocatableInvoice[],
  amountPaise: number,
): AllocationOutcome {
  if (amountPaise < 0) throw new Error("recovery amount must be non-negative");

  const ordered = [...invoices].sort((a, b) => {
    if (a.invoiceDate !== b.invoiceDate) return a.invoiceDate < b.invoiceDate ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  let remaining = amountPaise;
  const allocations: Allocation[] = [];

  for (const inv of ordered) {
    if (remaining <= 0) break;
    if (inv.outstandingBalance <= 0) continue;
    const applied = Math.min(remaining, inv.outstandingBalance);
    remaining -= applied;
    allocations.push({
      invoiceId: inv.id,
      applied,
      balanceAfter: inv.outstandingBalance - applied,
    });
  }

  return {
    allocations,
    unapplied: remaining,
    totalApplied: amountPaise - remaining,
  };
}
