/**
 * TanStack Start equivalent of src/app/actions/payments.ts (M1 Batch 4).
 * Same semantics exactly: explicit caseId (never inferred/defaulted --
 * the UI's Organisation -> Case selector is the only source), rupees ->
 * paise via the same moneyToPaise schema, confirmed-payment allocation +
 * escalation-cancellation logic entirely in the reused, unmodified
 * repository method. Staff-only; never throws across the RPC boundary.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import { authorizeStaffMutation } from "@/lib/auth/tanstack-session";
import { moneyToPaise } from "@/contract/schemas";
import type { PaymentRecord } from "@/contract/types";

export interface RecordPaymentState {
  payment: PaymentRecord | null;
  error: string | null;
}

/**
 * Pure caseId + amount validation, factored out for direct
 * unit-testability (see payments.functions.test.ts) -- same reasoning as
 * every prior guard extraction on this branch. Enforces explicit case
 * selection (never inferred/defaulted) and the rupees -> paise conversion
 * every hand-entered amount in this app goes through
 * (src/contract/schemas.ts#moneyToPaise).
 */
export function validateRecordPaymentInput(
  caseId: string,
  rawAmount: string,
): { ok: true; amount: number } | { ok: false; error: string } {
  if (!caseId) {
    return { ok: false, error: "Select an organisation and case before recording a receipt." };
  }
  const parsedAmount = moneyToPaise.safeParse(rawAmount);
  if (!parsedAmount.success) {
    return { ok: false, error: "Enter a valid amount, e.g. 1,25,000." };
  }
  if (parsedAmount.data <= 0) {
    return { ok: false, error: "Enter an amount greater than zero." };
  }
  return { ok: true, amount: parsedAmount.data };
}

export const recordPaymentFn = createServerFn({ method: "POST" })
  .validator(
    (data: unknown) =>
      data as { caseId: string; kind: string; amount: string; reference?: string | null; clientConfirmed?: boolean },
  )
  .handler(async ({ data }): Promise<RecordPaymentState> => {
    const { caseId } = data;
    const kind = data.kind as PaymentRecord["kind"];
    const reference = (data.reference ?? "").trim() || null;
    const clientConfirmed = data.clientConfirmed ?? false;

    const validated = validateRecordPaymentInput(caseId, data.amount);
    if (!validated.ok) return { payment: null, error: validated.error };
    const { amount } = validated;

    try {
      const actor = await authorizeStaffMutation();
      const repo = await getRepo();
      const result = await repo.recordPayment({ caseId, kind, amount, reference, clientConfirmed }, actor);
      return { payment: result.payment, error: null };
    } catch (e: unknown) {
      return { payment: null, error: e instanceof Error ? e.message : "Failed to record receipt" };
    }
  });

export interface ConfirmPaymentState {
  confirmed: boolean;
  error: string | null;
}

export const confirmPaymentFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { paymentId: string; caseId?: string })
  .handler(async ({ data }): Promise<ConfirmPaymentState> => {
    try {
      const actor = await authorizeStaffMutation();
      const repo = await getRepo();
      await repo.confirmPayment(data.paymentId, actor);
      return { confirmed: true, error: null };
    } catch (e: unknown) {
      return { confirmed: false, error: e instanceof Error ? e.message : "Failed to confirm receipt" };
    }
  });
