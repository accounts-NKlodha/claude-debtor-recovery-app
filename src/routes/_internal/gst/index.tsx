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
import { ShieldCheck } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
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
        <Card>
          <ul className="divide-y divide-border">
            {rows.map(({ c, debtor, org }) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                <span
                  aria-hidden="true"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground"
                >
                  <ShieldCheck className="h-4 w-4" />
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
                <LinkButton href={`/gst/${c.id}`} variant="primary">
                  Open
                </LinkButton>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
