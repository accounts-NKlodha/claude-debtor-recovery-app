import { describe, expect, it, vi } from "vitest";
import type {
  Communication, CommunicationDelivery, Debtor, Invoice, Organisation, PaymentAllocation, PaymentPromise, PaymentRecord, RecoveryCase,
} from "@/contract/types";
import {
  evaluateWhatsAppOffers, toOfferView, whatsAppEventKeys, type LiveSendEnv, type WhatsAppEngineInput, type WhatsAppOffer,
} from "./whatsapp-messages";
import type { WhatsAppMessageKind } from "./whatsapp-templates";

// 19 Sep 2026, 11:30 IST.
const NOW = new Date("2026-09-19T06:00:00Z");

const ORG: Organisation = {
  id: "org-1", clientCode: "T", legalEntityName: "ABC Traders", creditorGstin: null, udyamNumber: null, jitoMember: false,
  upiId: "abctraders@okhdfcbank", upiPayeeName: "ABC Traders Payee", createdAt: "2026-01-01T00:00:00Z",
};
const DEBTOR = { id: "d1", name: "Rohit Sharma", mobile: "9876500011", email: null } as Debtor;
const invoice = (id: string, no: string, total: number, outstanding: number): Invoice =>
  ({ id, caseId: "case-1", invoiceNumber: no, invoiceTotal: total, outstandingBalance: outstanding, dueDate: "2026-09-18" }) as Invoice;
const kase = (over: Partial<RecoveryCase> = {}): RecoveryCase =>
  ({ id: "case-1", organisationId: "org-1", debtorId: "d1", status: "active", principalOutstanding: 100_000_00, nextScheduledAt: null, ...over }) as RecoveryCase;
const payment = (id: string, amount: number, receivedOn: string, confirmed = true): PaymentRecord =>
  ({ id, caseId: "case-1", amount, receivedOn, kind: "bank", clientConfirmed: confirmed, createdAt: `${receivedOn}T05:00:00Z` }) as PaymentRecord;
const alloc = (id: string, paymentRecordId: string, invoiceId: string, amount: number, at: string): PaymentAllocation =>
  ({ id, paymentRecordId, invoiceId, amount, createdAt: at }) as PaymentAllocation;
const promise = (over: Partial<PaymentPromise> = {}): PaymentPromise => ({
  id: "pr-1", organisationId: "org-1", caseId: "case-1", invoiceId: "inv-1", promisedOn: "2026-09-25", promisedAmount: null,
  status: "active", sourceReplyId: null, supersedesId: null, recordedById: "u1", createdAt: "2026-09-19T05:00:00Z", supersededAt: null, ...over,
});

function make(over: Partial<WhatsAppEngineInput> = {}, env: Partial<LiveSendEnv> = {}): WhatsAppEngineInput {
  return {
    now: NOW,
    env: { liveConfigured: true, campaignConfigured: () => true, isAutomationEnabled: async () => true, ...env },
    kase: kase(),
    debtor: DEBTOR,
    org: ORG,
    invoices: [invoice("inv-1", "INV-1024", 100_000_00, 100_000_00)],
    payments: [], allocations: [], promises: [], communications: [], deliveriesByCommunication: {},
    ...over,
  };
}
const of = (offers: WhatsAppOffer[], kind: WhatsAppMessageKind) => offers.filter((o) => o.kind === kind);

describe("idempotency identity per business event", () => {
  it("is built from the event, not merely recipient + template", () => {
    expect(whatsAppEventKeys.initialReminder("c1", "i1")).toBe("wa:initial-reminder:c1:i1");
    expect(whatsAppEventKeys.followUpReminder("c1", "i1")).toBe("wa:followup-reminder:c1:i1:1");
    expect(whatsAppEventKeys.followUpReminder("c1", "i1", 2)).toBe("wa:followup-reminder:c1:i1:2");
    expect(whatsAppEventKeys.commitmentReminder("p1")).toBe("wa:commitment-reminder:p1");
    expect(whatsAppEventKeys.paymentReceived("pay1", "i1")).toBe("wa:payment-received:pay1:i1");
    expect(whatsAppEventKeys.paymentClosed("c1", "i1", "pay9")).toBe("wa:payment-closed:c1:i1:pay9");
  });
});

