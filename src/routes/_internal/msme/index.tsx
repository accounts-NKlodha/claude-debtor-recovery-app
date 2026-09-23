/**
 * TanStack Start adapter for src/app/(internal)/msme/page.tsx. Identical
 * JSX -- reuses PageHeader, Card, EmptyState, StatusPill verbatim; only
 * LinkButton swapped for the TanStack adapter. Authorization is enforced
 * by the parent _internal layout route.
 *
 * Lives in msme/ alongside $caseId.tsx as an independent sibling -- same
 * reasoning as gst/ above and cases/ in M1 Batch 2.
 */
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
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
        <div className="flex flex-col gap-2">
          {rows.map(({ c, debtor, org }) => (
            <Card key={c.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-sm font-medium">{debtor?.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {org?.legalEntityName} &middot; {formatInr(c.principalOutstanding)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill status={c.status} />
                  <LinkButton href={`/msme/${c.id}`} variant="primary">
                    Open wizard
                  </LinkButton>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
