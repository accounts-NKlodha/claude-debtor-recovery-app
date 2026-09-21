/**
 * SupabaseRepository: the new WhatsApp message families and promise
 * recording through the real RPC sequence (fake client, faked adapters --
 * nothing is sent or written anywhere). Proves the durable-send RPCs get the
 * business-event key, the template, the authenticated actor and the real
 * provider name, that the follow-up advances the case through the audited
 * apply_case_mutation RPC, and that promises go through record_payment_promise.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MutationActor } from "@/lib/auth/types";
import { WHATSAPP_MESSAGE_KINDS, WHATSAPP_TEMPLATES } from "@/domain/whatsapp-templates";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const fakeWhatsapp = { name: "fake-aisensy", send: vi.fn() };
const fakeEmail = { name: "fake-gmail", send: vi.fn() };
vi.mock("@/adapters", () => ({
  getAdapters: () => ({ email: fakeEmail, whatsapp: fakeWhatsapp }),
  isLiveWhatsAppConfigured: () => true,
}));

const STAFF: MutationActor = { actorId: "staff-actor-1", actorRole: "staff" };

const ORG = { id: "org-1", client_code: "ORG1", legal_entity_name: "Acme Textiles", creditor_gstin: null, udyam_number: null, jito_member: false, is_firm: false, upi_id: "acme@okaxis", upi_payee_name: "Acme Payee", created_at: "2026-01-01T00:00:00Z" };
const DEBTOR = { id: "debtor-1", organisation_id: "org-1", name: "Debtor Co", mobile: "9876500000", email: null, gstin: null, address: null, contact_verified: false, total_due: 100000, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
const INVOICE = { id: "inv-1", organisation_id: "org-1", case_id: "case-1", debtor_id: "debtor-1", invoice_number: "INV-1024", invoice_date: "2026-08-01", due_date: "2026-09-18", taxable_value: 100000, tax_rate: 0, tax_amount: 0, invoice_total: 100000, outstanding_balance: 100000, currency: "INR", source_document_id: null, extraction_confidence: null, created_at: "2026-01-01T00:00:00Z" };
const caseRow = (over: Record<string, unknown> = {}) => ({
  id: "case-1", organisation_id: "org-1", debtor_id: "debtor-1", status: "initial_communication_sent", automation_mode: "assist", waiting_on: "system",
  automation_started_at: null, current_step: "", blocker: null, next_scheduled_action: null, next_scheduled_at: "2026-09-01T00:00:00Z",
  eligibility_route: "ordinary", principal_outstanding: 100000, recovered_to_date: 0, assignee_id: null, group_key: null,
  created_at: "2026-01-01T00:00:00Z", activated_at: "2026-01-01T00:00:00Z", closed_at: null, ...over,
});
const commRow = (status: string) => ({
  id: "comm-1", case_id: "case-1", organisation_id: "org-1", channel: "whatsapp", direction: "outbound", template_key: "payment_reminder_followup_v2", template_version: 2,
  subject: null, body: "body", provider_message_id: null, thread_ref: null, delivery_status: status, has_secure_link: false,
  idempotency_key: "wa:followup-reminder:case-1:inv-1:1", reply_classification: null, reviewed_by_id: null, created_at: "2026-09-19T05:00:00Z", delivered_at: null,
});
const deliveryRow = (status: string) => ({ id: "del-1", organisation_id: "org-1", communication_id: "comm-1", attempt: 1, status, adapter_outcome: null, provider: null, provider_message_id: null, error_detail: null, occurred_at: "2026-09-19T05:00:00Z" });

function fakeClient(opts: { tables?: Record<string, unknown>; rpc?: Record<string, unknown>; automationEnabled?: boolean } = {}) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const tables: Record<string, unknown> = {
    organisations: ORG, debtors: DEBTOR, recovery_cases: caseRow(), invoices: [INVOICE], payment_records: [], payment_allocations: [],
    payment_promises: [], communications: [], communication_deliveries: [],
    system_settings: { value_json: { enabled: opts.automationEnabled ?? true } }, ...opts.tables,
  };
  const client = {
    rpc: vi.fn((fn: string, args: unknown) => {
      rpcCalls.push({ fn, args: args as Record<string, unknown> });
      return Promise.resolve({ data: opts.rpc?.[fn] ?? null, error: null });
    }),
    from: vi.fn((table: string) => {
      const data = tables[table] ?? null;
      const b: Record<string, unknown> = {
        select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b,
        maybeSingle: () => Promise.resolve({ data, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
      };
      return b;
    }),
  };
  return { client, rpcCalls };
}

async function repoWith(fake: ReturnType<typeof fakeClient>) {
  const { createClient } = await import("@/lib/supabase/server");
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fake.client);
  const { SupabaseRepository } = await import("./supabase");
  return new SupabaseRepository();
}

const OK = { outcome: "success", providerRef: null, errorCode: null, evidenceRefs: [], nextAction: null, data: { providerMessageId: "" } };

beforeEach(() => {
  for (const k of WHATSAPP_MESSAGE_KINDS) vi.stubEnv(WHATSAPP_TEMPLATES[k].campaignEnvVar, `Campaign ${k}`);
  fakeWhatsapp.send.mockReset();
  fakeWhatsapp.send.mockResolvedValue(OK);
  fakeEmail.send.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const EVENT_KEY = "wa:followup-reminder:case-1:inv-1:1";
const sendRpcs = {
  begin_communication_send: { communication: commRow("queued"), isNew: true },
  begin_delivery_attempt: { blocked: false, blockedReason: null, delivery: deliveryRow("queued") },
  complete_delivery_attempt: { delivery: deliveryRow("sent"), communication: commRow("sent") },
  apply_case_mutation: caseRow({ status: "follow_up_sent" }),
};

describe("SupabaseRepository.sendWhatsAppMessage: follow-up reminder", () => {
  it("runs the durable RPC sequence with the business-event key, the actor and the real provider name, then advances the case through the audited RPC", async () => {
    const fake = fakeClient({ rpc: sendRpcs });
    const repo = await repoWith(fake);
    const result = await repo.sendWhatsAppMessage("case-1", { eventKey: EVENT_KEY }, STAFF);

    expect(result.status).toBe("accepted");
    expect(result.case.status).toBe("follow_up_sent");
    expect(fakeWhatsapp.send).toHaveBeenCalledTimes(1);
    expect(fakeWhatsapp.send.mock.calls[0][0]).toMatchObject({ templateKey: "payment_reminder_followup_v2", to: "9876500000", idempotencyKey: EVENT_KEY });
    expect(fakeWhatsapp.send.mock.calls[0][0].templateParams).toHaveLength(8);
    expect(fakeEmail.send).not.toHaveBeenCalled();

    const rpc = (fn: string) => fake.rpcCalls.filter((c) => c.fn === fn);
    expect(rpc("begin_communication_send")[0].args).toMatchObject({
      p_channel: "whatsapp", p_idempotency_key: EVENT_KEY, p_template_key: "payment_reminder_followup_v2", p_template_version: 2,
      p_subject: null, p_expected_actor_id: "staff-actor-1",
    });
    expect(String(rpc("begin_communication_send")[0].args.p_reason)).toMatch(/^Follow-up payment reminder \(whatsapp\)/);
    expect(rpc("begin_delivery_attempt")[0].args).toMatchObject({ p_communication_id: "comm-1", p_expected_actor_id: "staff-actor-1" });
    expect(rpc("complete_delivery_attempt")[0].args).toMatchObject({ p_status: "sent", p_provider: "fake-aisensy", p_case: null, p_expected_actor_id: "staff-actor-1" });

    const advance = rpc("apply_case_mutation")[0].args;
    expect(advance).toMatchObject({ p_case_id: "case-1", p_action: "reminder.followup_sent", p_entity: "recovery_case", p_expected_actor_id: "staff-actor-1" });
    expect((advance.p_case as { status: string }).status).toBe("follow_up_sent");
  });

  it("an already-accepted event (double click) makes NO RPC write and no provider call", async () => {
    const fake = fakeClient({ tables: { communications: [commRow("sent")], communication_deliveries: [deliveryRow("sent")] }, rpc: sendRpcs });
    const repo = await repoWith(fake);
    const result = await repo.sendWhatsAppMessage("case-1", { eventKey: EVENT_KEY }, STAFF);
    expect(result.status).toBe("already_sent");
    expect(fakeWhatsapp.send).not.toHaveBeenCalled();
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("provider rejection: 'rejected', no case advancement RPC", async () => {
    fakeWhatsapp.send.mockResolvedValue({ outcome: "permanent_failure", providerRef: null, errorCode: "AISENSY_REQUEST_REJECTED_400", evidenceRefs: [], nextAction: "x" });
    const fake = fakeClient({ rpc: { ...sendRpcs, complete_delivery_attempt: { delivery: deliveryRow("failed"), communication: commRow("failed") } } });
    const repo = await repoWith(fake);
    const result = await repo.sendWhatsAppMessage("case-1", { eventKey: EVENT_KEY }, STAFF);
    expect(result.status).toBe("rejected");
    expect(fake.rpcCalls.some((c) => c.fn === "apply_case_mutation")).toBe(false);
    expect(fake.rpcCalls.find((c) => c.fn === "complete_delivery_attempt")!.args).toMatchObject({ p_status: "failed", p_provider: "fake-aisensy" });
  });

  it("a blocked (ambiguous) attempt is reported and never reaches the provider", async () => {
    const fake = fakeClient({ rpc: { ...sendRpcs, begin_delivery_attempt: { blocked: true, blockedReason: "previous attempt unresolved", delivery: deliveryRow("queued") } } });
    const repo = await repoWith(fake);
    const result = await repo.sendWhatsAppMessage("case-1", { eventKey: EVENT_KEY }, STAFF);
    expect(result.status).toBe("ambiguous");
    expect(fakeWhatsapp.send).not.toHaveBeenCalled();
    expect(fake.rpcCalls.some((c) => c.fn === "apply_case_mutation" || c.fn === "complete_delivery_attempt")).toBe(false);
  });

  it("kill switch off: refused before any RPC, nothing sent", async () => {
    const fake = fakeClient({ rpc: sendRpcs, automationEnabled: false });
    const repo = await repoWith(fake);
    await expect(repo.sendWhatsAppMessage("case-1", { eventKey: EVENT_KEY }, STAFF)).rejects.toThrow(/kill switch is off/);
    expect(fake.rpcCalls).toHaveLength(0);
    expect(fakeWhatsapp.send).not.toHaveBeenCalled();
  });

  it("campaign not configured: refused before any RPC, nothing sent", async () => {
    vi.stubEnv(WHATSAPP_TEMPLATES.followup_reminder.campaignEnvVar, "");
    const fake = fakeClient({ rpc: sendRpcs });
    const repo = await repoWith(fake);
    await expect(repo.sendWhatsAppMessage("case-1", { eventKey: EVENT_KEY }, STAFF)).rejects.toThrow(/campaign for this message is not configured/);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("wrong workflow state (active case): refused, nothing recorded", async () => {
    const fake = fakeClient({ tables: { recovery_cases: caseRow({ status: "active", next_scheduled_at: null }) }, rpc: sendRpcs });
    const repo = await repoWith(fake);
    await expect(repo.sendWhatsAppMessage("case-1", { eventKey: EVENT_KEY }, STAFF)).rejects.toThrow(/initial reminder has not been sent yet/);
    expect(fake.rpcCalls).toHaveLength(0);
  });
});

describe("SupabaseRepository.sendWhatsAppMessage: payment received", () => {
  it("uses the per-payment/per-invoice key and needs no case-advancement RPC", async () => {
    const fake = fakeClient({
      tables: {
        recovery_cases: caseRow({ status: "payment_confirmation_required", principal_outstanding: 75000 }),
        invoices: [{ ...INVOICE, outstanding_balance: 75000 }],
        payment_records: [{ id: "pay-1", organisation_id: "org-1", case_id: "case-1", kind: "bank", amount: 25000, received_on: "2026-09-19", reference: null, client_confirmed: true, recorded_by: null, created_at: "2026-09-19T05:00:00Z" }],
        payment_allocations: [{ id: "al-1", organisation_id: "org-1", payment_record_id: "pay-1", invoice_id: "inv-1", amount: 25000, created_at: "2026-09-19T05:00:00Z" }],
      },
      rpc: {
        ...sendRpcs,
        begin_communication_send: { communication: { ...commRow("queued"), idempotency_key: "wa:payment-received:pay-1:inv-1", template_key: "payment_received_confirmation_v2" }, isNew: true },
      },
    });
    const repo = await repoWith(fake);
    const result = await repo.sendWhatsAppMessage("case-1", { eventKey: "wa:payment-received:pay-1:inv-1" }, STAFF);
    expect(result.status).toBe("accepted");
    expect(fakeWhatsapp.send.mock.calls[0][0].templateKey).toBe("payment_received_confirmation_v2");
    expect(fakeWhatsapp.send.mock.calls[0][0].templateParams).toEqual(["Debtor Co", "Acme Textiles", "INV-1024", " 250", "19 September 2026", " 750"]);
    expect(fake.rpcCalls.some((c) => c.fn === "apply_case_mutation")).toBe(false);
  });
});

describe("SupabaseRepository.recordPaymentPromise", () => {
  const input = { caseId: "case-1", invoiceId: null, promisedOn: new Date(Date.now() + 330 * 60_000 + 5 * 86_400_000).toISOString().slice(0, 10), promisedAmountPaise: 40000, sourceReplyId: null };
  const promiseRow = { id: "pr-1", organisation_id: "org-1", case_id: "case-1", invoice_id: "inv-1", promised_on: input.promisedOn, promised_amount: 40000, status: "active", source_reply_id: null, supersedes_id: null, recorded_by_id: "staff-actor-1", created_at: "2026-09-19T05:00:00Z", superseded_at: null };

  it("goes through record_payment_promise with the actor, the auto-linked sole invoice and the computed workflow patch", async () => {
    const fake = fakeClient({ rpc: { record_payment_promise: { promise: promiseRow, case: caseRow({ status: "promise_to_pay" }) } } });
    const repo = await repoWith(fake);
    const { promise, case: updated } = await repo.recordPaymentPromise("case-1", input, STAFF);

    const call = fake.rpcCalls[0];
    expect(call.fn).toBe("record_payment_promise");
    expect(call.args).toMatchObject({
      p_case_id: "case-1", p_invoice_id: "inv-1", p_promised_on: input.promisedOn, p_promised_amount: 40000, p_source_reply_id: null, p_expected_actor_id: "staff-actor-1",
    });
    expect((call.args.p_case as { status: string; nextScheduledAt: string }).status).toBe("promise_to_pay");
    expect((call.args.p_case as { nextScheduledAt: string }).nextScheduledAt).toBe(`${input.promisedOn}T05:30:00.000Z`);
    expect(promise).toMatchObject({ id: "pr-1", invoiceId: "inv-1", promisedAmount: 40000, status: "active" });
    expect(updated.status).toBe("promise_to_pay");
  });

  it("refuses bad input before calling the database", async () => {
    const fake = fakeClient({ rpc: {} });
    const repo = await repoWith(fake);
    await expect(repo.recordPaymentPromise("case-1", { ...input, promisedOn: "2020-01-01" }, STAFF)).rejects.toThrow(/in the past/);
    await expect(repo.recordPaymentPromise("case-1", { ...input, invoiceId: "inv-other" }, STAFF)).rejects.toThrow(/does not belong to this case/);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("surfaces a database-side rejection (e.g. non-staff) instead of swallowing it", async () => {
    const fake = fakeClient({});
    (fake.client.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: null, error: { message: "record_payment_promise: staff/admin session required" } });
    const repo = await repoWith(fake);
    await expect(repo.recordPaymentPromise("case-1", input, STAFF)).rejects.toThrow(/staff\/admin session required/);
  });
});
