import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { GstScreen, type GstPack } from "@/components/screens/gst-screen";
import { getRepo } from "@/server/repo";

export const metadata = { title: "GST communication — Debtrecover" };

// TODO(api): replace mock with server fetch.
export default async function GstPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const repo = getRepo();
  const kase = await repo.getCase(caseId);
  if (!kase) notFound();
  const [debtor, org, invoices] = await Promise.all([
    repo.getDebtor(kase.debtorId),
    repo.getOrg(kase.organisationId),
    repo.listInvoicesForCase(caseId),
  ]);

  const pack: GstPack = {
    caseId,
    debtorName: debtor?.name ?? "—",
    recipientGstin: debtor?.gstin ?? "08AAAAA0000A1Z0",
    clientName: org?.legalEntityName ?? "—",
    principalOutstanding: kase.principalOutstanding,
    invoiceCount: Math.max(1, invoices.length),
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={`Case ${caseId} · ${pack.clientName}`}
        title="GST taxpayer communication"
        description="Prepare and file a communication on the GST portal. The system prefills and validates; a person completes the CAPTCHA and presses Send."
      />
      <GstScreen pack={pack} />
    </div>
  );
}
