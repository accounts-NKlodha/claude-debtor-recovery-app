/**
 * Approved AiSensy WhatsApp templates: registry, parameter builders and
 * durable-record renderers for the five V1 message families.
 *
 *   initial_reminder     payment_reminder_initial_v2       8 variables
 *   followup_reminder    payment_reminder_followup_v2      8 variables (same shape as initial)
 *   commitment_reminder  payment_commitment_reminder_v2    7 variables
 *   payment_received     payment_received_confirmation_v2  6 variables
 *   payment_closed       payment_closed_confirmation_v2    5 variables
 *
 * The variable order of each template below is the order in the approved
 * drafts the templates were created from. Amount variables are passed
 * WITHOUT the rupee sign because the approved text already prints "₹"
 * before them. "N K Lodha & Co" is fixed template text, not a variable.
 * Campaign names are NOT here: they are server-side configuration, read by
 * environment-variable name (src/lib/config/aisensy.ts) and failing closed
 * when unset. Nothing debtor-, creditor-, invoice-, amount-, date- or
 * payment-specific is ever hardcoded.
 */

export type WhatsAppMessageKind =
  | "initial_reminder"
  | "followup_reminder"
  | "commitment_reminder"
  | "payment_received"
  | "payment_closed";

export const WHATSAPP_MESSAGE_KINDS: readonly WhatsAppMessageKind[] = [
  "initial_reminder",
  "followup_reminder",
  "commitment_reminder",
  "payment_received",
  "payment_closed",
] as const;

export interface WhatsAppTemplateDef {
  kind: WhatsAppMessageKind;
  /** Stored as communications.template_key; also what the adapter resolves the definition by. */
  templateKey: string;
  templateVersion: number;
  paramCount: number;
  /** Human labels for {{1}}..{{n}}, used in "missing data" reasons (never provider details). */
  paramLabels: readonly string[];
  /** Name of the server-side environment variable holding the AiSensy campaign name. */
  campaignEnvVar: string;
  /** Whether the approved template prints the creditor's UPI ID + payee. */
  requiresUpi: boolean;
  /** Operator-facing name. */
  label: string;
}

export const WHATSAPP_TEMPLATES: Record<WhatsAppMessageKind, WhatsAppTemplateDef> = {
  initial_reminder: {
    kind: "initial_reminder",
    templateKey: "payment_reminder_initial_v2",
    templateVersion: 2,
    paramCount: 8,
    paramLabels: ["debtor name", "invoice number", "invoice amount", "due date", "outstanding amount", "creditor name", "UPI ID", "UPI payee name"],
    campaignEnvVar: "AISENSY_CAMPAIGN_PAYMENT_REMINDER_INITIAL_V2",
    requiresUpi: true,
    label: "Initial payment reminder",
  },
  followup_reminder: {
    kind: "followup_reminder",
    templateKey: "payment_reminder_followup_v2",
    templateVersion: 2,
    paramCount: 8,
    paramLabels: ["debtor name", "invoice number", "invoice amount", "due date", "outstanding amount", "creditor name", "UPI ID", "UPI payee name"],
    campaignEnvVar: "AISENSY_CAMPAIGN_PAYMENT_REMINDER_FOLLOWUP_V2",
    requiresUpi: true,
    label: "Follow-up payment reminder",
  },
  commitment_reminder: {
    kind: "commitment_reminder",
    templateKey: "payment_commitment_reminder_v2",
    templateVersion: 2,
    paramCount: 7,
    paramLabels: ["debtor name", "invoice number", "promised payment date", "amount due", "creditor name", "UPI ID", "UPI payee name"],
    campaignEnvVar: "AISENSY_CAMPAIGN_PAYMENT_COMMITMENT_REMINDER_V2",
    requiresUpi: true,
    label: "Payment commitment reminder",
  },
  payment_received: {
    kind: "payment_received",
    templateKey: "payment_received_confirmation_v2",
    templateVersion: 2,
    paramCount: 6,
    paramLabels: ["debtor name", "creditor name", "invoice number", "amount received", "received on", "balance outstanding"],
    campaignEnvVar: "AISENSY_CAMPAIGN_PAYMENT_RECEIVED_CONFIRMATION_V2",
    requiresUpi: false,
    label: "Payment received confirmation",
  },
  payment_closed: {
    kind: "payment_closed",
    templateKey: "payment_closed_confirmation_v2",
    templateVersion: 2,
    paramCount: 5,
    paramLabels: ["debtor name", "creditor name", "invoice number", "total amount paid", "settled on"],
    campaignEnvVar: "AISENSY_CAMPAIGN_PAYMENT_CLOSED_CONFIRMATION_V2",
    requiresUpi: false,
    label: "Payment closed confirmation",
  },
};

