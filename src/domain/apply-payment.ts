/**
 * Pure combination of allocation + workflow for a confirmed payment
 * (PRD §7 "confirmed payment immediately cancels pending escalation",
 * invariant §15.4 append-only recoveries / §15.5 cancel-on-full-recovery).
 *
 * No I/O here — callers (the repository layer) own persistence. This keeps
 * the rule testable without a database and reusable by whichever storage
 * backend is active.
 */

import { allocateRecovery, type AllocatableInvoice } from "./allocation";
import { advance, caseToWorkflowState, transitionToCasePatch } from "./workflow";
import type { RecoveryCase } from "@/contract/types";

export interface ApplyPaymentResult {
  updatedCase: RecoveryCase;
  invoiceAllocations: ReturnType<typeof allocateRecovery>["allocations"];
  unapplied: number;
  note: string;
}

export function applyConfirmedPayment(
  kase: RecoveryCase,
  invoices: AllocatableInvoice[],
  amountPaise: number,
): ApplyPaymentResult {
  // Allocate against known invoices when we have them. A case can reach
  // payment confirmation without invoice rows loaded (e.g. a grouped case, or
  // a data gap) -- degrade to applying the payment against the case's own
  // outstanding balance directly rather than silently doing nothing.
  const { allocations, unapplied, totalApplied } =
    invoices.length > 0
      ? allocateRecovery(invoices, amountPaise)
      : {
          allocations: [],
          unapplied: Math.max(0, amountPaise - kase.principalOutstanding),
          totalApplied: Math.min(amountPaise, kase.principalOutstanding),
        };
  const newPrincipalOutstanding = Math.max(0, kase.principalOutstanding - totalApplied);
  const fullSettlement = newPrincipalOutstanding === 0;

  const transition = advance(caseToWorkflowState(kase), {
    type: "PAYMENT_CONFIRMED",
    fullSettlement,
  });

  const updatedCase: RecoveryCase = {
    ...kase,
    ...transitionToCasePatch(transition.next),
    // Allocation is authoritative for partial payments; for a full
    // settlement it agrees with advance()'s own principal/recovered reset.
    principalOutstanding: newPrincipalOutstanding,
    recoveredToDate: kase.recoveredToDate + totalApplied,
    closedAt: fullSettlement ? new Date().toISOString() : kase.closedAt,
  };

  return {
    updatedCase,
    invoiceAllocations: allocations,
    unapplied,
    note: transition.note,
  };
}
