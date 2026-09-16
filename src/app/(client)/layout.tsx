import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getRepo } from "@/server/repo";
import { getAuthContext, isProduction } from "@/lib/auth/session";

/** Audit P0-3: force dynamic, uncached rendering -- see (internal)/layout.tsx. */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

/**
 * Server-side Client-only authorization boundary, mirroring
 * (internal)/layout.tsx's staff/admin gate (P1-A, authorization hardening
 * task): a Staff/Admin session must not silently consume the client
 * portal as if it were the client (final UAT: no approved impersonation
 * feature exists), the same way a Client must not reach the internal
 * surface.
 */
export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const actor = await getAuthContext();
  if (actor && actor.kind !== "client") {
    redirect("/dashboard");
  }
  if (!actor && isProduction()) {
    redirect("/sign-in");
  }

  // Least privilege: a real client session only ever needs its own
  // organisation(s) for the shell's org switcher, never every tenant in
  // the system -- the non-production demo fallback (no real session)
  // still gets the full list, matching this layout's pre-existing demo
  // behavior and resolveClientOrganisationId's own fallback shape.
  const repo = getRepo();
  const organisations =
    actor && actor.kind === "client"
      ? (await Promise.all(actor.organisationIds.map((id) => repo.getOrg(id)))).filter((o) => o !== undefined)
      : await repo.listOrganisations();

  const user = actor && actor.kind === "client" ? { displayName: actor.displayName, email: null, role: "client" as const } : { displayName: "Client (demo)", email: null, role: "client" as const };

  return (
    <AppShell surface="client" organisations={organisations} user={user}>
      {children}
    </AppShell>
  );
}
