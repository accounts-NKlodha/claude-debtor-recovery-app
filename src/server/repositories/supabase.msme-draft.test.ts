/**
 * Supabase side of MSME Save & resume: saves go through save_msme_stage (not an
 * audit-only write), the draft is read from msme_drafts, filing locks the draft
 * BEFORE the case mutation, and RPC failures map to typed domain errors.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MutationActor } from "@/lib/auth/types";

vi.mock("server-only", () => ({}));

const ACTOR: MutationActor = { actorId: "staff-1", actorRole: "staff" };
const CASE_ROW = {
  id: "case-1", organisation_id: "org-1", debtor_id: "debtor-1", status: "msme_eligibility_review", automation_mode: "assist",
  waiting_on: "system", automation_started_at: null, current_step: null, blocker: null, next_scheduled_action: null,
  next_scheduled_at: null, eligibility_route: "msme", principal_outstanding: 100000, recovered_to_date: 0, assignee_id: null,
  group_key: null, created_at: "2026-01-01T00:00:00Z", activated_at: "2026-01-01T00:00:00Z", closed_at: null,
};
const DRAFT_ROW = {
  id: "d1", organisation_id: "org-1", case_id: "case-1", form_data: { claimantName: "Acme" }, saved_stages: ["claimant"],
  current_stage: "claimant", status: "draft", diary_number: null, petition_pdf_key: null, locked_at: null, version: 3,
  created_by: "staff-1", updated_by: "staff-1", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z",
};

const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
let rpcError: string | null = null;
let draftData: unknown = DRAFT_ROW;

function fakeClient() {
  return {
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (rpcError && (fn === "save_msme_stage" || fn === "lock_msme_draft")) {
        return Promise.resolve({ data: null, error: { message: rpcError } });
      }
      if (fn === "apply_case_mutation") return Promise.resolve({ data: { ...CASE_ROW, status: "msme_odr_filed" }, error: null });
      return Promise.resolve({ data: DRAFT_ROW, error: null });
    }),
    from: vi.fn((table: string) => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: table === "msme_drafts" ? draftData : CASE_ROW, error: null }),
      };
      return builder;
    }),
  };
}

vi.mock("@/adapters", () => ({
  getAdapters: () => ({
    msmePortal: {
      name: "fake",
      saveStage: async () => ({ outcome: "success", providerRef: null, errorCode: null, evidenceRefs: [], nextAction: null, data: { resumeToken: "tok" } }),
      captureAcknowledgement: async () => ({ outcome: "success", providerRef: null, errorCode: null, evidenceRefs: [], nextAction: null, data: { diaryNumber: "DIARY-1", petitionPdfKey: "pdf-1" } }),
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

afterEach(() => {
  rpcCalls.length = 0;
  rpcError = null;
  draftData = DRAFT_ROW;
  vi.resetModules();
});

async function repo() {
  const { createClient } = await import("@/lib/supabase/server");
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeClient());
  const { SupabaseRepository } = await import("./supabase");
  return new SupabaseRepository();
}

describe("SupabaseRepository MSME draft", () => {
  it("saves through save_msme_stage with the payload, actor and expected version", async () => {
    const r = await repo();
    const out = await r.saveMsmeStage("case-1", "claimant", { claimantName: "Acme" }, ACTOR, 2);
    expect(out).toEqual({ resumeToken: "tok", version: 3 });
    const call = rpcCalls.find((c) => c.fn === "save_msme_stage")!;
    expect(call.args).toMatchObject({
      p_case_id: "case-1", p_stage: "claimant", p_payload: { claimantName: "Acme" },
      p_expected_version: 2, p_expected_actor_id: "staff-1",
    });
    // the RPC audits atomically; no separate audit-only write
    expect(rpcCalls.some((c) => c.fn === "record_audit_event")).toBe(false);
  });

  it("maps locked and conflict failures to typed errors", async () => {
    const r = await repo();
    rpcError = "save_msme_stage: the ODR filing was submitted; the draft is locked";
    await expect(r.saveMsmeStage("case-1", "claimant", {}, ACTOR)).rejects.toMatchObject({ kind: "locked" });
    rpcError = "save_msme_stage: the draft was changed by another session (expected version 1, found 2)";
    await expect(r.saveMsmeStage("case-1", "claimant", {}, ACTOR, 1)).rejects.toMatchObject({ kind: "conflict" });
  });

  it("reads the persisted draft (null when never saved)", async () => {
    const r = await repo();
    expect(await r.getMsmeDraft("case-1")).toMatchObject({
      caseId: "case-1", formData: { claimantName: "Acme" }, currentStage: "claimant", version: 3, status: "draft",
    });
    draftData = null;
    expect(await r.getMsmeDraft("case-1")).toBeNull();
  });

  it("filing locks the draft before the case is advanced", async () => {
    const r = await repo();
    const out = await r.captureMsmeAcknowledgement("case-1", ACTOR);
    expect(out.diaryNumber).toBe("DIARY-1");
    const order = rpcCalls.map((c) => c.fn).filter((f) => f === "lock_msme_draft" || f === "apply_case_mutation");
    expect(order).toEqual(["lock_msme_draft", "apply_case_mutation"]);
    expect(rpcCalls.find((c) => c.fn === "lock_msme_draft")!.args).toMatchObject({
      p_case_id: "case-1", p_diary_number: "DIARY-1", p_petition_pdf_key: "pdf-1",
    });
  });

  it("does not advance the case if locking fails", async () => {
    const r = await repo();
    rpcError = "lock_msme_draft: the filing is already locked with a different diary number";
    await expect(r.captureMsmeAcknowledgement("case-1", ACTOR)).rejects.toMatchObject({ kind: "locked" });
    expect(rpcCalls.some((c) => c.fn === "apply_case_mutation")).toBe(false);
  });
});
