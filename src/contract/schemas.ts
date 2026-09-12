/**
 * Runtime validation schemas. Used by API route handlers and the bulk importer.
 * Keep field names aligned with types.ts / the CSV contract.
 */

import { z } from "zod";

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

export const manualInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1),
  invoiceDate: flexibleDate,
  dueDate: flexibleDate.nullable().optional(),
  taxableValue: moneyToPaise,
  taxRate: z.coerce.number().min(0).max(100),
  taxAmount: moneyToPaise,
  invoiceTotal: moneyToPaise,
  outstandingBalance: moneyToPaise,
  debtorName: z.string().min(1),
  debtorGstin: optionalGstinSchema,
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
 * Onboarding a new client organisation (PRD §4 tenancy). Demo-only until
 * Phase 1 staff/admin authentication and authorization exist -- see the
 * production guard in src/app/actions/organisations.ts.
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
