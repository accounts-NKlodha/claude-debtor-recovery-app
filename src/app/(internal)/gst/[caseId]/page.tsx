import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { GstScreen, type GstPack } from "@/components/screens/gst-screen";
import { getCase, getDebtor, getOrg, listInvoicesForCase } from "@/lib/mock-data";

export const metadata = { title: "GST communication — Debtrecover" };

// TODO(api): replace mock with server fetch.
export default async function GstPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const kase = getCase(caseId);
  if (!kase) notFound();
  const debtor = getDebtor(kase.debtorId);

  const pack: GstPack = {
    caseId,
    debtorName: debtor?.name ?? "—",
    recipientGstin: debtor?.gstin ?? "08AAAAA0000A1Z0",
    clientName: getOrg(kase.organisationId)?.legalEntityName ?? "—",
    principalOutstanding: kase.principalOutstanding,
    invoiceCount: Math.max(1, listInvoicesForCase(caseId).length),
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="GST taxpayer communication"
        description="Prepare and file a communication on the GST portal. The system prefills and validates; a person completes the CAPTCHA and presses Send."
      />
      <GstScreen pack={pack} />
    </div>
  );
}