describe("initial reminder offer", () => {
  it("is available for an active case, tied to the specific invoice, with the 8 parameters", async () => {
    const [o] = of(await evaluateWhatsAppOffers(make()), "initial_reminder");
    expect(o.status).toBe("available");
    expect(o.eventKey).toBe("wa:initial-reminder:case-1:inv-1");
    expect(o.subject).toEqual({ invoiceId: "inv-1" });
    expect(o.entry?.templateKey).toBe("payment_reminder_initial_v2");
    expect(o.entry?.templateParams).toHaveLength(8);
    expect(o.entry?.idempotencyKey).toBe(o.eventKey);
    expect(o.reason).toMatch(/not been sent its initial reminder/);
  });

  it("is unavailable, with the reason, once the case is past its reminder stage", async () => {
    const [o] = of(await evaluateWhatsAppOffers(make({ kase: kase({ status: "follow_up_sent" }) })), "initial_reminder");
    expect(o.status).toBe("unavailable");
    expect(o.reason).toMatch(/only sent while a case is in its reminder stage/);
    expect(o.entry).toBeNull();
  });

  it("stays available for an un-reminded invoice while the case is initial_communication_sent (case status is an aggregate, not a per-invoice lock)", async () => {
    const [o] = of(await evaluateWhatsAppOffers(make({ kase: kase({ status: "initial_communication_sent" }) })), "initial_reminder");
    expect(o.status).toBe("available");
  });

  it("offers one reminder PER INVOICE on a multi-invoice case, each with its own identity and amounts", async () => {
    const invoices = [invoice("inv-1", "A-1", 50_000_00, 50_000_00), invoice("inv-2", "B-2", 75_000_00, 25_000_00)];
    const offers = of(await evaluateWhatsAppOffers(make({ invoices })), "initial_reminder");
    expect(offers.map((o) => o.eventKey)).toEqual(["wa:initial-reminder:case-1:inv-1", "wa:initial-reminder:case-1:inv-2"]);
    expect(offers[1].entry?.templateParams?.[1]).toBe("B-2");
    expect(offers[1].entry?.templateParams?.[2]).toBe(" 75,000");
    expect(offers[1].entry?.templateParams?.[4]).toBe(" 25,000");
  });

  it("has a placeholder (never a guessed invoice) when the case has no invoice", async () => {
    const [o] = of(await evaluateWhatsAppOffers(make({ invoices: [] })), "initial_reminder");
    expect(o).toMatchObject({ status: "unavailable", eventKey: null });
    expect(o.reason).toMatch(/no invoice/i);
  });
});

