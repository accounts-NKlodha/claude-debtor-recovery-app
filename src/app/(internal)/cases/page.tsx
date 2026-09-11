import { PageHeader } from "@/components/ui/page-header";
import { CasesTable } from "@/components/screens/cases-table";
import { caseRows } from "@/lib/mock-data";

export const metadata = { title: "Cases — Debtrecover" };

// TODO(api): replace mock with server fetch (RLS-scoped list).
export default function CasesPage() {
  const rows = caseRows();
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
