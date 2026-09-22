/**
 * Covers decideLandingRedirect (root-landing.functions.ts, M1 Batch 1).
 * Plain function, no createServerFn wrapper, so no Start runtime needed.
 */
import { describe, expect, it } from "vitest";
import { decideLandingRedirect } from "./root-landing.functions";
import type { AuthContext } from "@/lib/auth/types";

const staffActor: AuthContext = {
  kind: "staff",
  userId: "s1",
  role: "staff",
  email: "uat-staff@nklodha.in",
  displayName: "UAT Staff",
  demo: false,
};

const clientActor: AuthContext = {
  kind: "client",
  userId: "u1",
  organisationId: "org-1",
  organisationIds: ["org-1"],
  displayName: "Test Client",
  demo: false,
};

describe("decideLandingRedirect", () => {
  it("sends a missing session to /sign-in in production", () => {
    expect(decideLandingRedirect(null, true)).toBe("/sign-in");
  });

  it("sends a missing session to /dashboard outside production (demo fallback)", () => {
    expect(decideLandingRedirect(null, false)).toBe("/dashboard");
  });

  it("sends a staff/admin actor to /dashboard", () => {
    expect(decideLandingRedirect(staffActor, true)).toBe("/dashboard");
    expect(decideLandingRedirect(staffActor, false)).toBe("/dashboard");
  });

  it("sends a client actor to /client", () => {
    expect(decideLandingRedirect(clientActor, true)).toBe("/client");
    expect(decideLandingRedirect(clientActor, false)).toBe("/client");
  });
});