describe("follow-up reminder offer", () => {
  const due = kase({ status: "initial_communication_sent", nextScheduledAt: "2026-09-18T10:00:00Z" });

  it("becomes available once the 24h window has elapsed, keyed by case + invoice + stage 1", async () => {
    const [o] = of(await evaluateWhatsAppOffers(make({ kase: due })), "followup_reminder");
    expect(o.status).toBe("available");
    expect(o.eventKey).toBe("wa:followup-reminder:case-1:inv-1:1");
    expect(o.entry?.templateKey).toBe("payment_reminder_followup_v2");
    expect(o.entry?.templateParams).toHaveLength(8);
    expect(o.reason).toMatch(/within 24 hours of this invoice's initial reminder/);
  });

  it("is not yet available inside the response window (states the end date)", async () => {
    const k = kase({ status: "initial_communication_sent", nextScheduledAt: "2026-09-20T10:00:00Z" });
    const [o] = of(await evaluateWhatsAppOffers(make({ kase: k })), "followup_reminder");
    expect(o.status).toBe("unavailable");
    expect(o.reason).toMatch(/runs until 20 September 2026/);
  });

  it("is unavailable before the initial reminder, and outside the initial-reminder stage", async () => {
    expect(of(await evaluateWhatsAppOffers(make()), "followup_reminder")[0].reason).toMatch(/initial reminder has not been sent yet/);
    for (const status of ["follow_up_sent", "promise_to_pay", "gst_eligibility_review", "recovered"] as const) {
      const [o] = of(await evaluateWhatsAppOffers(make({ kase: kase({ status }) })), "followup_reminder");
      expect(o.status, status).toBe("unavailable");
    }
  });

  it("is unavailable when the response window never started", async () => {
    const k = kase({ status: "initial_communication_sent", nextScheduledAt: null });
    expect(of(await evaluateWhatsAppOffers(make({ kase: k })), "followup_reminder")[0].reason).toMatch(/initial reminder has not been sent yet/);
  });
});

describe("commitment reminder offer", () => {
  const promised = kase({ status: "promise_to_pay" });

  it("has a placeholder when no promise exists", async () => {
    const [o] = of(await evaluateWhatsAppOffers(make({ kase: promised })), "commitment_reminder");
    expect(o).toMatchObject({ status: "unavailable", eventKey: null });
    expect(o.reason).toMatch(/No promise to pay/);
  });

  it("is available for a genuine active promise, tied to that promise's identity and invoice", async () => {
    const [o] = of(await evaluateWhatsAppOffers(make({ kase: promised, promises: [promise({ promisedAmount: 40_000_00 })] })), "commitment_reminder");
    expect(o.status).toBe("available");
    expect(o.eventKey).toBe("wa:commitment-reminder:pr-1");
    expect(o.subject).toEqual({ promiseId: "pr-1", invoiceId: "inv-1" });
    expect(o.entry?.templateParams).toEqual([
      "Rohit Sharma", "INV-1024", "25 September 2026", " 40,000", "ABC Traders", "abctraders@okhdfcbank", "ABC Traders Payee",
    ]);
    expect(o.detail).toMatch(/25 September 2026 of ₹40,000/);
  });

  it("uses the invoice outstanding when no amount was promised, and never more than the outstanding", async () => {
    const a = of(await evaluateWhatsAppOffers(make({ kase: promised, promises: [promise()] })), "commitment_reminder")[0];
    expect(a.entry?.templateParams?.[3]).toBe(" 1,00,000");
    const inv = [invoice("inv-1", "INV-1024", 100_000_00, 30_000_00)];
    const b = of(await evaluateWhatsAppOffers(make({ kase: promised, invoices: inv, promises: [promise({ promisedAmount: 90_000_00 })] })), "commitment_reminder")[0];
    expect(b.entry?.templateParams?.[3]).toBe(" 30,000");
  });

  it("notes when the promised date is today, and is unavailable once the date has passed", async () => {
    const today = of(await evaluateWhatsAppOffers(make({ kase: promised, promises: [promise({ promisedOn: "2026-09-19" })] })), "commitment_reminder")[0];
    expect(today.status).toBe("available");
    expect(today.reason).toMatch(/today/);
    const past = of(await evaluateWhatsAppOffers(make({ kase: promised, promises: [promise({ promisedOn: "2026-09-18" })] })), "commitment_reminder")[0];
    expect(past.status).toBe("unavailable");
    expect(past.reason).toMatch(/promised date .* has passed/);
  });

  it("is unavailable when the case is no longer in the promise-to-pay stage", async () => {
    const o = of(await evaluateWhatsAppOffers(make({ kase: kase({ status: "payment_confirmation_required" }), promises: [promise()] })), "commitment_reminder")[0];
    expect(o.status).toBe("unavailable");
    expect(o.reason).toMatch(/no longer in the promise-to-pay stage/);
  });

  it("a promise not linked to an invoice is ambiguous on a multi-invoice case (no guessing), but fine on a single-invoice case", async () => {
    const two = [invoice("inv-1", "A-1", 50_000_00, 50_000_00), invoice("inv-2", "B-2", 50_000_00, 50_000_00)];
    const amb = of(await evaluateWhatsAppOffers(make({ kase: promised, invoices: two, promises: [promise({ invoiceId: null })] })), "commitment_reminder")[0];
    expect(amb.status).toBe("unavailable");
    expect(amb.reason).toMatch(/not linked to an invoice/);
    const single = of(await evaluateWhatsAppOffers(make({ kase: promised, promises: [promise({ invoiceId: null })] })), "commitment_reminder")[0];
    expect(single.status).toBe("available");
    expect(single.subject.invoiceId).toBe("inv-1");
  });

  it("history is preserved: a superseded promise is not offered and the new promise has its own identity", async () => {
    const promises = [
      promise({ id: "pr-1", promisedOn: "2026-09-22", status: "superseded", supersededAt: "2026-09-19T05:30:00Z" }),
      promise({ id: "pr-2", promisedOn: "2026-09-27", supersedesId: "pr-1" }),
    ];
    const offers = of(await evaluateWhatsAppOffers(make({ kase: promised, promises })), "commitment_reminder");
    expect(offers).toHaveLength(1);
    expect(offers[0].eventKey).toBe("wa:commitment-reminder:pr-2");
    expect(offers[0].entry?.templateParams?.[2]).toBe("27 September 2026");
  });

  it("the earlier promise's send does not block the new promise's send (each is its own event)", async () => {
    const comm = { id: "c-old", channel: "whatsapp", direction: "outbound", idempotencyKey: "wa:commitment-reminder:pr-1", deliveryStatus: "sent", createdAt: "2026-09-19T05:00:00Z" } as Communication;
    const promises = [
      promise({ id: "pr-1", status: "superseded" }),
      promise({ id: "pr-2", promisedOn: "2026-09-27", supersedesId: "pr-1" }),
    ];
    const offers = of(await evaluateWhatsAppOffers(make({ kase: promised, promises, communications: [comm], deliveriesByCommunication: { "c-old": [] } })), "commitment_reminder");
    expect(offers[0]).toMatchObject({ eventKey: "wa:commitment-reminder:pr-2", status: "available" });
  });
});

describe("payment received vs payment closed", () => {
  const inv = (out: number) => [invoice("inv-1", "INV-1024", 100_000_00, out)];

  it("has a placeholder until a payment is confirmed (an unconfirmed record has no allocation and is never offered)", async () => {
    const offers = of(await evaluateWhatsAppOffers(make({ payments: [payment("pay-1", 25_000_00, "2026-09-19", false)] })), "payment_received");
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ status: "unavailable", eventKey: null });
    expect(offers[0].reason).toMatch(/No confirmed payment/);
  });

  it("PARTIAL payment (₹25,000 of ₹1,00,000): received is available with the remaining balance; closed is NOT", async () => {
    const offers = await evaluateWhatsAppOffers(
      make({
        kase: kase({ status: "payment_confirmation_required", principalOutstanding: 75_000_00 }),
        invoices: inv(75_000_00),
        payments: [payment("pay-1", 25_000_00, "2026-09-19")],
        allocations: [alloc("al-1", "pay-1", "inv-1", 25_000_00, "2026-09-19T05:00:00Z")],
      }),
    );
    const [received] = of(offers, "payment_received");
    expect(received.status).toBe("available");
    expect(received.eventKey).toBe("wa:payment-received:pay-1:inv-1");
    expect(received.subject).toEqual({ paymentId: "pay-1", invoiceId: "inv-1" });
    expect(received.entry?.templateParams).toEqual(["Rohit Sharma", "ABC Traders", "INV-1024", " 25,000", "19 September 2026", " 75,000"]);
    expect(received.detail).toMatch(/₹25,000 received on 19 September 2026 against invoice INV-1024/);
    const [closed] = of(offers, "payment_closed");
    expect(closed.status).toBe("unavailable");
    expect(closed.eventKey).toBeNull();
    expect(closed.reason).toMatch(/outstanding balance of ₹75,000 remains|Available once/);
  });

  it("keeps paise in the received amount and balance", async () => {
    const offers = await evaluateWhatsAppOffers(
      make({
        kase: kase({ principalOutstanding: 89_999_50 }),
        invoices: inv(89_999_50),
        payments: [payment("pay-1", 10_000_50, "2026-09-19")],
        allocations: [alloc("al-1", "pay-1", "inv-1", 10_000_50, "2026-09-19T05:00:00Z")],
      }),
    );
    expect(of(offers, "payment_received")[0].entry?.templateParams?.slice(3)).toEqual([" 10,000.50", "19 September 2026", " 89,999.50"]);
  });

  it("computes each payment's balance-after from the ledger, even when a later payment exists", async () => {
    const offers = of(
      await evaluateWhatsAppOffers(
        make({
          kase: kase({ principalOutstanding: 50_000_00 }),
          invoices: inv(50_000_00),
          payments: [payment("pay-1", 25_000_00, "2026-09-10"), payment("pay-2", 25_000_00, "2026-09-15")],
          allocations: [alloc("al-1", "pay-1", "inv-1", 25_000_00, "2026-09-10T05:00:00Z"), alloc("al-2", "pay-2", "inv-1", 25_000_00, "2026-09-15T05:00:00Z")],
        }),
      ),
      "payment_received",
    );
    const byPay = Object.fromEntries(offers.map((o) => [o.subject.paymentId, o.entry?.templateParams?.[5]]));
    expect(byPay).toEqual({ "pay-1": " 75,000", "pay-2": " 50,000" }); // 100k -25k = 75k after the first; 50k after the second
  });

  it("FINAL payment settling a single-invoice case: closed is available; received is suppressed (never both)", async () => {
    const offers = await evaluateWhatsAppOffers(
      make({
        kase: kase({ status: "recovered", principalOutstanding: 0 }),
        invoices: inv(0),
        payments: [payment("pay-1", 25_000_00, "2026-09-10"), payment("pay-2", 75_000_00, "2026-09-20")],
        allocations: [alloc("al-1", "pay-1", "inv-1", 25_000_00, "2026-09-10T05:00:00Z"), alloc("al-2", "pay-2", "inv-1", 75_000_00, "2026-09-20T05:00:00Z")],
      }),
    );
    const [closed] = of(offers, "payment_closed");
    expect(closed.status).toBe("available");
    expect(closed.eventKey).toBe("wa:payment-closed:case-1:inv-1:pay-2");
    expect(closed.entry?.templateParams).toEqual(["Rohit Sharma", "ABC Traders", "INV-1024", " 1,00,000", "20 September 2026"]);
    const received = of(offers, "payment_received");
    const settling = received.find((o) => o.subject.paymentId === "pay-2")!;
    expect(settling.status).toBe("unavailable");
    expect(settling.reason).toMatch(/Payment Closed confirmation instead/);
    // The earlier partial payment can still be acknowledged.
    expect(received.find((o) => o.subject.paymentId === "pay-1")!.status).toBe("available");
  });

  it("a recovered case with outstanding still > 0 (e.g. hearing outcome) does NOT enable the closed message", async () => {
    const offers = await evaluateWhatsAppOffers(
      make({ kase: kase({ status: "recovered", principalOutstanding: 40_000_00 }), invoices: inv(40_000_00) }),
    );
    const [closed] = of(offers, "payment_closed");
    expect(closed.status).toBe("unavailable");
    expect(closed.eventKey).toBeNull();
    expect(closed.reason).toMatch(/outstanding balance of ₹40,000 remains/);
  });

  it("a multi-invoice case never guesses an invoice for the closed message, but the payment is still acknowledgeable per invoice", async () => {
    const invoices = [invoice("inv-1", "A-1", 50_000_00, 0), invoice("inv-2", "B-2", 50_000_00, 0)];
    const offers = await evaluateWhatsAppOffers(
      make({
        kase: kase({ status: "recovered", principalOutstanding: 0 }),
        invoices,
        payments: [payment("pay-1", 100_000_00, "2026-09-20")],
        allocations: [alloc("al-1", "pay-1", "inv-1", 50_000_00, "2026-09-20T05:00:00Z"), alloc("al-2", "pay-1", "inv-2", 50_000_00, "2026-09-20T05:00:00Z")],
      }),
    );
    const [closed] = of(offers, "payment_closed");
    expect(closed.status).toBe("unavailable");
    expect(closed.reason).toMatch(/several invoices/);
    const received = of(offers, "payment_received");
    expect(received.map((o) => o.eventKey).sort()).toEqual(["wa:payment-received:pay-1:inv-1", "wa:payment-received:pay-1:inv-2"]);
    expect(received.every((o) => o.status === "available")).toBe(true);
  });

  it("needs no UPI details for received/closed", async () => {
    const noUpi = { ...ORG, upiId: null, upiPayeeName: null };
    const offers = await evaluateWhatsAppOffers(
      make({
        org: noUpi,
        kase: kase({ status: "recovered", principalOutstanding: 0 }),
        invoices: inv(0),
        payments: [payment("pay-1", 100_000_00, "2026-09-20")],
        allocations: [alloc("al-1", "pay-1", "inv-1", 100_000_00, "2026-09-20T05:00:00Z")],
      }),
    );
    expect(of(offers, "payment_closed")[0].status).toBe("available");
  });
});

