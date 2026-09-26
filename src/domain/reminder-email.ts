/**
 * Debtor-facing initial-reminder EMAIL: subject, plain-text body and an
 * email-client-safe HTML body, all built from the same data so the two always
 * carry the same information. Pure and deterministic (no clock, no random) --
 * the same reminder always renders identically, like the subject.
 *
 * HTML rules: table layout, inline CSS only, ~600px wide, no remote images,
 * no scripts, no tracking. EVERY interpolated value goes through escapeHtml();
 * nothing user-controlled is ever inserted raw.
 */
import { buildReminderSubject } from "./reminder";
import { formatTemplateAmount, formatTemplateDate } from "./whatsapp-templates";

export interface ReminderEmailInput {
  creditorName: string;
  debtorName: string;
  invoiceNumber: string | null;
  invoiceAmountPaise: number | null;
  dueDate: string | null;
  outstandingPaise: number;
  /** Payment section is shown only when a UPI ID is present. */
  upiId?: string | null;
  upiPayeeName?: string | null;
  /** Other outstanding invoices on the case (0 for a single-invoice case). */
  otherInvoiceCount?: number;
  /** Total outstanding across the whole case, shown when there are other invoices. */
  totalOutstandingPaise?: number;
}

export interface ReminderEmail {
  subject: string;
  text: string;
  html: string;
}

const FIRM = "N K Lodha & Co";
const CTA =
  "Please arrange payment at your earliest convenience. If payment has already been made, or if you need any clarification, simply reply to this email.";
const DISCLAIMER = "This is an automated payment reminder.";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Single-line, trimmed -- values never break the layout or inject lines into the text body. */
const oneLine = (v: string | null | undefined): string => (v ?? "").replace(/\s+/g, " ").trim();
const rupees = (paise: number): string => `₹${formatTemplateAmount(paise)}`;

interface Row {
  label: string;
  value: string;
}

