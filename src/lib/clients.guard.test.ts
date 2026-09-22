/**
 * Covers isAdminForRender (clients.functions.ts, M1 Batch 1) -- the
 * render-only admin check shared by /clients and /clients/new. Plain
 * function, no createServerFn wrapper, so no Start runtime needed.
 */
import { describe, expect, it } from "vitest";
import { isAdminForRender } from "./clients.functions";
import type { AuthContext } from "@/lib/auth/types";

const staffActor: AuthContext = {
  kind: "staff",
  userId: "s1",
  role: "staff",
  email: "uat-staff@nklodha.in",
  displayName: "UAT Staff",
  demo: false,
};

const adminActor: AuthContext = { ...staffActor, role: "admin", displayName: "UAT Admin" };

const clientActor: AuthContext = {
  kind: "client",
  userId: "u1",
  organisationId: "org-1",
  organisationIds: ["org-1"],
  displayName: "Test Client",
  demo: false,
};

describe("isAdminForRender", () => {
  it("treats a missing session (dev-only demo fallback) as admin", () => {
    expect(isAdminForRender(null)).toBe(true);
  });

  it("is true for an admin staff actor", () => {
    expect(isAdminForRender(adminActor)).toBe(true);
  });

  it("is false for a plain staff actor", () => {
    expect(isAdminForRender(staffActor)).toBe(false);
  });

  it("is false for a client actor", () => {
    expect(isAdminForRender(clientActor)).toBe(false);
  });
});
