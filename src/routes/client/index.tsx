/**
 * TanStack Start adapter for src/app/(client)/client/page.tsx. Same
 * data-assembly (presentation differs slightly) -- reuses PageHeader, Card, Badge,
 * SpotlightCard, the chart components and
 * formatInr/formatInrCompact verbatim; only LinkButton is swapped for the
 * TanStack adapter. Authorization is enforced by the parent client layout
 * route, same as the Next.js (client) route group.
 */
import { CLIENT_NOTHING_PENDING_NOTE, clientAttentionNotice } from "@/domain/client-notice";
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
        actions={<LinkButton href="/client/cases" variant="primary">View your cases</LinkButton>}
      />

      {overview.actionsRequired > 0 ? (
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-warning">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="text-sm font-semibold">{clientAttentionNotice(overview.actionsRequired).title}</p>
            <p className="text-xs opacity-90">{clientAttentionNotice(overview.actionsRequired).body}</p>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t.label}</p>
              <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{t.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Your cases</CardTitle>
            <LinkButton href="/client/cases">View all</LinkButton>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 pt-0">
            {cases.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{c.debtorName}</span>
                  {c.reference ? (
                    <span className="block truncate text-[11px] text-muted-foreground">Ref. {c.reference}</span>
                  ) : null}
                </span>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-medium tabular-nums">{formatInr(c.principalOutstanding)}</span>
                  <Badge tone={c.closed ? "success" : "info"}>{c.stage}</Badge>
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
              : CLIENT_NOTHING_PENDING_NOTE
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