export function buildReminderEmail(input: ReminderEmailInput): ReminderEmail {
  const creditor = oneLine(input.creditorName) || "our client";
  const debtor = oneLine(input.debtorName) || "Customer";
  const invoiceNumber = oneLine(input.invoiceNumber);
  const upiId = oneLine(input.upiId);
  const payee = oneLine(input.upiPayeeName);
  const others = input.otherInvoiceCount ?? 0;

  const subject = buildReminderSubject({ legalEntityName: creditor, invoiceNumber: invoiceNumber || null });

  const invoiceRows: Row[] = [
    ...(invoiceNumber ? [{ label: "Invoice number", value: invoiceNumber }] : []),
    ...(input.invoiceAmountPaise !== null ? [{ label: "Invoice amount", value: rupees(input.invoiceAmountPaise) }] : []),
    { label: "Due date", value: formatTemplateDate(input.dueDate) },
    { label: "Outstanding amount", value: rupees(input.outstandingPaise) },
    { label: "Creditor", value: creditor },
  ];
  const otherNote =
    others > 0 && input.totalOutstandingPaise !== undefined
      ? `${others} other invoice${others === 1 ? "" : "s"} on this account ${others === 1 ? "is" : "are"} also outstanding. Total outstanding: ${rupees(input.totalOutstandingPaise)}.`
      : null;
  const paymentRows: Row[] = upiId
    ? [{ label: "UPI ID", value: upiId }, ...(payee ? [{ label: "Payee name", value: payee }] : [])]
    : [];

  return { subject, text: renderText(), html: renderHtml() };

  function renderText(): string {
    const block = (rows: Row[]) => rows.map((r) => `  ${r.label}: ${r.value}`).join("\n");
    return [
      `${FIRM} — Payment Reminder`,
      "",
      `Dear ${debtor},`,
      "",
      `This is a payment reminder on behalf of ${creditor}.`,
      "",
      "Invoice summary",
      block(invoiceRows),
      ...(otherNote ? ["", otherNote] : []),
      ...(paymentRows.length ? ["", "Pay via UPI", block(paymentRows)] : []),
      "",
      CTA,
      "",
      "Regards,",
      FIRM,
      "Debtor Recovery",
      "",
      DISCLAIMER,
    ].join("\n");
  }

  function renderHtml(): string {
    const e = escapeHtml;
    const FONT = "font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
    const NAVY = "#1f3a6e";
    const INK = "#14213d";
    const MUTED = "#5f6b7e";
    const RULE = "#dfe5ef";

    // Invoice rows: "Outstanding amount" is the one strong figure; the rest are quiet.
    const summary = invoiceRows
      .map((r, i) => {
        const strong = r.label === "Outstanding amount";
        const top = i ? `border-top:1px solid ${RULE};` : "";
        return strong
          ? `<tr><td bgcolor="#eef3fb" style="${FONT}background-color:#eef3fb;font-size:14px;line-height:22px;color:${NAVY};font-weight:600;padding:14px 16px;${top}">${e(r.label)}</td>` +
              `<td bgcolor="#eef3fb" align="right" style="${FONT}background-color:#eef3fb;font-size:22px;line-height:28px;color:${NAVY};font-weight:700;padding:14px 16px;${top}">${e(r.value)}</td></tr>`
          : `<tr><td style="${FONT}font-size:14px;line-height:20px;color:${MUTED};padding:11px 16px;${top}">${e(r.label)}</td>` +
              `<td align="right" style="${FONT}font-size:14px;line-height:20px;color:${INK};font-weight:600;padding:11px 16px;${top}">${e(r.value)}</td></tr>`;
      })
      .join("");

    const payment = paymentRows.length
      ? `<tr><td style="padding:0 32px 24px 32px;">` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${NAVY};border-radius:8px;">` +
        `<tr><td style="${FONT}padding:14px 18px 6px 18px;font-size:12px;line-height:16px;letter-spacing:0.8px;text-transform:uppercase;color:${NAVY};font-weight:700;">Pay via UPI</td></tr>` +
        paymentRows
          .map(
            (r, i) =>
              `<tr><td style="${FONT}padding:${i === paymentRows.length - 1 ? "2px 18px 16px" : "2px 18px"} 18px;font-size:15px;line-height:24px;color:${INK};"><span style="color:${MUTED};">${e(r.label)}:</span>&nbsp;<strong>${e(r.value)}</strong></td></tr>`,
          )
          .join("") +
        `</table></td></tr>`
      : "";

    const other = otherNote
      ? `<tr><td style="${FONT}padding:0 32px 20px 32px;font-size:13px;line-height:20px;color:${MUTED};">${e(otherNote)}</td></tr>`
      : "";

    // CTA: same sentence(s) as the plain-text body, split so the reassurance reads on its own line.
    const [ctaLead, ...ctaRest] = CTA.split(/(?<=\.)\s+/);
    const cta =
      `<tr><td style="padding:0 32px 28px 32px;">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
      `<td width="4" bgcolor="${NAVY}" style="background-color:${NAVY};font-size:0;line-height:0;">&nbsp;</td>` +
      `<td bgcolor="#f5f8fd" style="${FONT}background-color:#f5f8fd;padding:16px 20px;font-size:15px;line-height:24px;color:${INK};">` +
      `<p style="margin:0 0 6px 0;font-weight:600;">${e(ctaLead)}</p>` +
      (ctaRest.length ? `<p style="margin:0;color:#334155;">${e(ctaRest.join(" "))}</p>` : "") +
      `</td></tr></table></td></tr>`;

    return (
      `<!DOCTYPE html>` +
      `<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<meta name="x-apple-disable-message-reformatting"><title>${e(subject)}</title></head>` +
      `<body style="margin:0;padding:0;background-color:#e9eef6;">` +
      `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${e(`Payment reminder for invoice ${invoiceNumber || ""} — ${rupees(input.outstandingPaise)} outstanding`)}</div>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#e9eef6" style="background-color:#e9eef6;"><tr><td align="center" style="padding:28px 12px;">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:600px;background-color:#ffffff;border:1px solid ${RULE};border-top:4px solid ${NAVY};border-radius:10px;">` +
      // header
      `<tr><td bgcolor="${NAVY}" style="background-color:${NAVY};border-radius:6px 6px 0 0;padding:26px 32px 22px 32px;">` +
      `<div style="${FONT}font-size:24px;line-height:30px;font-weight:700;letter-spacing:0.2px;color:#ffffff;">${e(FIRM)}</div>` +
      `<div style="${FONT}font-size:13px;line-height:18px;letter-spacing:1px;text-transform:uppercase;color:#b9c6e2;margin-top:4px;">Payment Reminder</div></td></tr>` +
      // greeting + intro
      `<tr><td style="${FONT}padding:30px 32px 6px 32px;font-size:15px;line-height:24px;color:${INK};">` +
      `<p style="margin:0 0 12px 0;">Dear ${e(debtor)},</p>` +
      `<p style="margin:0;">This is a payment reminder on behalf of <strong>${e(creditor)}</strong>.</p></td></tr>` +
      // invoice summary
      `<tr><td style="padding:18px 32px 22px 32px;">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${RULE};border-radius:8px;">` +
      `<tr><td colspan="2" style="${FONT}border-bottom:1px solid ${RULE};padding:11px 16px;font-size:12px;line-height:16px;letter-spacing:0.8px;text-transform:uppercase;color:${NAVY};font-weight:700;">Invoice summary</td></tr>` +
      summary +
      `</table></td></tr>` +
      other +
      payment +
      cta +
      // footer
      `<tr><td style="${FONT}border-top:1px solid ${RULE};padding:20px 32px 24px 32px;font-size:13px;line-height:20px;color:#7a8597;">` +
      `<div style="color:#4a5568;font-weight:600;">${e(FIRM)}</div><div>Debtor Recovery</div>` +
      `<div style="margin-top:10px;font-size:12px;color:#8a94a6;">${e(DISCLAIMER)}</div></td></tr>` +
      `</table></td></tr></table></body></html>`
    );
  }
}
