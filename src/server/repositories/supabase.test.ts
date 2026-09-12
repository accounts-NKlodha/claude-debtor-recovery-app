/**
 * P0-4 §9: unit-level proof (mocked Supabase client -- no live project
 * exists to test against, see docs/DEPLOYMENT.md) that:
 *  - a MutationActor's identity, never anything from a mutation's own input
 *    payload, is what reaches the database as the expected-actor check;
 *  - a failed RPC/initialization surfaces as a rejected promise, never a
 *    fake success and never a silent fallback to another repository;
 *  - the privileged-writer RPCs (0006_production_write_rpcs.sql) derive
 *    tenant scope from the case/payment row itself, not from a
 *    caller-supplied organisation id, except where creating a brand-new
 *    case genuinely has no existing row to derive it from.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MutationActor } from "@/lib/auth/types";

vi.mock("server-only", () => ({}));

const ACTOR: MutationActor = { actorId: "staff-actor-1", actorRole: "staff" };

/** Minimal fake Supabase client: records every .rpc()/.from() call so tests
 * can assert on exactly what was sent, and lets each test script the
 * response (success or error) per call. */
function buildFakeSupabase(opts: {
  rpcResponses?: Record<string, { data?: unknown; error?: { message: string } | null }>;
  fromResponses?: Record<string, { data?: unknown; error?: { message: string } | null }>;
}) {
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const client = {
    rpc: vi.fn((fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      const response = opts.rpcResponses?.[fn] ?? { data: null, error: null };
      return Promise.resolve(response);
    }),
    from: vi.fn((table: string) => {
      const response = opts.fromResponses?.[table] ?? { data: null, error: null };
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

async function mockedCreateClient() {
  const { createClient } = await import("@/lib/supabase/server");
  return createClient as unknown as ReturnType<typeof vi.fn>;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

describe("SupabaseRepository: MutationActor reaches the database, never the input payload", () => {
  it("recordPayment sends the actor's id as p_expected_actor_id, not any field from `input`", async () => {
    const { client, rpcCalls } = buildFakeSupabase({
      rpcResponses: {
        record_payment_row: {
          data: {
            id: "pay-1",
            organisation_id: "org-1",
            case_id: "case-1",
            kind: "bank",
            amount: 1000,
            received_on: "2026-01-01",
            reference: null,
            client_confirmed: false,
            created_at: "2026-01-01T00:00:00Z",
          },
          error: null,
        },
      },
    });
    const createClient = await mockedCreateClient();
    createClient.mockResolvedValue(client);

    const { SupabaseRepository } = await import("./supabase");
    const repo = new SupabaseRepository();
    await repo.recordPayment(
      { caseId: "case-1", kind: "bank", amount: 1000, reference: null, clientConfirmed: false },
      ACTOR,
    );

    const call = rpcCalls.find((c) => c.fn === "record_payment_row");
    expect(call).toBeDefined();
    const args = call!.args as Record<string, unknown>;
    expect(args.p_expected_actor_id).toBe(ACTOR.actorId);
    // The raw mutation input has no actor-shaped field at all -- nothing in
    // `args` could have come from anywhere but the ACTOR parameter.
    expect(Object.keys(args)).not.toContain("actorId");
  });

  it("setAutomationState sends the actor's id as p_expected_actor_id", async () => {
    const { client, rpcCalls } = buildFakeSupabase({
      rpcResponses: { set_automation_state: { data: { enabled: false }, error: null } },
    });
    const createClient = await mockedCreateClient();
    createClient.mockResolvedValue(client);

    const { SupabaseRepository } = await import("./supabase");
    const repo = new SupabaseRepository();
    await repo.setAutomationState(false, "test", ACTOR);

    const call = rpcCalls.find((c) => c.fn === "set_automation_state");
    const args = call!.args as Record<string, unknown>;
    expect(args.p_expected_actor_id).toBe(ACTOR.actorId);
  });

  it("createOrganisation sends the actor's id as p_expected_actor_id, and INSERT+audit happen in one atomic RPC call (not two sequential requests)", async () => {
    const { client, rpcCalls } = buildFakeSupabase({
      rpcResponses: {
        create_organisation: {
          data: {
            id: "org-1",
            client_code: "NKL-X",
            legal_entity_name: "X Pvt Ltd",
            creditor_gstin: null,
            udyam_number: null,
            jito_member: false,
            created_at: "2026-01-01T00:00:00Z",
          },
          error: null,
        },
      },
      fromResponses: {
        organisations: { data: null, error: null }, // duplicate pre-checks: none found
      },
    });
    const createClient = await mockedCreateClient();
    createClient.mockResolvedValue(client);

    const { SupabaseRepository } = await import("./supabase");
    const repo = new SupabaseRepository();
    const result = await repo.createOrganisation(
      {
        clientCode: "NKL-X",
        legalEntityName: "X Pvt Ltd",
        creditorGstin: null,
        udyamNumber: null,
        jitoMember: false,
        confirmDuplicateName: false,
        duplicateOverrideReason: null,
      },
      ACTOR,
    );

    expect(result.status).toBe("created");
    const rpcNames = rpcCalls.map((c) => c.fn);
    // Exactly one write RPC -- confirms this is the atomic create_organisation
    // call, not a separate insert followed by a separate audit RPC.
    expect(rpcNames.filter((n) => n === "create_organisation")).toHaveLength(1);
    expect(rpcNames).not.toContain("record_audit_event");
    const call = rpcCalls.find((c) => c.fn === "create_organisation");
    expect((call!.args as Record<string, unknown>).p_expected_actor_id).toBe(ACTOR.actorId);
  });
});

describe("SupabaseRepository: a failed write is a rejected promise, never a fake success", () => {
  it("recordPayment rejects (does not resolve) when the RPC returns an error", async () => {
    const { client } = buildFakeSupabase({
      rpcResponses: { record_payment_row: { data: null, error: { message: "case not found" } } },
    });
    const createClient = await mockedCreateClient();
    createClient.mockResolvedValue(client);

    const { SupabaseRepository } = await import("./supabase");
    const repo = new SupabaseRepository();
    await expect(
      repo.recordPayment(
        { caseId: "missing-case", kind: "bank", amount: 1000, reference: null, clientConfirmed: false },
        ACTOR,
      ),
    ).rejects.toThrow(/case not found/);
  });

  it("a Supabase client-initialization failure surfaces as a rejection, not a silent fallback to another repository", async () => {
    const createClient = await mockedCreateClient();
    createClient.mockRejectedValue(new Error("Missing NEXT_PUBLIC_SUPABASE_URL"));

    const { SupabaseRepository } = await import("./supabase");
    const { MemoryRepository } = await import("./memory");
    const repo = new SupabaseRepository();
    expect(repo).not.toBeInstanceOf(MemoryRepository); // still the class we asked for
    await expect(repo.getAutomationState()).rejects.toThrow(/Missing NEXT_PUBLIC_SUPABASE_URL/);
  });
});

describe("SupabaseRepository: service-role client is not used on any ordinary mutation path", () => {
  it("the repository file never references createAdminClient", () => {
    const source = readFileSync(join(process.cwd(), "src/server/repositories/supabase.ts"), "utf8");
    expect(source).not.toMatch(/createAdminClient/);
  });
});

describe("Privileged write RPCs (0006_production_write_rpcs.sql): tenant scope derived from the row, not a caller-supplied org id", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/0006_production_write_rpcs.sql"),
    "utf8",
  );

  it.each([
    "apply_case_mutation",
    "record_payment_row",
    "apply_payment_confirmation",
    "correct_invoice_row",
  ])("%s derives organisation_id from the existing row, never from a parameter", (fnName) => {
    const fnBody = migration.slice(migration.indexOf(`function ${fnName}(`));
    const nextFnStart = fnBody.indexOf("create or replace function", 1);
    const scoped = nextFnStart === -1 ? fnBody : fnBody.slice(0, nextFnStart);
    expect(scoped).toMatch(/select\s+(case_id,\s*)?organisation_id\s+into\s+v_(org_id|case_id,\s*v_org_id)\s+from/i);
  });

  it("create_case_from_invoice is the one function that takes organisation_id as a parameter (no existing row to derive it from) -- gated by is_staff(), consistent with staff's cross-org design", () => {
    const fnBody = migration.slice(migration.indexOf("function create_case_from_invoice("));
    expect(fnBody).toMatch(/if not is_staff\(\) then/);
  });

  it("create_organisation is admin-only, matching P0-1/P0-2-R2's application-layer decision", () => {
    const fnBody = migration.slice(migration.indexOf("function create_organisation("));
    expect(fnBody).toMatch(/v_actor_role is distinct from 'admin'/);
  });

  it("record_audit_event and every 0006 function have EXECUTE explicitly revoked from PUBLIC (Postgres grants it by default)", () => {
    for (const fn of [
      "record_audit_event",
      "set_automation_state",
      "apply_case_mutation",
      "record_payment_row",
      "apply_payment_confirmation",
      "correct_invoice_row",
      "create_case_from_invoice",
      "create_organisation",
    ]) {
      expect(migration).toMatch(new RegExp(`revoke execute on function ${fn}\\(`));
    }
  });

  it.each([
    "set_automation_state",
    "apply_case_mutation",
    "record_payment_row",
    "apply_payment_confirmation",
    "correct_invoice_row",
    "create_case_from_invoice",
    "create_organisation",
  ])("%s has an explicit authorization check and a caller-identity consistency check", (fnName) => {
    const fnBody = migration.slice(migration.indexOf(`function ${fnName}(`));
    const nextFnStart = fnBody.indexOf("create or replace function", 1);
    const scoped = nextFnStart === -1 ? fnBody : fnBody.slice(0, nextFnStart);
    expect(scoped).toMatch(/auth\.uid\(\) is null/);
    expect(scoped).toMatch(/p_expected_actor_id is not null and p_expected_actor_id is distinct from auth\.uid\(\)/);
  });
});
