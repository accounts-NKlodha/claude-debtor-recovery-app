/**
 * Decides whether -- and how -- the WhatsApp leg of the INITIAL reminder is
 * attempted (the email leg is independent and unchanged). Shared by
 * SupabaseRepository and MemoryRepository so the two can never drift apart
 * on a safety rule, and built on the same pieces as the multi-message
 * engine (src/domain/whatsapp-messages.ts): invoice selection, the common
 * live-send blockers and the business-event idempotency key.
 *
 * Outcomes:
 *   - "none":    nothing to attempt and nothing worth telling the operator
 *                (debtor has no mobile number, or WhatsApp is simply not
 *                enabled in production).
 *   - "skipped": WhatsApp IS enabled but must not be sent; `reason` is a
 *                controlled, operator-facing explanation. Never a send
 *                failure -- no communication row exists, no provider is called.
 *   - "attempt": a channel entry ready for the durable send pipeline.
 *
 * With the live AiSensy adapter configured, ALL of these must hold:
 *   1. the reminder is tied to exactly one invoice (never "the first one"),
 *      and one whose initial reminder has not already been sent;
 *   2. the WhatsApp campaign is configured;
 *   3. the debtor's mobile normalizes deterministically (never guessed);
 *   4. the creditor's UPI ID AND payee name are configured -- no fallback to
 *      synthetic/default details;
 *   5. the global automation kill switch is on.
 * Outside production with the live adapter NOT configured, the legacy mock
 * WhatsApp path is kept as the existing demo/test affordance.
 */

import type { Invoice, Organisation } from "@/contract/types";
import {
  PAYMENT_DETAILS_NOT_CONFIGURED_REASON,
  liveSendBlocker,
  pickReminderInvoice,
  whatsAppEventKeys,
  type LiveSendEnv,
  type WhatsAppChannelEntry,
} from "./whatsapp-messages";
import {
  RENDERERS,
  WHATSAPP_TEMPLATES,
  buildPaymentReminderInitialV2Params,
  validateTemplateParams,
} from "./whatsapp-templates";

export { PAYMENT_DETAILS_NOT_CONFIGURED_REASON };
export type { WhatsAppChannelEntry };

export type WhatsAppReminderPlan =
  | { kind: "none" }
  | { kind: "skipped"; reason: string }
  | { kind: "attempt"; entry: WhatsAppChannelEntry };

export async function planWhatsAppReminder(input: {
  caseId: string;
  debtor: { name: string; mobile: string | null } | undefined;
  org: Organisation | undefined;
  invoices: Invoice[];
  /** Operator's explicit invoice choice; required while several invoices still await their initial reminder. */
  selectedInvoiceId?: string | null;
  /** Invoices whose initial reminder the provider has already accepted (they stay independent of the others). */
  alreadyRemindedInvoiceIds?: ReadonlySet<string>;
  isProduction: boolean;
  env: LiveSendEnv;
  /** Body used only for the legacy mock/demo path. */
  legacyBody: string;
}): Promise<WhatsAppReminderPlan> {
  const { debtor, org, env } = input;
  if (!debtor?.mobile) return { kind: "none" };

  if (!env.liveConfigured) {
    if (input.isProduction) return { kind: "none" };
    return {
      kind: "attempt",
      entry: {
        channel: "whatsapp",
        to: debtor.mobile,
        templateKey: "reminder_initial_v3",
        templateVersion: 3,
        subject: null,
        body: input.legacyBody,
      },
    };
  }

  const def = WHATSAPP_TEMPLATES.initial_reminder;
  const picked = pickReminderInvoice(input.invoices, input.selectedInvoiceId, input.alreadyRemindedInvoiceIds);
  if ("reason" in picked) return { kind: "skipped", reason: picked.reason };
  const { invoice } = picked;

  const blocker = await liveSendBlocker(def, { debtorMobile: debtor.mobile, org, env });
  if (blocker) return { kind: "skipped", reason: blocker };

  const templateParams = buildPaymentReminderInitialV2Params({
    debtorName: debtor.name,
    invoiceNumber: invoice.invoiceNumber,
    invoiceAmountPaise: invoice.invoiceTotal,
    dueDate: invoice.dueDate,
    outstandingAmountPaise: invoice.outstandingBalance,
    creditorName: org!.legalEntityName,
    upiId: org!.upiId!.trim(),
    upiPayeeName: org!.upiPayeeName!.trim(),
  });
  const invalid = validateTemplateParams(def, templateParams);
  if (invalid) return { kind: "skipped", reason: invalid };

  return {
    kind: "attempt",
    entry: {
      channel: "whatsapp",
      to: debtor.mobile,
      templateKey: def.templateKey,
      templateVersion: def.templateVersion,
      subject: null,
      body: RENDERERS.initial_reminder(templateParams),
      templateParams,
      idempotencyKey: whatsAppEventKeys.initialReminder(input.caseId, invoice.id),
    },
  };
}
