/**
 * TanStack Start adapter for src/app/(internal)/msme/[caseId]/page.tsx.
 * Identical JSX -- reuses PageHeader verbatim and the MsmeWizard adapter
 * (only its Next Server Action / next/navigation dependencies swapped,
 * see src/components/tanstack/msme-wizard.tsx). Authorization is enforced
 * by the parent _internal layout route.
 */
import { createFileRoute, notFound } from "@tanstack/react-router";
import { PageHeader } from "@/components/ui/page-header";
import { MsmeWizard } from "@/components/tanstack/msme-wizard";
import { getMsmeDetailData } from "@/lib/msme-detail.functions";

export const Route = createFileRoute("/_internal/msme/$caseId")({
  loader: async ({ params }) => {
    const seed = await getMsmeDetailData({ data: { caseId: params.caseId } });
    if (!seed) throw notFound();
    return seed;
  },
  component: MsmeDetailPage,
  head: () => ({ meta: [{ title: "MSME ODR filing — Debtrecover" }] }),
});

function MsmeDetailPage() {
  const seed = Route.useLoaderData();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={`Case ${seed.caseId} · ${seed.clientName}`}
        title="MSME ODR / MSEFC filing"
        description="Seven-stage filing observed from the MSME Samadhaan flow. Save and resume at any stage; the submitted snapshot is immutable."
      />
      <MsmeWizard seed={seed} />
    </div>
  );
}
