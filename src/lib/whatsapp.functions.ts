/**
 * TanStack Start equivalent of src/app/actions/whatsapp.ts (M1 Batch 2).
 * Same semantics exactly: eligibility/recipient/params recomputed
 * server-side from durable data (never trusts the browser beyond the
 * eventKey name); same staff-only authorization; recordPaymentPromise
 * preserves promise history via the repository (an earlier active promise
 * for the same invoice is superseded, never overwritten) -- unmodified,
 * reused repository method.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import { authorizeStaffMutation } from "@/lib/auth/tanstack-session";
import { recordPaymentPromiseSchema } from "@/contract/schemas";

export type SendWhatsAppMessageState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "accepted" }
  | { kind: "rejected" }
  | { kind: "ambiguous" }
  | { kind: "already_sent" };

export const sendWhatsAppMessageFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { caseId: string; eventKey: string; forceRetryAfterAmbiguous?: boolean })
  .handler(async ({ data }): Promise<SendWhatsAppMessageState> => {
    const caseId = data.caseId.trim();
    const eventKey = data.eventKey.trim();
    const forceRetryAfterAmbiguous = data.forceRetryAfterAmbiguous ?? false;
    if (!caseId || !eventKey) return { kind: "error", message: "Missing case or message." };

    let result;
    try {
      const actor = await authorizeStaffMutation();
      const repo = await getRepo();
      result = await repo.sendWhatsAppMessage(caseId, { eventKey, forceRetryAfterAmbiguous }, actor);
    } catch (e: unknown) {
      return { kind: "error", message: e instanceof Error ? e.message : "Failed to send the WhatsApp message" };
    }

    return { kind: result.status };
  });

export type RecordPaymentPromiseState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "saved" };

/**
 * Pure rupees-string -> integer-paise parsing, factored out for direct
 * unit-testability (see whatsapp.functions.test.ts). Blank input is a
 * valid "no amount promised" case (returns null); a non-finite or
 * non-positive number is rejected. Commas (thousands separators) are
 * stripped before parsing.
 */
export function parsePromisedAmountPaise(raw: string | null | undefined): { ok: true; value: number | null } | { ok: false; error: string } {
  const cleaned = (raw ?? "").replace(/,/g, "").trim();
  if (cleaned === "") return { ok: true, value: null };
  const rupees = Number(cleaned);
  if (!Number.isFinite(rupees) || rupees <= 0) {
    return { ok: false, error: "Promised amount must be greater than zero" };
  }
  return { ok: true, value: Math.round(rupees * 100) };
}

export const recordPaymentPromiseFn = createServerFn({ method: "POST" })
  .validator(
    (data: unknown) =>
      data as {
        caseId: string;
        invoiceId?: string | null;
        promisedOn: string;
        promisedAmount?: string | null;
        sourceReplyId?: string | null;
      },
  )
  .handler(async ({ data }): Promise<RecordPaymentPromiseState> => {
    const amountResult = parsePromisedAmountPaise(data.promisedAmount);
    if (!amountResult.ok) return { kind: "error", message: amountResult.error };
    const promisedAmountPaise = amountResult.value;

    const parsed = recordPaymentPromiseSchema.safeParse({
      caseId: data.caseId,
      invoiceId: data.invoiceId,
      promisedOn: data.promisedOn,
      promisedAmountPaise,
      sourceReplyId: data.sourceReplyId,
    });
    if (!parsed.success) {
      return { kind: "error", message: parsed.error.issues[0]?.message ?? "Invalid promise details" };
    }

    try {
      const actor = await authorizeStaffMutation();
      const repo = await getRepo();
      await repo.recordPaymentPromise(parsed.data.caseId, parsed.data, actor);
    } catch (e: unknown) {
      return { kind: "error", message: e instanceof Error ? e.message : "Failed to record the promise" };
    }

    return { kind: "saved" };
  });
