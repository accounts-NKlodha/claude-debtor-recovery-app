/**
 * SupabaseRepository activation gates against a fake client: gate evidence is
 * read from the audit log, the case patch goes through apply_case_mutation /
 * correct_invoice_row, and OCR confirmation alone never activates.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MutationActor } from "@/lib/auth/types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const ACTOR: MutationActor = { actorId: "staff-actor-1", actorRole: "staff" };
const NOW = new Date("2026-09-21T06:00:00Z");

const caseRow = (status: string) => ({
  id: "case-1", organisation_id: "org-1", debtor_id: "debtor-1", status, automation_mode: "assist", waiting_on: "staff",
  automation_started_at: null, current_step: null, blocker: null, next_scheduled_action: null, next_scheduled_at: null,
  eligibility_route: null, principal_outstanding: 2_500_000, recovered_to_date: 0, assignee_id: null, group_key: null,
  created_at: "2026-09-01T00:00:00Z", activated_at: null, closed_at: null,
});
const invoiceRow = (due: string | null) => ({
  id: "inv-1", organisation_id: "org-1", case_id: "case-1", debtor_id: "debtor-1", invoice_number: "UAT-1", invoice_date: "2026-06-15",
  due_date: due, taxable_value: 2_118_644, tax_rate: 18, tax_amount: 381_356, invoice_total: 2_500_000, outstanding_balance: 2_500_000,
  currency: "INR", source_document_id: null, extraction_confidence: 0.5, created_at: "2026-09-01T00:00:00Z",
});

function fake(opts: { status: string; due?: string | null; audit?: { action: string; entity_id: string }[] }) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const responses: Record<string, unknown> = {
    recovery_cases: caseRow(opts.status),
    invoices: [invoiceRow(opts.due === undefined ? "2026-07-15" : opts.due)],
    audit_events: opts.audit ?? [],
  };
  const client = {
    rpc: vi.fn((fn: string, args: unknown) => {
      rpcCalls.push({ fn, args: args as Record<string, unknown> });
      if (fn === "apply_case_mutation") return Promise.resolve({ data: { ...caseRow((args as { p_case: { status: string } }).p_case.status) }, error: null });
      if (fn === "correct_invoice_row") return Promise.resolve({ data: invoiceRow("2026-07-15"), error: null });
      return Promise.resolve({ data: null, error: null });
    }),
    from: vi.fn((table: string) => {
      const response = { data: responses[table] ?? null, error: null };
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
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

async function repoWith(f: ReturnType<typeof fake>) {
  const { createClient } = await import("@/lib/supabase/server");
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(f.client);
  const { SupabaseRepository } = await import("./supabase");
  return new SupabaseRepository();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

describe("SupabaseRepository activation gates", () => {
  it("getActivationGates reads evidence from the audit log and derives the age gate from the due date", async () => {
    const repo = await repoWith(fake({ status: "under_validation", audit: [{ action: "ocr.corrected", entity_id: "inv-1" }] }));
    expect(await repo.getActivationGates("case-1")).toMatchObject({
      clientCertified: false, staffValidated: true, ageGatePassed: true, daysOverdue: 68, missing: ["client certification"],
    });
  });

  it("OCR confirmation alone does NOT activate: the case patch is under_validation, waiting on the client", async () => {
    const f = fake({ status: "correction_required" });
    const repo = await repoWith(f);
    const out = await repo.correctInvoiceOcr("case-1", "inv-1", { invoiceTotal: 2_500_000, outstandingBalance: 2_500_000 }, ACTOR);
    const call = f.rpcCalls.find((c) => c.fn === "correct_invoice_row")!;
    const patch = call.args.p_case as { status: string; blocker: string; waitingOn: string; activatedAt: string | null };
    expect(patch.status).toBe("under_validation");
    expect(patch.waitingOn).toBe("client");
    expect(patch.blocker).toMatch(/client certification/);
    expect(patch.activatedAt).toBeNull();
    expect(out.case.status).toBe("under_validation");
  });

  it("OCR confirmation with certification already on record activates and stamps activatedAt", async () => {
    const f = fake({ status: "correction_required", audit: [{ action: "case.client_certified", entity_id: "case-1" }] });
    const repo = await repoWith(f);
    await repo.correctInvoiceOcr("case-1", "inv-1", { outstandingBalance: 2_500_000 }, ACTOR);
    const patch = f.rpcCalls.find((c) => c.fn === "correct_invoice_row")!.args.p_case as { status: string; activatedAt: string | null };
    expect(patch.status).toBe("active");
    expect(patch.activatedAt).toBeTruthy();
  });

  it("a corrected due date is what the age gate sees (a young corrected date keeps the case gated)", async () => {
    const f = fake({ status: "correction_required", audit: [{ action: "case.client_certified", entity_id: "case-1" }] });
    const repo = await repoWith(f);
    await repo.correctInvoiceOcr("case-1", "inv-1", { dueDate: "2026-09-10" }, ACTOR);
    const patch = f.rpcCalls.find((c) => c.fn === "correct_invoice_row")!.args.p_case as { status: string; blocker: string };
    expect(patch.status).toBe("under_validation");
    expect(patch.blocker).toMatch(/60-day age gate/);
  });

  it("recording client certification on an under_validation case (staff already validated) activates through apply_case_mutation, audited with the reason", async () => {
    const f = fake({ status: "under_validation", audit: [{ action: "ocr.corrected", entity_id: "inv-1" }] });
    const repo = await repoWith(f);
    const out = await repo.recordActivationGate("case-1", "client_certification", "Certified by email", ACTOR);
    const call = f.rpcCalls.find((c) => c.fn === "apply_case_mutation")!;
    expect(call.args.p_action).toBe("case.client_certified");
    expect(call.args.p_entity).toBe("recovery_case");
    expect(String(call.args.p_reason)).toContain("Certified by email");
    expect(call.args.p_expected_actor_id).toBe(ACTOR.actorId);
    expect((call.args.p_case as { status: string }).status).toBe("active");
    expect(out.activated).toBe(true);
  });

  it("certification on a case still awaiting correction only records evidence: the case patch is unchanged", async () => {
    const f = fake({ status: "correction_required" });
    const repo = await repoWith(f);
    const out = await repo.recordActivationGate("case-1", "client_certification", "Certified early", ACTOR);
    expect((f.rpcCalls.find((c) => c.fn === "apply_case_mutation")!.args.p_case as { status: string }).status).toBe("correction_required");
    expect(out.activated).toBe(false);
  });

  it("refuses an empty reason, an already-activated case, and staff validation of a case awaiting correction -- without calling any RPC", async () => {
    const f1 = fake({ status: "correction_required" });
    const r1 = await repoWith(f1);
    await expect(r1.recordActivationGate("case-1", "client_certification", "  ", ACTOR)).rejects.toThrow(/reason is required/);
    await expect(r1.recordActivationGate("case-1", "staff_validation", "x", ACTOR)).rejects.toThrow(/confirming the corrected invoice fields/);
    expect(f1.rpcCalls).toHaveLength(0);

    vi.resetModules();
    const f2 = fake({ status: "active" });
    const r2 = await repoWith(f2);
    await expect(r2.recordActivationGate("case-1", "client_certification", "x", ACTOR)).rejects.toThrow(/already "active"/);
    expect(f2.rpcCalls).toHaveLength(0);
  });
});
