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
import { createClient } from "@/lib/supabase/tanstack-server";
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
export async function getAuthContext(
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

/** Mirrors src/lib/auth/session.ts's resolveClientOrganisationId exactly. */
export async function resolveClientOrganisationId(fallbackOrganisations: { id: string }[]): Promise<string> {
  const actor = await getAuthContext();
  if (actor?.kind === "client") return actor.organisationId;

  if (isProduction()) throw new UnauthenticatedError("Client session required");

  const fallback = fallbackOrganisations[0];
  if (!fallback) throw new UnauthenticatedError("No organisation available for demo client session");
  return fallback.id;
}

export async function requireStaffSession() {
  return requireStaffContext(await getAuthContext());
}

export async function requireAdminSession() {
  return requireAdminContext(await getAuthContext());
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
