"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeStaffMutation } from "@/lib/auth/session";
import { recordPaymentPromiseSchema } from "@/contract/schemas";

export type SendWhatsAppMessageState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  /** The provider accepted the request. This is NOT delivery or read confirmation. */
  | { kind: "accepted" }
  | { kind: "rejected" }
  | { kind: "ambiguous" }
  | { kind: "already_sent" };

/**
 * Operator-triggered send of ONE approved WhatsApp message for ONE business
 * event (follow-up, commitment reminder, payment received, payment closed).
 * The browser only names the event (`eventKey`); eligibility, recipient,
 * parameters and body are recomputed on the server from durable data, and
 * authorization is the same staff check every other mutation uses -- a
 * client user or a forged request can never send anything the server-side
 * engine would refuse.
 *
 * Takes the `useActionState` shape and always RETURNS its outcome instead of
 * throwing across the action boundary (same convention as
 * sendInitialReminderAction). `forceRetryAfterAmbiguous` must only be set by
 * the UI's explicit "an earlier attempt's outcome is unknown" confirmation.
 */
export async function sendWhatsAppMessageAction(
  _prevState: SendWhatsAppMessageState,
  formData: FormData,
): Promise<SendWhatsAppMessageState> {
  const caseId = String(formData.get("caseId") ?? "").trim();
  const eventKey = String(formData.get("eventKey") ?? "").trim();
  const forceRetryAfterAmbiguous = formData.get("forceRetryAfterAmbiguous") === "true";
  if (!caseId || !eventKey) return { kind: "error", message: "Missing case or message." };

  let result;
  try {
    const actor = await authorizeStaffMutation();
    result = await getRepo().sendWhatsAppMessage(caseId, { eventKey, forceRetryAfterAmbiguous }, actor);
  } catch (e: unknown) {
    return { kind: "error", message: e instanceof Error ? e.message : "Failed to send the WhatsApp message" };
  }

  revalidatePath("/today");
  revalidatePath("/cases");
  revalidatePath("/communications");
  revalidatePath(`/cases/${caseId}`);
  return { kind: result.status };
}

export type RecordPaymentPromiseState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "saved" };

/**
 * Record a promise-to-pay (date, optional amount, optional invoice). The
 * amount is entered in rupees and converted to integer paise here. Staff
 * only; validated server-side regardless of client checks; history is
 * preserved by the repository (an earlier promise is superseded, never
 * overwritten).
 */
export async function recordPaymentPromiseAction(
  _prevState: RecordPaymentPromiseState,
  formData: FormData,
): Promise<RecordPaymentPromiseState> {
  const rawAmount = String(formData.get("promisedAmount") ?? "").replace(/,/g, "").trim();
  let promisedAmountPaise: number | null = null;
  if (rawAmount !== "") {
    const rupees = Number(rawAmount);
    if (!Number.isFinite(rupees) || rupees <= 0) return { kind: "error", message: "Promised amount must be greater than zero" };
    promisedAmountPaise = Math.round(rupees * 100);
  }

  const parsed = recordPaymentPromiseSchema.safeParse({
    caseId: formData.get("caseId"),
    invoiceId: formData.get("invoiceId"),
    promisedOn: formData.get("promisedOn"),
    promisedAmountPaise,
    sourceReplyId: formData.get("sourceReplyId"),
  });
  if (!parsed.success) {
    return { kind: "error", message: parsed.error.issues[0]?.message ?? "Invalid promise details" };
  }

  try {
    const actor = await authorizeStaffMutation();
    await getRepo().recordPaymentPromise(parsed.data.caseId, parsed.data, actor);
  } catch (e: unknown) {
    return { kind: "error", message: e instanceof Error ? e.message : "Failed to record the promise" };
  }

  revalidatePath("/today");
  revalidatePath("/cases");
  revalidatePath(`/cases/${parsed.data.caseId}`);
  return { kind: "saved" };
}
