import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { MsmeWizard, type MsmeSeed } from "@/components/screens/msme-wizard";
import { getRepo } from "@/server/repo";
import { formatInr } from "@/lib/utils";

export const metadata = { title: "MSME ODR filing — Debtrecover" };

// TODO(api): replace mock with server fetch + saved draft hydration.
export default async function MsmePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const repo = getRepo();
  const kase = await repo.getCase(caseId);
  if (!kase) notFound();
  const [debtor, org] = await Promise.all([repo.getDebtor(kase.debtorId), repo.getOrg(kase.organisationId)]);

  const seed: MsmeSeed = {
    caseId,
    claimantName: org?.legalEntityName ?? "—",
    claimantUdyam: org?.udyamNumber ?? "",
    respondentName: debtor?.name ?? "—",
    respondentGstin: debtor?.gstin ?? "",
    claimAmount: formatInr(kase.principalOutstanding, { withSymbol: false }),
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="MSME ODR / MSEFC filing"
        description="Seven-stage filing observed from the MSME Samadhaan flow. Save and resume at any stage; the submitted snapshot is immutable."
      />
      <MsmeWizard seed={seed} />
    </div>
  );
}
