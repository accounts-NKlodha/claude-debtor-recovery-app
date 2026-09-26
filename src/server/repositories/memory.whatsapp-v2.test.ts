/**
 * V2 AiSensy WhatsApp reminder through the real repository communication
 * path (MemoryRepository -- same Repository interface, same shared planner
 * and same begin/attempt/complete sequence SupabaseRepository runs against
 * the RPCs). Adapters are faked so nothing is ever sent: this proves durable
 * records, provider attribution, idempotency, ambiguity handling, workflow
 * advancement, kill switch, missing-payment-details behavior, audit
 * attribution and Gmail regression without a live provider.
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
const staff: MutationActor = { actorId: "test-staff-wa-v2", actorRole: "staff" };
const admin: MutationActor = { actorId: "test-admin-wa-v2", actorRole: "admin" };

const OK = (ref: string | null) => ({
  outcome: "success" as const,
  providerRef: ref,
  errorCode: null,
  evidenceRefs: [],
  nextAction: null,
  data: { providerMessageId: ref ?? "" },
});

afterEach(() => vi.unstubAllEnvs());

beforeEach(async () => {
  for (const k of WHATSAPP_MESSAGE_KINDS) vi.stubEnv(WHATSAPP_TEMPLATES[k].campaignEnvVar, `Test Campaign ${k}`);
  fakeEmail.send.mockReset();
  fakeWhatsapp.send.mockReset();
  fakeEmail.send.mockResolvedValue(OK("<email-ref@mail>"));
  fakeWhatsapp.send.mockResolvedValue(OK(null));
  await repo.setAutomationState(true, "test reset", admin);
  mock.updateOrganisationPaymentDetails("org-1", "acme@okaxis", "Acme Industrial Payee");
});

// NODE_ENV is "test" here, so the planner takes the live branch purely
// because isLiveWhatsAppConfigured() is mocked true -- environment-independent.
function seedActiveCase(id: string, over: { mobile?: string | null; email?: string | null } = {}): RecoveryCase {
  const base = mock.getCase("case-1")!;
  const debtor = mock.getDebtor(base.debtorId)!;
  const debtorId = `deb-${id}`;
  mock.insertDebtor({
    ...debtor,
    id: debtorId,
    name: "WhatsApp Test Customer",
    mobile: over.mobile !== undefined ? over.mobile : "9876500011",
    email: over.email !== undefined ? over.email : "debtor@example.com",
  });
  const kase: RecoveryCase = { ...base, id, debtorId, status: "active", closedAt: null };
  mock.insertCase(kase);
  const baseInvoice = mock.listInvoicesForCase("case-1")[0];
  mock.insertInvoice({
    ...baseInvoice, id: `inv-${id}`, caseId: id, invoiceNumber: "WA-TEST-001", invoiceTotal: 1_000_00,
    outstandingBalance: 1_000_00, dueDate: "2026-09-18",
  });
  return kase;
}

describe("V2 WhatsApp reminder: durable send through the real communication path", () => {
  it("sends the confirmed 8-value V2 parameter set, records the communication + delivery with the real provider name, advances the case, audits the actor", async () => {
    const kase = seedActiveCase("case-wa-v2-happy");
    const result = await repo.sendInitialReminder(kase.id, staff);

    expect(fakeWhatsapp.send).toHaveBeenCalledTimes(1);
    const sent = fakeWhatsapp.send.mock.calls[0][0];
    expect(sent.templateKey).toBe("payment_reminder_initial_v2");
    expect(sent.templateParams).toHaveLength(8);
    expect(sent.templateParams[0]).toBe("WhatsApp Test Customer"); // {{1}} debtor
    expect(sent.templateParams[1]).toBe("WA-TEST-001"); // {{2}} the specific invoice's number
    expect(sent.templateParams[2]).toBe(" 1,000"); // {{3}} that invoice's amount
    expect(sent.templateParams[5]).toBe("Acme Industrial Supplies Pvt Ltd"); // {{6}} creditor org name
    expect(sent.templateParams[6]).toBe("acme@okaxis"); // {{7}} UPI ID
    expect(sent.templateParams[7]).toBe("Acme Industrial Payee"); // {{8}} payee
    expect(sent.templateParams.join("|")).not.toContain("₹");
    expect(sent.to).toBe("9876500011");

    const wa = result.communications.find((c) => c.channel === "whatsapp")!;
    expect(wa.templateKey).toBe("payment_reminder_initial_v2");
    expect(wa.templateVersion).toBe(2);
    expect(wa.body).toContain("Pay via UPI: acme@okaxis");
    expect(wa.deliveryStatus).toBe("sent"); // accepted by provider -- never claims delivered/read
    expect(wa.idempotencyKey).toBe(`wa:initial-reminder:${kase.id}:inv-${kase.id}`); // business event: case + invoice + initial reminder

    const deliveries = await repo.listDeliveriesForCommunication(wa.id);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].provider).toBe("fake-aisensy"); // adapter.name, not a hardcoded provider
    expect(deliveries[0].status).toBe("sent");
    expect(deliveries[0].adapterOutcome).toBe("success");
    expect(deliveries[0].providerMessageId).toBeNull(); // Campaign API supplies none; never fabricated

    expect(result.case.status).toBe("initial_communication_sent");
    expect(result.warnings).toEqual([]);
    const audit = await repo.listAuditLog(3);
    expect(audit[0]).toMatchObject({ action: "reminder.sent", actorId: "test-staff-wa-v2", actorRole: "staff" });
    expect(audit.map((a) => JSON.stringify(a)).join()).not.toContain("acme@okaxis");
  });

  it("Gmail regression: the email leg is unchanged -- same subject, no template params, provider recorded as its own adapter", async () => {
    const kase = seedActiveCase("case-wa-v2-gmail");
    const result = await repo.sendInitialReminder(kase.id, staff);

    expect(fakeEmail.send).toHaveBeenCalledTimes(1);
    const sent = fakeEmail.send.mock.calls[0][0];
    expect(sent.templateKey).toBe("reminder_initial_email_v1");
    expect(sent.templateParams).toBeUndefined();
    expect(sent.subject).toContain("Payment reminder");
    // plain-text fallback + HTML alternative, same core data (redesigned debtor email)
    expect(sent.body).toContain("on behalf of");
    expect(sent.body).toContain("Invoice number: WA-TEST-001");
    expect(sent.body).toContain("UPI ID: acme@okaxis");
    expect(sent.html).toContain("<!DOCTYPE html>");
    expect(sent.html).toContain("WA-TEST-001");
    expect(sent.html).toContain("acme@okaxis");
    expect(sent.html).not.toMatch(/<script/i);
    // the durable record stores the plain-text body
    expect(result.communications.find((c) => c.channel === "email")!.body).toBe(sent.body);

    const email = result.communications.find((c) => c.channel === "email")!;
    expect(email.subject).toContain("Payment reminder");
    const deliveries = await repo.listDeliveriesForCommunication(email.id);
    expect(deliveries[0].provider).toBe("fake-gmail");
  });

  it("no duplicate: a second reminder is refused by the case-status guard and neither adapter is called again", async () => {
    const kase = seedActiveCase("case-wa-v2-dup");
    await repo.sendInitialReminder(kase.id, staff);
    await expect(repo.sendInitialReminder(kase.id, staff)).rejects.toThrow(/already been sent its initial reminder/);

    expect(fakeWhatsapp.send).toHaveBeenCalledTimes(1);
    expect(fakeEmail.send).toHaveBeenCalledTimes(1);
    const comms = await repo.listCommunicationsForCase(kase.id);
    expect(comms.filter((c) => c.channel === "whatsapp")).toHaveLength(1);
  });

  it("idempotency is decided by the durable invoice history, not the case status: even if the case reads 'active' again the provider is never re-called", async () => {
    const kase = seedActiveCase("case-wa-v2-idem", { email: null });
    await repo.sendInitialReminder(kase.id, staff);
    expect(fakeWhatsapp.send).toHaveBeenCalledTimes(1);

    mock.mutateCase(kase.id, { status: "active" }); // simulate a concurrent second request that read 'active'
    await expect(repo.sendInitialReminder(kase.id, staff)).rejects.toThrow(/already been sent its initial reminder/);
    expect(fakeWhatsapp.send).toHaveBeenCalledTimes(1);
    expect(mock.COMMUNICATIONS.filter((c) => c.caseId === kase.id && c.channel === "whatsapp")).toHaveLength(1);
  });

  it("ambiguous prior attempt blocks a blind automatic resend; only an explicit operator override retries", async () => {
    const kase = seedActiveCase("case-wa-v2-ambiguous", { email: null });
    const key = `wa:initial-reminder:${kase.id}:inv-${kase.id}`;
    const begun = mock.beginCommunicationSend({
      organisationId: kase.organisationId, caseId: kase.id, channel: "whatsapp", idempotencyKey: key,
      templateKey: "payment_reminder_initial_v2", templateVersion: 2, subject: null, body: "b",
    });
    // An attempt that started but never completed = provider outcome unknown.
    mock.beginDeliveryAttempt(kase.organisationId, begun.communication.id, 1, false);

    const blocked = await repo.sendInitialReminder(kase.id, staff);
    expect(blocked.ambiguous).toBe(true);
    expect(fakeWhatsapp.send).not.toHaveBeenCalled();
    expect(blocked.case.status).toBe("active"); // ambiguous never advances the workflow

    const forced = await repo.sendInitialReminder(kase.id, staff, { forceRetryAfterAmbiguous: true });
    expect(fakeWhatsapp.send).toHaveBeenCalledTimes(1);
    expect(forced.case.status).toBe("initial_communication_sent");
  });

  it("provider rejection on WhatsApp alone does not advance the case and never reports the message as sent", async () => {
    fakeWhatsapp.send.mockResolvedValue({
      outcome: "permanent_failure", providerRef: null, errorCode: "AISENSY_REQUEST_REJECTED_400", evidenceRefs: [], nextAction: "x",
    });
    const kase = seedActiveCase("case-wa-v2-rejected", { email: null });
    const result = await repo.sendInitialReminder(kase.id, staff);

    const wa = result.communications[0];
    expect(wa.deliveryStatus).toBe("failed");
    expect(result.case.status).not.toBe("initial_communication_sent");
    const deliveries = await repo.listDeliveriesForCommunication(wa.id);
    expect(deliveries[0]).toMatchObject({ status: "failed", provider: "fake-aisensy", errorDetail: "AISENSY_REQUEST_REJECTED_400" });
  });

  it("a WhatsApp failure does not block the working email channel, and the case advances via email", async () => {
    fakeWhatsapp.send.mockResolvedValue({
      outcome: "permanent_failure", providerRef: null, errorCode: "AISENSY_AUTH_FAILED", evidenceRefs: [], nextAction: "x",
    });
    const kase = seedActiveCase("case-wa-v2-mixed");
    const result = await repo.sendInitialReminder(kase.id, staff);
    expect(result.communications.find((c) => c.channel === "whatsapp")!.deliveryStatus).toBe("failed");
    expect(result.communications.find((c) => c.channel === "email")!.deliveryStatus).toBe("sent");
    expect(result.case.status).toBe("initial_communication_sent");
  });
});

describe("V2 WhatsApp reminder: creditor payment details and kill switch", () => {
  it.each([
    ["no UPI ID / payee", null, null],
  ])("missing payment details (%s): WhatsApp is not sent and no WhatsApp communication is created, email still goes, operator is warned", async (_l, upi, payee) => {
    mock.updateOrganisationPaymentDetails("org-1", upi, payee);
    const kase = seedActiveCase("case-wa-v2-nodetails");
    const result = await repo.sendInitialReminder(kase.id, staff);

    expect(fakeWhatsapp.send).not.toHaveBeenCalled();
    expect(result.communications.map((c) => c.channel)).toEqual(["email"]);
    expect(mock.COMMUNICATIONS.some((c) => c.caseId === kase.id && c.channel === "whatsapp")).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/payment details/i);
    expect(result.warnings[0]).toMatch(/not configured/i);
    expect(result.warnings[0]).not.toMatch(/acme@okaxis|default|placeholder/i); // no synthetic fallback
  });

  it("missing payment details with no other channel: controlled operator error, nothing sent or recorded, case stays active", async () => {
    mock.updateOrganisationPaymentDetails("org-1", null, null);
    const kase = seedActiveCase("case-wa-v2-nodetails-only", { email: null });
    await expect(repo.sendInitialReminder(kase.id, staff)).rejects.toThrow(/payment details .*not configured/i);
    expect(fakeWhatsapp.send).not.toHaveBeenCalled();
    expect(fakeEmail.send).not.toHaveBeenCalled();
    expect(await repo.listCommunicationsForCase(kase.id)).toHaveLength(0);
    expect(mock.getCase(kase.id)!.status).toBe("active");
  });

  it("kill switch engaged (automation.enabled = false): NEITHER channel is sent -- no partial send", async () => {
    await repo.setAutomationState(false, "Testing the kill switch", admin);
    const kase = seedActiveCase("case-wa-v2-killswitch");
    await expect(repo.sendInitialReminder(kase.id, staff)).rejects.toThrow(/kill switch/i);

    expect(fakeWhatsapp.send).not.toHaveBeenCalled();
    expect(await repo.listCommunicationsForCase(kase.id)).toHaveLength(0);
    expect(mock.getCase(kase.id)!.status).toBe("active");
  });

  it("kill switch off with no other channel: controlled error, nothing recorded", async () => {
    await repo.setAutomationState(false, "Testing the kill switch", admin);
    const kase = seedActiveCase("case-wa-v2-killswitch-only", { email: null });
    await expect(repo.sendInitialReminder(kase.id, staff)).rejects.toThrow(/kill switch/i);
    expect(fakeWhatsapp.send).not.toHaveBeenCalled();
    expect(await repo.listCommunicationsForCase(kase.id)).toHaveLength(0);
  });

  it("an unnormalizable debtor mobile skips WhatsApp (never a guessed destination)", async () => {
    const kase = seedActiveCase("case-wa-v2-badmobile", { mobile: "12345" });
    const result = await repo.sendInitialReminder(kase.id, staff);
    expect(fakeWhatsapp.send).not.toHaveBeenCalled();
    expect(result.warnings[0]).toMatch(/mobile number/i);
  });
});

describe("demo-data safety", () => {
  it("a default MemoryRepository never takes the live WhatsApp path, even when the live adapter is configured -- demo debtors are never messaged for real", async () => {
    const demoRepo = new MemoryRepository();
    const kase = seedActiveCase("case-wa-v2-demo-safety", { email: null });
    await demoRepo.sendInitialReminder(kase.id, staff);

    expect(fakeWhatsapp.send).toHaveBeenCalledTimes(1);
    const sent = fakeWhatsapp.send.mock.calls[0][0];
    expect(sent.templateKey).toBe("reminder_initial_v3"); // legacy demo template, never the approved V2 key
    expect(sent.templateParams).toBeUndefined();
  });
});

describe("organisation payment-details update (repository)", () => {
  it("is full-replace, audited with the real actor, and never records the UPI values in the audit entry", async () => {
    const before = mock.AUDIT_LOG.length;
    const org = await repo.updateOrganisationPaymentDetails(
      "org-2",
      { upiId: "vertex@ybl", upiPayeeName: "Vertex Polymers", reason: "Confirmed with client" },
      admin,
    );
    expect(org).toMatchObject({ upiId: "vertex@ybl", upiPayeeName: "Vertex Polymers" });
    expect(mock.AUDIT_LOG.length).toBe(before + 1);
    expect(mock.AUDIT_LOG[0]).toMatchObject({ action: "organisation.payment_details_updated", actorId: "test-admin-wa-v2", entityId: "org-2" });
    expect(JSON.stringify(mock.AUDIT_LOG[0])).not.toContain("vertex@ybl");

    const cleared = await repo.updateOrganisationPaymentDetails("org-2", { upiId: null, upiPayeeName: null, reason: "Client changed bank" }, admin);
    expect(cleared.upiId).toBeNull();
    expect(cleared.upiPayeeName).toBeNull();
  });

  it("rejects an unknown organisation", async () => {
    await expect(
      repo.updateOrganisationPaymentDetails("org-nope", { upiId: null, upiPayeeName: null, reason: "x y z" }, admin),
    ).rejects.toThrow(/not found/i);
  });
});
