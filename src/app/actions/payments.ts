"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeStaffMutation } from "@/lib/auth/session";
import { moneyToPaise } from "@/contract/schemas";
import type { PaymentRecord } from "@/contract/types";

export interface RecordPaymentState {
  payment: PaymentRecord | null;
  error: string | null;
}

/**
 * Record a receipt. If `clientConfirmed`, this immediately runs allocation +
 * the workflow rule that cancels pending escalation (PRD §7).
 *
 * Staff-only (recorded by the firm on the debtor's behalf -- the field name
 * `clientConfirmed` describes the payment's real-world status, not who is
 * calling this action). Authenticates independently of src/proxy.ts.
 *
 * `caseId` must come from an explicit Organisation -> Case selection in the
 * UI (core-workflow remediation task -- the standalone payment form
 * previously fell back to a hardcoded, non-existent "case-1" whenever no
 * receipts already existed to infer a case from, meaning it silently
 * couldn't record a payment against a real, fresh production case at all).
 * `record_payment_row` (0006_production_write_rpcs.sql) already derives
 * organisation_id from the case row itself and rejects an unknown case_id
 * server-side -- a browser-supplied organisation id is never trusted or
 * even accepted here; the only trust boundary that matters is `caseId`
 * actually existing, which the RPC itself verifies.
 *
 * Takes the `useActionState`/`<form action=...>` shape (prevState,
 * FormData) and always RETURNS its outcome rather than throwing --
 * matches the production-crash fix applied to sign-in/kill-switch/
 * send-reminder during final UAT.
 */
export async function recordPaymentAction(
  _prevState: RecordPaymentState,
  formData: FormData,
): Promise<RecordPaymentState> {
  const caseId = String(formData.get("caseId") ?? "");
  const kind = String(formData.get("kind") ?? "") as PaymentRecord["kind"];
  const reference = String(formData.get("reference") ?? "").trim() || null;
  const clientConfirmed = formData.get("clientConfirmed") === "true";

  if (!caseId) {
    return { payment: null, error: "Select an organisation and case before recording a receipt." };
  }
  // Human-entered rupees ("1,25,000" | "125000.50") -> integer paise --
  // same conversion the rest of this app uses everywhere money is entered
  // by hand (src/contract/schemas.ts#moneyToPaise).
  const parsedAmount = moneyToPaise.safeParse(String(formData.get("amount") ?? ""));
  if (!parsedAmount.success) {
    return { payment: null, error: "Enter a valid amount, e.g. 1,25,000." };
  }
  const amount = parsedAmount.data;
  if (amount <= 0) {
    return { payment: null, error: "Enter an amount greater than zero." };
  }

  try {
    const actor = await authorizeStaffMutation();
    const result = await getRepo().recordPayment({ caseId, kind, amount, reference, clientConfirmed }, actor);
    revalidatePath("/payments");
    revalidatePath("/today");
    revalidatePath(`/cases/${caseId}`);
    return { payment: result.payment, error: null };
  } catch (e: unknown) {
    return { payment: null, error: e instanceof Error ? e.message : "Failed to record receipt" };
  }
}

export interface ConfirmPaymentState {
  confirmed: boolean;
  error: string | null;
}

/** Staff records that the client confirmed an already-recorded receipt (IRL,
 * not in-app). Cancels pending escalation. Returns its outcome as state
 * rather than throwing -- apply_payment_confirmation genuinely rejects a
 * double-confirm (a real, reachable case: a double-click or two staff
 * confirming the same receipt), so this is not a hypothetical crash path. */
export async function confirmPaymentAction(
  _prevState: ConfirmPaymentState,
  formData: FormData,
): Promise<ConfirmPaymentState> {
  const paymentId = String(formData.get("paymentId") ?? "");
  const caseId = String(formData.get("caseId") ?? "");
  try {
    const actor = await authorizeStaffMutation();
    await getRepo().confirmPayment(paymentId, actor);
    revalidatePath("/payments");
    revalidatePath("/today");
    if (caseId) revalidatePath(`/cases/${caseId}`);
    return { confirmed: true, error: null };
  } catch (e: unknown) {
    return { confirmed: false, error: e instanceof Error ? e.message : "Failed to confirm receipt" };
  }
}