describe("common blockers (fail closed, no mock fallback)", () => {
  const all = (offers: WhatsAppOffer[]) => offers.filter((o) => o.eventKey !== null);

  it("everything is unavailable when the live provider is not enabled", async () => {
    const offers = await evaluateWhatsAppOffers(make({}, { liveConfigured: false }));
    for (const o of all(offers)) expect(o.status).toBe("unavailable");
    expect(of(offers, "initial_reminder")[0].reason).toMatch(/not enabled in this environment/);
  });

  it("a missing campaign makes ONLY that message unavailable, without naming any provider internals", async () => {
    const offers = await evaluateWhatsAppOffers(make({}, { campaignConfigured: (k) => k !== "initial_reminder" }));
    const initial = of(offers, "initial_reminder")[0];
    expect(initial.status).toBe("unavailable");
    expect(initial.reason).toMatch(/campaign for this message is not configured/);
    expect(initial.reason).not.toMatch(/AISENSY|env/i);
  });

  it("missing UPI details block the three payment-instruction messages with a controlled reason", async () => {
    const noPayee = { ...ORG, upiPayeeName: null };
    const initial = await evaluateWhatsAppOffers(make({ org: noPayee }));
    expect(of(initial, "initial_reminder")[0].reason).toMatch(/payment details \(UPI ID and UPI payee name\) are not configured/);
    const followUp = await evaluateWhatsAppOffers(
      make({ org: noPayee, kase: kase({ status: "initial_communication_sent", nextScheduledAt: "2026-09-18T10:00:00Z" }) }),
    );
    expect(of(followUp, "followup_reminder")[0].reason).toMatch(/payment details/);
    const commitment = await evaluateWhatsAppOffers(make({ org: noPayee, kase: kase({ status: "promise_to_pay" }), promises: [promise()] }));
    expect(of(commitment, "commitment_reminder")[0].reason).toMatch(/payment details/);
  });

  it("reports a missing or invalid debtor mobile", async () => {
    const none = await evaluateWhatsAppOffers(make({ debtor: { ...DEBTOR, mobile: null } }));
    expect(of(none, "initial_reminder")[0].reason).toMatch(/no mobile number/);
    const bad = await evaluateWhatsAppOffers(make({ debtor: { ...DEBTOR, mobile: "12345" } }));
    expect(of(bad, "initial_reminder")[0].reason).toMatch(/not a valid Indian mobile number/);
  });

  it("reports the kill switch, and reads it at most once per evaluation", async () => {
    const isAutomationEnabled = vi.fn(async () => false);
    // An active case (initial eligible) that also has a confirmed partial payment (received eligible): two offers reach the kill switch.
    const offers = await evaluateWhatsAppOffers(
      make(
        {
          invoices: [invoice("inv-1", "INV-1024", 100_000_00, 75_000_00)],
          payments: [payment("pay-1", 25_000_00, "2026-09-19")],
          allocations: [alloc("al-1", "pay-1", "inv-1", 25_000_00, "2026-09-19T05:00:00Z")],
        },
        { isAutomationEnabled },
      ),
    );
    expect(of(offers, "initial_reminder")[0].reason).toMatch(/kill switch is off/);
    expect(of(offers, "payment_received")[0].reason).toMatch(/kill switch is off/);
    expect(isAutomationEnabled).toHaveBeenCalledTimes(1);
  });

  it("does not read the kill switch when a cheaper check already blocks", async () => {
    const isAutomationEnabled = vi.fn(async () => true);
    await evaluateWhatsAppOffers(make({ debtor: { ...DEBTOR, mobile: null } }, { isAutomationEnabled }));
    expect(isAutomationEnabled).not.toHaveBeenCalled();
  });

  it("reports missing required data by label when a builder input is empty", async () => {
    const offers = await evaluateWhatsAppOffers(make({ debtor: { ...DEBTOR, name: "  " } }));
    expect(of(offers, "initial_reminder")[0].reason).toMatch(/required data is missing: debtor name/i);
  });
});

