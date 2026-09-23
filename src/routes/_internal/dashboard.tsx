/**
 * TanStack Start adapter for src/app/(internal)/dashboard/page.tsx. Same
 * data (getDashboardData -> repo KPIs, urgent queue, trend, ageing, stage
 * funnel) and the same components; only the layout differs. No figure here
 * is derived client-side -- every number is a field from the loader.
 * Authorization is enforced by the parent _internal layout route.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  ChevronRight,
  FolderKanban,
  ShieldCheck,
  TriangleAlert,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/tanstack/link-button";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { WaitingOnPill } from "@/components/ui/status-pill";
import { RecoveryTrend } from "@/components/charts/recovery-trend";
import { AgeingBars } from "@/components/charts/ageing-bars";
import { StageFunnel } from "@/components/charts/stage-funnel";
import { getDashboardData } from "@/lib/dashboard.functions";
import type { QueueItem } from "@/lib/mock-data";
import { cn, formatInr, formatInrCompact } from "@/lib/utils";

export const Route = createFileRoute("/_internal/dashboard")({
  loader: () => getDashboardData(),
  component: DashboardPage,
  head: () => ({ meta: [{ title: "Dashboard — Debtrecover" }] }),
});

const DUE_META: Record<QueueItem["dueState"], { label: string; tone: "danger" | "warning" | "info" | "neutral" }> = {
  overdue: { label: "Overdue", tone: "danger" },
  today: { label: "Due today", tone: "warning" },
  upcoming: { label: "Upcoming", tone: "info" },
  none: { label: "No due date", tone: "neutral" },
};

const ACTIONS_SHOWN = 5;

function DashboardPage() {
  const { k, queue, trend, ageing, stageFunnel } = Route.useLoaderData();

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Kolkata",
  });
  const top = queue[0];
  const actions = queue.slice(0, ACTIONS_SHOWN);

  const ops = [
    { label: "Open cases", value: k.openCases, href: "/cases", Icon: FolderKanban, alert: false },
    { label: "Urgent tasks", value: k.urgentTasks, href: "/today", Icon: TriangleAlert, alert: k.urgentTasks > 0 },
    { label: "Awaiting client", value: k.awaitingClient, href: "/today", Icon: Users, alert: false },
    { label: "Portal runs", value: k.portalRuns, href: "/gst", Icon: ShieldCheck, alert: false },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={`${today} · IST`}
        title="Dashboard"
        description="Portfolio-wide recovery metrics across every client. For the ranked exception queue, see Today / Urgent."
        size="hero"
        actions={
          <LinkButton href="/today" variant="primary" className="h-9 px-3.5 text-sm">
            <CalendarClock className="h-4 w-4" /> Go to Today / Urgent
          </LinkButton>
        }
      />

      {/* KPIs: money first, then the operational counts */}
      <section aria-label="Key figures" className="grid gap-3 md:grid-cols-2 xl:grid-cols-12">
        <HeroFigure
          className="xl:col-span-4"
          label="Under recovery"
          value={formatInrCompact(k.amountUnderRecovery)}
          exact={formatInr(k.amountUnderRecovery)}
          note={`${k.openCases} open case${k.openCases === 1 ? "" : "s"}`}
        />
        <HeroFigure
          className="xl:col-span-4"
          label="Recovered (confirmed)"
          value={formatInrCompact(k.recoveredThisMonth)}
          exact={formatInr(k.recoveredThisMonth)}
          note="Client-confirmed receipts"
          tone="success"
        />
        <div className="grid grid-cols-2 gap-3 md:col-span-2 md:grid-cols-4 xl:col-span-4 xl:grid-cols-2">
          {ops.map(({ label, value, href, Icon, alert }) => (
            <Link
              key={label}
              to={href}
              className={cn(
                "group flex flex-col justify-between gap-2 rounded-lg border bg-card p-3.5 shadow-xs transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                alert ? "border-danger/30" : "border-border",
              )}
            >
              <span className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                {label}
                <Icon className={cn("h-3.5 w-3.5", alert ? "text-danger" : "text-muted-foreground")} />
              </span>
              <span className={cn("text-2xl font-semibold tabular-nums leading-none", alert && "text-danger")}>
                {value}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-12">
        {/* Today's required actions */}
        <Card className="min-w-0 xl:col-span-7">
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle>Today&apos;s required actions</CardTitle>
              <CardDescription>
                {queue.length === 0
                  ? "Nothing is blocked on a decision."
                  : `Top ${actions.length} of ${queue.length} open item${queue.length === 1 ? "" : "s"}, highest risk and nearest deadline first.`}
              </CardDescription>
            </div>
            {queue.length > 0 ? (
              <LinkButton href="/today" variant="ghost" className="shrink-0">
                View all <ArrowRight className="h-3.5 w-3.5" />
              </LinkButton>
            ) : null}
          </CardHeader>
          <CardContent className="px-2 pb-2">
            {actions.length === 0 ? (
              <EmptyState
                className="m-3 border-0 bg-transparent"
                title="Nothing needs a decision right now"
                description="Blocked cases surface here as the smallest safe next action."
              />
            ) : (
              <ol className="flex flex-col">
                {actions.map((item) => (
                  <li key={item.taskId}>
                    <ActionRow item={item} />
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <div className="flex min-w-0 flex-col gap-4 xl:col-span-5">
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
          <Card className="flex-1">
            <CardHeader>
              <CardTitle>Stage-wise progress</CardTitle>
              <CardDescription>Cases and value by workflow stage, all clients</CardDescription>
            </CardHeader>
            <CardContent>
              <StageFunnel data={stageFunnel} />
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recovery trend</CardTitle>
            <CardDescription>Last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            {trend.length > 0 ? (
              <RecoveryTrend data={trend} />
            ) : (
              <EmptyState
                className="border-0 bg-transparent py-8"
                title="No trend data yet"
                description="Recovery allocations will populate this once payments are recorded."
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Ageing</CardTitle>
            <CardDescription>Outstanding by days past due, all clients</CardDescription>
          </CardHeader>
          <CardContent>
            <AgeingBars data={ageing.map((a) => ({ bucket: a.bucket, amount: a.amount }))} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function HeroFigure({
  label,
  value,
  exact,
  note,
  tone = "neutral",
  className,
}: {
  label: string;
  value: string;
  exact: string;
  note: string;
  tone?: "neutral" | "success";
  className?: string;
}) {
  return (
    <Card className={cn("relative overflow-hidden", className)}>
      <CardContent className="flex h-full flex-col gap-2 p-5">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <span
          className={cn(
            "text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl",
            tone === "success" ? "text-success" : "text-foreground",
          )}
          title={exact}
        >
          {value}
        </span>
        <span className="mt-auto text-xs text-muted-foreground">
          <span className="sr-only">Exact amount {exact}. </span>
          {note}
        </span>
      </CardContent>
    </Card>
  );
}

function ActionRow({ item }: { item: QueueItem }) {
  const due = DUE_META[item.dueState];
  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", item.urgent ? "bg-danger" : "bg-border")}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm font-medium text-foreground">{item.nextSafeAction}</span>
        <span className="truncate text-xs text-muted-foreground">
          {item.client}
          {item.debtor ? <> &middot; {item.debtor}</> : null}
        </span>
        <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {item.urgent ? <Badge tone="danger">Urgent</Badge> : null}
          <Badge tone={due.tone}>{due.label}</Badge>
          <WaitingOnPill value={item.waitingOn} />
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1 text-right">
        <span className="text-sm font-semibold tabular-nums">
          {item.amountAtRisk > 0 ? formatInr(item.amountAtRisk) : "—"}
        </span>
        <span className="text-[11px] text-muted-foreground">at risk</span>
      </span>
      {item.caseId ? (
        <ChevronRight aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
      ) : (
        <ArrowUpRight aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-transparent" />
      )}
    </>
  );
  const cls =
    "flex items-start gap-3 rounded-md px-3 py-3 transition-colors focus-visible:outline-2 focus-visible:outline-ring";
  return item.caseId ? (
    <Link to="/cases/$id" params={{ id: item.caseId }} className={cn(cls, "hover:bg-muted/60")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
