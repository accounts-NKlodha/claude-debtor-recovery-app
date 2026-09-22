/**
 * TanStack Start adapter for src/app/(internal)/today/page.tsx. Identical
 * JSX -- reuses PageHeader, SpotlightCard, formatInr verbatim and the
 * TodayQueue adapter (only its LinkButton dependency swapped, see
 * src/components/tanstack/today-queue.tsx). Authorization is enforced by
 * the parent _internal layout route.
 */
import { createFileRoute } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/tanstack/link-button";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { TodayQueue } from "@/components/tanstack/today-queue";
import { getTodayData } from "@/lib/today.functions";
import { formatInr } from "@/lib/utils";

export const Route = createFileRoute("/_internal/today")({
  loader: () => getTodayData(),
  component: TodayPage,
  head: () => ({ meta: [{ title: "Today / Urgent — Debtrecover" }] }),
});

function TodayPage() {
  const { queue } = Route.useLoaderData();
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
