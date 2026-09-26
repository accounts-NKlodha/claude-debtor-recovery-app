/**
 * TanStack Start equivalent of src/app/(internal)/clients/page.tsx's data
 * assembly (M1 Batch 1). Admin-only controls (add client, automation
 * switch, payment details) are still independently enforced server-side by
 * their own mutation server functions (organisations.functions.ts,
 * settings.functions.ts) -- `isAdmin` here only decides whether to *render*
 * those controls for a Staff session (authorization hardening task #6:
 * "prefer not to render", never the real boundary), same as the Next.js
 * page.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import { demoFallbackAllowed, getAuthContext, requireStaffSession } from "@/lib/auth/tanstack-session";
import type { AuthContext } from "@/lib/auth/types";

const PORTAL_RUN_STATUSES = ["gst_eligibility_review", "gst_notification_prepared", "msme_eligibility_review"];

/** Pure, directly unit-testable (see clients.guard.test.ts). */
export function isAdminForRender(actor: AuthContext | null): boolean {
  return !actor || (actor.kind === "staff" && actor.role === "admin");
}

export const getClientsPolicyData = createServerFn({ method: "GET" }).handler(async () => {
  // Role guard first (client -> Forbidden, production no session -> Unauthenticated),
  // before any repository call. The demo actor maps back to null so the
  // non-production render behaviour of isAdminForRender is unchanged.
  const guarded = await requireStaffSession();
  const actor = guarded.demo ? null : guarded;
  const repo = await getRepo();
  const [{ enabled }, cases, organisations] = await Promise.all([
    repo.getAutomationState(),
    repo.listAllCases(),
    repo.listOrganisations(),
  ]);

  const isAdmin = isAdminForRender(actor);
  const preparedCount = cases.filter((c) => c.status === "initial_communication_sent").length;
  const portalRunCount = cases.filter((c) => PORTAL_RUN_STATUSES.includes(c.status)).length;
  const caseCountByOrg: Record<string, number> = {};
  for (const c of cases) caseCountByOrg[c.organisationId] = (caseCountByOrg[c.organisationId] ?? 0) + 1;

  return { isAdmin, enabled, preparedCount, portalRunCount, caseCountByOrg, organisations };
});

/**
 * TanStack Start equivalent of src/app/(internal)/clients/new/page.tsx's
 * page-level admin check. The mutation server function
 * (createOrganisationFn) already enforces this independently -- this only
 * stops a Staff session from ever rendering the form, same as the Next.js
 * page.
 */
export const getNewClientPageAccess = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await getAuthContext();
  // No session (or a revoked one) is not "admin" -- the null->admin render
  // rule exists only for the demo-data fallback.
  if (!actor && !demoFallbackAllowed()) return { isAdmin: false };
  return { isAdmin: isAdminForRender(actor) };
});
