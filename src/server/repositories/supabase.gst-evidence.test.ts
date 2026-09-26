/**
 * GST reload hydration, Supabase side: getGstEvidence must query only the
 * recognised GST audit events for THIS case, and what captureGstFiling writes
 * must be exactly what the reader parses back (so the free-text reason can't
 * drift away from the parser unnoticed).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MutationActor } from "@/lib/auth/types";

vi.mock("server-only", () => ({}));

const ACTOR: MutationActor = { actorId: "staff-1", actorRole: "staff" };
const CASE_ROW = {
  id: "case-1", organisation_id: "org-1", debtor_id: "debtor-1", status: "gst_notification_prepared", automation_mode: "assist",
  waiting_on: "system", automation_started_at: null, current_step: null, blocker: null, next_scheduled_action: null,
  next_scheduled_at: null, eligibility_route: "gst", principal_outstanding: 100000, recovered_to_date: 0, assignee_id: null,
  group_key: null, created_at: "2026-01-01T00:00:00Z", activated_at: "2026-01-01T00:00:00Z", closed_at: null,
};

const auditRows: Array<{ action: string; reason: string | null; created_at: string }> = [];
const queries: Array<{ table: string; filters: Array<[string, unknown[]]> }> = [];
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

function fakeClient() {
  return {
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: { ...CASE_ROW, status: "gst_notification_filed" }, error: null });
    }),
    from: vi.fn((table: string) => {
      const q = { table, filters: [] as Array<[string, unknown[]]> };
      queries.push(q);
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (...a: unknown[]) => (q.filters.push(["eq", a]), builder),
        in: (...a: unknown[]) => (q.filters.push(["in", a]), builder),
        order: (...a: unknown[]) => (q.filters.push(["order", a]), builder),
        maybeSingle: () => Promise.resolve({ data: CASE_ROW, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: table === "audit_events" ? auditRows : [], error: null }),
      };
      return builder;
    }),
  };
}

vi.mock("@/adapters", () => ({
  getAdapters: () => ({
    gstPortal: {
      name: "fake",
      captureResult: async () => ({ outcome: "success", providerRef: null, errorCode: null, evidenceRefs: [], nextAction: null, data: { referenceNumber: "MOCK", filedAt: new Date().toISOString() } }),
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

afterEach(() => {
  auditRows.length = 0;
  queries.length = 0;
  rpcCalls.length = 0;
  vi.resetModules();
});

async function repo() {
  const { createClient } = await import("@/lib/supabase/server");
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeClient());
  const { SupabaseRepository } = await import("./supabase");
  return new SupabaseRepository();
}

describe("SupabaseRepository.getGstEvidence", () => {
  it("reads only this case's recognised GST audit events, oldest first", async () => {
    const r = await repo();
    await r.getGstEvidence("case-1");
    const q = queries.find((x) => x.table === "audit_events")!;
    expect(q.filters).toContainEqual(["eq", ["entity", "recovery_case"]]);
    expect(q.filters).toContainEqual(["eq", ["entity_id", "case-1"]]);
    expect(q.filters).toContainEqual(["in", ["action", ["gst.prepared", "gst.session_opened", "gst.filed"]]]);
    expect(q.filters).toContainEqual(["order", ["created_at", { ascending: true }]]);
  });

  it("reconstructs an opened session and a filing with its reference from those rows", async () => {
    auditRows.push(
      { action: "gst.prepared", reason: "GST pack re-validated", created_at: "2026-09-22T16:52:00Z" },
      { action: "gst.session_opened", reason: "Operator solves CAPTCHA and presses Send", created_at: "2026-09-22T16:53:00Z" },
      { action: "gst.filed", reason: "Ignored event GST_NOTIFICATION_FILED in status under_validation; reference M1BATCH4GSTREF001", created_at: "2026-09-22T16:54:00Z" },
    );
    const e = await (await repo()).getGstEvidence("case-1");
    expect(e).toMatchObject({ sessionOpenedAt: "2026-09-22T16:53:00Z", filedAt: "2026-09-22T16:54:00Z", referenceNumber: "M1BATCH4GSTREF001", filingCount: 1 });
  });

  it("is empty (a truthful 'not started') only when nothing is recorded", async () => {
    const e = await (await repo()).getGstEvidence("case-1");
    expect(e).toMatchObject({ sessionOpenedAt: null, filedAt: null, referenceNumber: null, filingCount: 0 });
  });

  it("propagates a read failure instead of returning a false empty state", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    const failing = {
      from: () => {
        const b: Record<string, unknown> = { select: () => b, eq: () => b, in: () => b, order: () => b, then: (res: (v: unknown) => void) => res({ data: null, error: { message: "boom" } }) };
        return b;
      },
    };
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(failing);
    const { SupabaseRepository } = await import("./supabase");
    await expect(new SupabaseRepository().getGstEvidence("case-1")).rejects.toThrow(/boom/);
  });

  it("what captureGstFiling writes is exactly what the reader parses back", async () => {
    const r = await repo();
    await r.captureGstFiling("case-1", "AD0809260001234", ACTOR);
    const write = rpcCalls.find((c) => c.args.p_action === "gst.filed")!;
    auditRows.push({ action: "gst.filed", reason: write.args.p_reason as string, created_at: "2026-09-25T16:00:00Z" });
    const e = await r.getGstEvidence("case-1");
    expect(e.referenceNumber).toBe("AD0809260001234");
    expect(e.filedAt).toBe("2026-09-25T16:00:00Z");
  });
});
