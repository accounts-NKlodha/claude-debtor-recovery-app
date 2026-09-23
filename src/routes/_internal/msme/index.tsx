/**
 * TanStack Start adapter for src/app/(internal)/msme/page.tsx. Identical
 * JSX -- reuses PageHeader, Card, EmptyState, StatusPill verbatim; only
 * LinkButton swapped for the TanStack adapter. Authorization is enforced
 * by the parent _internal layout route.
 *
 * Lives in msme/ alongside $caseId.tsx as an independent sibling -- same
 * reasoning as gst/ above and cases/ in M1 Batch 2.
 */
import { Gavel } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/tanstack/link-button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { getMsmeListData } from "@/lib/msme-list.functions";
import { formatInr } from "@/lib/utils";

export const Route = createFileRoute("/_internal/msme/")({
  loader: () => getMsmeListData(),
  component: MsmeIndexPage,
  head: () => ({ meta: [{ title: "DD / Hearings — Debtrecover" }] }),
});

function MsmeIndexPage() {
  const { rows } = Route.useLoaderData();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Portal runs · MSME ODR / MSEFC"
        title="MSME ODR filing & hearings"
        description="Seven-stage assisted filing, DD preparation and hearing tracking. Post-submit portal login/live data is on hold pending live credentials."
      />
      {rows.length === 0 ? (
        <EmptyState title="No cases in MSME ODR right now" />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {rows.map(({ c, debtor, org }) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                <span
                  aria-hidden="true"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground"
                >
                  <Gavel className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{debtor?.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{org?.legalEntityName}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums">{formatInr(c.principalOutstanding)}</p>
                  <p className="text-[11px] text-muted-foreground">outstanding</p>
                </div>
                <StatusPill status={c.status} />
                <LinkButton href={`/msme/${c.id}`} variant="primary">
                  Open wizard
                </LinkButton>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
