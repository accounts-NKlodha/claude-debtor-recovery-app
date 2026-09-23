/**
 * TanStack Start adapter for src/app/(internal)/audit/page.tsx. Same data;
 * presented as a single ledger list. Authorization is enforced by the
 * parent _internal layout route.
 */
import { createFileRoute } from "@tanstack/react-router";
import { ScrollText } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getAuditData } from "@/lib/audit.functions";

function fmtDate(s: string) {
  return new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export const Route = createFileRoute("/_internal/audit")({
  loader: () => getAuditData(),
  component: AuditPage,
  head: () => ({ meta: [{ title: "Audit / Security — Debtrecover" }] }),
});

function AuditPage() {
  const { entries } = Route.useLoaderData();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Audit & security"
        title="Audit event log"
        description="Every create, change, view, external action and admin override is recorded here, append-only, newest first."
      />

      {entries.length === 0 ? (
        <EmptyState icon={<ScrollText />} title="No audit events yet" />
      ) : (
        <Card>
          <div className="flex items-center justify-between border-b border-border px-5 py-3 text-xs text-muted-foreground">
            <span>
              {entries.length} event{entries.length === 1 ? "" : "s"} · newest first
            </span>
            <span className="hidden sm:inline">Append-only</span>
          </div>
          <ol className="divide-y divide-border">
            {entries.map((e) => (
              <li key={e.id} className="flex flex-col gap-1.5 px-5 py-3.5 sm:flex-row sm:items-start sm:gap-4">
                <time
                  dateTime={e.createdAt}
                  className="shrink-0 text-xs tabular-nums text-muted-foreground sm:w-40 sm:pt-0.5"
                >
                  {fmtDate(e.createdAt)}
                </time>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-foreground">
                      {e.action}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {e.entity} &middot; <span className="font-mono">{e.entityId ?? "—"}</span>
                    </span>
                    <Badge tone={e.actorRole === "system" ? "neutral" : "primary"} className="ml-auto">
                      {e.actorRole}
                    </Badge>
                  </div>
                  {e.reason ? <p className="text-sm text-foreground/90">{e.reason}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