/** Kept for existing callers: the initial reminder's identity. */
export const PAYMENT_REMINDER_INITIAL_V2 = {
  templateKey: WHATSAPP_TEMPLATES.initial_reminder.templateKey,
  templateVersion: WHATSAPP_TEMPLATES.initial_reminder.templateVersion,
  paramCount: WHATSAPP_TEMPLATES.initial_reminder.paramCount,
} as const;

export function getTemplateDefByKey(templateKey: string | undefined): WhatsAppTemplateDef | null {
  if (!templateKey) return null;
  return WHATSAPP_MESSAGE_KINDS.map((k) => WHATSAPP_TEMPLATES[k]).find((d) => d.templateKey === templateKey) ?? null;
}

/**
 * Exact-count + non-empty validation shared by the engine (so an offer is
 * unavailable with a readable reason) and the adapter (last line of
 * defence before any network call). Returns null when valid, otherwise a
 * controlled description naming the missing data by label -- never values.
 */
export function validateTemplateParams(def: WhatsAppTemplateDef, params: readonly string[] | undefined): string | null {
  if (!params || params.length !== def.paramCount) {
    return `the message needs exactly ${def.paramCount} values`;
  }
  const missing = params.map((p, i) => (typeof p !== "string" || p.trim() === "" ? def.paramLabels[i] : null)).filter(Boolean);
  return missing.length > 0 ? `required data is missing: ${missing.join(", ")}` : null;
}

/**
 * WhatsApp/Meta reject template parameter values containing newlines, tabs
 * or runs of 4+ spaces, and reject empty values. Collapsing all whitespace
 * to single spaces is deterministic and always safe.
 */
