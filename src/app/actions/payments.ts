"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeStaffMutation } from "@/lib/auth/session";
import type { PaymentRecord } from "@/contract/types";

/**
 * Record a receipt. If `clientConfirmed`, this immediately runs allocation +
 * the workflow rule that cancels pending escalation (PRD §7).
 *
 * Staff-only (recorded by the firm on the debtor's behalf -- the field name
 * `clientConfirmed` describes the payment's real-world status, not who is
 * calling this action). Authenticates independently of src/proxy.ts.
 */
export async function recordPaymentAction(input: {
  caseId: string;
  kind: PaymentRecord["kind"];
  amount: number;
  reference: string | null;
  clientConfirmed: boolean;
}) {
  const actor = await authorizeStaffMutation();
  const result = await getRepo().recordPayment(input, actor);
  revalidatePath("/payments");
  revalidatePath("/today");
  revalidatePath(`/cases/${input.caseId}`);
  return result;
}

/** Staff records that the client confirmed an already-recorded receipt (IRL, not in-app). Cancels pending escalation. */
export async function confirmPaymentAction(paymentId: string, caseId: string) {
  const actor = await authorizeStaffMutation();
  const result = await getRepo().confirmPayment(paymentId, actor);
  revalidatePath("/payments");
  revalidatePath("/today");
  revalidatePath(`/cases/${caseId}`);
  return result;
}
