import { PageHeader } from "@/components/ui/page-header";
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
        description="Every recovery case across clients. Sort and filter to triage; click a row for the full case."
      />
      <CasesTable rows={rows} />
    </div>
  );
}
