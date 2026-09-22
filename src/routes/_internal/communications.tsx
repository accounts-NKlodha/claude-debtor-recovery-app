/**
 * TanStack Start adapter for src/app/(internal)/communications/page.tsx.
 * Identical JSX -- reuses PageHeader verbatim and the CommsLog adapter
 * (only its LinkButton dependency swapped, see
 * src/components/tanstack/comms-log.tsx). The `?case=` search param that
 * opens a specific thread is preserved via validateSearch/useSearch
 * (Next.js used an async `searchParams` page prop; TanStack Router's
 * search-params are the direct equivalent). Authorization is enforced by
 * the parent _internal layout route.
 */
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/ui/page-header";
import { CommsLog } from "@/components/tanstack/comms-log";
import { getCommunicationsData } from "@/lib/communications.functions";

export const Route = createFileRoute("/_internal/communications")({
  validateSearch: (search: Record<string, unknown>) => ({
    case: typeof search.case === "string" ? search.case : undefined,
  }),
  loader: () => getCommunicationsData(),
  component: CommunicationsPage,
  head: () => ({ meta: [{ title: "Communications — Debtrecover" }] }),
});

function CommunicationsPage() {
  const { rows } = Route.useLoaderData();
  const { case: caseId } = Route.useSearch();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Communications"
        description="Unified WhatsApp, email and postal log across every case. Filter by channel, direction or delivery status."
      />
      <CommsLog rows={rows} initialCase={caseId} />
    </div>
  );
}
