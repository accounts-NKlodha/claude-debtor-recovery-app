import { notFound } from "next/navigation";
import { CaseDetail, type CaseDetailVM } from "@/components/screens/case-detail";
import { getRepo } from "@/server/repo";

// TODO(api): add row-level authorization once auth lands (client users must
// only reach cases in their own organisation).
export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const repo = getRepo();
  const kase = await repo.getCase(id);
  if (!kase) notFound();

  const [debtor, org, invoices, communications, payments, tasks, allocations, ddRecord, hearings, debtorReplies] =
    await Promise.all([
      repo.getDebtor(kase.debtorId),
      repo.getOrg(kase.organisationId),
      repo.listInvoicesForCase(id),
      repo.listCommunicationsForCase(id),
      repo.listPaymentsForCase(id),
      repo.listTasksForCase(id),
      repo.listAllocationsForCase(id),
      repo.getDdRecord(id),
      repo.listHearingsForCase(id),
      repo.listDebtorRepliesForCase(id),
    ]);

  const vm: CaseDetailVM = {
    kase,
    clientName: org?.legalEntityName ?? "—",
    debtorName: debtor?.name ?? "—",
    debtorGstin: debtor?.gstin ?? null,
    debtorAddress: debtor?.address ?? null,
    assignee: await repo.assigneeName(kase.assigneeId),
    invoices,
    communications,
    payments,
    tasks: tasks.filter((t) => !t.resolvedAt),
    allocations,
    ddRecord,
    hearings,
    debtorReplies,
  };

  return <CaseDetail vm={vm} />;
}