describe("history: accepted / rejected / ambiguous", () => {
  const key = "wa:initial-reminder:case-1:inv-1";
  const comm = (status: Communication["deliveryStatus"]) =>
    ({ id: "c1", channel: "whatsapp", direction: "outbound", idempotencyKey: key, deliveryStatus: status, createdAt: "2026-09-19T05:00:00Z" }) as Communication;
  const delivery = (n: number): CommunicationDelivery => ({ id: `dl${n}`, attempt: n, occurredAt: `2026-09-19T05:0${n}:00Z` }) as CommunicationDelivery;

  it("an accepted send is final: status 'sent', never re-offered (states acceptance, not delivery), even if the case moved on", async () => {
    const [o] = of(
      await evaluateWhatsAppOffers(make({ kase: kase({ status: "initial_communication_sent" }), communications: [comm("sent")], deliveriesByCommunication: { c1: [delivery(1)] } })),
      "initial_reminder",
    );
    expect(o.status).toBe("sent");
    expect(o.history).toMatchObject({ outcome: "accepted", attempts: 1 });
    expect(o.reason).toMatch(/Accepted by the WhatsApp provider on 19 September 2026 \(delivery is not confirmed\)/);
    expect(o.entry).toBeNull();
  });

  it("a rejected attempt is retryable and says so", async () => {
    const [o] = of(await evaluateWhatsAppOffers(make({ communications: [comm("failed")], deliveriesByCommunication: { c1: [delivery(1)] } })), "initial_reminder");
    expect(o.status).toBe("available");
    expect(o.history?.outcome).toBe("rejected");
    expect(o.reason).toMatch(/previous attempt on 19 September 2026 was rejected -- you can retry/);
    expect(o.ambiguous).toBe(false);
  });

  it("an attempt whose outcome is unknown is flagged ambiguous and requires explicit confirmation", async () => {
    const [o] = of(await evaluateWhatsAppOffers(make({ communications: [comm("queued")], deliveriesByCommunication: { c1: [delivery(1)] } })), "initial_reminder");
    expect(o.status).toBe("available");
    expect(o.ambiguous).toBe(true);
    expect(o.history?.outcome).toBe("ambiguous");
    expect(o.reason).toMatch(/outcome is unknown -- confirm before retrying/);
  });

  it("counts attempts and reports the latest attempt time", async () => {
    const [o] = of(await evaluateWhatsAppOffers(make({ communications: [comm("failed")], deliveriesByCommunication: { c1: [delivery(1), delivery(2)] } })), "initial_reminder");
    expect(o.history).toMatchObject({ attempts: 2, attemptedAt: "2026-09-19T05:02:00Z" });
  });
});

describe("toOfferView", () => {
  it("strips the recipient number and parameters before anything reaches a browser component", async () => {
    const [o] = of(await evaluateWhatsAppOffers(make()), "initial_reminder");
    expect(o.entry?.to).toBe("9876500011");
    const view = toOfferView(o);
    expect("entry" in view).toBe(false);
    expect(JSON.stringify(view)).not.toMatch(/9876500011|abctraders@okhdfcbank/);
  });
});
