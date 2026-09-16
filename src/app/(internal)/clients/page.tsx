import { Building2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import { SettingsScreen } from "@/components/screens/settings-screen";
import { getRepo } from "@/server/repo";
import { getAuthContext } from "@/lib/auth/session";

export const metadata = { title: "Clients / Policy — Debtrecover" };

const PORTAL_RUN_STATUSES = ["gst_eligibility_review", "gst_notification_prepared", "msme_eligibility_review"];

export default async function ClientsPolicyPage() {
  const repo = getRepo();
  const [actor, { enabled }, cases, organisations] = await Promise.all([
    getAuthContext(),
    repo.getAutomationState(),
    repo.listAllCases(),
    repo.listOrganisations(),
  ]);
  // Onboarding a new client organisation and the global automation kill
  // switch are both Admin-only per the accepted V1 role model (server
  // actions already enforce this independently -- authorizeAdminMutation
  // in src/app/actions/organisations.ts / settings.ts); this only decides
  // whether to *render* those controls for a Staff session at all
  // (authorization hardening task #6: "prefer not to render", never the
  // real boundary). The demo fallback outside production (no real
  // session) is treated as admin, matching demoStaffContext's own
  // existing "outside production, staff mutations proceed" behavior.
  const isAdmin = !actor || (actor.kind === "staff" && actor.role === "admin");
  const preparedCount = cases.filter((c) => c.status === "initial_communication_sent").length;
  const portalRunCount = cases.filter((c) => PORTAL_RUN_STATUSES.includes(c.status)).length;
  const caseCountByOrg = new Map<string, number>();
  for (const c of cases) caseCountByOrg.set(c.organisationId, (caseCountByOrg.get(c.organisationId) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Clients & policy"
        title="Clients"
        description="Every client organisation cases can be scoped to. Admin controls below require a reason and create an audit event."
        actions={isAdmin ? <LinkButton href="/clients/new" variant="primary">+ Add client</LinkButton> : undefined}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Client roster
          </CardTitle>
          <CardDescription>{organisations.length} client organisation(s) on file.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pt-0">
          {organisations.map((o) => (
            <div
              key={o.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium">{o.legalEntityName}</p>
                <p className="text-xs text-muted-foreground">
                  {o.clientCode} &middot; {caseCountByOrg.get(o.id) ?? 0} case
                  {(caseCountByOrg.get(o.id) ?? 0) === 1 ? "" : "s"}
                  {o.creditorGstin ? (
                    <>
                      {" "}
                      &middot; <span className="font-mono">{o.creditorGstin}</span>
                    </>
                  ) : null}
                </p>
              </div>
              {o.jitoMember ? <Badge tone="info">JITO — 5% fee</Badge> : <Badge tone="neutral">10% fee</Badge>}
            </div>
          ))}
        </CardContent>
      </Card>

      {isAdmin ? (
        <SettingsScreen enabled={enabled} preparedCount={preparedCount} portalRunCount={portalRunCount} />
      ) : null}
    </div>
  );
}
