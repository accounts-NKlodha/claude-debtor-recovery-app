/**
 * TanStack Start adapter for src/app/(internal)/gst/page.tsx. Identical
 * JSX -- reuses PageHeader, Card, EmptyState, StatusPill verbatim; only
 * LinkButton swapped for the TanStack adapter. Authorization is enforced
 * by the parent _internal layout route.
 *
 * Lives in gst/ alongside $caseId.tsx as an independent sibling (no
 * gst.tsx layout file) -- same reasoning as cases/ in M1 Batch 2: a flat
 * gst.tsx + gst.$caseId.tsx pairing would make the router treat gst.tsx
 * as gst.$caseId's implicit parent/layout, which silently breaks the
 * detail route (gst.tsx's component has no <Outlet/>).
 */
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { LinkButton } from "@/components/tanstack/link-button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { getGstListData } from "@/lib/gst-list.functions";
import { formatInr } from "@/lib/utils";

export const Route = createFileRoute("/_internal/gst/")({
  loader: () => getGstListData(),
  component: GstIndexPage,
  head: () => ({ meta: [{ title: "Portal runs — Debtrecover" }] }),
});

function GstIndexPage() {
  const { rows } = Route.useLoaderData();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Portal runs · GST communication"
        title="GST assisted notification"
        description="Operator-assisted only — staff completes CAPTCHA and final Send. Open a case to prepare and file."
      />
      {rows.length === 0 ? (
        <EmptyState title="No cases on the GST route right now" />
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
                  <LinkButton href={`/gst/${c.id}`} variant="primary">
                    Open
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
