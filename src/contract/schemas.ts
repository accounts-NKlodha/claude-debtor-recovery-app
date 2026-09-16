/**
 * Runtime validation schemas. Used by API route handlers and the bulk importer.
 * Keep field names aligned with types.ts / the CSV contract.
 */

import { z } from "zod";
import { CHANNEL, REPLY_CLASSIFICATION } from "@/contract/enums";

export const gstinSchema = z
  .string()
  .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/, "invalid GSTIN");

/** An optional GSTIN field left blank in a form submits "" -- treat that as
 * absent rather than failing the GSTIN regex (found via live testing). */
export const optionalGstinSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  gstinSchema.nullable().optional(),
);

export const indianMobileSchema = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^(\+?91)?[6-9]\d{9}$/, "invalid Indian mobile"));

/** A debtor contact field (email/mobile) left blank in a form submits "" --
 * treat that as absent rather than failing format validation (same class
 * of bug as optionalGstinSchema/optionalFlexibleDate above). Core-workflow
 * remediation task: debtor email/mobile are always optional at the point
 * of data entry -- a case may be created or have its contact corrected
 * with either, both, or neither present. */
export const optionalEmailSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z
    .string()
    .trim()
    .toLowerCase()
    .email("invalid email")
    .nullable()
    .optional(),
);
export const optionalMobileSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  indianMobileSchema.nullable().optional(),
);

/** Editing a debtor's email/mobile (case detail -> "Edit contact details",
 * staff/admin only). At least one channel need not be present -- a case
 * without contact info is allowed to exist; this schema only governs what
 * gets *saved* when staff supplies a value. */
export const debtorContactSchema = z.object({
  email: optionalEmailSchema,
  mobile: optionalMobileSchema,
});
export type DebtorContactInput = z.infer<typeof debtorContactSchema>;

/** Staff logging + classifying an inbound debtor reply (PRD §8; no AI
 * classification is wired in this build, so classification is always
 * staff-entered). `communicationId` links to an existing inbound message
 * when this reply is being classified from one; absent when staff logs a
 * reply received outside a tracked channel (e.g. a phone call). */
export const debtorReplySchema = z.object({
  channel: z.enum(CHANNEL),
  rawBody: z.string().trim().min(1, "Reply text is required"),
  communicationId: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().nullable().optional(),
  ),
  classification: z.enum(REPLY_CLASSIFICATION),
});
export type DebtorReplyInput = z.infer<typeof debtorReplySchema>;

/** money entered by humans: "1,23,456.78" | "123456" | "-500" -> paise int */
export const moneyToPaise = z
  .string()
  .trim()
  .transform((raw, ctx) => {
    const cleaned = raw.replace(/[₹,\s]/g, "");
    if (cleaned === "" || !/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid amount" });
      return z.NEVER;
    }
    return Math.round(parseFloat(cleaned) * 100);
  });

/** accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY -> YYYY-MM-DD */
export const flexibleDate = z
  .string()
  .trim()
  .transform((raw, ctx) => {
    let m: RegExpMatchArray | null;
    if ((m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`;
    if ((m = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/))) {
      const dd = m[1].padStart(2, "0");
      const mm = m[2].padStart(2, "0");
      if (+mm > 12 || +dd > 31) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid date" });
        return z.NEVER;
      }
      return `${m[3]}-${mm}-${dd}`;
    }
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "unrecognised date format" });
    return z.NEVER;
  });

/** An optional date field left blank in a form submits "" -- treat that as
 * absent rather than failing flexibleDate's format check (same class of bug
 * as optionalGstinSchema above; found via live testing during final UAT --
 * this exact field blocked creating a case with no due date at all). */
const optionalFlexibleDate = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  flexibleDate.nullable().optional(),
);

export const manualInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1),
  invoiceDate: flexibleDate,
  dueDate: optionalFlexibleDate,
  taxableValue: moneyToPaise,
  taxRate: z.coerce.number().min(0).max(100),
  taxAmount: moneyToPaise,
  invoiceTotal: moneyToPaise,
  outstandingBalance: moneyToPaise,
  debtorName: z.string().min(1),
  debtorGstin: optionalGstinSchema,
  debtorEmail: optionalEmailSchema,
  debtorMobile: optionalMobileSchema,
});
export type ManualInvoiceInput = z.infer<typeof manualInvoiceSchema>;

export const debtorSchema = z.object({
  name: z.string().min(1),
  mobile: indianMobileSchema.nullable().optional(),
  email: z.string().email().nullable().optional(),
  gstin: optionalGstinSchema,
  address: z.string().nullable().optional(),
  totalDue: moneyToPaise,
});

/**
 * Onboarding a new client organisation (PRD §4 tenancy). Admin-only in
 * production -- see src/app/actions/organisations.ts for why (P0-1/P0-2-R2:
 * the product brief scopes staff to operating existing cases, and this
 * creates a new tenant/billing relationship, closer to Admin's
 * "Configuration" responsibility).
 *
 * `confirmDuplicateName` + `duplicateOverrideReason` support a two-step
 * flow: a legal-entity-name collision (case/whitespace-insensitive) with an
 * existing client returns a warning instead of silently creating a
 * duplicate; the caller re-submits with `confirmDuplicateName: true` and a
 * reason to proceed. A duplicate creditor GSTIN is always rejected outright
 * -- a GSTIN identifies one legal entity, so there is no legitimate override.
 */
export const createOrganisationSchema = z
  .object({
    clientCode: z
      .string()
      .trim()
      .min(2, "Client code is required")
      .max(20)
      .regex(/^[A-Za-z0-9-]+$/, "Letters, digits and hyphens only"),
    legalEntityName: z.string().trim().min(2, "Legal entity name is required"),
    creditorGstin: optionalGstinSchema,
    udyamNumber: z.string().trim().nullable().optional(),
    jitoMember: z.boolean().default(false),
    confirmDuplicateName: z.boolean().default(false),
    duplicateOverrideReason: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => !v.confirmDuplicateName || !!v.duplicateOverrideReason?.trim(), {
    message: "A reason is required to add a client with a name that already exists",
    path: ["duplicateOverrideReason"],
  });
export type CreateOrganisationInput = z.infer<typeof createOrganisationSchema>;

export const BULK_IMPORT_COLUMNS = [
  "client_code",
  "legal_entity_name",
  "creditor_gstin",
  "debtor_name",
  "debtor_gstin",
  "debtor_mobile",
  "debtor_email",
  "invoice_number",
  "invoice_date",
  "due_date",
  "taxable_value",
  "tax_rate",
  "tax_amount",
  "invoice_total",
  "adjustments",
  "total_due",
  "ledger_as_of",
  "client_certified",
  "group_key",
  "notes",
] as const;

export const gstComposeSchema = z.object({
  recipientGstin: gstinSchema,
  subject: z.string().min(1).max(50),
  action: z.enum(["payment_not_received", "others"]),
  remarks: z.string().min(1).max(200),
  invoiceRecordCount: z.number().int().min(1).max(50),
  attachmentStorageKeys: z.array(z.string()).max(4),
});
export type GstComposeInput = z.infer<typeof gstComposeSchema>;

export const reminderComposeSchema = z.object({
  caseId: z.string().uuid(),
  channels: z.array(z.enum(["whatsapp", "email", "postal"])).min(1),
  templateKey: z.string().min(1),
  body: z.string().min(1).max(4000),
  subject: z.string().max(200).optional(),
  attachDocumentIds: z.array(z.string().uuid()).optional(),
});
