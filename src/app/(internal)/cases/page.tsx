import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/link-button";
import { CasesTable } from "@/components/screens/cases-table";
import { getRepo } from "@/server/repo";

export const metadata = { title: "Cases — Debtrecover" };

// TODO(api): scope to the signed-in staff member's org access once auth lands.
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
