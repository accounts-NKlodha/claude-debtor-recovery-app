/**
 * Request-bound glue: resolves the current Supabase session into the
 * canonical AuthContext. This is the ONLY place a server component/action is
 * expected to call to find out who is making the request -- everything else
 * (pages, actions, repositories) takes an AuthContext as a parameter rather
 * than resolving its own.
 *
 * Deliberately thin: all branching/authorization logic lives in
 * src/lib/auth/context.ts (pure, unit-tested). This file's only job is
 * "turn a real request into a RawIdentity".
 */

import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AppUserRow, UserOrganisationRow } from "@/lib/supabase/types";
import {
  demoStaffContext,
  isProduction,
  requireAdminContext,
  requireClientContext,
  requireStaffContext,
  resolveAuthContext,
  type RawIdentity,
} from "./context";
import { UnauthenticatedError, type AuthContext } from "./types";

/**
 * Resolves the authenticated actor for the current request, or `null` if
 * there isn't one. Uses `auth.getUser()` (not `getSession()`) so the
 * identity is revalidated against Supabase Auth on every call rather than
 * trusting an unverified cookie payload.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    // NEXT_PUBLIC_SUPABASE_URL/ANON_KEY not configured -- no session is
    // possible. Production callers still fail closed via requireStaffContext
    // etc. (no session -> UnauthenticatedError); this is not itself a bypass.
    return null;
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return null;

  // Explicit row typing: the hand-written Database type doesn't carry enough
  // generic plumbing for these calls' overload resolution (same limitation
  // noted in src/server/repositories/supabase.ts).
  const appUserRes = await supabase.from("app_users").select("*").eq("id", user.id).maybeSingle();
  const appUser = appUserRes.data as unknown as AppUserRow | null;
  if (!appUser) return null;

  const membershipsRes = await supabase
    .from("user_organisations")
    .select("*")
    .eq("user_id", user.id);
  const memberships = (membershipsRes.data ?? []) as unknown as UserOrganisationRow[];

  const raw: RawIdentity = {
    userId: user.id,
    appUser: { role: appUser.role, email: appUser.email, displayName: appUser.display_name },
    organisationIds: memberships.map((m) => m.organisation_id),
    // TODO(api): source the session-selected organisation from a signed,
    // server-issued session claim once "explicit server-side organisation
    // selection + session rotation" (P0-1 requirement 4) is implemented.
    // Until then a multi-org client identity resolves to its first
    // membership -- single-org clients (the only case exercised so far)
    // are unaffected.
    selectedOrganisationId: null,
  };

  return resolveAuthContext(raw);
}

/** Staff/admin only. Fails closed in production; demo fallback outside it. */
export async function requireStaffSession() {
  return requireStaffContext(await getAuthContext());
}

/** Admin only. Fails closed in production; demo fallback outside it. */
export async function requireAdminSession() {
  return requireAdminContext(await getAuthContext());
}

/** Client actor scoped to exactly `organisationId`. No demo fallback in any
 * environment -- there's no honest way to guess which org a request "should"
 * belong to. */
export async function requireClientSession(organisationId: string) {
  return requireClientContext(await getAuthContext(), organisationId);
}

/** True when the current request has no real session and is running outside
 * production -- i.e. the demo/no-auth fallback is what's actually serving it. */
export async function isUnauthenticatedDemoRequest(): Promise<boolean> {
  if (isProduction()) return false;
  const actor = await getAuthContext();
  return actor === null;
}

/**
 * Resolves the organisation id a client-surface page should scope to.
 *
 * Production: requires a real client session and returns its authenticated
 * `organisationId` -- never a browser-controlled value (P0-2 requirement 3).
 * Non-production with no session: falls back to the first organisation in
 * `fallbackOrganisations` (demo mode -- there is no client OAuth session to
 * derive from yet), clearly bounded to non-production only.
 */
export async function resolveClientOrganisationId(
  fallbackOrganisations: { id: string }[],
): Promise<string> {
  const actor = await getAuthContext();
  if (actor?.kind === "client") return actor.organisationId;

  if (isProduction()) throw new UnauthenticatedError("Client session required");

  const fallback = fallbackOrganisations[0];
  if (!fallback) throw new UnauthenticatedError("No organisation available for demo client session");
  return fallback.id;
}

export { UnauthenticatedError, demoStaffContext, isProduction };
