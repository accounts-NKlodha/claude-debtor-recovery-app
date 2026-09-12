/**
 * Pure authorization logic (P0-1 / P0-2 foundation). Deliberately has no
 * dependency on Next.js request objects, cookies, or the Supabase client --
 * everything here is plain data in, throw-or-return out, so it can be unit
 * tested without a browser, a database, or a running server (see
 * context.test.ts). src/lib/auth/session.ts is the thin glue layer that
 * resolves a real request into the inputs these functions take.
 */

import { ForbiddenError, UnauthenticatedError, type AuthContext } from "./types";

/**
 * Raw shape available after verifying a Supabase session (`auth.getUser()`)
 * and loading the matching `app_users` row + `user_organisations` rows.
 * `null` fields mean "authenticated with Supabase but not provisioned as an
 * app user" -- still unauthenticated as far as this app is concerned.
 */
export interface RawIdentity {
  userId: string;
  appUser: {
    role: "staff" | "admin" | "client";
    email: string | null;
    displayName: string;
  } | null;
  organisationIds: string[];
  /** The organisation a client identity most recently selected server-side
   * (e.g. via a prior authenticated "select organisation" action), if any. */
  selectedOrganisationId: string | null;
}

/**
 * Turn a raw, verified identity into the canonical AuthContext, or `null` if
 * it doesn't resolve to a usable app actor. Never throws -- callers decide
 * whether `null` is fatal (see requireStaffSession/requireClientSession).
 */
export function resolveAuthContext(raw: RawIdentity | null): AuthContext | null {
  if (!raw || !raw.appUser) return null;

  if (raw.appUser.role === "staff" || raw.appUser.role === "admin") {
    return {
      kind: "staff",
      userId: raw.userId,
      role: raw.appUser.role,
      email: raw.appUser.email,
      displayName: raw.appUser.displayName,
      demo: false,
    };
  }

  // client
  if (raw.organisationIds.length === 0) return null; // not a member of anything -- unusable
  const organisationId =
    raw.selectedOrganisationId && raw.organisationIds.includes(raw.selectedOrganisationId)
      ? raw.selectedOrganisationId
      : raw.organisationIds[0];
  return {
    kind: "client",
    userId: raw.userId,
    organisationId,
    organisationIds: raw.organisationIds,
    displayName: raw.appUser.displayName,
    demo: false,
  };
}

/** The only place a "no real session" fallback may be constructed, and only
 * when the caller has already confirmed this is not a production runtime. */
export function demoStaffContext(): Extract<AuthContext, { kind: "staff" }> {
  return {
    kind: "staff",
    userId: "demo-staff",
    role: "staff",
    email: null,
    displayName: "Demo Staff (unauthenticated)",
    demo: true,
  };
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Require a staff/admin actor. In production with no real session, this
 * always throws (P0-1 requirements 6/7) -- there is no demo fallback here.
 * Outside production, a missing session resolves to a clearly-labelled demo
 * actor (P0-1 requirement 8) so the rest of the app keeps working without
 * live Google OAuth credentials.
 */
export function requireStaffContext(actor: AuthContext | null): Extract<AuthContext, { kind: "staff" }> {
  if (!actor) {
    if (!isProduction()) return demoStaffContext();
    throw new UnauthenticatedError();
  }
  if (actor.kind !== "staff") {
    throw new ForbiddenError("Staff/admin session required");
  }
  return actor;
}

export function requireAdminContext(actor: AuthContext | null): Extract<AuthContext, { kind: "staff" }> {
  const staff = requireStaffContext(actor);
  if (staff.role !== "admin" && !staff.demo) {
    throw new ForbiddenError("Admin session required");
  }
  return staff;
}

/** Require a client actor scoped to exactly `organisationId`. No demo
 * fallback: there is no honest way to guess which organisation a browser
 * request "should" belong to, in production or otherwise. */
export function requireClientContext(
  actor: AuthContext | null,
  organisationId: string,
): Extract<AuthContext, { kind: "client" }> {
  if (!actor) throw new UnauthenticatedError();
  if (actor.kind !== "client") throw new ForbiddenError("Client session required");
  if (actor.organisationId !== organisationId) {
    throw new ForbiddenError("Session is not scoped to the requested organisation");
  }
  return actor;
}

/**
 * P0-2 requirement 3: a browser-supplied organisation id must never override
 * the authenticated tenant context. Staff/admin have broad cross-org access
 * by design (PRD §4); a client actor may only ever act for their own
 * session-selected organisation.
 */
export function assertOwnsOrganisation(actor: AuthContext, organisationId: string): void {
  if (actor.kind === "staff") return;
  if (actor.organisationId !== organisationId) {
    throw new ForbiddenError(
      `Cross-tenant access denied: session is scoped to organisation ${actor.organisationId}, ` +
        `not ${organisationId}`,
    );
  }
}

/** For audit attribution (P0-2 requirement 10): derive actor id/role from
 * the authenticated context, never from a caller-supplied value. */
export function actorAttribution(actor: AuthContext): { actorId: string; actorRole: string } {
  return {
    actorId: actor.userId,
    actorRole: actor.kind === "staff" ? actor.role : "client",
  };
}
