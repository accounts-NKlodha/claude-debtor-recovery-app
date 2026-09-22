/**
 * Server-only logic for the client-portal surface guard, mirroring
 * src/app/(client)/layout.tsx exactly (M1 Batch 1). Kept in its own file for
 * the same reason as tanstack-shell.functions.ts -- getAuthContext/getRepo
 * transitively import "server-only" and must never sit at module scope in a
 * file that also exports a client-rendered route component.
 *
 * Guard semantics preserved exactly:
 *   - a definitive staff/admin actor is always redirected to /dashboard (no
 *     approved impersonation feature exists -- a staff/admin session must
 *     not silently consume the client portal as if it were the client);
 *   - a missing session is redirected to /sign-in ONLY in production
 *     (outside production, the existing demo-fallback keeps working).
 * Least privilege: a real client session only ever loads its own
 * organisation(s); the non-production demo fallback (no real session) gets
 * the full list, matching resolveClientOrganisationId's own fallback shape.
 */
import { createServerFn } from "@tanstack/react-start";
import type { Organisation } from "@/contract/types";
import { getRepo } from "@/server/repo.tanstack";
import { getAuthContext, isProduction } from "@/lib/auth/tanstack-session";

export type ClientShellResult =
  | { kind: "redirect"; to: "/dashboard" | "/sign-in" }
  | { kind: "ok"; organisations: Organisation[]; user: { displayName: string; email: string | null; role: "client" } };

/**
 * Pure redirect decision, factored out for direct unit-testability (see
 * tanstack-client-shell.guard.test.ts) -- same reasoning as
 * decideShellRedirect in tanstack-shell.functions.ts.
 */
export function decideClientShellRedirect(
  actor: Awaited<ReturnType<typeof getAuthContext>>,
  isProd: boolean,
): { kind: "redirect"; to: "/dashboard" | "/sign-in" } | null {
  if (actor && actor.kind !== "client") {
    return { kind: "redirect", to: "/dashboard" };
  }
  if (!actor && isProd) {
    return { kind: "redirect", to: "/sign-in" };
  }
  return null;
}

/** Pure data-assembly half of the guard, likewise factored out for direct unit-testability. */
export async function resolveClientShellData(
  actor: Awaited<ReturnType<typeof getAuthContext>>,
  repo: Awaited<ReturnType<typeof getRepo>>,
): Promise<ClientShellResult> {
  const organisations =
    actor && actor.kind === "client"
      ? (await Promise.all(actor.organisationIds.map((id) => repo.getOrg(id)))).filter(
          (o): o is Organisation => o !== undefined,
        )
      : await repo.listOrganisations();

  const user =
    actor && actor.kind === "client"
      ? { displayName: actor.displayName, email: null, role: "client" as const }
      : { displayName: "Client (demo)", email: null, role: "client" as const };

  return { kind: "ok", organisations, user };
}

export const getClientShellData = createServerFn({ method: "GET" }).handler(async (): Promise<ClientShellResult> => {
  const actor = await getAuthContext();
  const redirect = decideClientShellRedirect(actor, isProduction());
  if (redirect) return redirect;

  const repo = await getRepo();
  return resolveClientShellData(actor, repo);
});
