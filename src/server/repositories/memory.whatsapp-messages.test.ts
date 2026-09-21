/**
 * WhatsApp V1: follow-up, commitment, payment-received and payment-closed
 * messages (plus the initial reminder's new invoice/event rules) through the
 * real repository communication path. Adapters are faked -- nothing is ever
 * sent. Proves: exact variable order/count, business-event idempotency,
 * double-click/concurrency safety, ambiguity blocking, workflow advancement
 * only where justified, kill switch, missing configuration, promise
 * history, partial-vs-final payment, audit attribution, provider
 * attribution and Gmail independence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as mock from "@/lib/mock-data";
import type { MutationActor } from "@/lib/auth/types";
import type { RecoveryCase } from "@/contract/types";
import { WHATSAPP_MESSAGE_KINDS, WHATSAPP_TEMPLATES } from "@/domain/whatsapp-templates";

vi.mock("server-only", () => ({}));

const fakeEmail = { name: "fake-gmail", send: vi.fn(), parseWebhook: () => null };
const fakeWhatsapp = { name: "fake-aisensy", send: vi.fn(), parseWebhook: () => null };
vi.mock("@/adapters", () => ({
  getAdapters: () => ({ email: fakeEmail, whatsapp: fakeWhatsapp }),
  isLiveWhatsAppConfigured: () => true,
}));

import { MemoryRepository } from "./memory";

const repo = new MemoryRepository({ allowLiveWhatsApp: true });
const staff: MutationActor = { actorId: "test-staff-wa-msgs", actorRole: "staff" };
const admin: MutationActor = { actorId: "test-admin-wa-msgs", actorRole: "admin" };

const OK = (ref: string | null = null) => ({
  outcome: "success" as const, providerRef: ref, errorCode: null, evidenceRefs: [], nextAction: null, data: { providerMessageId: ref ?? "" },
});
const REJECTED = { outcome: "permanent_failure" as const, providerRef: null, errorCode: "AISENSY_REQUEST_REJECTED_400", evidenceRefs: [], nextAction: "x" };

const istToday = (plusDays = 0) => new Date(Date.now() + 330 * 60_000 + plusDays * 86_400_000).toISOString().slice(0, 10);

afterEach(() => vi.unstubAllEnvs());
beforeEach(async () => {
  for (const k of WHATSAPP_MESSAGE_KINDS) vi.stubEnv(WHATSAPP_TEMPLATES[k].campaignEnvVar, `Campaign ${k}`);
  fakeEmail.send.mockReset();
  fakeWhatsapp.send.mockReset();
  fakeEmail.send.mockResolvedValue(OK("<e@mail>"));
  fakeWhatsapp.send.mockResolvedValue(OK());
  await repo.setAutomationState(true, "test reset", admin);
  mock.updateOrganisationPaymentDetails("org-1", "acme@okaxis", "Acme Industrial Payee");
});

interface InvoiceSpec { number: string; total: number; outstanding: number }
let seq = 0;
function seed(
  status: RecoveryCase["status"],
  over: { mobile?: string | null; email?: string | null; invoices?: InvoiceSpec[]; nextScheduledAt?: string | null } = {},
) {
  const id = `case-wamsg-${++seq}`;
  const base = mock.getCase("case-1")!;
  const debtor = mock.getDebtor(base.debtorId)!;
  const specs = over.invoices ?? [{ number: "WA-TEST-001", total: 100_000_00, outstanding: 100_000_00 }];
  mock.insertDebtor({
    ...debtor, id: `deb-${id}`, name: "WhatsApp Test Customer",
    mobile: over.mobile !== undefined ? over.mobile : "9876500011",
    email: over.email !== undefined ? over.email : null,
  });
  const kase: RecoveryCase = {
    ...base, id, debtorId: `deb-${id}`, status, closedAt: null,
    principalOutstanding: specs.reduce((s, i) => s + i.outstanding, 0),
    nextScheduledAt: over.nextScheduledAt === undefined ? null : over.nextScheduledAt,
  };
  mock.insertCase(kase);
  const baseInvoice = mock.listInvoicesForCase("case-1")[0];
  const invoiceIds = specs.map((spec, i) => {
    const invId = `inv-${id}-${i + 1}`;
    mock.insertInvoice({ ...baseInvoice, id: invId, caseId: id, invoiceNumber: spec.number, invoiceTotal: spec.total, outstandingBalance: spec.outstanding, dueDate: "2026-09-18" });
    return invId;
  });
  return { id, kase, invoiceIds };
}

const offerOf = async (caseId: string, kind: string) => (await repo.getWhatsAppOffers(caseId)).filter((o) => o.kind === kind);
const PAST = "2026-09-01T00:00:00Z";

describe("Follow-up reminder", () => {
  it("is sent with the 8 approved variables, recorded durably with provider attribution, and moves the case to follow_up_sent (BEFORE any GST review)", async () => {
    const { id, invoiceIds } = seed("initial_communication_sent", { nextScheduledAt: PAST });
    const [offer] = await offerOf(id, "followup_reminder");
    expect(offer.status).toBe("available");
    expect(offer.eventKey).toBe(`wa:followup-reminder:${id}:${invoiceIds[0]}:1`);

    const result = await repo.sendWhatsAppMessage(id, { eventKey: offer.eventKey! }, staff);
    expect(result.status).toBe("accepted");
    expect(result.case.status).toBe("follow_up_sent");
    expect(result.case.status).not.toBe("gst_eligibility_review");

    const sent = fakeWhatsapp.send.mock.calls[0][0];
    expect(sent.templateKey).toBe("payment_reminder_followup_v2");
    expect(sent.templateParams).toEqual([
      "WhatsApp Test Customer", "WA-TEST-001", " 1,00,000", "18 September 2026", " 1,00,000",
      "Acme Industrial Supplies Pvt Ltd", "acme@okaxis", "Acme Industrial Payee",
    ]);
    expect(sent.to).toBe("9876500011");

    const comm = result.communication!;
    expect(comm.channel).toBe("whatsapp");
    expect(comm.templateKey).toBe("payment_reminder_followup_v2");
    expect(comm.idempotencyKey).toBe(offer.eventKey);
    expect(comm.deliveryStatus).toBe("sent");
    const deliveries = await repo.listDeliveriesForCommunication(comm.id);
    expect(deliveries[0]).toMatchObject({ provider: "fake-aisensy", status: "sent", adapterOutcome: "success", providerMessageId: null });
  });

  it("starts the second 24h window and audits the operator who sent it", async () => {
    const { id } = seed("initial_communication_sent", { nextScheduledAt: PAST });
    const [offer] = await offerOf(id, "followup_reminder");
    const before = Date.now();
    const result = await repo.sendWhatsAppMessage(id, { eventKey: offer.eventKey! }, staff);
    const due = new Date(result.case.nextScheduledAt!).getTime();
    expect(due).toBeGreaterThanOrEqual(before + 24 * 3_600_000 - 5_000);
    expect(due).toBeLessThanOrEqual(Date.now() + 24 * 3_600_000 + 5_000);
    const audit = (await repo.listAuditLog(5)).find((a) => a.action === "reminder.followup_sent")!;
    expect(audit).toMatchObject({ actorId: "test-staff-wa-msgs", actorRole: "staff", entityId: id });
  });

  it("is refused (with the reason) inside the response window, and nothing is sent or recorded", async () => {
    const future = new Date(Date.now() + 6 * 3_600_000).toISOString();
    const { id } = seed("initial_communication_sent", { nextScheduledAt: future });
    const [offer] = await offerOf(id, "followup_reminder");
    expect(offer.status).toBe("unavailable");
    await expect(repo.sendWhatsAppMessage(id, { eventKey: offer.eventKey! }, staff)).rejects.toThrow(/not sent: .*24-hour response window runs until/);
    expect(fakeWhatsapp.send).not.toHaveBeenCalled();
    expect(mock.COMMUNICATIONS.some((c) => c.caseId === id)).toBe(false);
  });

  it("wrong workflow state: an active case cannot be sent a follow-up", async () => {
    const { id } = seed("active");
    const [offer] = await offerOf(id, "followup_reminder");
    await expect(repo.sendWhatsAppMessage(id, { eventKey: offer.eventKey! }, staff)).rejects.toThrow(/initial reminder has not been sent yet/);
  });

  it("double click: the second identical request sends nothing and records nothing more", async () => {
    const { id } = seed("initial_communication_sent", { nextScheduledAt: PAST });
    const [offer] = await offerOf(id, "followup_reminder");
    const first = await repo.sendWhatsAppMessage(id, { eventKey: offer.eventKey! }, staff);
    const second = await repo.sendWhatsAppMessage(id, { eventKey: offer.eventKey! }, staff);
    expect(first.status).toBe("accepted");
    expect(second.status).toBe("already_sent");
    expect(fakeWhatsapp.send).toHaveBeenCalledTimes(1);
    expect(mock.COMMUNICATIONS.filter((c) => c.caseId === id && c.channel === "whatsapp")).toHaveLength(1);
  });

  it("truly concurrent double submit: the provider is called exactly once", async () => {
    const { id } = seed("initial_communication_sent", { nextScheduledAt: PAST });
    const [offer] = await offerOf(id, "followup_reminder");
    const results = await Promise.all([
      repo.sendWhatsAppMessage(id, { eventKey: offer.eventKey! }, staff),
      repo.sendWhatsAppMessage(id, { eventKey: offer.eventKey! }, staff),
    ]);
    expect(fakeWhatsapp.send).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.status === "accepted")).toHaveLength(1);
    expect(results.every((r) => ["accepted", "ambiguous", "already_sent"].includes(r.status))).toBe(true);
    expect(mock.COMMUNICATIONS.filter((c) => c.caseId === id && c.channel === "whatsapp")).toHaveLength(1);
  });

  it("provider rejection: no case advancement and honest 'rejected'; an explicit retry reuses the SAME communication (attempt 2)", async () => {
    const { id } = seed("initial_communication_sent", { nextScheduledAt: PAST });
    const [offer] = await offerOf(id, "followup_reminder");
    fakeWhatsapp.send.mockResolvedValue(REJECTED);
    const failed = await repo.sendWhatsAppMessage(id, { eventKey: offer.eventKey! }, staff);
    expect(failed.status).toBe("rejected");
    expect(failed.case.status).toBe("initial_communication_sent");
    expect(failed.communication?.deliveryStatus).toBe("failed");

    const [again] = await offerOf(id, "followup_reminder");
    expect(again.status).toBe("available");
    expect(again.history?.outcome).toBe("rejected");

    fakeWhatsapp.send.mockResolvedValue(OK());
    const retried = await repo.sendWhatsAppMessage(id, { eventKey: offer.eventKey! }, staff);
    expect(retried.status).toBe("accepted");
    expect(retried.communication?.id).toBe(failed.communication?.id);
    expect((await repo.listDeliveriesForCommunication(retried.communication!.id)).length).toBeGreaterThanOrEqual(2);
    expect(retried.case.status).toBe("follow_up_sent");
  });

  it("ambiguous prior attempt blocks a blind resend; only an explicit operator override retries", async () => {
    const { id, kase } = seed("initial_communication_sent", { nextScheduledAt: PAST });
    const [offer] = await offerOf(id, "followup_reminder");
    const begun = mock.beginCommunicationSend({
      organisationId: kase.organisationId, caseId: id, channel: "whatsapp", idempotencyKey: offer.eventKey!,
      templateKey: "payment_reminder_followup_v2", templateVersion: 2, subject: null, body: "b",
    });
    mock.beginDeliveryAttempt(kase.organisationId, begun.communication.id, 1, false); // started, never completed

    const [flagged] = await offerOf(id, "followup_reminder");
    expect(flagged.ambiguous).toBe(true);
    const blocked = await repo.sendWhatsAppMessage(id, { eventKey: offer.eventKey! }, staff);
    expect(blocked.status).toBe("ambiguous");
    expect(fakeWhatsapp.send).not.toHaveBeenCalled();
    expect(blocked.case.status).toBe("initial_communication_sent");

    const forced = await repo.sendWhatsAppMessage(id, { eventKey: offer.eventKey!, forceRetryAfterAmbiguous: true }, staff);
    expect(forced.status).toBe("accepted");
    expect(fakeWhatsapp.send).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["kill switch off", async () => repo.setAutomationState(false, "Testing the kill switch", admin), /kill switch is off/],
    ["campaign not configured", async () => vi.stubEnv(WHATSAPP_TEMPLATES.followup_reminder.campaignEnvVar, ""), /campaign for this message is not configured/],
    ["creditor UPI details missing", async () => void mock.updateOrganisationPaymentDetails("org-1", null, null), /payment details \(UPI ID and UPI payee name\) are not configured/],
  ])("%s: refused with a controlled reason, nothing sent, nothing recorded", async (_label, breakIt, reason) => {
    const { id } = seed("initial_communication_sent", { nextScheduledAt: PAST });
    const [offer] = await offerOf(id, "followup_reminder");
    expect(offer.status).toBe("available");
    await breakIt();
    await expect(repo.sendWhatsAppMessage(id, { eventKey: offer.eventKey! }, staff)).rejects.toThrow(reason);
    expect(fakeWhatsapp.send).not.toHaveBeenCalled();
    expect(mock.COMMUNICATIONS.some((c) => c.caseId === id)).toBe(false);
    expect(mock.getCase(id)!.status).toBe("initial_communication_sent");
  });

  it.each([["missing", null], ["invalid", "12345"]])("a %s debtor mobile blocks the send", async (_l, mobile) => {
    const { id } = seed("initial_communication_sent", { nextScheduledAt: PAST, mobile });
    const [offer] = await offerOf(id, "followup_reminder");
    expect(offer.status).toBe("unavailable");
    await expect(repo.sendWhatsAppMessage(id, { eventKey: offer.eventKey! }, staff)).rejects.toThrow(/mobile number/);
    expect(fakeWhatsapp.send).not.toHaveBeenCalled();
  });
});

describe("Promise-to-pay recording and the commitment reminder", () => {
  it("records a durable promise, moves the case to promise_to_pay, schedules 11:00 IST on the date and audits the actor (without the amount)", async () => {
    const { id, invoiceIds } = seed("initial_communication_sent");
    const promisedOn = istToday(5);
    const before = mock.AUDIT_LOG.length;
    const { promise, case: updated } = await repo.recordPaymentPromise(
      id, { caseId: id, invoiceId: null, promisedOn, promisedAmountPaise: 40_000_00, sourceReplyId: null }, staff,
    );
    expect(promise).toMatchObject({ caseId: id, invoiceId: invoiceIds[0], promisedOn, promisedAmount: 40_000_00, status: "active", supersedesId: null, recordedById: "test-staff-wa-msgs" });
    expect(updated.status).toBe("promise_to_pay");
    expect(updated.nextScheduledAt).toBe(`${promisedOn}T05:30:00.000Z`);
    expect(mock.AUDIT_LOG.length).toBe(before + 1);
    expect(mock.AUDIT_LOG[0]).toMatchObject({ action: "promise.recorded", actorId: "test-staff-wa-msgs", entityId: id });
    expect(JSON.stringify(mock.AUDIT_LOG[0])).not.toContain("40000");
  });

  it("sends the commitment reminder tied to THAT promise, with the 7 approved variables and the promise's amount", async () => {
    const { id, invoiceIds } = seed("initial_communication_sent");
    const promisedOn = istToday(5);
    const { promise } = await repo.recordPaymentPromise(id, { caseId: id, invoiceId: null, promisedOn, promisedAmountPaise: 40_000_00, sourceReplyId: null }, staff);
    const [offer] = await offerOf(id, "commitment_reminder");
    expect(offer).toMatchObject({ status: "available", eventKey: `wa:commitment-reminder:${promise.id}`, subject: { promiseId: promise.id, invoiceId: invoiceIds[0] } });

    const result = await repo.sendWhatsAppMessage(id, { eventKey: offer.eventKey! }, staff);
    expect(result.status).toBe("accepted");
    expect(result.case.status).toBe("promise_to_pay"); // informational message: no workflow change
    const sent = fakeWhatsapp.send.mock.calls[0][0];
    expect(sent.templateKey).toBe("payment_commitment_reminder_v2");
    expect(sent.templateParams).toEqual([
      "WhatsApp Test Customer", "WA-TEST-001",
      new Date(`${promisedOn}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }),
      " 40,000", "Acme Industrial Supplies Pvt Ltd", "acme@okaxis", "Acme Industrial Payee",
    ]);
    const deliveries = await repo.listDeliveriesForCommunication(result.communication!.id);
    expect(deliveries[0].provider).toBe("fake-aisensy");
  });

  it("changing the promised date PRESERVES history: the old promise is superseded, the new one has its own identity and can be sent even if the old one already was", async () => {
    const { id } = seed("initial_communication_sent");
    const first = (await repo.recordPaymentPromise(id, { caseId: id, invoiceId: null, promisedOn: istToday(3), promisedAmountPaise: null, sourceReplyId: null }, staff)).promise;
    const [firstOffer] = await offerOf(id, "commitment_reminder");
    await repo.sendWhatsAppMessage(id, { eventKey: firstOffer.eventKey! }, staff);

    const second = (await repo.recordPaymentPromise(id, { caseId: id, invoiceId: null, promisedOn: istToday(8), promisedAmountPaise: null, sourceReplyId: null }, staff)).promise;
    const all = await repo.listPromisesForCase(id);
    expect(all).toHaveLength(2);
    expect(all.find((p) => p.id === first.id)).toMatchObject({ status: "superseded", promisedOn: istToday(3) });
    expect(all.find((p) => p.id === second.id)).toMatchObject({ status: "active", supersedesId: first.id, promisedOn: istToday(8) });

    const offers = await offerOf(id, "commitment_reminder");
    expect(offers).toHaveLength(1);
    expect(offers[0].eventKey).toBe(`wa:commitment-reminder:${second.id}`);
    expect(offers[0].status).toBe("available");
    await repo.sendWhatsAppMessage(id, { eventKey: offers[0].eventKey! }, staff);
    expect(fakeWhatsapp.send).toHaveBeenCalledTimes(2); // one per promise, never a duplicate for the same one
  });

  it("double click on a promise's reminder sends once", async () => {
    const { id } = seed("initial_communication_sent");
    await repo.recordPaymentPromise(id, { caseId: id, invoiceId: null, promisedOn: istToday(2), promisedAmountPaise: null, sourceReplyId: null }, staff);
    const [offer] = await offerOf(id, "commitment_reminder");
    await repo.sendWhatsAppMessage(id, { eventKey: offer.eventKey! }, staff);
    expect((await repo.sendWhatsAppMessage(id, { eventKey: offer.eventKey! }, staff)).status).toBe("already_sent");
    expect(fakeWhatsapp.send).toHaveBeenCalledTimes(1);
  });

  it("no commitment message without a genuine promise: a debtor reply classified as a promise (no date) offers nothing", async () => {
    const { id } = seed("initial_communication_sent");
    await repo.recordDebtorReply(id, { channel: "whatsapp", rawBody: "I will pay soon", classification: "promise_to_pay" }, staff);
    expect(mock.getCase(id)!.status).toBe("promise_to_pay");
    const [offer] = await offerOf(id, "commitment_reminder");
    expect(offer).toMatchObject({ status: "unavailable", eventKey: null });
    expect(offer.reason).toMatch(/No promise to pay has been recorded/);
  });

  it("a promise on a multi-invoice case must name its invoice, and the reminder uses THAT invoice (never the first)", async () => {
    const { id, invoiceIds } = seed("initial_communication_sent", {
      invoices: [{ number: "A-1", total: 50_000_00, outstanding: 50_000_00 }, { number: "B-2", total: 80_000_00, outstanding: 60_000_00 }],
    });
    await expect(
      repo.recordPaymentPromise(id, { caseId: id, invoiceId: null, promisedOn: istToday(4), promisedAmountPaise: null, sourceReplyId: null }, staff),
    ).rejects.toThrow(/Choose the invoice this promise relates to/);
    await repo.recordPaymentPromise(id, { caseId: id, invoiceId: invoiceIds[1], promisedOn: istToday(4), promisedAmountPaise: null, sourceReplyId: null }, staff);
    const [offer] = await offerOf(id, "commitment_reminder");
    await repo.sendWhatsAppMessage(id, { eventKey: offer.eventKey! }, staff);
    const sent = fakeWhatsapp.send.mock.calls[0][0];
    expect(sent.templateParams[1]).toBe("B-2");
    expect(sent.templateParams[3]).toBe(" 60,000"); // that invoice's outstanding, no amount promised
  });

  it("validation: past date, unknown invoice, amount above the outstanding, and a case that is not awaiting a response are all refused", async () => {
    const { id } = seed("initial_communication_sent", { invoices: [{ number: "A-1", total: 50_000_00, outstanding: 50_000_00 }] });
    const promise = (over: object) => repo.recordPaymentPromise(id, { caseId: id, invoiceId: null, promisedOn: istToday(3), promisedAmountPaise: null, sourceReplyId: null, ...over }, staff);
    await expect(promise({ promisedOn: istToday(-1) })).rejects.toThrow(/in the past/);
    await expect(promise({ invoiceId: "inv-not-here" })).rejects.toThrow(/does not belong to this case/);
    await expect(promise({ promisedAmountPaise: 90_000_00 })).rejects.toThrow(/exceeds the invoice's outstanding balance/);
    const active = seed("active");
    await expect(
      repo.recordPaymentPromise(active.id, { caseId: active.id, invoiceId: null, promisedOn: istToday(3), promisedAmountPaise: null, sourceReplyId: null }, staff),
    ).rejects.toThrow(/only be recorded while awaiting the debtor's response/);
    expect(mock.listPromisesForCase(active.id)).toHaveLength(0);
  });

  it("the commitment reminder is unavailable once the promised date has passed", async () => {
    const { id, kase } = seed("promise_to_pay");
    mock.insertPromiseSupersedingActive({
      id: "promise-old", organisationId: kase.organisationId, caseId: id, invoiceId: `inv-${id}-1`, promisedOn: istToday(-1),
      promisedAmount: null, sourceReplyId: null, recordedById: "u1",
    });
    const [offer] = await offerOf(id, "commitment_reminder");
    expect(offer.status).toBe("unavailable");
    expect(offer.reason).toMatch(/has passed/);
  });
});

describe("Payment received vs payment closed", () => {
  const pay = (id: string, amount: number, confirmed = true) =>
    repo.recordPayment({ caseId: id, kind: "bank", amount, reference: null, clientConfirmed: confirmed }, staff);

  it("PARTIAL payment (₹25,000 of ₹1,00,000): Payment Received is offered with the remaining balance; Payment Closed is NOT", async () => {
    const { id, invoiceIds } = seed("initial_communication_sent");
    const { payment } = await pay(id, 25_000_00);

    const received = await offerOf(id, "payment_received");
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ status: "available", eventKey: `wa:payment-received:${payment.id}:${invoiceIds[0]}` });
    const [closed] = await offerOf(id, "payment_closed");
    expect(closed).toMatchObject({ status: "unavailable", eventKey: null });

    const result = await repo.sendWhatsAppMessage(id, { eventKey: received[0].eventKey! }, staff);
    expect(result.status).toBe("accepted");
    const sent = fakeWhatsapp.send.mock.calls[0][0];
    expect(sent.templateKey).toBe("payment_received_confirmation_v2");
    expect(sent.templateParams).toEqual([
      "WhatsApp Test Customer", "Acme Industrial Supplies Pvt Ltd", "WA-TEST-001", " 25,000",
      new Date(`${payment.receivedOn}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }),
      " 75,000",
    ]);
    // Informational only: it must not touch the workflow.
    expect(result.case.status).toBe(mock.getCase(id)!.status);
    const deliveries = await repo.listDeliveriesForCommunication(result.communication!.id);
    expect(deliveries[0].provider).toBe("fake-aisensy");
  });

  it("a payment message needs no UPI details", async () => {
    const { id } = seed("initial_communication_sent");
    await pay(id, 25_000_00);
    mock.updateOrganisationPaymentDetails("org-1", null, null);
    const [offer] = await offerOf(id, "payment_received");
    expect(offer.status).toBe("available");
  });

  it("double click on Payment Received sends once", async () => {
    const { id } = seed("initial_communication_sent");
    await pay(id, 25_000_00);
    const [offer] = await offerOf(id, "payment_received");
    await repo.sendWhatsAppMessage(id, { eventKey: offer.eventKey! }, staff);
    expect((await repo.sendWhatsAppMessage(id, { eventKey: offer.eventKey! }, staff)).status).toBe("already_sent");
    expect(fakeWhatsapp.send).toHaveBeenCalledTimes(1);
  });

  it("each partial payment is its own event with its own balance", async () => {
    const { id } = seed("initial_communication_sent");
    await pay(id, 25_000_00);
    await pay(id, 15_000_00);
    const offers = await offerOf(id, "payment_received");
    expect(offers).toHaveLength(2);
    expect(new Set(offers.map((o) => o.eventKey)).size).toBe(2);
    for (const o of offers) await repo.sendWhatsAppMessage(id, { eventKey: o.eventKey! }, staff);
    const balances = fakeWhatsapp.send.mock.calls.map((c) => [c[0].templateParams[3], c[0].templateParams[5]]).sort();
    expect(balances).toEqual([[" 15,000", " 60,000"], [" 25,000", " 75,000"]]);
  });

  it("an UNCONFIRMED payment record and a debtor's 'I have paid' reply never enable Payment Received", async () => {
    const { id } = seed("initial_communication_sent");
    await pay(id, 25_000_00, false);
    await repo.recordDebtorReply(id, { channel: "whatsapp", rawBody: "I have paid", classification: "payment_made" }, staff);
    const [offer] = await offerOf(id, "payment_received");
    expect(offer).toMatchObject({ status: "unavailable", eventKey: null });
    expect(offer.reason).toMatch(/No confirmed payment/);
  });

  it("FINAL payment (zero outstanding, recovered): Payment Closed is offered, Payment Received for that payment is suppressed -- never both", async () => {
    const { id, invoiceIds } = seed("initial_communication_sent");
    const first = (await pay(id, 25_000_00)).payment;
    const second = (await pay(id, 75_000_00)).payment;
    expect(mock.getCase(id)).toMatchObject({ status: "recovered", principalOutstanding: 0 });

    const [closed] = await offerOf(id, "payment_closed");
    expect(closed).toMatchObject({ status: "available", eventKey: `wa:payment-closed:${id}:${invoiceIds[0]}:${second.id}` });
    const received = await offerOf(id, "payment_received");
    expect(received.find((o) => o.subject.paymentId === second.id)).toMatchObject({ status: "unavailable" });
    expect(received.find((o) => o.subject.paymentId === second.id)!.reason).toMatch(/Payment Closed confirmation instead/);
    expect(received.find((o) => o.subject.paymentId === first.id)!.status).toBe("available");

    const result = await repo.sendWhatsAppMessage(id, { eventKey: closed.eventKey! }, staff);
    expect(result.status).toBe("accepted");
    const sent = fakeWhatsapp.send.mock.calls[0][0];
    expect(sent.templateKey).toBe("payment_closed_confirmation_v2");
    expect(sent.templateParams.slice(2, 4)).toEqual(["WA-TEST-001", " 1,00,000"]);
    expect(sent.templateParams).toHaveLength(5);
    // The suppressed acknowledgement can never be sent for the settling payment.
    const settlingReceived = received.find((o) => o.subject.paymentId === second.id)!;
    await expect(repo.sendWhatsAppMessage(id, { eventKey: settlingReceived.eventKey! }, staff)).rejects.toThrow(/Payment Closed confirmation instead/);
    expect(fakeWhatsapp.send).toHaveBeenCalledTimes(1);
  });

  it("double click on Payment Closed sends once", async () => {
    const { id } = seed("initial_communication_sent");
    await pay(id, 100_000_00);
    const [closed] = await offerOf(id, "payment_closed");
    await repo.sendWhatsAppMessage(id, { eventKey: closed.eventKey! }, staff);
    expect((await repo.sendWhatsAppMessage(id, { eventKey: closed.eventKey! }, staff)).status).toBe("already_sent");
    expect(fakeWhatsapp.send).toHaveBeenCalledTimes(1);
  });

  it("a recovered case whose authoritative outstanding is still > 0 does NOT enable Payment Closed", async () => {
    const { id } = seed("recovered", { invoices: [{ number: "A-1", total: 50_000_00, outstanding: 20_000_00 }] });
    mock.mutateCase(id, { principalOutstanding: 20_000_00 });
    const [closed] = await offerOf(id, "payment_closed");
    expect(closed.status).toBe("unavailable");
    expect(closed.reason).toMatch(/outstanding balance of ₹20,000 remains/);
  });

  it("multi-invoice: Payment Closed never guesses an invoice; the payment is acknowledged per invoice", async () => {
    const { id, invoiceIds } = seed("initial_communication_sent", {
      invoices: [{ number: "A-1", total: 40_000_00, outstanding: 40_000_00 }, { number: "B-2", total: 60_000_00, outstanding: 60_000_00 }],
    });
    const { payment } = await pay(id, 100_000_00);
    expect(mock.getCase(id)!.status).toBe("recovered");
    const [closed] = await offerOf(id, "payment_closed");
    expect(closed.status).toBe("unavailable");
    expect(closed.reason).toMatch(/several invoices/);
    const received = await offerOf(id, "payment_received");
    expect(received.map((o) => o.eventKey).sort()).toEqual([`wa:payment-received:${payment.id}:${invoiceIds[0]}`, `wa:payment-received:${payment.id}:${invoiceIds[1]}`]);
    await repo.sendWhatsAppMessage(id, { eventKey: received.find((o) => o.invoiceNumber === "B-2")!.eventKey! }, staff);
    expect(fakeWhatsapp.send.mock.calls[0][0].templateParams.slice(2, 4)).toEqual(["B-2", " 60,000"]);
  });
});

describe("Initial reminder: invoice and event rules", () => {
  it("multi-invoice: WhatsApp needs an explicit invoice (email is unaffected); with a choice the key is per invoice", async () => {
    const { id, invoiceIds } = seed("active", {
      email: "debtor@example.com",
      invoices: [{ number: "A-1", total: 50_000_00, outstanding: 50_000_00 }, { number: "B-2", total: 80_000_00, outstanding: 80_000_00 }],
    });
    const skipped = await repo.sendInitialReminder(id, staff);
    expect(fakeWhatsapp.send).not.toHaveBeenCalled();
    expect(skipped.warnings[0]).toMatch(/2 invoices -- choose the invoice/);
    expect(skipped.communications.map((c) => c.channel)).toEqual(["email"]); // Gmail leg unchanged

    const { id: id2, invoiceIds: ids2 } = seed("active", {
      email: "debtor@example.com",
      invoices: [{ number: "A-1", total: 50_000_00, outstanding: 50_000_00 }, { number: "B-2", total: 80_000_00, outstanding: 80_000_00 }],
    });
    const sent = await repo.sendInitialReminder(id2, staff, { invoiceId: ids2[1] });
    expect(sent.communications.find((c) => c.channel === "whatsapp")!.idempotencyKey).toBe(`wa:initial-reminder:${id2}:${ids2[1]}`);
    expect(fakeWhatsapp.send.mock.calls[0][0].templateParams[1]).toBe("B-2");
    expect(invoiceIds).toHaveLength(2);
  });

  it("Gmail regression: the email leg is byte-for-byte the same shape and never receives template parameters", async () => {
    const { id } = seed("active", { email: "debtor@example.com" });
    const result = await repo.sendInitialReminder(id, staff);
    expect(fakeEmail.send).toHaveBeenCalledTimes(1);
    const sent = fakeEmail.send.mock.calls[0][0];
    expect(sent.templateKey).toBe("reminder_initial_email_v1");
    expect(sent.templateParams).toBeUndefined();
    expect(sent.subject).toContain("Payment reminder");
    const email = result.communications.find((c) => c.channel === "email")!;
    expect(email.idempotencyKey).toBe(`reminder-initial:email:${id}:${new Date().toISOString().slice(0, 10)}`);
    expect((await repo.listDeliveriesForCommunication(email.id))[0].provider).toBe("fake-gmail");
  });

  it("the four new message types never touch the email adapter", async () => {
    const { id } = seed("initial_communication_sent", { nextScheduledAt: PAST, email: "debtor@example.com" });
    const [offer] = await offerOf(id, "followup_reminder");
    await repo.sendWhatsAppMessage(id, { eventKey: offer.eventKey! }, staff);
    expect(fakeEmail.send).not.toHaveBeenCalled();
  });
});

describe("server-side enforcement", () => {
  it("an unknown or forged event key sends nothing", async () => {
    const { id } = seed("initial_communication_sent", { nextScheduledAt: PAST });
    await expect(repo.sendWhatsAppMessage(id, { eventKey: "wa:followup-reminder:other-case:other-invoice:1" }, staff)).rejects.toThrow(/not available for this case/);
    await expect(repo.sendWhatsAppMessage(id, { eventKey: "" }, staff)).rejects.toThrow(/not available for this case/);
    expect(fakeWhatsapp.send).not.toHaveBeenCalled();
  });

  it("an event key belonging to ANOTHER case cannot be used to send on this one", async () => {
    const a = seed("initial_communication_sent", { nextScheduledAt: PAST });
    const b = seed("initial_communication_sent", { nextScheduledAt: PAST });
    const [offerA] = await offerOf(a.id, "followup_reminder");
    await expect(repo.sendWhatsAppMessage(b.id, { eventKey: offerA.eventKey! }, staff)).rejects.toThrow(/not available for this case/);
    expect(fakeWhatsapp.send).not.toHaveBeenCalled();
  });

  it("a default (demo) MemoryRepository can never send the new messages, even with the live provider configured", async () => {
    const demo = new MemoryRepository();
    const { id } = seed("initial_communication_sent", { nextScheduledAt: PAST });
    const [offer] = await demo.getWhatsAppOffers(id).then((o) => o.filter((x) => x.kind === "followup_reminder"));
    expect(offer.status).toBe("unavailable");
    expect(offer.reason).toMatch(/not enabled in this environment/);
    await expect(demo.sendWhatsAppMessage(id, { eventKey: offer.eventKey! }, staff)).rejects.toThrow(/not enabled/);
    expect(fakeWhatsapp.send).not.toHaveBeenCalled();
  });
});
