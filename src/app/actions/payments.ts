"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import type { PaymentRecord } from "@/contract/types";

/**
 * Record a receipt. If `clientConfirmed`, this immediately runs allocation +
 * the workflow rule that cancels pending escalation (PRD §7).
 */
export async function recordPaymentAction(input: {
  caseId: string;
  kind: PaymentRecord["kind"];
  amount: number;
  reference: string | null;
  clientConfirmed: boolean;
}) {
  const result = await getRepo().recordPayment(input);
  revalidatePath("/payments");
  revalidatePath("/today");
  revalidatePath(`/cases/${input.caseId}`);
  return result;
}

/** Client confirms an already-recorded receipt. Cancels pending escalation. */
export async function confirmPaymentAction(paymentId: string, caseId: string) {
  const result = await getRepo().confirmPayment(paymentId);
  revalidatePath("/payments");
  revalidatePath("/today");
  revalidatePath(`/cases/${caseId}`);
  return result;
}
