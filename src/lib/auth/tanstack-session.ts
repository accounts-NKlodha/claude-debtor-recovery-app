/**
 * TanStack Start equivalent of src/lib/auth/session.ts. Reuses the SAME
 * pure authorization logic (./context.ts, ./types.ts -- zero Next.js
 * dependencies, unit-tested in context.test.ts, completely unmodified) and
 * swaps only the "thin glue" layer: resolving a real request into a
 * RawIdentity via the TanStack cookie-based Supabase client instead of the
 * Next.js one. Mirrors src/lib/auth/session.ts function-for-function.
 *
 * Only exists on the TanStack port branch; src/lib/auth/session.ts (Next)
 * is untouched.
 */
import { getCookies, getRequest } from "@tanstack/react-start/server";
import { createClient } from "@/lib/supabase/tanstack-server";
import { resolveRepoMode } from "@/server/repo-mode";
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
 * Optional `existingClient`: within a single request, TanStack Start's
 * cookie API (getCookies/setCookie, backed by h3) does NOT share state the
 * way Next.js's `next/headers` cookies() does -- setCookie() only appends to
 * the outgoing response, it never updates what a later getCookies() call in
 * the same request parses back out of the incoming request. So a call to
 * signInWithPassword() followed by a *fresh* createClient() + getUser() in
 * the same request would never see the session it just established, and
 * every sign-in would be wrongly treated as an unprovisioned identity.
 * signInFn (tanstack-actions.ts) passes its own already-authenticated
 * client through for exactly this reason; every other call site is
 * unaffected and keeps creating its own client from request cookies as
 * before.
 */
async function resolveAuthContextUncached(
  existingClient?: Awaited<ReturnType<typeof createClient>>,
): Promise<AuthContext | null> {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  if (existingClient) {
    supabase = existingClient;
  } else {
    try {
      supabase = await createClient();
    } catch {
      return null;
    }
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return null;

  const appUserRes = await supabase.from("app_users").select("*").eq("id", user.id).maybeSingle();
  const appUser = appUserRes.data as unknown as AppUserRow | null;
  if (!appUser) return null;

  const membershipsRes = await supabase.from("user_organisations").select("*").eq("user_id", user.id);
  const memberships = (membershipsRes.data ?? []) as unknown as UserOrganisationRow[];

  const raw: RawIdentity = {
    userId: user.id,
    appUser: { role: appUser.role, email: appUser.email, displayName: appUser.display_name },
    organisationIds: memberships.map((m) => m.organisation_id),
    selectedOrganisationId: null,
  };

  return resolveAuthContext(raw);
}

/**
 * Request-scoped memoization of the (network) session validation. Keyed on
 * the incoming Request object, so a result can NEVER outlive or cross the
 * request it was computed for -- nothing is cached across requests, and a
 * revoked session is re-checked against Supabase Auth on every new request.
 * Calls that pass their own client (sign-in) are never cached.
 */
const requestAuthCache = new WeakMap<object, Promise<AuthContext | null>>();

function currentRequestKey(): object | null {
  try {
    return getRequest();
  } catch {
    return null; // outside a Start request (e.g. some tests): no memoization
  }
}

/** Sign-in/sign-out change who the request is: drop this request's memo. */
export function clearRequestAuthCache(): void {
  const key = currentRequestKey();
  if (key) requestAuthCache.delete(key);
}

export async function getAuthContext(
  existingClient?: Awaited<ReturnType<typeof createClient>>,
): Promise<AuthContext | null> {
  if (existingClient) return resolveAuthContextUncached(existingClient);
  const key = currentRequestKey();
  if (!key) return resolveAuthContextUncached();
  const cached = requestAuthCache.get(key);
  if (cached) return cached;
  const pending = resolveAuthContextUncached();
  requestAuthCache.set(key, pending);
  pending.catch(() => requestAuthCache.delete(key));
  return pending;
}

const SESSION_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

/** True when the request carries a Supabase session cookie (valid or not). */
export function requestCarriesSessionCookie(): boolean {
  try {
    return Object.keys(getCookies()).some((name) => SESSION_COOKIE.test(name));
  } catch {
    return false;
  }
}

/**
 * The non-production demo actor (in-memory demo data) is only ever offered
 * when ALL hold: not production, the data layer is the in-memory repository,
 * and the request presents no session cookie at all. A presented-but-invalid
 * (revoked/replayed/expired) session, or any request against real Supabase
 * data, must fail closed instead of degrading to a demo identity that would
 * then read data with whatever JWT the cookie still carries.
 */
export function demoFallbackAllowed(): boolean {
  return !isProduction() && resolveRepoMode() === "memory" && !requestCarriesSessionCookie();
}

/**
 * Resolves the organisation a client request is scoped to, authenticating
 * FIRST. `loadFallbackOrganisations` is lazy on purpose: it is only invoked
 * on the demo-data fallback path (no session at all, in-memory demo data,
 * not production), so a revoked/invalid session never triggers a data query.
 */
export async function resolveClientOrganisationId(
  loadFallbackOrganisations: () => Promise<{ id: string }[]>,
): Promise<string> {
  const actor = await getAuthContext();
  if (actor?.kind === "client") return actor.organisationId;

  // A staff/admin session is not a client session in any environment, and
  // the demo fallback exists only for "no session at all" on demo data.
  if (actor || !demoFallbackAllowed()) throw new UnauthenticatedError("Client session required");

  const fallback = (await loadFallbackOrganisations())[0];
  if (!fallback) throw new UnauthenticatedError("No organisation available for demo client session");
  return fallback.id;
}

export async function requireStaffSession() {
  const actor = await getAuthContext();
  if (!actor && !demoFallbackAllowed()) throw new UnauthenticatedError();
  return requireStaffContext(actor);
}

export async function requireAdminSession() {
  const actor = await getAuthContext();
  if (!actor && !demoFallbackAllowed()) throw new UnauthenticatedError();
  return requireAdminContext(actor);
}

export async function requireClientSession(organisationId: string) {
  return requireClientContext(await getAuthContext(), organisationId);
}

export async function authorizeStaffMutation(): Promise<MutationActor> {
  const actor = await requireStaffSession();
  return actorAttribution(actor);
}

export async function authorizeAdminMutation(): Promise<MutationActor> {
  const actor = await requireAdminSession();
  return actorAttribution(actor);
}

export async function authorizeClientMutation(organisationId: string): Promise<MutationActor> {
  const actor = await requireClientSession(organisationId);
  return actorAttribution(actor);
}

export { UnauthenticatedError, demoStaffContext, isProduction };
