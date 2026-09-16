import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getRepo } from "@/server/repo";
import { getAuthContext, isProduction } from "@/lib/auth/session";

/**
 * Audit P0-3: these pages were statically prerendered and served with
 * `Cache-Control: s-maxage=31536000` -- a shared cache could serve one
 * user's case/client data to another. Every route in this authenticated
 * segment must render dynamically, uncached, per request.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const INTAKE_PIPELINE_STATUSES = ["received", "under_validation", "correction_required"];
const PORTAL_RUN_STATUSES = ["gst_eligibility_review", "gst_notification_prepared", "msme_eligibility_review"];
const DD_HEARING_STATUSES = ["msme_odr_filed", "msefc_dd", "hearing_scheduled"];

/**
 * Server-side Staff/Admin authorization boundary for the entire
 * `(internal)` route group (P1-A, authorization + server-action hardening
 * task). Every page under this layout -- dashboard, cases, clients, audit,
 * payments, gst, msme, intake, communications, today -- inherits this
 * check automatically; a page added later needs no authorization code of
 * its own to be covered.
 *
 * This does NOT replace `src/proxy.ts` (which only proves "some
 * authenticated session exists") or RLS (which remains the real
 * tenant-isolation boundary for data) -- it closes the specific gap final
 * UAT found: a CLIENT session, once authenticated, could render this
 * entire staff/admin surface, because nothing between proxy.ts and each
 * page's own data-fetching ever checked *which* role was signed in.
 *
 * Mirrors requireStaffContext's own fail-closed-in-production /
 * demo-fallback-outside-production split (src/lib/auth/context.ts) rather
 * than reimplementing it -- a definitive client actor is always redirected
 * to /client, in every environment; a missing session is only redirected
 * in production (outside production, the existing demoStaffContext()
 * fallback used throughout the app keeps working, unchanged).
 */
export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const actor = await getAuthContext();
  if (actor && actor.kind === "client") {
    redirect("/client");
  }
  if (!actor && isProduction()) {
    redirect("/sign-in");
  }

  const repo = getRepo();
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

  return (
    <AppShell surface="internal" organisations={organisations} counts={counts} user={user}>
      {children}
    </AppShell>
  );
}
