import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { TodayQueue } from "@/components/screens/today-queue";
import { getRepo } from "@/server/repo";
import { formatInrCompact } from "@/lib/utils";

export const metadata = { title: "Today / Urgent — Debtrecover" };

// TODO(api): scope to the signed-in staff member's org access once auth lands.
export default async function TodayPage() {
  const repo = getRepo();
  const [queue, k] = await Promise.all([repo.urgentQueue(), repo.dashboardKpis()]);

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
