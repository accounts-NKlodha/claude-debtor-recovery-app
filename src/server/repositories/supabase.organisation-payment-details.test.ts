/**
 * SupabaseRepository.updateOrganisationPaymentDetails goes through the
 * admin-only update_organisation_payment_details RPC (0022), passing the
 * authenticated actor's id as p_expected_actor_id -- never any field from the
 * input payload -- and maps the returned row (including the new columns).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MutationActor } from "@/lib/auth/types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const ADMIN: MutationActor = { actorId: "admin-actor-1", actorRole: "admin" };

const ORG_ROW = {
  id: "org-1",
  client_code: "ORG1",
  legal_entity_name: "Acme Textiles",
  creditor_gstin: null,
  udyam_number: null,
  jito_member: false,
  is_firm: false,
  upi_id: "acme@okaxis",
  upi_payee_name: "Acme Textiles Payee",
  created_at: "2026-01-01T00:00:00Z",
};

afterEach(() => {
  vi.resetModules();
});

async function repoWith(rpcResponse: { data?: unknown; error?: { message: string } | null }) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc: vi.fn((fn: string, args: unknown) => {
      rpcCalls.push({ fn, args: args as Record<string, unknown> });
      return Promise.resolve(rpcResponse);
    }),
  };
  const { createClient } = await import("@/lib/supabase/server");
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  const { SupabaseRepository } = await import("./supabase");
  return { repo: new SupabaseRepository(), rpcCalls };
}

describe("SupabaseRepository.updateOrganisationPaymentDetails", () => {
  it("calls update_organisation_payment_details with the actor's id as p_expected_actor_id and maps the new columns", async () => {
    const { repo, rpcCalls } = await repoWith({ data: ORG_ROW, error: null });
    const org = await repo.updateOrganisationPaymentDetails(
      "org-1",
      { upiId: "acme@okaxis", upiPayeeName: "Acme Textiles Payee", reason: "Confirmed with client" },
      ADMIN,
    );

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("update_organisation_payment_details");
    expect(rpcCalls[0].args).toEqual({
      p_organisation_id: "org-1",
      p_upi_id: "acme@okaxis",
      p_upi_payee_name: "Acme Textiles Payee",
      p_reason: "Confirmed with client",
      p_expected_actor_id: "admin-actor-1",
    });
    expect(org).toMatchObject({ id: "org-1", upiId: "acme@okaxis", upiPayeeName: "Acme Textiles Payee" });
  });

  it("passes null/null through to clear the details", async () => {
    const { repo, rpcCalls } = await repoWith({ data: { ...ORG_ROW, upi_id: null, upi_payee_name: null }, error: null });
    const org = await repo.updateOrganisationPaymentDetails("org-1", { upiId: null, upiPayeeName: null, reason: "Client changed bank" }, ADMIN);
    expect(rpcCalls[0].args).toMatchObject({ p_upi_id: null, p_upi_payee_name: null });
    expect(org.upiId).toBeNull();
  });

  it("surfaces a database-side rejection (e.g. non-admin session) as an error rather than swallowing it", async () => {
    const { repo } = await repoWith({ data: null, error: { message: "update_organisation_payment_details: admin session required" } });
    await expect(
      repo.updateOrganisationPaymentDetails("org-1", { upiId: "a@bank", upiPayeeName: "Aa", reason: "test reason" }, ADMIN),
    ).rejects.toThrow(/admin session required/);
  });
});
