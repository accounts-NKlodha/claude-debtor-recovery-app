/**
 * TanStack Start adapter for src/app/(internal)/gst/[caseId]/page.tsx.
 * Identical JSX -- reuses PageHeader verbatim and the GstScreen adapter
 * (only its Next Server Action / next/navigation dependencies swapped,
 * see src/components/tanstack/gst-screen.tsx). Authorization is enforced
 * by the parent _internal layout route.
 */
import { createFileRoute, notFound } from "@tanstack/react-router";
import { PageHeader } from "@/components/ui/page-header";
import { GstScreen } from "@/components/tanstack/gst-screen";
import { getGstDetailData } from "@/lib/gst-detail.functions";

export const Route = createFileRoute("/_internal/gst/$caseId")({
  loader: async ({ params }) => {
    const pack = await getGstDetailData({ data: { caseId: params.caseId } });
    if (!pack) throw notFound();
    return pack;
  },
  component: GstDetailPage,
  head: () => ({ meta: [{ title: "GST communication — Debtrecover" }] }),
});

function GstDetailPage() {
  const pack = Route.useLoaderData();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={`Case ${pack.caseId} · ${pack.clientName}`}
        title="GST taxpayer communication"
        description="Prepare and file a communication on the GST portal. The system prefills and validates; a person completes the CAPTCHA and presses Send."
      />
      <GstScreen pack={pack} />
    </div>
  );
}
