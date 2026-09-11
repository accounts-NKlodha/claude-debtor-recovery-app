import { TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/link-button";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { TodayQueue } from "@/components/screens/today-queue";
import { getRepo } from "@/server/repo";
import { formatInr } from "@/lib/utils";

export const metadata = { title: "Today / Urgent — Debtrecover" };

// TODO(api): scope to the signed-in staff member's org access once auth lands.
export default async function TodayPage() {
  const repo = getRepo();
  const queue = await repo.urgentQueue();

  const urgentCount = queue.filter((i) => i.urgent).length;
  const urgentAmount = queue.filter((i) => i.urgent).reduce((s, i) => s + i.amountAtRisk, 0);
  const top = queue[0];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Exception-first queue"
        title="Today / Urgent"
        description="Every row is the smallest safe next action for a blocked case — highest amount at risk and closest deadline first."
        actions={<LinkButton href="/intake" variant="primary">+ New intake</LinkButton>}
      />

      {urgentCount > 0 ? (
        <div className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-bg px-4 py-3 text-danger">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="text-sm font-semibold">
              {urgentCount} urgent action{urgentCount === 1 ? "" : "s"} need attention
            </p>
            <p className="text-xs opacity-90">
              Holding {formatInr(urgentAmount)} across cases waiting on staff or client.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <TodayQueue items={queue} />
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
          />
        ) : null}
      </div>
    </div>
  );
}
