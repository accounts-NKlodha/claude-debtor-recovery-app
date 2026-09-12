import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  actorAttribution,
  assertOwnsOrganisation,
  demoStaffContext,
  isProduction,
  requireAdminContext,
  requireClientContext,
  requireStaffContext,
  resolveAuthContext,
  type RawIdentity,
} from "./context";
import { ForbiddenError, UnauthenticatedError, type AuthContext } from "./types";

const ORG_A = "org-a";
const ORG_B = "org-b";

function clientActor(organisationId: string): AuthContext {
  return {
    kind: "client",
    userId: "user-1",
    organisationId,
    organisationIds: [organisationId],
    displayName: "Test Client",
    demo: false,
  };
}

function staffActor(): AuthContext {
  return {
    kind: "staff",
    userId: "staff-1",
    role: "staff",
    email: "staff@example.com",
    displayName: "Test Staff",
    demo: false,
  };
}

describe("resolveAuthContext (P0-1: canonical actor derivation)", () => {
  it("returns null for a null/unprovisioned raw identity -- no actor, no access", () => {
    expect(resolveAuthContext(null)).toBeNull();
    expect(resolveAuthContext({ userId: "x", appUser: null, organisationIds: [], selectedOrganisationId: null })).toBeNull();
  });

  it("returns null for a client with no organisation memberships", () => {
    const raw: RawIdentity = {
      userId: "u1",
      appUser: { role: "client", email: null, displayName: "No Org" },
      organisationIds: [],
      selectedOrganisationId: null,
    };
    expect(resolveAuthContext(raw)).toBeNull();
  });

  it("never lets a client's selectedOrganisationId escape their actual memberships", () => {
    const raw: RawIdentity = {
      userId: "u1",
      appUser: { role: "client", email: null, displayName: "Client" },
      organisationIds: [ORG_A],
      selectedOrganisationId: ORG_B, // not a member of ORG_B
    };
    const actor = resolveAuthContext(raw);
    expect(actor?.kind).toBe("client");
    expect((actor as Extract<AuthContext, { kind: "client" }>).organisationId).toBe(ORG_A);
  });
});

describe("fail-closed: unauthenticated / invalid actor rejected", () => {
  const originalEnv = process.env.NODE_ENV;
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });
  afterEach(() => {
    vi.stubEnv("NODE_ENV", originalEnv ?? "test");
  });

  it("requireStaffContext throws UnauthenticatedError for a null actor in production", () => {
    expect(isProduction()).toBe(true);
    expect(() => requireStaffContext(null)).toThrow(UnauthenticatedError);
  });

  it("requireClientContext throws UnauthenticatedError for a null actor", () => {
    expect(() => requireClientContext(null, ORG_A)).toThrow(UnauthenticatedError);
  });

  it("requireStaffContext rejects a client actor (wrong actor kind)", () => {
    expect(() => requireStaffContext(clientActor(ORG_A))).toThrow(ForbiddenError);
  });

  it("requireClientContext rejects a staff actor (wrong actor kind)", () => {
    expect(() => requireClientContext(staffActor(), ORG_A)).toThrow(ForbiddenError);
  });
});

describe("tenant isolation: cross-tenant access denied (P0-2)", () => {
  it("assertOwnsOrganisation throws when a client actor targets another tenant's data", () => {
    const actor = clientActor(ORG_A);
    expect(() => assertOwnsOrganisation(actor, ORG_B)).toThrow(ForbiddenError);
  });

  it("assertOwnsOrganisation passes for a client actor's own tenant", () => {
    const actor = clientActor(ORG_A);
    expect(() => assertOwnsOrganisation(actor, ORG_A)).not.toThrow();
  });

  it("requireClientContext throws when the requested organisationId != the session's tenant (covers read/update/delete callers alike, since they all gate through this)", () => {
    const actor = clientActor(ORG_A);
    expect(() => requireClientContext(actor, ORG_B)).toThrow(ForbiddenError);
  });

  it("a client-supplied/browser-supplied tenant id cannot override the authenticated session's tenant", () => {
    // Simulates a request handler receiving organisationId=ORG_B from a form
    // field/query param while the session is actually scoped to ORG_A.
    const sessionActor = clientActor(ORG_A);
    const browserSuppliedOrgId = ORG_B;
    expect(() => assertOwnsOrganisation(sessionActor, browserSuppliedOrgId)).toThrow(ForbiddenError);
  });

  it("staff actors are exempt from single-tenant scoping by design (cross-org access is their role)", () => {
    expect(() => assertOwnsOrganisation(staffActor(), ORG_A)).not.toThrow();
    expect(() => assertOwnsOrganisation(staffActor(), ORG_B)).not.toThrow();
  });
});

describe("audit attribution cannot be forged by a client-supplied actor id (P0-2 requirement 10)", () => {
  it("actorAttribution always derives from the authenticated context, not any external input", () => {
    const actor = clientActor(ORG_A);
    const attribution = actorAttribution(actor);
    expect(attribution.actorId).toBe(actor.userId);
    expect(attribution.actorId).not.toBe("attacker-forged-id");
  });

  it("staff attribution reports their real role, not a caller-supplied one", () => {
    const attribution = actorAttribution(staffActor());
    expect(attribution.actorRole).toBe("staff");
  });
});

describe("demo fallback cannot activate in production (P0-1 requirements 6-8)", () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    vi.stubEnv("NODE_ENV", originalEnv ?? "test");
  });

  it("requireStaffContext(null) throws in production instead of returning a demo actor", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => requireStaffContext(null)).toThrow(UnauthenticatedError);
  });

  it("requireStaffContext(null) returns a clearly-labelled demo actor outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    const actor = requireStaffContext(null);
    expect(actor.demo).toBe(true);
    expect(actor.kind).toBe("staff");
  });

  it("requireClientContext never has a demo fallback, in any environment", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(() => requireClientContext(null, ORG_A)).toThrow(UnauthenticatedError);
    vi.stubEnv("NODE_ENV", "production");
    expect(() => requireClientContext(null, ORG_A)).toThrow(UnauthenticatedError);
  });

  it("demoStaffContext() output is always explicitly marked demo:true -- never indistinguishable from a real session", () => {
    expect(demoStaffContext().demo).toBe(true);
  });
});

describe("admin escalation requires an actual admin role (or explicit demo), not just any staff session", () => {
  it("a non-admin staff actor is rejected by requireAdminContext", () => {
    expect(() => requireAdminContext(staffActor())).toThrow(ForbiddenError);
  });

  it("an admin staff actor passes requireAdminContext", () => {
    const admin: AuthContext = { ...(staffActor() as Extract<AuthContext, { kind: "staff" }>), role: "admin" };
    expect(requireAdminContext(admin).role).toBe("admin");
  });
});
