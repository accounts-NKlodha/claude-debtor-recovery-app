/**
 * Final-UAT go-live task: WhatsApp has no real production provider
 * (src/adapters/index.ts keeps it mocked unconditionally), and the mock
 * adapter reports fake success with a realistic `wamid.*` providerRef for
 * virtually every send. Left unguarded, `sendInitialReminder` would attempt
 * it automatically whenever a debtor has a mobile number on file, silently
 * advancing a real case's reminder timer and recording a
 * communication_delivery that claims a WhatsApp send which never happened
 * -- even if the real Gmail send failed. This proves the fix in
 * SupabaseRepository.sendInitialReminder: WhatsApp is never attempted in
 * production, only outside it (where the mock remains an explicit,
 * understood demo/test affordance).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MutationActor } from "@/lib/auth/types";
import { WHATSAPP_MESSAGE_KINDS, WHATSAPP_TEMPLATES } from "@/domain/whatsapp-templates";

vi.mock("server-only", () => ({}));

const ACTOR: MutationActor = { actorId: "staff-actor-1", actorRole: "staff" };

const ORG_ROW = {
  id: "org-1",
  client_code: "ORG1",
  legal_entity_name: "Acme Textiles",
  creditor_gstin: null,
  udyam_number: null,
  jito_member: false,
  is_firm: false,
  upi_id: "acme@upi",
  upi_payee_name: "Acme Textiles Payee",
  created_at: "2026-01-01T00:00:00Z",
};

const DEBTOR_ROW = {
  id: "debtor-1",
  organisation_id: "org-1",
  name: "Debtor Co",
  mobile: "9876500000",
  email: "debtor@example.com",
  gstin: null,
  address: null,
  contact_verified: false,
  total_due: 100000,
};

const INVOICE_ROW = {
  id: "inv-1",
  organisation_id: "org-1",
  case_id: "case-1",
  debtor_id: "debtor-1",
  invoice_number: "INV-1024",
  invoice_date: "2026-08-01",
  due_date: "2026-09-18",
  taxable_value: 100000,
  tax_rate: 0,
  tax_amount: 0,
  invoice_total: 100000,
  outstanding_balance: 100000,
  currency: "INR",
  source_document_id: null,
  extraction_confidence: null,
  created_at: "2026-01-01T00:00:00Z",
};

const CASE_ROW = {
  id: "case-1",
  organisation_id: "org-1",
  debtor_id: "debtor-1",
  status: "active",
  automation_mode: "assist",
  waiting_on: "system",
  automation_started_at: null,
  current_step: null,
  blocker: null,
  next_scheduled_action: null,
  next_scheduled_at: null,
  eligibility_route: "ordinary",
  principal_outstanding: 100000,
  recovered_to_date: 0,
  assignee_id: null,
  group_key: null,
  created_at: "2026-01-01T00:00:00Z",
  activated_at: "2026-01-01T00:00:00Z",
  closed_at: null,
};

function communicationRow(channel: "whatsapp" | "email", status: "queued" | "sent") {
  return {
    id: `comm-${channel}`,
    case_id: "case-1",
    organisation_id: "org-1",
    channel,
    direction: "outbound",
    template_key: `reminder_initial_${channel}`,
    template_version: 1,
    subject: null,
    body: "body",
    provider_message_id: null,
    thread_ref: null,
    delivery_status: status,
    has_secure_link: false,
    idempotency_key: `reminder-initial:${channel}:case-1:2026-01-01`,
    reply_classification: null,
    reviewed_by_id: null,
    created_at: "2026-01-01T00:00:00Z",
    delivered_at: null,
  };
}

function deliveryRow(channel: "whatsapp" | "email") {
  return {
    id: `delivery-${channel}`,
    communication_id: `comm-${channel}`,
    attempt: 1,
    status: "queued",
    adapter_outcome: null,
    provider_message_id: null,
    error_detail: null,
    created_at: "2026-01-01T00:00:00Z",
  };
}

/** Minimal fake Supabase client -- same shape as supabase.test.ts's harness. */
function buildFakeSupabase(
  rpcResponses: Record<string, { data?: unknown; error?: { message: string } | null }>,
  options: { automationEnabled?: boolean; org?: Record<string, unknown>; debtor?: Record<string, unknown> } = {},
) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const fromResponses: Record<string, { data: unknown; error: null }> = {
    organisations: { data: { ...ORG_ROW, ...options.org }, error: null },
    debtors: { data: { ...DEBTOR_ROW, ...options.debtor }, error: null },
    recovery_cases: { data: CASE_ROW, error: null },
    invoices: { data: [INVOICE_ROW], error: null },
    communication_deliveries: { data: [], error: null },
    communications: { data: [], error: null },
    system_settings: { data: { value_json: { enabled: options.automationEnabled ?? true } }, error: null },
  };
  const client = {
    rpc: vi.fn((fn: string, args: unknown) => {
      rpcCalls.push({ fn, args: args as Record<string, unknown> });
      const response = rpcResponses[fn] ?? { data: null, error: null };
      return Promise.resolve(response);
    }),
    from: vi.fn((table: string) => {
      const response = fromResponses[table] ?? { data: null, error: null };
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve(response),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(response).then(resolve),
      };
      return builder;
    }),
  };
  return { client, rpcCalls };
}

