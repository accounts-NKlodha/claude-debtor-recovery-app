/**
 * TanStack Start adapter for src/app/(internal)/clients/page.tsx. Identical
 * JSX -- reuses PageHeader, Card, Badge verbatim and the SettingsScreen /
 * OrganisationPaymentDetailsForm adapters (their Next Server Action /
 * next/navigation dependencies swapped for TanStack server functions +
 * router.invalidate, see src/components/tanstack/*). Authorization is
 * enforced by the parent _internal layout route; the two admin-only
 * mutation server functions (createOrganisationFn,
 * updateOrganisationPaymentDetailsFn) independently re-enforce admin-only,
 * same as the Next.js page -- `isAdmin` here only decides what to render.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/tanstack/link-button";
import { SettingsScreen } from "@/components/tanstack/settings-screen";
import { OrganisationPaymentDetailsForm } from "@/components/tanstack/organisation-payment-details";
import { getClientsPolicyData } from "@/lib/clients.functions";

export const Route = createFileRoute("/_internal/clients/")({
  loader: () => getClientsPolicyData(),
  component: ClientsPolicyPage,
  head: () => ({ meta: [{ title: "Clients / Policy — Debtrecover" }] }),
});

function ClientsPolicyPage() {
  const { isAdmin, enabled, preparedCount, portalRunCount, caseCountByOrg, organisations } = Route.useLoaderData();

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
          {organisations.map((o) => {
            const upiConfigured = Boolean(o.upiId && o.upiPayeeName);
            return (
              <div key={o.id} className="flex flex-col rounded-md border border-border px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{o.legalEntityName}</p>
                    <p className="text-xs text-muted-foreground">
                      {o.clientCode} &middot; {caseCountByOrg[o.id] ?? 0} case
                      {(caseCountByOrg[o.id] ?? 0) === 1 ? "" : "s"}
                      {o.creditorGstin ? (
                        <>
                          {" "}
                          &middot; <span className="font-mono">{o.creditorGstin}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {upiConfigured ? (
                      <Badge tone="success">UPI configured</Badge>
                    ) : (
                      <Badge tone="warning">UPI not set — no WhatsApp reminders</Badge>
                    )}
                    {o.jitoMember ? <Badge tone="info">JITO — 5% fee</Badge> : <Badge tone="neutral">10% fee</Badge>}
                  </div>
                </div>
                {isAdmin ? (
                  <details className="mt-1 text-xs">
                    <summary className="cursor-pointer text-muted-foreground">Payment details (UPI)</summary>
                    <OrganisationPaymentDetailsForm
                      organisationId={o.id}
                      upiId={o.upiId}
                      upiPayeeName={o.upiPayeeName}
                    />
                  </details>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {isAdmin ? (
        <SettingsScreen enabled={enabled} preparedCount={preparedCount} portalRunCount={portalRunCount} />
      ) : null}
    </div>
  );
}
