/**
 * TanStack Start adapter for src/app/(internal)/audit/page.tsx. Identical
 * JSX -- reuses PageHeader, Card, EmptyState verbatim. Authorization is
 * enforced by the parent _internal layout route.
 */
import { createFileRoute } from "@tanstack/react-router";
import { ScrollText } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
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
        <EmptyState title="No audit events yet" />
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((e) => (
            <Card key={e.id}>
              <CardContent className="flex items-start gap-3 p-4">
                <ScrollText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-xs font-medium">{e.action}</span>
                    <span className="text-xs text-muted-foreground">
                      {e.entity} &middot; {e.entityId}
                    </span>
                  </div>
                  {e.reason ? <p className="text-sm">{e.reason}</p> : null}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{fmtDate(e.createdAt)}</span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
