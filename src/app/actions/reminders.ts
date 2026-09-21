"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeStaffMutation } from "@/lib/auth/session";

export type SendReminderState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "sent"; channels: string[]; warnings: string[] }
  | { kind: "failed"; channels: string[]; warnings: string[] }
  | { kind: "ambiguous"; warnings: string[] };

/**
 * Send the initial reminder for an `active` case, on every channel the
 * debtor has a real address for (WhatsApp only when the live AiSensy adapter is configured and the
 * creditor's UPI details are set, or via the mock outside production -- see
 * src/domain/whatsapp-reminder.ts; email everywhere). Runs each
 * channel's adapter under the retry-once policy with a durable,
 * database-enforced idempotency key (email-delivery task), records one
 * communication per channel, and advances the case per
 * src/domain/reminder.ts only if at least one channel succeeded.
 *
 * Takes the `useActionState`/`<form action=...>` shape (prevState,
 * FormData) and always RETURNS its outcome rather than throwing across the
 * client/server action boundary -- final-UAT go-live task: this is the
 * single most central action in the product, and a directly-invoked
 * "use server" function that throws (e.g. "debtor has no mobile or email
 * on file") hit Next.js's production error-digest handling in a way that
 * crashed the client with an opaque React error instead of showing the
 * actual message -- confirmed live while UAT-testing the core recovery
 * workflow. See src/app/actions/auth.ts for the same fix applied to
 * sign-in, where this was first found.
 *
 * `forceRetryAfterAmbiguous` (form field "forceRetryAfterAmbiguous" ===
 * "true") must only be set true when the caller has explicitly confirmed
 * (via the UI's distinct ambiguous-state prompt) that retrying is safe
 * despite a prior attempt's outcome being unknown -- see
 * docs/email-delivery/index.md.
 */
export async function sendInitialReminderAction(
  _prevState: SendReminderState,
  formData: FormData,
): Promise<SendReminderState> {
  const caseId = String(formData.get("caseId") ?? "");
  const forceRetryAfterAmbiguous = formData.get("forceRetryAfterAmbiguous") === "true";
  // Required for the WhatsApp reminder when the case has several invoices; never defaults to the first.
  const invoiceId = String(formData.get("invoiceId") ?? "").trim() || null;

  let result;
  try {
    const actor = await authorizeStaffMutation();
    result = await getRepo().sendInitialReminder(caseId, actor, { forceRetryAfterAmbiguous, invoiceId });
  } catch (e: unknown) {
    return { kind: "error", message: e instanceof Error ? e.message : "Failed to send reminder" };
  }

  revalidatePath("/today");
  revalidatePath("/cases");
  revalidatePath("/communications");
  revalidatePath(`/cases/${caseId}`);

  const sentChannels = result.communications.filter((c) => c.deliveryStatus === "sent").map((c) => c.channel);
  const failedChannels = result.communications.filter((c) => c.deliveryStatus === "failed").map((c) => c.channel);
  // A success outcome is only returned when the durable delivery result
  // actually says "sent" -- never merely because the action call itself
  // didn't throw (email-delivery task §13).
  // `warnings` = channels deliberately not attempted (e.g. WhatsApp skipped
  // because the creditor's UPI details are not configured) -- surfaced so the
  // operator is told why only one channel appears.
  if (result.ambiguous) return { kind: "ambiguous", warnings: result.warnings };
  if (sentChannels.length > 0) return { kind: "sent", channels: sentChannels, warnings: result.warnings };
  return { kind: "failed", channels: failedChannels, warnings: result.warnings };
}
