/**
 * TanStack Start adapter for src/app/(client)/client/page.tsx. Identical
 * JSX/Tailwind/data-assembly -- reuses PageHeader, Card, Badge,
 * SpotlightCard, the chart components, CLIENT_SAFE_LABEL and
 * formatInr/formatInrCompact verbatim; only LinkButton is swapped for the
 * TanStack adapter. Authorization is enforced by the parent client layout
 * route, same as the Next.js (client) route group.
 */
import { createFileRoute } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/tanstack/link-button";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { RecoveryTrend } from "@/components/charts/recovery-trend";
import { AgeingBars } from "@/components/charts/ageing-bars";
import { StageFunnel } from "@/components/charts/stage-funnel";
import { getClientOverviewData } from "@/lib/client-portal.functions";
import { CLIENT_SAFE_LABEL } from "@/contract/enums";
import { formatInr, formatInrCompact } from "@/lib/utils";

export const Route = createFileRoute("/client/")({
  loader: () => getClientOverviewData(),
  component: ClientOverviewPage,
  head: () => ({ meta: [{ title: "Overview — Debtrecover" }] }),
});

function ClientOverviewPage() {
  const { org, overview, cases, trend, stageFunnel } = Route.useLoaderData();

  const tiles = [
    { label: "Current outstanding", value: formatInrCompact(overview.totalOutstanding) },
    { label: "Recovered to date", value: formatInrCompact(overview.recovered) },
    { label: "Active cases", value: String(cases.length) },
    { label: "Recovery rate", value: `${overview.recoveryRatePct}%` },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Client overview"
        title="Your recoveries at a glance"
        description={`${org.legalEntityName} — updated just now`}
        size="hero"
        actions={<LinkButton href="/client/upload" variant="primary">Upload invoices</LinkButton>}
      />

      {overview.actionsRequired > 0 ? (
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-warning">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="text-sm font-semibold">
              {overview.actionsRequired} item{overview.actionsRequired === 1 ? "" : "s"} need your confirmation
            </p>
            <p className="text-xs opacity-90">
              Confirming a reported payment or correcting a contact keeps recovery moving.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardContent className="p-4">
              <p className="text-2xl font-semibold tabular-nums">{t.value}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Your cases</CardTitle>
            <LinkButton href="/client/cases">View all</LinkButton>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 pt-0">
            {cases.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <span className="text-sm">{c.groupKey ?? c.id}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatInr(c.principalOutstanding)}
                  </span>
                  <Badge tone="info">{CLIENT_SAFE_LABEL[c.status] ?? "In progress"}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <SpotlightCard
          eyebrow="Most important action"
          title={overview.upcomingAction?.label ?? "Nothing needs your input right now"}
          description={
            overview.upcomingAction?.when
              ? `Expected ${new Date(overview.upcomingAction.when).toLocaleDateString("en-IN", { dateStyle: "medium" })}`
              : "We'll notify you here as soon as something needs your confirmation."
          }
          action={
            overview.upcomingAction ? (
              <LinkButton href="/client/confirmations" variant="primary">
                Review
              </LinkButton>
            ) : null
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recovery trend</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {trend.length > 0 ? (
              <RecoveryTrend data={trend} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No trend data yet — recovery allocations will populate this once payments are recorded.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Ageing</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <AgeingBars data={overview.ageing} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stage-wise progress</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <StageFunnel data={stageFunnel} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fee summary</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between pt-0 text-sm">
          <span>Estimated success fee</span>
          <span className="tabular-nums font-semibold">{formatInr(overview.feeSummary.estimatedFee)}</span>
        </CardContent>
      </Card>
    </div>
  );
}
