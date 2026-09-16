/**
 * Authorization + server-action hardening task, #19: final UAT found
 * captureGstFiling would fall back to the mock GST adapter's own fabricated
 * reference number (or the literal string "UNSPECIFIED") whenever an empty
 * staffReference was submitted -- the browser form already makes this
 * field `required`, but a direct/bypassed server-action call could still
 * reach this fallback and record a case as "filed" against a government
 * portal with no real reference at all. There is no real GST portal
 * integration (gstPortal stays mocked regardless of profile/environment),
 * so any reference number that isn't staff-supplied is fabricated by
 * definition. Proves the production repository now rejects this instead.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MutationActor } from "@/lib/auth/types";

vi.mock("server-only", () => ({}));

const ACTOR: MutationActor = { actorId: "staff-1", actorRole: "staff" };

const CASE_ROW = {
  id: "case-1",
  organisation_id: "org-1",
  debtor_id: "debtor-1",
  status: "gst_notification_prepared",
  automation_mode: "assist",
  waiting_on: "system",
  automation_started_at: null,
  current_step: null,
  blocker: null,
  next_scheduled_action: null,
  next_scheduled_at: null,
  eligibility_route: "gst",
  principal_outstanding: 100000,
  recovered_to_date: 0,
  assignee_id: null,
  group_key: null,
  created_at: "2026-01-01T00:00:00Z",
  activated_at: "2026-01-01T00:00:00Z",
  closed_at: null,
};

function buildFakeSupabase() {
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const client = {
    rpc: vi.fn((fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: { ...CASE_ROW, status: "gst_notification_filed" }, error: null });
    }),
    from: vi.fn(() => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: CASE_ROW, error: null }),
      };
      return builder;
    }),
  };
  return { client, rpcCalls };
}

const fakeGstPortal = {
  name: "fake-gst-portal",
  prepare: vi.fn(),
  openAssistedSession: vi.fn(),
  captureResult: vi.fn(),
};

vi.mock("@/adapters", () => ({
  getAdapters: () => ({ gstPortal: fakeGstPortal }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  fakeGstPortal.captureResult.mockReset();
});

async function mockedCreateClient() {
  const { createClient } = await import("@/lib/supabase/server");
  return createClient as unknown as ReturnType<typeof vi.fn>;
}

describe("SupabaseRepository.captureGstFiling: no fabricated reference number in production", () => {
  it("rejects a blank staffReference -- never falls back to the mock adapter's own fabricated reference", async () => {
    fakeGstPortal.captureResult.mockResolvedValue({
      outcome: "success",
      providerRef: null,
      errorCode: null,
      evidenceRefs: [],
      nextAction: null,
      data: { referenceNumber: "GST-COMM-FABRICATED-BY-MOCK", filedAt: new Date().toISOString() },
    });
    const { client, rpcCalls } = buildFakeSupabase();
    const createClient = await mockedCreateClient();
    createClient.mockResolvedValue(client);

    const { SupabaseRepository } = await import("./supabase");
    const repo = new SupabaseRepository();

    await expect(repo.captureGstFiling("case-1", "", ACTOR)).rejects.toThrow(
      /real portal reference number is required/,
    );
    await expect(repo.captureGstFiling("case-1", "   ", ACTOR)).rejects.toThrow(
      /real portal reference number is required/,
    );
    // Never reached apply_case_mutation -- no case was marked "filed" against a fabricated reference.
    expect(rpcCalls.some((c) => c.fn === "apply_case_mutation")).toBe(false);
  });

  it("accepts a real staff-supplied reference and uses exactly that value, not the mock's", async () => {
    fakeGstPortal.captureResult.mockResolvedValue({
      outcome: "success",
      providerRef: null,
      errorCode: null,
      evidenceRefs: [],
      nextAction: null,
      data: { referenceNumber: "GST-COMM-FABRICATED-BY-MOCK", filedAt: new Date().toISOString() },
    });
    const { client } = buildFakeSupabase();
    const createClient = await mockedCreateClient();
    createClient.mockResolvedValue(client);

    const { SupabaseRepository } = await import("./supabase");
    const repo = new SupabaseRepository();

    const result = await repo.captureGstFiling("case-1", "AD0809260001234", ACTOR);
    expect(result.referenceNumber).toBe("AD0809260001234");
    expect(result.referenceNumber).not.toBe("GST-COMM-FABRICATED-BY-MOCK");
  });
});
