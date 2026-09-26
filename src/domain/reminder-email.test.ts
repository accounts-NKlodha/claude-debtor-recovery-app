import { describe, expect, it } from "vitest";
import { buildReminderEmail, escapeHtml, type ReminderEmailInput } from "./reminder-email";
import { buildReminderSubject } from "./reminder";

const base: ReminderEmailInput = {
  creditorName: "Acme Industrial Supplies Pvt Ltd",
  debtorName: "Kaveri Constructions",
  invoiceNumber: "INV-2026-041",
  invoiceAmountPaise: 118000,
  dueDate: "2026-05-31",
  outstandingPaise: 118000,
  upiId: "acme@okaxis",
  upiPayeeName: "Acme Payee",
};

describe("buildReminderEmail", () => {
  const mail = buildReminderEmail(base);

  it("keeps the existing subject exactly", () => {
    expect(mail.subject).toBe("Payment reminder — Invoice INV-2026-041 (Acme Industrial Supplies Pvt Ltd)");
    expect(mail.subject).toBe(buildReminderSubject({ legalEntityName: base.creditorName, invoiceNumber: base.invoiceNumber }));
  });

  it("HTML carries the header, debtor, invoice summary, payment section, CTA and footer", () => {
    for (const s of [
      "N K Lodha &amp; Co",
      "Payment Reminder",
      "Dear Kaveri Constructions,",
      "Acme Industrial Supplies Pvt Ltd",
      "Invoice summary",
      "INV-2026-041",
      "₹1,180",
      "31 May 2026",
      "Pay via UPI",
      "acme@okaxis",
      "Acme Payee",
      "If payment has already been made",
      "Debtor Recovery",
      "This is an automated payment reminder.",
    ]) {
      expect(mail.html).toContain(s);
    }
  });

  it("plain-text fallback carries the same core information", () => {
    for (const s of [
      "N K Lodha & Co — Payment Reminder",
      "Dear Kaveri Constructions,",
      "on behalf of Acme Industrial Supplies Pvt Ltd",
      "Invoice number: INV-2026-041",
      "Invoice amount: ₹1,180",
      "Due date: 31 May 2026",
      "Outstanding amount: ₹1,180",
      "Creditor: Acme Industrial Supplies Pvt Ltd",
      "UPI ID: acme@okaxis",
      "Payee name: Acme Payee",
      "simply reply to this email",
      "Debtor Recovery",
      "This is an automated payment reminder.",
    ]) {
      expect(mail.text).toContain(s);
    }
    expect(mail.text).not.toMatch(/<[a-z]/i);
  });

  it("omits the payment section (HTML and text) when there is no UPI ID", () => {
    const m = buildReminderEmail({ ...base, upiId: null, upiPayeeName: null });
    expect(m.html).not.toContain("Pay via UPI");
    expect(m.text).not.toContain("UPI");
  });

  it("shows the UPI ID alone when there is no payee name", () => {
    const m = buildReminderEmail({ ...base, upiPayeeName: "" });
    expect(m.html).toContain("acme@okaxis");
    expect(m.html).not.toContain("Payee name");
  });

  it("mentions other outstanding invoices with the case total", () => {
    const m = buildReminderEmail({ ...base, otherInvoiceCount: 2, totalOutstandingPaise: 500000 });
    expect(m.text).toContain("2 other invoices on this account are also outstanding. Total outstanding: ₹5,000.");
    expect(m.html).toContain("2 other invoices on this account are also outstanding");
  });

  it("is deterministic", () => {
    expect(buildReminderEmail(base)).toEqual(mail);
  });

  it("is email-client-safe: tables, inline CSS, no scripts / remote assets / external CSS", () => {
    expect(mail.html).toMatch(/<table role="presentation"/);
    expect(mail.html).toContain("max-width:600px");
    expect(mail.html).toContain('name="viewport"');
    expect(mail.html).not.toMatch(/<script|<link|<img|<iframe|<style|javascript:|@import|url\(|https?:\/\//i);
  });
});

describe("visual polish (still email-client-safe)", () => {
  const html = buildReminderEmail(base).html;

  it("has a navy accent: top border plus a navy header carrying the firm name and subtitle", () => {
    expect(html).toContain("border-top:4px solid #1f3a6e");
    expect(html).toMatch(/bgcolor="#1f3a6e"[^>]*>[\s\S]*N K Lodha &amp; Co[\s\S]*Payment Reminder/);
  });

  it("makes Outstanding amount the single strongest figure", () => {
    const strong = html.match(/font-size:22px/g) ?? [];
    expect(strong).toHaveLength(1);
    expect(html).toMatch(/Outstanding amount<\/td><td[^>]*font-size:22px[^>]*>₹1,180</);
    // no alarm styling
    expect(html).not.toMatch(/#(?:f00|ff0000|dc2626|ef4444|b91c1c)/i);
  });

  it("CTA is a distinct block with the payment reassurance on its own line", () => {
    expect(html).toContain("Please arrange payment at your earliest convenience.");
    expect(html).toMatch(/<p[^>]*>If payment has already been made, or if you need any clarification, simply reply to this email\.<\/p>/);
    expect(html).toContain('width="4" bgcolor="#1f3a6e"');
  });

  it("uses a bordered payment box only when payment details exist, leaving no empty space otherwise", () => {
    expect(html).toContain("border:1px solid #1f3a6e");
    const without = buildReminderEmail({ ...base, upiId: null, upiPayeeName: null }).html;
    expect(without).not.toContain("Pay via UPI");
    expect(without).not.toContain("border:1px solid #1f3a6e");
  });

  it("stays deliverability-safe: no gradients, shadows, images, external assets or scripts", () => {
    expect(html).not.toMatch(/gradient|box-shadow|<img|<script|<link|<style|@import|url\(|https?:\/\/|javascript:/i);
    expect(html).toContain("max-width:600px");
  });

  it("footer keeps firm name, Debtor Recovery and the automated-reminder disclaimer", () => {
    expect(html).toContain("Debtor Recovery");
    expect(html).toContain("This is an automated payment reminder.");
  });
});

describe("HTML safety", () => {
  const hostile = buildReminderEmail({
    creditorName: `<script>alert("c")</script> & Co`,
    debtorName: `<img src=x onerror=alert(1)> "Debtor"`,
    invoiceNumber: `INV<b>1</b>`,
    invoiceAmountPaise: 100,
    dueDate: "2026-05-31",
    outstandingPaise: 100,
    upiId: `<a href="javascript:x">upi</a>`,
    upiPayeeName: `Payee' onmouseover='x`,
  });

  it("escapes every interpolated value: no raw tag can be injected", () => {
    expect(hostile.html).not.toContain("<script");
    expect(hostile.html).not.toContain("<img");
    expect(hostile.html).not.toContain("<b>");
    expect(hostile.html).not.toContain('<a href');
    expect(hostile.html).toContain("&lt;script&gt;alert(&quot;c&quot;)&lt;/script&gt; &amp; Co");
    expect(hostile.html).toContain("&lt;img src=x onerror=alert(1)&gt; &quot;Debtor&quot;");
    expect(hostile.html).toContain("Payee&#39; onmouseover=&#39;x");
    // and the preheader / <title> (which repeat values) are escaped too
    expect(hostile.html).toContain("<title>Payment reminder — Invoice INV&lt;b&gt;1&lt;/b&gt;");
  });

  it("keeps values single-line in the text body", () => {
    const m = buildReminderEmail({ ...base, debtorName: "Line one\nInjected: header\r\nmore" });
    expect(m.text).toContain("Dear Line one Injected: header more,");
  });

  it("escapeHtml handles all five characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
