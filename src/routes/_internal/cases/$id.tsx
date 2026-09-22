/**
 * TanStack Start adapter for src/app/(internal)/cases/[id]/page.tsx (M1
 * Batch 2) -- the case-detail hub. Reuses the CaseDetail adapter (thin
 * copy of src/components/screens/case-detail.tsx, see
 * src/components/tanstack/case-detail.tsx for what changed and why).
 * Authorization is enforced by the parent _internal layout route.
 *
 * Lives in cases/ alongside index.tsx as an independent sibling -- see
 * that file's doc comment for why a flat cases.tsx + cases.$id.tsx pairing
 * doesn't work.
 */
import { createFileRoute, notFound } from "@tanstack/react-router";
import { CaseDetail } from "@/components/tanstack/case-detail";
import { getCaseDetailData } from "@/lib/case-detail.functions";

export const Route = createFileRoute("/_internal/cases/$id")({
  loader: async ({ params }) => {
    const vm = await getCaseDetailData({ data: { id: params.id } });
    if (!vm) throw notFound();
    return vm;
  },
  component: CaseDetailPage,
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `${loaderData.debtorName} — Debtrecover` : "Case — Debtrecover" }],
  }),
});

function CaseDetailPage() {
  const vm = Route.useLoaderData();
  return <CaseDetail vm={vm} />;
}