export function sanitizeTemplateParam(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Indian-grouped rupee amount with NO currency symbol (amount VARIABLES add one leading space -- see AMOUNT_PARAM_LEADING_SPACE). Whole rupees show
 * no decimals; any paise show exactly two ("25,000.50") so a partial payment
 * is never silently rounded. */
export function formatTemplateAmount(paise: number): string {
  const whole = paise % 100 === 0;
  return (paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
}

/** "18 September 2026". Date-only inputs are formatted in UTC so the server
 * timezone can never shift the day. */
export function formatTemplateDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * Amount variables carry ONE leading space (" 25,000") so the template's
 * "₹{{n}}" renders as "₹ 25,000". Operator decision, made without changing the
 * approved templates. It is the only whitespace exception: every other value is
 * trimmed by sanitizeTemplateParam, and the space is never doubled (Meta rejects
 * runs of 4+ spaces). The symbol itself is still never part of a value.
 */
export const AMOUNT_PARAM_LEADING_SPACE = " ";
type ParamPart = string | null | undefined | { amountPaise: number };
const clean = (values: ParamPart[]): string[] =>
  values.map((v) =>
    v !== null && typeof v === "object" ? AMOUNT_PARAM_LEADING_SPACE + formatTemplateAmount(v.amountPaise) : sanitizeTemplateParam(v ?? ""),
  );

/* ---- initial + follow-up reminder: {{1}}..{{8}} ------------------------- */

export interface PaymentReminderInitialV2Input {
  debtorName: string;
  invoiceNumber: string | null;
  invoiceAmountPaise: number;
  dueDate: string | null;
  outstandingAmountPaise: number;
  creditorName: string;
  upiId: string;
  upiPayeeName: string;
}

/** {{1}} debtor, {{2}} invoice no, {{3}} invoice amount, {{4}} due date,
 * {{5}} outstanding amount, {{6}} creditor, {{7}} UPI ID, {{8}} UPI payee. */
export function buildPaymentReminderInitialV2Params(input: PaymentReminderInitialV2Input): string[] {
  return clean([
    input.debtorName,
    input.invoiceNumber ?? "—",
    { amountPaise: input.invoiceAmountPaise },
    formatTemplateDate(input.dueDate),
    { amountPaise: input.outstandingAmountPaise },
    input.creditorName,
    input.upiId,
    input.upiPayeeName,
  ]);
}

/** The follow-up template has exactly the initial reminder's 8-variable shape and order. */
export const buildFollowUpReminderV2Params = buildPaymentReminderInitialV2Params;

/* ---- commitment reminder: {{1}}..{{7}} ---------------------------------- */

export interface CommitmentReminderInput {
  debtorName: string;
  invoiceNumber: string;
  /** ISO date of the promised payment. */
  promisedOn: string;
  amountDuePaise: number;
  creditorName: string;
  upiId: string;
  upiPayeeName: string;
}

/** {{1}} debtor, {{2}} invoice no, {{3}} promised date, {{4}} amount due,
 * {{5}} creditor, {{6}} UPI ID, {{7}} UPI payee. */
export function buildCommitmentReminderV2Params(input: CommitmentReminderInput): string[] {
  return clean([
    input.debtorName,
    input.invoiceNumber,
    formatTemplateDate(input.promisedOn),
    { amountPaise: input.amountDuePaise },
    input.creditorName,
    input.upiId,
    input.upiPayeeName,
  ]);
}

/* ---- payment received: {{1}}..{{6}} ------------------------------------- */

export interface PaymentReceivedInput {
  debtorName: string;
  creditorName: string;
  invoiceNumber: string;
  amountReceivedPaise: number;
  /** ISO date the payment was received. */
  receivedOn: string;
  balanceOutstandingPaise: number;
}

/** {{1}} debtor, {{2}} creditor, {{3}} invoice no, {{4}} amount received,
 * {{5}} received on, {{6}} balance outstanding. */
export function buildPaymentReceivedV2Params(input: PaymentReceivedInput): string[] {
  return clean([
    input.debtorName,
    input.creditorName,
    input.invoiceNumber,
    { amountPaise: input.amountReceivedPaise },
    formatTemplateDate(input.receivedOn),
    { amountPaise: input.balanceOutstandingPaise },
  ]);
}

/* ---- payment closed: {{1}}..{{5}} --------------------------------------- */

export interface PaymentClosedInput {
  debtorName: string;
  creditorName: string;
  invoiceNumber: string;
  totalPaidPaise: number;
  /** ISO date of the payment that settled the invoice. */
  settledOn: string;
}

/** {{1}} debtor, {{2}} creditor, {{3}} invoice no, {{4}} total amount paid, {{5}} settled on. */
export function buildPaymentClosedV2Params(input: PaymentClosedInput): string[] {
  return clean([
    input.debtorName,
    input.creditorName,
    input.invoiceNumber,
    { amountPaise: input.totalPaidPaise },
    formatTemplateDate(input.settledOn),
  ]);
}

/* ---- durable renderings -------------------------------------------------- */
/* Human-readable record of what the debtor sees, stored as the
 * communication's `body`. Must be kept in step with the approved templates
 * in the AiSensy dashboard; a record of the send, never sent itself. */

export function renderPaymentReminderInitialV2Body(params: string[]): string {
  const [name, invoiceNo, invoiceAmount, dueDate, outstanding, creditor, upiId, payee] = params;
  return (
    `Dear ${name},\n\n` +
    `This is a payment reminder from N K Lodha & Co regarding your outstanding dues.\n\n` +
    `Invoice No.: ${invoiceNo}\n` +
    `Invoice Amount: ₹${invoiceAmount}\n` +
    `Due Date: ${dueDate}\n` +
    `Outstanding Amount: ₹${outstanding}\n\n` +
    `Please arrange payment to ${creditor} at the earliest.\n\n` +
    `Pay via UPI: ${upiId}\n` +
    `Payee: ${payee}\n\n` +
    `If you have already paid, or have any query about this invoice, simply reply to this message.\n\n` +
    `Regards,\nN K Lodha & Co`
  );
}

export function renderFollowUpReminderV2Body(params: string[]): string {
  const [name, invoiceNo, invoiceAmount, dueDate, outstanding, creditor, upiId, payee] = params;
  return (
    `Dear ${name},\n\n` +
    `This is a follow-up to our earlier reminder from N K Lodha & Co. Our records show the payment below is still pending.\n\n` +
    `Invoice No.: ${invoiceNo}\n` +
    `Invoice Amount: ₹${invoiceAmount}\n` +
    `Due Date: ${dueDate}\n` +
    `Outstanding Amount: ₹${outstanding}\n\n` +
    `Please arrange payment to ${creditor} at the earliest.\n\n` +
    `Pay via UPI: ${upiId}\n` +
    `Payee: ${payee}\n\n` +
    `If you have already paid, or need any clarification, please reply to this message with the payment details.\n\n` +
    `Regards,\nN K Lodha & Co`
  );
}

export function renderCommitmentReminderV2Body(params: string[]): string {
  const [name, invoiceNo, promisedOn, amountDue, creditor, upiId, payee] = params;
  return (
    `Dear ${name},\n\n` +
    `This is a reminder from N K Lodha & Co about the payment you agreed to make.\n\n` +
    `Invoice No.: ${invoiceNo}\n` +
    `Promised Payment Date: ${promisedOn}\n` +
    `Amount Due: ₹${amountDue}\n\n` +
    `Please arrange payment to ${creditor} by the promised date.\n\n` +
    `Pay via UPI: ${upiId}\n` +
    `Payee: ${payee}\n\n` +
    `If you have already paid, or need to change the date, simply reply to this message.\n\n` +
    `Regards,\nN K Lodha & Co`
  );
}

export function renderPaymentReceivedV2Body(params: string[]): string {
  const [name, creditor, invoiceNo, amountReceived, receivedOn, balance] = params;
  return (
    `Dear ${name},\n\n` +
    `We acknowledge with thanks the receipt of your payment towards dues owed to ${creditor}.\n\n` +
    `Invoice No.: ${invoiceNo}\n` +
    `Amount Received: ₹${amountReceived}\n` +
    `Received On: ${receivedOn}\n` +
    `Balance Outstanding: ₹${balance}\n\n` +
    `If you have any query about this payment, please reply to this message.\n\n` +
    `Regards,\nN K Lodha & Co`
  );
}

export function renderPaymentClosedV2Body(params: string[]): string {
  const [name, creditor, invoiceNo, totalPaid, settledOn] = params;
  return (
    `Dear ${name},\n\n` +
    `We are pleased to confirm that your dues to ${creditor} have been paid in full.\n\n` +
    `Invoice No.: ${invoiceNo}\n` +
    `Total Amount Paid: ₹${totalPaid}\n` +
    `Settled On: ${settledOn}\n` +
    `Balance Outstanding: ₹0\n\n` +
    `Thank you for your prompt attention. If you have any query, please reply to this message.\n\n` +
    `Regards,\nN K Lodha & Co`
  );
}

export const RENDERERS: Record<WhatsAppMessageKind, (params: string[]) => string> = {
  initial_reminder: renderPaymentReminderInitialV2Body,
  followup_reminder: renderFollowUpReminderV2Body,
  commitment_reminder: renderCommitmentReminderV2Body,
  payment_received: renderPaymentReceivedV2Body,
  payment_closed: renderPaymentClosedV2Body,
};
