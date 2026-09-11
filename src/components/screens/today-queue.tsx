"use client";

import * as React from "react";
import { ArrowRight, Clock, TriangleAlert } from "lucide-react";
import type { QueueItem } from "@/lib/mock-data";
import { cn, formatInr } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import { WaitingOnPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";

const DUE_META: Record<QueueItem["dueState"], { label: string; tone: "danger" | "warning" | "info" | "neutral" }> = {
  overdue: { label: "Overdue", tone: "danger" },
  today: { label: "Due today", tone: "warning" },
  upcoming: { label: "Upcoming", tone: "info" },
  none: { label: "No due date", tone: "neutral" },
};

const FILTERS = ["all", "staff", "client", "portal", "system"] as const;

export function TodayQueue({ items }: { items: QueueItem[] }) {
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]>("all");
  const shown = filter === "all" ? items : items.filter((i) => i.waitingOn === filter);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium capitalize transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              filter === f
                ? "border-transparent bg-accent text-accent-foreground"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {f === "all" ? "All" : `Waiting on ${f}`}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title="Nothing needs a decision right now"
          description="When automation hits a safe blocker — low-confidence data, a certification, a dispute, a payment confirmation — it will surface here as the smallest next action."
        />
      ) : (
        <ol className="flex flex-col gap-2">
          {shown.map((item) => {
            const due = DUE_META[item.dueState];
            return (
              <li
                key={item.taskId}
                className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {item.urgent && (
                      <Badge tone="danger" icon={<TriangleAlert />}>
                        Urgent
                      </Badge>
                    )}
                    <Badge tone={due.tone} icon={<Clock />}>
                      {due.label}
                    </Badge>
                    <WaitingOnPill value={item.waitingOn} />
                  </div>
                  <p className="text-sm font-medium">{item.nextSafeAction}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.client}
                    {item.debtor ? <> &middot; {item.debtor}</> : null}
                  </p>
                  {item.blocker && (
                    <p className="text-xs text-warning">Blocker: {item.blocker}</p>
                  )}
                </div>

                <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end">
                  <div className="text-right">
                    <p className="text-[11px] text-muted-foreground">Amount at risk</p>
                    <p className="text-sm font-semibold tabular-nums">
                      {item.amountAtRisk > 0 ? formatInr(item.amountAtRisk) : "—"}
                    </p>
                  </div>
                  {item.caseId ? (
                    <LinkButton href={`/cases/${item.caseId}`}>
                      Open case <ArrowRight className="h-3.5 w-3.5" />
                    </LinkButton>
                  ) : (
                    <Badge tone="neutral">Policy task</Badge>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
