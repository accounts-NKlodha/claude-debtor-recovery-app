/**
 * TanStack Start adapter for src/components/screens/comms-log.tsx --
 * identical markup/behavior, only `@/components/ui/link-button` (wraps
 * next/link) swapped for the TanStack adapter (@/components/tanstack/
 * link-button, wraps TanStack Router's <Link to>). Only exists on the
 * TanStack port branch; the Next.js original is untouched.
 */
"use client";

import * as React from "react";
import { Mail, MessageSquareText, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { Communication } from "@/contract/types";
import { CHANNEL, COMMUNICATION_DIRECTION, DELIVERY_STATUS } from "@/contract/enums";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/tanstack/link-button";
import { EmptyState } from "@/components/ui/empty-state";
import { ChipFilterRow, type ChipOption } from "@/components/ui/chip-filter";

export interface CommRow extends Communication {
  clientName: string;
  debtorName: string;
}

type QuickFilter = "all" | "review" | "failed";

function needsReview(r: CommRow) {
  return r.direction === "inbound" && !r.reviewedById;
}
function isFailure(r: CommRow) {
  return r.deliveryStatus === "failed" || r.deliveryStatus === "bounced";
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 min-w-36 rounded-md border border-input bg-card px-2 text-sm font-normal capitalize text-foreground shadow-xs"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CommsLog({
  rows,
  initialCase,
}: {
  rows: CommRow[];
  initialCase?: string;
}) {
  const [quickFilter, setQuickFilter] = React.useState<QuickFilter>("all");
  const [channel, setChannel] = React.useState("");
  const [direction, setDirection] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [openThread, setOpenThread] = React.useState<string | null>(
    initialCase ? (rows.find((r) => r.caseId === initialCase)?.threadRef ?? null) : null,
  );

  const quickOptions: ChipOption<QuickFilter>[] = [
    { value: "all", label: "All messages", count: rows.length },
    { value: "review", label: "Needs human review", count: rows.filter(needsReview).length },
    { value: "failed", label: "Delivery failures", count: rows.filter(isFailure).length },
  ];

  const filtered = rows.filter(
    (r) =>
      (!channel || r.channel === channel) &&
      (!direction || r.direction === direction) &&
      (!status || r.deliveryStatus === status) &&
      (quickFilter === "all" || (quickFilter === "review" ? needsReview(r) : isFailure(r))),
  );

  const threads = Array.from(
    filtered.reduce((map, r) => {
      const key = r.threadRef ?? r.id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
      return map;
    }, new Map<string, CommRow[]>()),
  );

  const active = openThread
    ? rows
        .filter((r) => (r.threadRef ?? r.id) === openThread)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    : null;

  return (
    <div className="flex flex-col gap-4">
      <ChipFilterRow
        aria-label="Quick-filter communications"
        options={quickOptions}
        value={quickFilter}
        onChange={setQuickFilter}
      />
      <div className="flex flex-wrap gap-3">
        <Select label="Channel" value={channel} onChange={setChannel} options={CHANNEL} />
        <Select
          label="Direction"
          value={direction}
          onChange={setDirection}
          options={COMMUNICATION_DIRECTION}
        />
        <Select label="Delivery status" value={status} onChange={setStatus} options={DELIVERY_STATUS} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
        <div className="flex flex-col gap-2">
          {threads.length === 0 ? (
            <EmptyState title="No messages match these filters" />
          ) : (
            threads.map(([key, msgs]) => {
              const last = msgs[msgs.length - 1];
              const isOpen = openThread === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setOpenThread(key)}
                  aria-current={isOpen ? "true" : undefined}
                  className={cn(
                    "flex flex-col gap-1 rounded-lg border p-3 text-left shadow-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                    isOpen ? "border-primary/50 bg-accent" : "border-border bg-card hover:bg-muted/60",
                  )}
                >
                  <div className="flex items-center gap-2">
                    {last.channel === "email" ? (
                      <Mail className="h-3.5 w-3.5" />
                    ) : (
                      <MessageSquareText className="h-3.5 w-3.5" />
                    )}
                    <span className="truncate text-sm font-medium">{last.debtorName}</span>
                    <span className="ml-auto text-[11px] text-muted-foreground">{msgs.length} msg</span>
                  </div>
                  <p className="line-clamp-1 text-xs text-muted-foreground">{last.body}</p>
                  {msgs.some(isFailure) ? (
                    <Badge tone="danger" className="self-start">
                      Delivery failed
                    </Badge>
                  ) : null}
                  <span className="text-[11px] text-muted-foreground">{last.clientName}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-4 shadow-xs lg:sticky lg:top-20 lg:self-start">
          {!active || active.length === 0 ? (
            <EmptyState title="Select a thread" description="Choose a conversation on the left to read the full exchange." />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
                <div>
                  <p className="text-sm font-semibold">{active[0].debtorName}</p>
                  <p className="text-xs text-muted-foreground">{active[0].clientName}</p>
                </div>
                {active[0].caseId ? (
                  <LinkButton href={`/cases/${active[0].caseId}`}>Open case</LinkButton>
                ) : null}
              </div>
              {active.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "max-w-[85%] rounded-lg border px-3 py-2 text-sm",
                    m.direction === "outbound"
                      ? "ml-auto border-primary/30 bg-accent"
                      : "border-border bg-muted",
                  )}
                >
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {m.direction === "outbound" ? (
                      <ArrowUpRight className="h-3 w-3" />
                    ) : (
                      <ArrowDownLeft className="h-3 w-3" />
                    )}
                    {m.channel} &middot;{" "}
                    <span className={cn(isFailure(m) && "font-medium text-danger")}>{m.deliveryStatus}</span>
                    {m.replyClassification ? (
                      <Badge tone="info" className="ml-1">
                        {m.replyClassification.replace(/_/g, " ")}
                      </Badge>
                    ) : null}
                    <span className="ml-auto">
                      {new Date(m.createdAt).toLocaleString("en-IN", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                  {m.subject ? <p className="font-medium">{m.subject}</p> : null}
                  <p>{m.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
