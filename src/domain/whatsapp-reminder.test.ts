import { describe, expect, it, vi } from "vitest";
import type { Invoice, Organisation } from "@/contract/types";
import { PAYMENT_DETAILS_NOT_CONFIGURED_REASON, planWhatsAppReminder } from "./whatsapp-reminder";
import type { LiveSendEnv } from "./whatsapp-messages";

const ORG: Organisation = {
  id: "org-1", clientCode: "TEST", legalEntityName: "Test Company", creditorGstin: null, udyamNumber: null,
  jitoMember: false, upiId: "testcompany@upi", upiPayeeName: "Test Company Payee", createdAt: "2026-01-01T00:00:00Z",
};

const inv = (id: string, number: string, outstanding = 1_000_00): Invoice =>
  ({ id, invoiceNumber: number, invoiceTotal: 1_000_00, outstandingBalance: outstanding, dueDate: "2026-09-18" }) as Invoice;

function input(over: Partial<Parameters<typeof planWhatsAppReminder>[0]> = {}, env: Partial<LiveSendEnv> = {}) {
  const isAutomationEnabled = env.isAutomationEnabled ?? vi.fn(async () => true);
  return {
    isAutomationEnabled,
    args: {
      caseId: "case-1",
      debtor: { name: "WhatsApp Test Customer", mobile: "9876500011" } as { name: string; mobile: string | null } | undefined,
      org: ORG as Organisation | undefined,
      invoices: [inv("inv-1", "WA-TEST-001")],
      selectedInvoiceId: undefined as string | null | undefined,
      isProduction: true,
      legacyBody: "legacy body",
      env: { liveConfigured: true, campaignConfigured: () => true, isAutomationEnabled, ...env } as LiveSendEnv,
      ...over,
    },
  };
}

