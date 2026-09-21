import { describe, expect, it } from "vitest";
import {
  PAYMENT_REMINDER_INITIAL_V2,
  buildPaymentReminderInitialV2Params,
  renderPaymentReminderInitialV2Body,
  sanitizeTemplateParam,
} from "./whatsapp-templates";

const BASE = {
  debtorName: "WhatsApp Test Customer",
  invoiceNumber: "WA-TEST-001",
  invoiceAmountPaise: 1_000_00,
  dueDate: "2026-09-18",
  outstandingAmountPaise: 1_000_00,
  creditorName: "Test Company",
  upiId: "testcompany@upi",
  upiPayeeName: "Test Company",
};

describe("payment_reminder_initial_v2 identity", () => {
  it("pins the approved template key, version and variable count", () => {
    expect(PAYMENT_REMINDER_INITIAL_V2).toEqual({
      templateKey: "payment_reminder_initial_v2",
      templateVersion: 2,
      paramCount: 8,
    });
  });
});

describe("buildPaymentReminderInitialV2Params", () => {
  it("returns exactly 8 values in the confirmed {{1}}..{{8}} order", () => {
    expect(buildPaymentReminderInitialV2Params(BASE)).toEqual([
      "WhatsApp Test Customer", // {{1}} debtor / customer name
      "WA-TEST-001", //            {{2}} invoice number
      " 1,000", //                  {{3}} invoice amount, no rupee sign
      "18 September 2026", //      {{4}} due date
      " 1,000", //                  {{5}} outstanding amount, no rupee sign
      "Test Company", //           {{6}} creditor / client organisation name
      "testcompany@upi", //        {{7}} organisation UPI ID
      "Test Company", //           {{8}} organisation UPI payee name
    ]);
    expect(buildPaymentReminderInitialV2Params(BASE)).toHaveLength(PAYMENT_REMINDER_INITIAL_V2.paramCount);
  });

  it("never emits a rupee sign (the approved template already prints it)", () => {
    expect(buildPaymentReminderInitialV2Params(BASE).join("|")).not.toContain("₹");
  });

  it("uses Indian digit grouping for larger amounts", () => {
    const params = buildPaymentReminderInitialV2Params({
      ...BASE,
      invoiceAmountPaise: 15_00_000_00,
      outstandingAmountPaise: 12_34_567_00,
    });
    expect(params[2]).toBe(" 15,00,000");
    expect(params[4]).toBe(" 12,34,567");
  });

  it("formats the due date as a full month name regardless of the server timezone", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles"; // behind UTC: a local-time formatter would show the 17th
      expect(buildPaymentReminderInitialV2Params(BASE)[3]).toBe("18 September 2026");
      expect(buildPaymentReminderInitialV2Params({ ...BASE, dueDate: "2026-01-05" })[3]).toBe("5 January 2026");
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("substitutes a placeholder rather than an empty value when invoice number / due date are unknown", () => {
    const params = buildPaymentReminderInitialV2Params({ ...BASE, invoiceNumber: null, dueDate: null });
    expect(params[1]).toBe("—");
    expect(params[3]).toBe("—");
    expect(params.every((p) => p.length > 0)).toBe(true);
  });

  it("collapses newlines, tabs and runs of spaces (WhatsApp rejects them in parameters)", () => {
    const params = buildPaymentReminderInitialV2Params({
      ...BASE,
      debtorName: "  Acme\nTraders\t  Pvt    Ltd ",
      creditorName: "A\r\nB",
    });
    expect(params[0]).toBe("Acme Traders Pvt Ltd");
    expect(params[5]).toBe("A B");
    for (const p of params) expect(p).not.toMatch(/[\n\r\t]| {2,}/);
  });
});

describe("sanitizeTemplateParam", () => {
  it("is deterministic and idempotent", () => {
    const once = sanitizeTemplateParam(" a \n b ");
    expect(once).toBe("a b");
    expect(sanitizeTemplateParam(once)).toBe(once);
  });
});

describe("renderPaymentReminderInitialV2Body (durable record of the message)", () => {
  it("renders every parameter into the approved wording with exactly one rupee sign per amount", () => {
    const body = renderPaymentReminderInitialV2Body(buildPaymentReminderInitialV2Params(BASE));
    expect(body).toContain("Dear WhatsApp Test Customer,");
    expect(body).toContain("Invoice No.: WA-TEST-001");
    expect(body).toContain("Invoice Amount: ₹ 1,000");
    expect(body).toContain("Due Date: 18 September 2026");
    expect(body).toContain("Outstanding Amount: ₹ 1,000");
    expect(body).toContain("Please arrange payment to Test Company at the earliest.");
    expect(body).toContain("Pay via UPI: testcompany@upi");
    expect(body).toContain("Payee: Test Company");
    expect(body).toContain("N K Lodha & Co");
    expect(body).not.toContain("₹₹");
  });
});

/* ===== WhatsApp V1: the other four approved messages ===================== */
import {
  RENDERERS,
  WHATSAPP_MESSAGE_KINDS,
  WHATSAPP_TEMPLATES,
  buildCommitmentReminderV2Params,
  buildFollowUpReminderV2Params,
  buildPaymentClosedV2Params,
  buildPaymentReceivedV2Params,
  formatTemplateAmount,
  getTemplateDefByKey,
  validateTemplateParams,
} from "./whatsapp-templates";

describe("template registry", () => {
  it("pins every approved template key, version and variable count", () => {
    expect(WHATSAPP_MESSAGE_KINDS.map((k) => [k, WHATSAPP_TEMPLATES[k].templateKey, WHATSAPP_TEMPLATES[k].paramCount])).toEqual([
      ["initial_reminder", "payment_reminder_initial_v2", 8],
      ["followup_reminder", "payment_reminder_followup_v2", 8],
      ["commitment_reminder", "payment_commitment_reminder_v2", 7],
      ["payment_received", "payment_received_confirmation_v2", 6],
      ["payment_closed", "payment_closed_confirmation_v2", 5],
    ]);
  });

  it("has a label for every variable, and only the three payment-instruction templates require UPI", () => {
    for (const k of WHATSAPP_MESSAGE_KINDS) expect(WHATSAPP_TEMPLATES[k].paramLabels).toHaveLength(WHATSAPP_TEMPLATES[k].paramCount);
    expect(WHATSAPP_MESSAGE_KINDS.filter((k) => WHATSAPP_TEMPLATES[k].requiresUpi)).toEqual([
      "initial_reminder", "followup_reminder", "commitment_reminder",
    ]);
  });

  it("resolves a definition only by an approved template key", () => {
    expect(getTemplateDefByKey("payment_closed_confirmation_v2")?.kind).toBe("payment_closed");
    expect(getTemplateDefByKey("payment_dispute_acknowledgement")).toBeNull(); // approved, but deliberately not activated
    expect(getTemplateDefByKey("reminder_initial_v3")).toBeNull();
    expect(getTemplateDefByKey(undefined)).toBeNull();
  });

  it("never hardcodes business data in the registry", () => {
    expect(JSON.stringify(WHATSAPP_TEMPLATES)).not.toMatch(/@upi|@ok|INV-|Test Company|Rohit|\d{10}/);
  });
});

describe("validateTemplateParams", () => {
  const def = WHATSAPP_TEMPLATES.payment_closed;
  it("accepts exactly the right count of non-empty values", () => {
    expect(validateTemplateParams(def, ["a", "b", "c", "d", "e"])).toBeNull();
  });
  it("rejects a wrong count", () => {
    for (const n of [0, 4, 6]) expect(validateTemplateParams(def, Array(n).fill("x"))).toMatch(/exactly 5 values/);
    expect(validateTemplateParams(def, undefined)).toMatch(/exactly 5 values/);
  });
  it("names the missing variable by label (never by value)", () => {
    expect(validateTemplateParams(def, ["a", "b", "  ", "d", "e"])).toBe("required data is missing: invoice number");
    expect(validateTemplateParams(def, ["", "b", "c", "d", ""])).toBe("required data is missing: debtor name, settled on");
  });
});

describe("amount formatting", () => {
  it("shows whole rupees without decimals and any paise with exactly two", () => {
    expect(formatTemplateAmount(25_000_00)).toBe("25,000");
    expect(formatTemplateAmount(25_000_50)).toBe("25,000.50");
    expect(formatTemplateAmount(1_00_000_00)).toBe("1,00,000");
    expect(formatTemplateAmount(99)).toBe("0.99");
    expect(formatTemplateAmount(0)).toBe("0");
  });
});

describe("follow-up reminder builder (same 8-variable shape as the initial reminder)", () => {
  it("builds the identical ordered mapping", () => {
    expect(buildFollowUpReminderV2Params(BASE)).toEqual(buildPaymentReminderInitialV2Params(BASE));
    expect(buildFollowUpReminderV2Params(BASE)).toHaveLength(8);
  });
  it("renders the approved follow-up wording with every value", () => {
    const body = RENDERERS.followup_reminder(buildFollowUpReminderV2Params(BASE));
    expect(body).toContain("This is a follow-up to our earlier reminder from N K Lodha & Co.");
    expect(body).toContain("Invoice No.: WA-TEST-001");
    expect(body).toContain("Outstanding Amount: ₹ 1,000");
    expect(body).toContain("Pay via UPI: testcompany@upi");
    expect(body).not.toContain("₹₹");
  });
});

describe("commitment reminder builder", () => {
  const input = {
    debtorName: "Rohit Sharma", invoiceNumber: "INV-1024", promisedOn: "2026-09-25", amountDuePaise: 25_000_00,
    creditorName: "ABC Traders", upiId: "abctraders@okhdfcbank", upiPayeeName: "ABC Traders",
  };
  it("returns exactly 7 values in the approved {{1}}..{{7}} order", () => {
    expect(buildCommitmentReminderV2Params(input)).toEqual([
      "Rohit Sharma", "INV-1024", "25 September 2026", " 25,000", "ABC Traders", "abctraders@okhdfcbank", "ABC Traders",
    ]);
  });
  it("renders the approved wording, one rupee sign, no leaked template syntax", () => {
    const body = RENDERERS.commitment_reminder(buildCommitmentReminderV2Params(input));
    expect(body).toContain("about the payment you agreed to make");
    expect(body).toContain("Promised Payment Date: 25 September 2026");
    expect(body).toContain("Amount Due: ₹ 25,000");
    expect(body).toContain("Please arrange payment to ABC Traders by the promised date.");
    expect(body).not.toMatch(/₹₹|\{\{/);
  });
});

describe("payment received builder", () => {
  const input = {
    debtorName: "Rohit Sharma", creditorName: "ABC Traders", invoiceNumber: "INV-1024",
    amountReceivedPaise: 10_000_50, receivedOn: "2026-09-20", balanceOutstandingPaise: 15_000_00,
  };
  it("returns exactly 6 values in the approved order (creditor is {{2}}), keeping paise", () => {
    expect(buildPaymentReceivedV2Params(input)).toEqual([
      "Rohit Sharma", "ABC Traders", "INV-1024", " 10,000.50", "20 September 2026", " 15,000",
    ]);
  });
  it("renders the approved wording and needs no UPI", () => {
    const body = RENDERERS.payment_received(buildPaymentReceivedV2Params(input));
    expect(body).toContain("receipt of your payment towards dues owed to ABC Traders");
    expect(body).toContain("Amount Received: ₹ 10,000.50");
    expect(body).toContain("Balance Outstanding: ₹ 15,000");
    expect(body).not.toMatch(/UPI/);
  });
});

describe("payment closed builder", () => {
  const input = { debtorName: "Rohit Sharma", creditorName: "ABC Traders", invoiceNumber: "INV-1024", totalPaidPaise: 25_000_00, settledOn: "2026-09-20" };
  it("returns exactly 5 values in the approved order", () => {
    expect(buildPaymentClosedV2Params(input)).toEqual(["Rohit Sharma", "ABC Traders", "INV-1024", " 25,000", "20 September 2026"]);
  });
  it("renders the approved wording with the fixed zero balance and no UPI", () => {
    const body = RENDERERS.payment_closed(buildPaymentClosedV2Params(input));
    expect(body).toContain("your dues to ABC Traders have been paid in full");
    expect(body).toContain("Total Amount Paid: ₹ 25,000");
    expect(body).toContain("Settled On: 20 September 2026");
    expect(body).toContain("Balance Outstanding: ₹0");
    expect(body).not.toMatch(/UPI/);
  });
});

import { AMOUNT_PARAM_LEADING_SPACE, renderPaymentClosedV2Body, renderPaymentReceivedV2Body } from "./whatsapp-templates";

describe("amount variables carry exactly one leading space (template renders '₹ 25,000')", () => {
  const initial = buildPaymentReminderInitialV2Params({
    debtorName: "  Rohit  Sharma ", invoiceNumber: "INV-1", invoiceAmountPaise: 25_000_00, dueDate: "2026-07-15",
    outstandingAmountPaise: 25_000_50, creditorName: "ABC", upiId: "a@upi", upiPayeeName: "ABC Payee",
  });

  it("the constant is a single space", () => {
    expect(AMOUNT_PARAM_LEADING_SPACE).toBe(" ");
  });

  it("only the amount variables ({{3}}, {{5}}) are spaced -- all other values stay trimmed and normalised", () => {
    expect(initial).toEqual(["Rohit Sharma", "INV-1", " 25,000", "15 July 2026", " 25,000.50", "ABC", "a@upi", "ABC Payee"]);
  });

  it("never doubles the space (Meta rejects runs of 4+ spaces) and never adds a rupee sign", () => {
    for (const p of initial) {
      expect(p).not.toMatch(/ {2,}/);
      expect(p).not.toContain("₹");
    }
    expect(initial[2]).toMatch(/^ \d/);
  });

  it("every message family spaces its amounts and nothing else", () => {
    const followUp = buildFollowUpReminderV2Params({ debtorName: "D", invoiceNumber: "I", invoiceAmountPaise: 1_000_00, dueDate: "2026-07-15", outstandingAmountPaise: 500_00, creditorName: "C", upiId: "u@upi", upiPayeeName: "P" });
    expect([followUp[2], followUp[4]]).toEqual([" 1,000", " 500"]);
    const commitment = buildCommitmentReminderV2Params({ debtorName: "D", invoiceNumber: "I", promisedOn: "2026-09-25", amountDuePaise: 10_000_00, creditorName: "C", upiId: "u@upi", upiPayeeName: "P" });
    expect(commitment[3]).toBe(" 10,000");
    expect(commitment.filter((_, i) => i !== 3).every((p) => !p.startsWith(" "))).toBe(true);
    const received = buildPaymentReceivedV2Params({ debtorName: "D", creditorName: "C", invoiceNumber: "I", amountReceivedPaise: 10_000_00, receivedOn: "2026-09-21", balanceOutstandingPaise: 15_000_00 });
    expect([received[3], received[5]]).toEqual([" 10,000", " 15,000"]);
    const closed = buildPaymentClosedV2Params({ debtorName: "D", creditorName: "C", invoiceNumber: "I", totalPaidPaise: 25_000_00, settledOn: "2026-09-22" });
    expect(closed[3]).toBe(" 25,000");
  });

  it("the stored/rendered body shows the rupee sign, a space, then the amount", () => {
    expect(renderPaymentReminderInitialV2Body(initial)).toContain("Invoice Amount: ₹ 25,000\n");
    expect(renderPaymentReminderInitialV2Body(initial)).toContain("Outstanding Amount: ₹ 25,000.50\n");
    const closed = buildPaymentClosedV2Params({ debtorName: "D", creditorName: "C", invoiceNumber: "I", totalPaidPaise: 25_000_00, settledOn: "2026-09-22" });
    expect(renderPaymentClosedV2Body(closed)).toContain("Total Amount Paid: ₹ 25,000\n");
    const received = buildPaymentReceivedV2Params({ debtorName: "D", creditorName: "C", invoiceNumber: "I", amountReceivedPaise: 10_000_00, receivedOn: "2026-09-21", balanceOutstandingPaise: 15_000_00 });
    expect(renderPaymentReceivedV2Body(received)).toContain("Amount Received: ₹ 10,000\n");
    expect(renderPaymentReceivedV2Body(received)).toContain("Balance Outstanding: ₹ 15,000\n");
  });
});