const fakeEmailAdapter = { name: "fake-email", send: vi.fn() };
const fakeWhatsappAdapter = { name: "fake-whatsapp", send: vi.fn() };
const isLiveWhatsAppConfiguredMock = vi.fn(() => false);

vi.mock("@/adapters", () => ({
  getAdapters: () => ({ email: fakeEmailAdapter, whatsapp: fakeWhatsappAdapter }),
  isLiveWhatsAppConfigured: () => isLiveWhatsAppConfiguredMock(),
}));

beforeEach(() => {
  for (const k of WHATSAPP_MESSAGE_KINDS) vi.stubEnv(WHATSAPP_TEMPLATES[k].campaignEnvVar, `Test Campaign ${k}`);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
  fakeEmailAdapter.send.mockReset();
  fakeWhatsappAdapter.send.mockReset();
  isLiveWhatsAppConfiguredMock.mockReset();
  isLiveWhatsAppConfiguredMock.mockReturnValue(false);
});

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

async function mockedCreateClient() {
  const { createClient } = await import("@/lib/supabase/server");
  return createClient as unknown as ReturnType<typeof vi.fn>;
}

describe("SupabaseRepository.sendInitialReminder: WhatsApp production safety", () => {
  it("in production, never attempts WhatsApp even though the debtor has a mobile number -- only email is sent", async () => {
    vi.stubEnv("NODE_ENV", "production");
    fakeEmailAdapter.send.mockResolvedValue({
      outcome: "success",
      providerRef: "<real-email-ref@mail.nklodha.in>",
      errorCode: null,
      evidenceRefs: [],
      nextAction: null,
      data: { providerMessageId: "<real-email-ref@mail.nklodha.in>" },
    });

    const { client, rpcCalls } = buildFakeSupabase({
      begin_communication_send: { data: { communication: communicationRow("email", "queued"), isNew: true }, error: null },
      begin_delivery_attempt: { data: { blocked: false, blockedReason: null, delivery: deliveryRow("email") }, error: null },
      complete_delivery_attempt: {
        data: { delivery: { ...deliveryRow("email"), status: "sent" }, communication: communicationRow("email", "sent") },
        error: null,
      },
      apply_case_mutation: { data: { ...CASE_ROW, status: "initial_communication_sent" }, error: null },
    });
    const createClient = await mockedCreateClient();
    createClient.mockResolvedValue(client);

    const { SupabaseRepository } = await import("./supabase");
    const repo = new SupabaseRepository();
    const result = await repo.sendInitialReminder("case-1", ACTOR);

    // The adapter-level proof: the mock WhatsApp adapter's .send() must
    // never be invoked at all in production -- not called, not called with
    // any outcome, period.
    expect(fakeWhatsappAdapter.send).not.toHaveBeenCalled();
    expect(fakeEmailAdapter.send).toHaveBeenCalledTimes(1);
    // the Supabase path hands the adapter both the plain-text body and the HTML alternative
    const emailCall = fakeEmailAdapter.send.mock.calls[0][0];
    expect(emailCall.html).toContain("<!DOCTYPE html>");
    expect(emailCall.body).toContain("Dear ");
    expect(emailCall.body).not.toMatch(/<[a-z]/i);

    // The database-level proof: no begin_communication_send call requests
    // p_channel: "whatsapp" -- so no communication/communication_delivery
    // row claiming a WhatsApp send can ever be created.
    const channelsRequested = rpcCalls.filter((c) => c.fn === "begin_communication_send").map((c) => c.args.p_channel);
    expect(channelsRequested).toEqual(["email"]);

    expect(result.communications).toHaveLength(1);
    expect(result.communications[0].channel).toBe("email");
  });

  it("outside production, WhatsApp remains available as the existing demo/test affordance", async () => {
    // Deliberately NOT stubbing NODE_ENV to "production" -- Vitest's default
    // test environment, matching every other non-production-mode test in
    // this suite.
    fakeEmailAdapter.send.mockResolvedValue({
      outcome: "success",
      providerRef: "<email-ref@mail.nklodha.in>",
      errorCode: null,
      evidenceRefs: [],
      nextAction: null,
      data: { providerMessageId: "<email-ref@mail.nklodha.in>" },
    });
    fakeWhatsappAdapter.send.mockResolvedValue({
      outcome: "success",
      providerRef: "wamid.fake",
      errorCode: null,
      evidenceRefs: [],
      nextAction: null,
      data: { providerMessageId: "wamid.fake" },
    });

    const { client, rpcCalls } = buildFakeSupabase({
      begin_communication_send: {
        data: { communication: communicationRow("whatsapp", "queued"), isNew: true },
        error: null,
      },
      begin_delivery_attempt: { data: { blocked: false, blockedReason: null, delivery: deliveryRow("whatsapp") }, error: null },
      complete_delivery_attempt: {
        data: { delivery: { ...deliveryRow("whatsapp"), status: "sent" }, communication: communicationRow("whatsapp", "sent") },
        error: null,
      },
      apply_case_mutation: { data: { ...CASE_ROW, status: "initial_communication_sent" }, error: null },
    });
    const createClient = await mockedCreateClient();
    createClient.mockResolvedValue(client);

    const { SupabaseRepository } = await import("./supabase");
    const repo = new SupabaseRepository();
    await repo.sendInitialReminder("case-1", ACTOR);

    const channelsRequested = rpcCalls.filter((c) => c.fn === "begin_communication_send").map((c) => c.args.p_channel);
    expect(channelsRequested).toContain("whatsapp");
    expect(fakeWhatsappAdapter.send).toHaveBeenCalledTimes(1);
  });

  it("in production with WHATSAPP_PROVIDER=aisensy configured, payment details set and the kill switch on, WhatsApp is attempted with the 8 approved V2 template params and the real adapter's name is persisted as the provider", async () => {
    vi.stubEnv("NODE_ENV", "production");
    isLiveWhatsAppConfiguredMock.mockReturnValue(true);
    fakeEmailAdapter.send.mockResolvedValue({
      outcome: "success",
      providerRef: "<real-email-ref@mail.nklodha.in>",
      errorCode: null,
      evidenceRefs: [],
      nextAction: null,
      data: { providerMessageId: "<real-email-ref@mail.nklodha.in>" },
    });
    fakeWhatsappAdapter.send.mockResolvedValue({
      outcome: "success",
      providerRef: "real-wamid-123",
      errorCode: null,
      evidenceRefs: [],
      nextAction: null,
      data: { providerMessageId: "real-wamid-123" },
    });

    const { client, rpcCalls } = buildFakeSupabase(
      {
        begin_communication_send: { data: { communication: communicationRow("whatsapp", "queued"), isNew: true }, error: null },
        begin_delivery_attempt: { data: { blocked: false, blockedReason: null, delivery: deliveryRow("whatsapp") }, error: null },
        complete_delivery_attempt: {
          data: { delivery: { ...deliveryRow("whatsapp"), status: "sent" }, communication: communicationRow("whatsapp", "sent") },
          error: null,
        },
        apply_case_mutation: { data: { ...CASE_ROW, status: "initial_communication_sent" }, error: null },
      },
      { automationEnabled: true },
    );
    const createClient = await mockedCreateClient();
    createClient.mockResolvedValue(client);

    const { SupabaseRepository } = await import("./supabase");
    const repo = new SupabaseRepository();
    await repo.sendInitialReminder("case-1", ACTOR);

    expect(fakeWhatsappAdapter.send).toHaveBeenCalledTimes(1);
    const sendArgs = fakeWhatsappAdapter.send.mock.calls[0][0];
    expect(sendArgs.templateParams).toBeInstanceOf(Array);
    expect(sendArgs.templateParams).toEqual([
      "Debtor Co",
      "INV-1024",
      " 1,000",
      "18 September 2026",
      " 1,000",
      "Acme Textiles",
      "acme@upi",
      "Acme Textiles Payee",
    ]);
    expect(sendArgs.templateKey).toBe("payment_reminder_initial_v2");
    expect(sendArgs.to).toBe(DEBTOR_ROW.mobile);

    const completeCalls = rpcCalls.filter((c) => c.fn === "complete_delivery_attempt");
    const whatsappComplete = completeCalls.find((c) => (c.args as { p_delivery_id: string }).p_delivery_id === "delivery-whatsapp");
    expect(whatsappComplete?.args.p_provider).toBe("fake-whatsapp");
  });

  it("kill switch behavior: in production with the global automation kill switch engaged, NEITHER channel is attempted (no provider call, nothing recorded, case untouched)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    isLiveWhatsAppConfiguredMock.mockReturnValue(true);
    fakeEmailAdapter.send.mockResolvedValue({
      outcome: "success",
      providerRef: "<real-email-ref@mail.nklodha.in>",
      errorCode: null,
      evidenceRefs: [],
      nextAction: null,
      data: { providerMessageId: "<real-email-ref@mail.nklodha.in>" },
    });

    const { client, rpcCalls } = buildFakeSupabase(
      {
        begin_communication_send: { data: { communication: communicationRow("email", "queued"), isNew: true }, error: null },
        begin_delivery_attempt: { data: { blocked: false, blockedReason: null, delivery: deliveryRow("email") }, error: null },
        complete_delivery_attempt: {
          data: { delivery: { ...deliveryRow("email"), status: "sent" }, communication: communicationRow("email", "sent") },
          error: null,
        },
        apply_case_mutation: { data: { ...CASE_ROW, status: "initial_communication_sent" }, error: null },
      },
      { automationEnabled: false },
    );
    const createClient = await mockedCreateClient();
    createClient.mockResolvedValue(client);

    const { SupabaseRepository } = await import("./supabase");
    const repo = new SupabaseRepository();
    await expect(repo.sendInitialReminder("case-1", ACTOR)).rejects.toThrow(/kill switch/i);

    expect(fakeWhatsappAdapter.send).not.toHaveBeenCalled();
    expect(fakeEmailAdapter.send).not.toHaveBeenCalled();
    const fns = rpcCalls.map((c) => c.fn);
    expect(fns).not.toContain("begin_communication_send");
    expect(fns).not.toContain("begin_delivery_attempt");
    expect(fns).not.toContain("complete_delivery_attempt");
    expect(fns).not.toContain("apply_case_mutation");
    // the block itself is audited so an operator can see why nothing was sent
    const audit = rpcCalls.find((c) => c.fn === "record_audit_event");
    expect(audit?.args).toMatchObject({ p_action: "communication.send_blocked", p_entity: "recovery_case", p_entity_id: "case-1" });
  });

  it("phone normalization: in production with WHATSAPP_PROVIDER=aisensy configured, an unnormalizable debtor mobile number skips WhatsApp instead of guessing a destination", async () => {
    vi.stubEnv("NODE_ENV", "production");
    isLiveWhatsAppConfiguredMock.mockReturnValue(true);
    fakeEmailAdapter.send.mockResolvedValue({
      outcome: "success",
      providerRef: "<real-email-ref@mail.nklodha.in>",
      errorCode: null,
      evidenceRefs: [],
      nextAction: null,
      data: { providerMessageId: "<real-email-ref@mail.nklodha.in>" },
    });

    const { client, rpcCalls } = buildFakeSupabase(
      {
        begin_communication_send: { data: { communication: communicationRow("email", "queued"), isNew: true }, error: null },
        begin_delivery_attempt: { data: { blocked: false, blockedReason: null, delivery: deliveryRow("email") }, error: null },
        complete_delivery_attempt: {
          data: { delivery: { ...deliveryRow("email"), status: "sent" }, communication: communicationRow("email", "sent") },
          error: null,
        },
        apply_case_mutation: { data: { ...CASE_ROW, status: "initial_communication_sent" }, error: null },
      },
      { automationEnabled: true },
    );
    // Override the debtor row with a malformed mobile number for this test only.
    const originalFrom = client.from;
    client.from = vi.fn((table: string) => {
      if (table === "debtors") {
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: () => builder,
          limit: () => builder,
          maybeSingle: () => Promise.resolve({ data: { ...DEBTOR_ROW, mobile: "12345" }, error: null }),
          then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: { ...DEBTOR_ROW, mobile: "12345" }, error: null }).then(resolve),
        };
        return builder;
      }
      return originalFrom(table);
    });
    const createClient = await mockedCreateClient();
    createClient.mockResolvedValue(client);

    const { SupabaseRepository } = await import("./supabase");
    const repo = new SupabaseRepository();
    const result = await repo.sendInitialReminder("case-1", ACTOR);

    expect(fakeWhatsappAdapter.send).not.toHaveBeenCalled();
    const channelsRequested = rpcCalls.filter((c) => c.fn === "begin_communication_send").map((c) => c.args.p_channel);
    expect(channelsRequested).toEqual(["email"]);
    expect(result.communications).toHaveLength(1);
  });

  it("missing payment details: WhatsApp is not sent (no adapter call, no communication row) but email still is, and the operator gets a controlled warning", async () => {
    vi.stubEnv("NODE_ENV", "production");
    isLiveWhatsAppConfiguredMock.mockReturnValue(true);
    fakeEmailAdapter.send.mockResolvedValue({
      outcome: "success", providerRef: "<e@mail>", errorCode: null, evidenceRefs: [], nextAction: null,
      data: { providerMessageId: "<e@mail>" },
    });
    const { client, rpcCalls } = buildFakeSupabase(
      {
        begin_communication_send: { data: { communication: communicationRow("email", "queued"), isNew: true }, error: null },
        begin_delivery_attempt: { data: { blocked: false, blockedReason: null, delivery: deliveryRow("email") }, error: null },
        complete_delivery_attempt: {
          data: { delivery: { ...deliveryRow("email"), status: "sent" }, communication: communicationRow("email", "sent") },
          error: null,
        },
        apply_case_mutation: { data: { ...CASE_ROW, status: "initial_communication_sent" }, error: null },
      },
      { automationEnabled: true, org: { upi_id: null, upi_payee_name: null } },
    );
    const createClient = await mockedCreateClient();
    createClient.mockResolvedValue(client);

    const { SupabaseRepository } = await import("./supabase");
    const result = await new SupabaseRepository().sendInitialReminder("case-1", ACTOR);

    expect(fakeWhatsappAdapter.send).not.toHaveBeenCalled();
    expect(rpcCalls.filter((c) => c.fn === "begin_communication_send").map((c) => c.args.p_channel)).toEqual(["email"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/WhatsApp reminder not sent/);
    expect(result.warnings[0]).toMatch(/payment details \(UPI ID and UPI payee name\) are not configured/);
  });

  it("missing payment details and no other channel: throws a controlled operator error naming the missing configuration, sends and records nothing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    isLiveWhatsAppConfiguredMock.mockReturnValue(true);
    const { client, rpcCalls } = buildFakeSupabase({}, { automationEnabled: true, org: { upi_id: null, upi_payee_name: null }, debtor: { email: null } });
    const createClient = await mockedCreateClient();
    createClient.mockResolvedValue(client);

    const { SupabaseRepository } = await import("./supabase");
    await expect(new SupabaseRepository().sendInitialReminder("case-1", ACTOR)).rejects.toThrow(
      /WhatsApp reminder not sent: the creditor's payment details \(UPI ID and UPI payee name\) are not configured/,
    );
    expect(fakeWhatsappAdapter.send).not.toHaveBeenCalled();
    expect(fakeEmailAdapter.send).not.toHaveBeenCalled();
    expect(rpcCalls.filter((c) => c.fn === "begin_communication_send")).toHaveLength(0);
    expect(rpcCalls.filter((c) => c.fn === "apply_case_mutation")).toHaveLength(0);
  });

  it("only one of UPI ID / payee name present (should be impossible in the DB) is still treated as not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    isLiveWhatsAppConfiguredMock.mockReturnValue(true);
    const { client } = buildFakeSupabase({}, { automationEnabled: true, org: { upi_payee_name: null }, debtor: { email: null } });
    const createClient = await mockedCreateClient();
    createClient.mockResolvedValue(client);

    const { SupabaseRepository } = await import("./supabase");
    await expect(new SupabaseRepository().sendInitialReminder("case-1", ACTOR)).rejects.toThrow(/payment details/);
    expect(fakeWhatsappAdapter.send).not.toHaveBeenCalled();
  });

});