describe("planWhatsAppReminder -- live AiSensy configured", () => {
  it("attempts the V2 initial template with the 8-value mapping and a business-event idempotency key", async () => {
    const plan = await planWhatsAppReminder(input().args);
    expect(plan.kind).toBe("attempt");
    if (plan.kind !== "attempt") return;
    expect(plan.entry.templateKey).toBe("payment_reminder_initial_v2");
    expect(plan.entry.templateVersion).toBe(2);
    expect(plan.entry.to).toBe("9876500011");
    expect(plan.entry.idempotencyKey).toBe("wa:initial-reminder:case-1:inv-1");
    expect(plan.entry.templateParams).toEqual([
      "WhatsApp Test Customer", "WA-TEST-001", " 1,000", "18 September 2026", " 1,000", "Test Company", "testcompany@upi", "Test Company Payee",
    ]);
    expect(plan.entry.body).toContain("Pay via UPI: testcompany@upi");
  });

  it("uses the selected invoice's own amounts when the case has several invoices", async () => {
    const invoices = [inv("inv-1", "A-1", 500_00), inv("inv-2", "B-2", 2_500_00)];
    const plan = await planWhatsAppReminder(input({ invoices, selectedInvoiceId: "inv-2" }).args);
    expect(plan.kind).toBe("attempt");
    if (plan.kind !== "attempt") return;
    expect(plan.entry.templateParams![1]).toBe("B-2");
    expect(plan.entry.templateParams![4]).toBe(" 2,500");
    expect(plan.entry.idempotencyKey).toBe("wa:initial-reminder:case-1:inv-2");
  });

  it("NEVER silently picks the first invoice of a multi-invoice case", async () => {
    const invoices = [inv("inv-1", "A-1"), inv("inv-2", "B-2")];
    const plan = await planWhatsAppReminder(input({ invoices }).args);
    expect(plan.kind).toBe("skipped");
    if (plan.kind === "skipped") expect(plan.reason).toMatch(/2 invoices -- choose the invoice/);
  });

  it("skips for an invoice that is not on the case, has no balance, or when the case has no invoices", async () => {
    const a = await planWhatsAppReminder(input({ selectedInvoiceId: "inv-other" }).args);
    expect(a).toMatchObject({ kind: "skipped", reason: expect.stringMatching(/does not belong/) });
    const b = await planWhatsAppReminder(input({ invoices: [inv("inv-1", "X", 0)] }).args);
    expect(b).toMatchObject({ kind: "skipped", reason: expect.stringMatching(/no invoice on this case has an outstanding balance/) });
    const c = await planWhatsAppReminder(input({ invoices: [] }).args);
    expect(c).toMatchObject({ kind: "skipped", reason: expect.stringMatching(/no invoice/) });
  });

  it.each([
    ["no UPI ID", { upiId: null }],
    ["no payee name", { upiPayeeName: null }],
    ["neither", { upiId: null, upiPayeeName: null }],
    ["whitespace-only UPI ID", { upiId: "   " }],
    ["whitespace-only payee name", { upiPayeeName: "  " }],
  ])("skips WhatsApp with a controlled reason when the creditor has %s -- never falls back to default details", async (_label, orgOver) => {
    const { args, isAutomationEnabled } = input({ org: { ...ORG, ...orgOver } });
    const plan = await planWhatsAppReminder(args);
    expect(plan).toEqual({ kind: "skipped", reason: PAYMENT_DETAILS_NOT_CONFIGURED_REASON });
    expect(isAutomationEnabled).not.toHaveBeenCalled(); // cheap checks first: kill switch never consulted
  });

  it("skips when the initial-reminder campaign is not configured (fails closed, no mock fallback)", async () => {
    const plan = await planWhatsAppReminder(input({}, { campaignConfigured: () => false }).args);
    expect(plan.kind).toBe("skipped");
    if (plan.kind === "skipped") expect(plan.reason).toMatch(/campaign .* not configured/);
  });

  it("skips when the creditor organisation cannot be found", async () => {
    expect((await planWhatsAppReminder(input({ org: undefined }).args)).kind).toBe("skipped");
  });

  it("skips when the debtor mobile number cannot be normalized", async () => {
    const { args, isAutomationEnabled } = input({ debtor: { name: "X", mobile: "12345" } });
    const plan = await planWhatsAppReminder(args);
    expect(plan.kind).toBe("skipped");
    expect(isAutomationEnabled).not.toHaveBeenCalled();
  });

  it("skips when the global kill switch is off", async () => {
    const isAutomationEnabled = vi.fn(async () => false);
    const plan = await planWhatsAppReminder(input({}, { isAutomationEnabled }).args);
    expect(plan).toEqual({ kind: "skipped", reason: "the global automation kill switch is off" });
    expect(isAutomationEnabled).toHaveBeenCalledTimes(1);
  });

  it("returns none when the debtor has no mobile number (nothing to say)", async () => {
    expect(await planWhatsAppReminder(input({ debtor: { name: "X", mobile: null } }).args)).toEqual({ kind: "none" });
    expect(await planWhatsAppReminder(input({ debtor: undefined }).args)).toEqual({ kind: "none" });
  });
});

describe("planWhatsAppReminder -- live adapter not configured", () => {
  it("in production, is silently disabled (never a mock send)", async () => {
    expect(await planWhatsAppReminder(input({ isProduction: true }, { liveConfigured: false }).args)).toEqual({ kind: "none" });
  });

  it("outside production, keeps the legacy mock/demo path with its date-scoped default key and no payment-details requirement", async () => {
    const plan = await planWhatsAppReminder(
      input({ isProduction: false, org: { ...ORG, upiId: null, upiPayeeName: null } }, { liveConfigured: false }).args,
    );
    expect(plan.kind).toBe("attempt");
    if (plan.kind !== "attempt") return;
    expect(plan.entry.templateKey).toBe("reminder_initial_v3");
    expect(plan.entry.body).toBe("legacy body");
    expect(plan.entry.templateParams).toBeUndefined();
    expect(plan.entry.idempotencyKey).toBeUndefined();
  });
});
