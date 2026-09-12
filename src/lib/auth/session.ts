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
  actorAttribution,
  demoStaffContext,
  isProduction,
  requireAdminContext,
  requireClientContext,
  requireStaffContext,
  resolveAuthContext,
  type RawIdentity,
} from "./context";
import { UnauthenticatedError, type AuthContext, type MutationActor } from "./types";

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

/**
 * The single entry point every staff-facing server action must call before
 * doing any mutation (P0-1/P0-2-R1 §2). Fails closed exactly like
 * `requireStaffSession()` (throws in production with no session; demo
 * fallback outside it) and additionally returns the `MutationActor` the
 * action must use for audit attribution -- never the action's own input
 * parameters, which a browser fully controls.
 */
export async function authorizeStaffMutation(): Promise<MutationActor> {
  const actor = await requireStaffSession();
  return actorAttribution(actor);
}

/** Like `authorizeStaffMutation`, but for actions PRD §5 reserves to admins
 * only (e.g. the global automation kill switch). */
export async function authorizeAdminMutation(): Promise<MutationActor> {
  const actor = await requireAdminSession();
  return actorAttribution(actor);
}

/**
 * The client-facing counterpart: requires a real client session scoped to
 * exactly `organisationId` (no demo fallback, in any environment -- see
 * `requireClientSession`) and returns the actor for audit attribution.
 * `organisationId` must come from the entity being mutated (e.g. a case
 * looked up by id), never from a form field, so a client can't submit a
 * different org id to redirect the mutation (P0-2 requirement 3).
 */
export async function authorizeClientMutation(organisationId: string): Promise<MutationActor> {
  const actor = await requireClientSession(organisationId);
  return actorAttribution(actor);
}

export { UnauthenticatedError, demoStaffContext, isProduction };
