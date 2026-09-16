import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { RecoveryTrend } from "@/components/charts/recovery-trend";
import { AgeingBars } from "@/components/charts/ageing-bars";
import { StageFunnel } from "@/components/charts/stage-funnel";
import { getRepo } from "@/server/repo";
import { formatInrCompact } from "@/lib/utils";

export const metadata = { title: "Dashboard — Debtrecover" };

// Staff/admin sessions intentionally see this dashboard across every client
// organisation (PRD §4's legitimate staff cross-org capability) -- there is
// no per-staff org scope to add here. Authorization for this page is
// enforced by the shared (internal) layout (src/app/(internal)/layout.tsx),
// with RLS as independent defense-in-depth (see docs/authorization-hardening).
export default async function DashboardPage() {
  const repo = getRepo();
  const [k, queue, trend, ageing, stageFunnel] = await Promise.all([
    repo.dashboardKpis(),
    repo.urgentQueue(),
    repo.recoveryTrend(),
    repo.ageingBuckets(),
    repo.stageFunnel(),
  ]);

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Kolkata",
  });
  const top = queue[0];

  const tiles = [
    { label: "Open cases", value: String(k.openCases) },
    { label: "Under recovery", value: formatInrCompact(k.amountUnderRecovery) },
    { label: "Recovered (confirmed)", value: formatInrCompact(k.recoveredThisMonth) },
    { label: "Urgent tasks", value: String(k.urgentTasks) },
    { label: "Awaiting client", value: String(k.awaitingClient) },
    { label: "Portal runs", value: String(k.portalRuns) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={`${today.toUpperCase()} · IST`}
        title="Dashboard"
        description="Portfolio-wide recovery metrics across every client. For the ranked exception queue, see Today / Urgent."
        size="hero"
        actions={<LinkButton href="/today" variant="primary">Go to Today / Urgent</LinkButton>}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardContent className="p-4">
              <p className="text-2xl font-semibold tabular-nums">{t.value}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {top ? (
        <SpotlightCard
          eyebrow="Next best action"
          title={top.nextSafeAction}
          description={
            <>
              {top.client}
              {top.debtor ? <> &middot; {top.debtor}</> : null}
              {top.blocker ? <> — {top.blocker}</> : null}
            </>
          }
          action={
            top.caseId ? (
              <LinkButton href={`/cases/${top.caseId}`} variant="primary">
                Open case
              </LinkButton>
            ) : null
          }
          secondaryAction={<LinkButton href="/today">View full queue</LinkButton>}
        />
      ) : null}

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
            <CardTitle>Ageing (all clients)</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <AgeingBars data={ageing.map((a) => ({ bucket: a.bucket, amount: a.amount }))} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stage-wise progress (all clients)</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <StageFunnel data={stageFunnel} />
        </CardContent>
      </Card>
    </div>
  );
}
