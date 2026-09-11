import { AppShell } from "@/components/app-shell";
import { getRepo } from "@/server/repo";

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

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
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

  return (
    <AppShell surface="internal" organisations={organisations} counts={counts}>
      {children}
    </AppShell>
  );
}
