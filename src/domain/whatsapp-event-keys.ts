/**
 * Idempotency identity of each WhatsApp business event. Deliberately its own
 * tiny module so both the eligibility engine and the invoice-level reminder
 * stage derivation can use it without importing each other.
 *
 * The key is built from the BUSINESS EVENT (which invoice / promise /
 * payment), never merely recipient + template, so a double-click or retry of
 * the same logical event can never produce a second external message.
 */

/** V1 has exactly one follow-up stage; the number is part of the identity so more can be added. */
export const FOLLOW_UP_STAGE = 1;

export const whatsAppEventKeys = {
  initialReminder: (caseId: string, invoiceId: string) => `wa:initial-reminder:${caseId}:${invoiceId}`,
  followUpReminder: (caseId: string, invoiceId: string, stage: number = FOLLOW_UP_STAGE) =>
    `wa:followup-reminder:${caseId}:${invoiceId}:${stage}`,
  commitmentReminder: (promiseId: string) => `wa:commitment-reminder:${promiseId}`,
  paymentReceived: (paymentId: string, invoiceId: string) => `wa:payment-received:${paymentId}:${invoiceId}`,
  paymentClosed: (caseId: string, invoiceId: string, settlingPaymentId: string) =>
    `wa:payment-closed:${caseId}:${invoiceId}:${settlingPaymentId}`,
};

/** The initial reminder's email leg is case-level (one email per case), keyed by day. */
export const EMAIL_INITIAL_KEY_PREFIX = (caseId: string) => `reminder-initial:email:${caseId}:`;
