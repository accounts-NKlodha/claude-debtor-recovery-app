/**
 * TanStack Start adapter for src/app/(internal)/cases/page.tsx. Identical
 * JSX -- reuses PageHeader verbatim and the CasesTable adapter (only its
 * next/navigation dependency swapped, see
 * src/components/tanstack/cases-table.tsx). Authorization is enforced by
 * the parent _internal layout route.
 *
 * Lives at cases/index.tsx (not a flat cases.tsx) so it and cases/$id.tsx
 * are independent siblings under _internal with no implicit layout
 * relationship between them -- a flat cases.tsx + cases.$id.tsx pairing
 * makes the router treat cases.tsx as cases.$id's parent, which silently
 * breaks case detail (cases.tsx's component has no <Outlet/>, so nothing
 * ever renders the child into it). See src/routes/_internal/cases/$id.tsx.
 */
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/tanstack/link-button";
import { CasesTable } from "@/components/tanstack/cases-table";
import { getCasesListData } from "@/lib/cases.functions";

export const Route = createFileRoute("/_internal/cases/")({
  loader: () => getCasesListData(),
  component: CasesPage,
  head: () => ({ meta: [{ title: "Cases — Debtrecover" }] }),
});

function CasesPage() {
  const { rows } = Route.useLoaderData();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Cases"
        description="Authorized cases stay separate by client and legal entity. Sort and filter to triage; click a row for the full case."
        actions={<LinkButton href="/intake" variant="primary">+ New intake</LinkButton>}
      />
      <CasesTable rows={rows} />
    </div>
  );
}
