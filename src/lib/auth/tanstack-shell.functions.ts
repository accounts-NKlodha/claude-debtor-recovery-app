/**
 * Server-only logic for the internal-surface guard, kept in its own file
 * (not inlined in src/routes/_internal.tsx) so its server-only imports
 * (getAuthContext, getRepo -- both transitively import "server-only") never
 * end up at module scope in a file that also exports a client-rendered
 * route component. createServerFn's own body-splitting only applies
 * cleanly when the server-only imports are isolated like this -- mirrors
 * the *.functions.ts convention this repo's own Lovable spike used.
 */
import { createServerFn } from "@tanstack/react-start";
import type { Organisation } from "@/contract/types";
import { getRepo } from "@/server/repo.tanstack";
import { demoFallbackAllowed, getAuthContext, isProduction } from "@/lib/auth/tanstack-session";

const INTAKE_PIPELINE_STATUSES = ["received", "under_validation", "correction_required"];
const PORTAL_RUN_STATUSES = ["gst_eligibility_review", "gst_notification_prepared", "msme_eligibility_review"];
const DD_HEARING_STATUSES = ["msme_odr_filed", "msefc_dd", "hearing_scheduled"];

export type ShellResult =
  | { kind: "redirect"; to: "/client" | "/sign-in" }
  | {
      kind: "ok";
      organisations: Organisation[];
      counts: Partial<Record<string, number>>;
      user: { displayName: string; email: string | null; role: "staff" | "admin" };
    };

/**
 * Pure redirect decision, factored out of the createServerFn wrapper below
 * so it's directly unit-testable (see tanstack-shell.guard.test.ts):
 * createServerFn's wrapper requires an AsyncLocalStorage-backed Start
 * runtime context that plain vitest doesn't provide, so the function it
 * wraps can't be invoked directly in a test -- only what it delegates to
 * can be. Returns null when the request should proceed to load real data
 * (a client actor is redirected in every environment; a missing session
 * only in production -- outside production the existing demo-staff
 * fallback keeps working, unchanged from the Next.js app's own behaviour).
 */
export function decideShellRedirect(
  actor: Awaited<ReturnType<typeof getAuthContext>>,
  isProd: boolean,
  /** Whether the non-production demo actor may stand in for "no session"
   * (see demoFallbackAllowed). Defaults to the historical rule. */
  demoFallback: boolean = !isProd,
): { kind: "redirect"; to: "/client" | "/sign-in" } | null {
  if (actor && actor.kind === "client") {
    return { kind: "redirect", to: "/client" };
  }
  if (!actor && (isProd || !demoFallback)) {
    return { kind: "redirect", to: "/sign-in" };
  }
  return null;
}

/**
 * Pure data-assembly half of the guard, likewise factored out for direct
 * unit-testability.
 */
export async function resolveInternalShellData(
  actor: Awaited<ReturnType<typeof getAuthContext>>,
  repo: Awaited<ReturnType<typeof getRepo>>,
): Promise<ShellResult> {
  const [organisations, cases, comms, payments, tasks] = await Promise.all([
    repo.listOrganisations(),
    repo.listAllCases(),
    repo.listAllCommunications(),
    repo.listAllPayments(),
    repo.openTasks(),
  ]);

  const counts = {
    "/today": tasks.length,
    "/intake": cases.filter((c) => INTAKE_PIPELINE_STATUSES.includes(c.status)).length,
    "/communications": comms.filter((c) => c.direction === "inbound" && !c.reviewedById).length,
    "/payments": payments.filter((p) => !p.clientConfirmed).length,
    "/gst": cases.filter((c) => PORTAL_RUN_STATUSES.includes(c.status)).length,
    "/msme": cases.filter((c) => DD_HEARING_STATUSES.includes(c.status)).length,
  };

  const user =
    actor && actor.kind === "staff"
      ? { displayName: actor.displayName, email: actor.email, role: actor.role }
      : { displayName: "Staff (demo)", email: null, role: "staff" as const };

  return { kind: "ok", organisations, counts, user };
}

export const getInternalShellData = createServerFn({ method: "GET" }).handler(async (): Promise<ShellResult> => {
  const actor = await getAuthContext();
  const redirect = decideShellRedirect(actor, isProduction(), demoFallbackAllowed());
  if (redirect) return redirect;

  const repo = await getRepo();
  return resolveInternalShellData(actor, repo);
});
