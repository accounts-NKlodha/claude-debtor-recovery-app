import { PageHeader } from "@/components/ui/page-header";
import { CommsLog, type CommRow } from "@/components/screens/comms-log";
import { getRepo } from "@/server/repo";

export const metadata = { title: "Communications — Debtrecover" };

// Staff/admin sessions intentionally see communications across every client
// organisation (PRD §4's legitimate staff cross-org capability) -- there is
// no per-staff org scope to add here. Authorization for this page is
// enforced by the shared (internal) layout (src/app/(internal)/layout.tsx),
// with RLS as independent defense-in-depth (see docs/authorization-hardening).
export default async function CommunicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ case?: string }>;
}) {
  const { case: caseId } = await searchParams;
  const repo = getRepo();
  const comms = await repo.listAllCommunications();
  const rows: CommRow[] = await Promise.all(
    comms.map(async (c) => {
      const kase = await repo.getCase(c.caseId);
      const [org, debtor] = await Promise.all([
        repo.getOrg(c.organisationId),
        kase ? repo.getDebtor(kase.debtorId) : Promise.resolve(undefined),
      ]);
      return {
        ...c,
        clientName: org?.legalEntityName ?? "—",
        debtorName: debtor?.name ?? "—",
      };
    }),
  );

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
