"use client";

import * as React from "react";
import { ArrowRight, Clock, TriangleAlert } from "lucide-react";
import type { QueueItem } from "@/lib/mock-data";
import { formatInr } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import { WaitingOnPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { ChipFilterRow, type ChipOption } from "@/components/ui/chip-filter";

const DUE_META: Record<QueueItem["dueState"], { label: string; tone: "danger" | "warning" | "info" | "neutral" }> = {
  overdue: { label: "Overdue", tone: "danger" },
  today: { label: "Due today", tone: "warning" },
  upcoming: { label: "Upcoming", tone: "info" },
  none: { label: "No due date", tone: "neutral" },
};

type FilterKey = "all" | "urgent" | "staff" | "client" | "portal" | "system";

export function TodayQueue({ items }: { items: QueueItem[] }) {
  const [filter, setFilter] = React.useState<FilterKey>("all");

  const options: ChipOption<FilterKey>[] = [
    { value: "all", label: "All", count: items.length },
    { value: "urgent", label: "Urgent", count: items.filter((i) => i.urgent).length },
    { value: "staff", label: "Waiting on staff", count: items.filter((i) => i.waitingOn === "staff").length },
    { value: "client", label: "Waiting on client", count: items.filter((i) => i.waitingOn === "client").length },
    { value: "portal", label: "Waiting on portal", count: items.filter((i) => i.waitingOn === "portal").length },
  ];

  const shown =
    filter === "all"
      ? items
      : filter === "urgent"
        ? items.filter((i) => i.urgent)
        : items.filter((i) => i.waitingOn === filter);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">Priority work</h2>
      </div>
      <ChipFilterRow aria-label="Filter priority work" options={options} value={filter} onChange={setFilter} />

      {shown.length === 0 ? (
        <EmptyState
          title="Nothing needs a decision right now"
          description="When automation hits a safe blocker — low-confidence data, a certification, a dispute, a payment confirmation — it will surface here as the smallest next action."
        />
      ) : (
        <ol className="flex flex-col gap-2">
          {shown.map((item, i) => {
            const due = DUE_META[item.dueState];
            return (
              <li
                key={item.taskId}
                className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center"
              >
                <span
                  aria-hidden
                  className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums sm:flex"
                >
                  {i + 1}
                </span>
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
