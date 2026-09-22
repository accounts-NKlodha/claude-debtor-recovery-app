/**
 * Covers the two things that are new/TanStack-specific in the M0-R1
 * vertical slice: getInternalShellData's redirect decision and data
 * assembly (tanstack-shell.functions.ts). The underlying role/authorization
 * logic (resolveAuthContext etc.) is reused unmodified from ./context.ts
 * and already covered by context.test.ts -- not re-tested here.
 *
 * decideShellRedirect/resolveInternalShellData are plain functions with no
 * createServerFn wrapper, so they run in ordinary vitest with no Start
 * runtime context and no module mocking (createServerFn's wrapper itself
 * requires an AsyncLocalStorage-backed context that only exists inside a
 * real request -- see the doc comment on decideShellRedirect for why the
 * decision logic is factored out like this).
 */
import { describe, expect, it, vi } from "vitest";
import { decideShellRedirect, resolveInternalShellData } from "./tanstack-shell.functions";
import type { AuthContext } from "./types";

function fakeRepo(overrides: Partial<Record<string, unknown[]>> = {}) {
  return {
    listOrganisations: vi.fn(async () => overrides.organisations ?? []),
    listAllCases: vi.fn(async () => overrides.cases ?? []),
    listAllCommunications: vi.fn(async () => overrides.comms ?? []),
    listAllPayments: vi.fn(async () => overrides.payments ?? []),
    openTasks: vi.fn(async () => overrides.tasks ?? []),
  } as unknown as Parameters<typeof resolveInternalShellData>[1];
}

const clientActor: AuthContext = {
  kind: "client",
  userId: "u1",
  organisationId: "org-1",
  organisationIds: ["org-1"],
  displayName: "Test Client",
  demo: false,
};

const staffActor: AuthContext = {
  kind: "staff",
  userId: "s1",
  role: "admin",
  email: "uat-admin@nklodha.in",
  displayName: "UAT Admin",
  demo: false,
};

describe("decideShellRedirect", () => {
  it("redirects a client actor to /client in every environment", () => {
    expect(decideShellRedirect(clientActor, true)).toEqual({ kind: "redirect", to: "/client" });
    expect(decideShellRedirect(clientActor, false)).toEqual({ kind: "redirect", to: "/client" });
  });

  it("redirects a missing session to /sign-in only in production", () => {
    expect(decideShellRedirect(null, true)).toEqual({ kind: "redirect", to: "/sign-in" });
    expect(decideShellRedirect(null, false)).toBeNull();
  });

  it("lets a staff/admin actor through in every environment", () => {
    expect(decideShellRedirect(staffActor, true)).toBeNull();
    expect(decideShellRedirect(staffActor, false)).toBeNull();
  });
});

describe("resolveInternalShellData", () => {
  it("falls back to demo staff when there is no actor (dev-only path, gated by decideShellRedirect)", async () => {
    const result = await resolveInternalShellData(null, fakeRepo());
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.user).toEqual({ displayName: "Staff (demo)", email: null, role: "staff" });
    }
  });

  it("returns the real identity for a staff/admin actor", async () => {
    const result = await resolveInternalShellData(staffActor, fakeRepo());
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.user).toEqual({ displayName: "UAT Admin", email: "uat-admin@nklodha.in", role: "admin" });
    }
  });

  it("derives sidebar counts from the repository data", async () => {
    const repo = fakeRepo({
      cases: [{ status: "received" }, { status: "hearing_scheduled" }],
      tasks: [{}, {}, {}],
    });
    const result = await resolveInternalShellData(staffActor, repo);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.counts["/today"]).toBe(3);
      expect(result.counts["/intake"]).toBe(1);
      expect(result.counts["/msme"]).toBe(1);
    }
  });
});
