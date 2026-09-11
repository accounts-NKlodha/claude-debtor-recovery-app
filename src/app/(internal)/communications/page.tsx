import { PageHeader } from "@/components/ui/page-header";
import { CommsLog, type CommRow } from "@/components/screens/comms-log";
import { COMMUNICATIONS, getCase, getDebtor, getOrg } from "@/lib/mock-data";

export const metadata = { title: "Communications — Debtrecover" };

// TODO(api): replace mock with server fetch.
export default async function CommunicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ case?: string }>;
}) {
  const { case: caseId } = await searchParams;
  const rows: CommRow[] = COMMUNICATIONS.map((c) => {
    const k = getCase(c.caseId);
    return {
      ...c,
      clientName: getOrg(c.organisationId)?.legalEntityName ?? "—",
      debtorName: k ? (getDebtor(k.debtorId)?.name ?? "—") : "—",
    };
  });

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
