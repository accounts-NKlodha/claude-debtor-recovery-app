/**
 * Covers the client-portal guard's redirect decision and data assembly
 * (tanstack-client-shell.functions.ts, M1 Batch 1) -- the client-surface
 * counterpart of tanstack-shell.guard.test.ts. Same reasoning: plain
 * functions with no createServerFn wrapper, so they run in ordinary vitest
 * with no Start runtime context and no module mocking.
 */
import { describe, expect, it } from "vitest";
import { decideClientShellRedirect, resolveClientShellData } from "./tanstack-client-shell.functions";
import type { AuthContext } from "./types";
import type { Organisation } from "@/contract/types";

function fakeOrg(id: string): Organisation {
  return { id, clientCode: `CODE-${id}`, legalEntityName: `Org ${id}` } as Organisation;
}

function fakeRepo(orgsById: Record<string, Organisation | undefined>, allOrgs: Organisation[]) {
  return {
    getOrg: async (id: string) => orgsById[id],
    listOrganisations: async () => allOrgs,
  } as unknown as Parameters<typeof resolveClientShellData>[1];
}

const clientActor: AuthContext = {
  kind: "client",
  userId: "u1",
  organisationId: "org-1",
  organisationIds: ["org-1", "org-2"],
  displayName: "Test Client",
  demo: false,
};

const staffActor: AuthContext = {
  kind: "staff",
  userId: "s1",
  role: "staff",
  email: "uat-staff@nklodha.in",
  displayName: "UAT Staff",
  demo: false,
};

describe("decideClientShellRedirect", () => {
  it("redirects a staff/admin actor to /dashboard in every environment", () => {
    expect(decideClientShellRedirect(staffActor, true)).toEqual({ kind: "redirect", to: "/dashboard" });
    expect(decideClientShellRedirect(staffActor, false)).toEqual({ kind: "redirect", to: "/dashboard" });
  });

  it("redirects a missing session to /sign-in only in production", () => {
    expect(decideClientShellRedirect(null, true)).toEqual({ kind: "redirect", to: "/sign-in" });
    expect(decideClientShellRedirect(null, false)).toBeNull();
  });

  it("lets a client actor through in every environment", () => {
    expect(decideClientShellRedirect(clientActor, true)).toBeNull();
    expect(decideClientShellRedirect(clientActor, false)).toBeNull();
  });
});

describe("resolveClientShellData", () => {
  it("scopes organisations to the client's own memberships (least privilege)", async () => {
    const org1 = fakeOrg("org-1");
    const org2 = fakeOrg("org-2");
    const repo = fakeRepo({ "org-1": org1, "org-2": org2 }, [org1, org2, fakeOrg("org-3")]);

    const result = await resolveClientShellData(clientActor, repo);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.organisations.map((o) => o.id)).toEqual(["org-1", "org-2"]);
      expect(result.user).toEqual({ displayName: "Test Client", email: null, role: "client" });
    }
  });

  it("falls back to the full organisation list for a missing session (dev-only path)", async () => {
    const all = [fakeOrg("org-1"), fakeOrg("org-2")];
    const repo = fakeRepo({}, all);

    const result = await resolveClientShellData(null, repo);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.organisations).toEqual(all);
      expect(result.user).toEqual({ displayName: "Client (demo)", email: null, role: "client" });
    }
  });
});
