import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RecoveryTrend } from "@/components/charts/recovery-trend";
import { AgeingBars } from "@/components/charts/ageing-bars";
import { StageFunnel } from "@/components/charts/stage-funnel";
import {
  ORGANISATIONS,
  RECOVERY_TREND,
  STAGE_FUNNEL,
  clientOverview,
  listCasesForOrg,
} from "@/lib/mock-data";
import { CLIENT_SAFE_LABEL } from "@/contract/enums";
import { formatInr, formatInrCompact } from "@/lib/utils";

export const metadata = { title: "Overview — Debtrecover" };

// TODO(api): replace mock with server fetch scoped to the signed-in client org.
export default function ClientOverviewPage() {
  const org = ORGANISATIONS[0];
  const o = clientOverview(org.id);
  const cases = listCasesForOrg(org.id);

  const tiles = [
    { label: "Actions required from you", value: String(o.actionsRequired) },
    { label: "Total outstanding", value: formatInrCompact(o.totalOutstanding) },
    { label: "Recovered", value: formatInrCompact(o.recovered) },
    { label: "Recovery rate", value: `${o.recoveryRatePct}%` },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        description={`${org.legalEntityName} — a client-safe summary of your recovery cases.`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground">{t.label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{t.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Upcoming action</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {o.upcomingAction ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">{o.upcomingAction.label}</span>
                <span className="text-xs text-muted-foreground">
                  {o.upcomingAction.when
                    ? new Date(o.upcomingAction.when).toLocaleDateString("en-IN", {
                        dateStyle: "medium",
                      })
                    : "Scheduling"}
                </span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing scheduled right now.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fee summary</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between pt-0 text-sm">
            <span>Estimated success fee</span>
            <span className="tabular-nums font-semibold">{formatInr(o.feeSummary.estimatedFee)}</span>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recovery trend</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <RecoveryTrend data={RECOVERY_TREND} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Ageing</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <AgeingBars data={o.ageing} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stage-wise progress</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <StageFunnel data={STAGE_FUNNEL} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your cases</CardTitle>
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
    </div>
  );
}
