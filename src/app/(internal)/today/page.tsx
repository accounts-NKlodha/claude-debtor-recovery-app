import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { TodayQueue } from "@/components/screens/today-queue";
import { DASHBOARD_KPIS, urgentQueue } from "@/lib/mock-data";
import { formatInrCompact } from "@/lib/utils";

export const metadata = { title: "Today / Urgent — Debtrecover" };

// TODO(api): replace mock with server fetch (auth + org scoping applied here).
export default function TodayPage() {
  const queue = urgentQueue();
  const k = DASHBOARD_KPIS;

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
        title="Today / Urgent"
        description="Exception-first queue. Every row is the smallest safe next action for a blocked case — highest amount at risk and closest deadline first."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardContent className="p-3">
              <p className="text-[11px] text-muted-foreground">{t.label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{t.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <TodayQueue items={queue} />
    </div>
  );
}
