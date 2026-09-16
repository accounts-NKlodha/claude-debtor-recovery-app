import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/link-button";
import { CasesTable } from "@/components/screens/cases-table";
import { getRepo } from "@/server/repo";

export const metadata = { title: "Cases — Debtrecover" };

// Staff/admin sessions intentionally see cases across every client
// organisation (PRD §4's legitimate staff cross-org capability) -- there is
// no per-staff org scope to add here. Authorization for this page is
// enforced by the shared (internal) layout (src/app/(internal)/layout.tsx),
// with RLS as independent defense-in-depth (see docs/authorization-hardening).
export default async function CasesPage() {
  const rows = await getRepo().caseRows();
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
