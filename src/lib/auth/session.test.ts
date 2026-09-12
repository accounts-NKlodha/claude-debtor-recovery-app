/**
 * Exercises the REAL session-resolution chain (getAuthContext ->
 * requireStaffContext/requireClientContext -> actorAttribution) end to end,
 * with only the Supabase client construction faked out -- everything else
 * (src/lib/auth/session.ts, src/lib/auth/context.ts) runs unmodified. This
 * is the closest thing to a live-session test available without a
 * provisioned Supabase project (see P0-1/P0-2-R1 §7 -- not a substitute for
 * real RLS/OAuth verification against a live project).
 *
 * src/lib/auth/context.test.ts already covers the pure authorization logic
 * in isolation; this file proves the same guarantees hold through the real
 * request-resolution glue, and is what any future client-invokable mutation
 * must rely on via authorizeClientMutation()/authorizeStaffMutation().
 */
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { ForbiddenError, UnauthenticatedError } from "./types";

// The real `server-only` package unconditionally throws when required
// directly (its actual client/server split is a webpack aliasing trick that
// doesn't apply under Vitest) -- stub it so importing the real session.ts is
// possible at all, matching how this module already resolves at build time.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

function thenableResult(data: unknown) {
  const promise = Promise.resolve({ data, error: null });
  (promise as { maybeSingle?: () => Promise<{ data: unknown; error: null }> }).maybeSingle = () =>
    Promise.resolve({ data, error: null });
  return promise;
}

function buildFakeSupabase(opts: {
  user: { id: string } | null;
  appUser?: { role: string; email: string | null; display_name: string } | null;
  memberships?: { organisation_id: string }[];
}) {
  return {
    auth: { getUser: async () => ({ data: { user: opts.user }, error: null }) },
    from(table: string) {
      return {
        select: () => ({
          eq: () => {
            if (table === "app_users") return thenableResult(opts.appUser ?? null);
            if (table === "user_organisations") return thenableResult(opts.memberships ?? []);
            throw new Error(`buildFakeSupabase: unexpected table "${table}"`);
          },
        }),
      };
    },
  };
}

async function mockedCreateClient() {
  const { createClient } = await import("@/lib/supabase/server");
  return createClient as unknown as Mock;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getAuthContext / requireClientSession (real chain, faked Supabase client)", () => {
  it("resolves a real client session scoped to exactly the organisation(s) they belong to", async () => {
    const createClient = await mockedCreateClient();
    createClient.mockResolvedValue(
      buildFakeSupabase({
        user: { id: "user-client-a" },
        appUser: { role: "client", email: "a@example.com", display_name: "Client A" },
        memberships: [{ organisation_id: "org-a" }],
      }),
    );

    const { requireClientSession } = await import("./session");
    const actor = await requireClientSession("org-a");
    expect(actor.organisationId).toBe("org-a");
    expect(actor.userId).toBe("user-client-a");
  });

  it("tenant A cannot mutate tenant B's record: a client session scoped to org-a is rejected for org-b", async () => {
    const createClient = await mockedCreateClient();
    createClient.mockResolvedValue(
      buildFakeSupabase({
        user: { id: "user-client-a" },
        appUser: { role: "client", email: null, display_name: "Client A" },
        memberships: [{ organisation_id: "org-a" }],
      }),
    );

    const { requireClientSession } = await import("./session");
    await expect(requireClientSession("org-b")).rejects.toThrow(ForbiddenError);
  });

  it("a browser-supplied organisation id cannot redirect a mutation: authorizeClientMutation(<attacker-supplied org>) is rejected even though the real session is valid for a different org", async () => {
    const createClient = await mockedCreateClient();
    createClient.mockResolvedValue(
      buildFakeSupabase({
        user: { id: "user-client-a" },
        appUser: { role: "client", email: null, display_name: "Client A" },
        memberships: [{ organisation_id: "org-a" }],
      }),
    );

    const { authorizeClientMutation } = await import("./session");
    await expect(authorizeClientMutation("org-b-supplied-by-browser")).rejects.toThrow(ForbiddenError);
    // The legitimate org still resolves fine -- this proves the rejection
    // above is the tenant check working, not a broken session.
    const actor = await authorizeClientMutation("org-a");
    expect(actor.actorId).toBe("user-client-a");
    expect(actor.actorRole).toBe("client");
  });

  it("a staff session is rejected by requireClientSession regardless of which org is requested (wrong actor type)", async () => {
    const createClient = await mockedCreateClient();
    createClient.mockResolvedValue(
      buildFakeSupabase({
        user: { id: "user-staff-1" },
        appUser: { role: "staff", email: "s@nklodha.in", display_name: "Staff One" },
      }),
    );

    const { requireClientSession } = await import("./session");
    await expect(requireClientSession("org-a")).rejects.toThrow(ForbiddenError);
  });

  it("an unauthenticated request (no Supabase user) is rejected, not silently treated as any org", async () => {
    const createClient = await mockedCreateClient();
    createClient.mockResolvedValue(buildFakeSupabase({ user: null }));

    const { requireClientSession, authorizeClientMutation } = await import("./session");
    await expect(requireClientSession("org-a")).rejects.toThrow(UnauthenticatedError);
    await expect(authorizeClientMutation("org-a")).rejects.toThrow(UnauthenticatedError);
  });
});

describe("authorizeStaffMutation (real chain): production cannot silently fall back to demo identity", () => {
  it("throws in production when there is no real session -- it does not return a demo actor", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const createClient = await mockedCreateClient();
    createClient.mockResolvedValue(buildFakeSupabase({ user: null }));

    const { authorizeStaffMutation } = await import("./session");
    await expect(authorizeStaffMutation()).rejects.toThrow(UnauthenticatedError);
  });

  it("also fails closed in production when createClient() itself throws (missing Supabase env config)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const createClient = await mockedCreateClient();
    createClient.mockRejectedValue(new Error("Missing NEXT_PUBLIC_SUPABASE_URL"));

    const { authorizeStaffMutation } = await import("./session");
    await expect(authorizeStaffMutation()).rejects.toThrow(UnauthenticatedError);
  });

  it("returns a demo actor outside production when there is no real session (existing, intentional demo behaviour)", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const createClient = await mockedCreateClient();
    createClient.mockResolvedValue(buildFakeSupabase({ user: null }));

    const { authorizeStaffMutation } = await import("./session");
    const actor = await authorizeStaffMutation();
    expect(actor.actorId).toBe("demo-staff");
  });

  it("resolves the real actor id/role when a real staff session exists, even in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const createClient = await mockedCreateClient();
    createClient.mockResolvedValue(
      buildFakeSupabase({
        user: { id: "user-staff-real" },
        appUser: { role: "admin", email: "admin@nklodha.in", display_name: "Real Admin" },
      }),
    );

    const { authorizeStaffMutation } = await import("./session");
    const actor = await authorizeStaffMutation();
    expect(actor.actorId).toBe("user-staff-real");
    expect(actor.actorRole).toBe("admin");
  });
});
