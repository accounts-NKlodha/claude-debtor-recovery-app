import { notFound } from "next/navigation";
import { CaseDetail, type CaseDetailVM } from "@/components/screens/case-detail";
import {
  assigneeName,
  getCase,
  getDebtor,
  getOrg,
  listCommunicationsForCase,
  listInvoicesForCase,
  listPaymentsForCase,
  listTasksForCase,
} from "@/lib/mock-data";

// TODO(api): replace mock with server fetch + row-level authorization.
export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const kase = getCase(id);
  if (!kase) notFound();

  const debtor = getDebtor(kase.debtorId);
  const vm: CaseDetailVM = {
    kase,
    clientName: getOrg(kase.organisationId)?.legalEntityName ?? "—",
    debtorName: debtor?.name ?? "—",
    debtorGstin: debtor?.gstin ?? null,
    debtorAddress: debtor?.address ?? null,
    assignee: assigneeName(kase.assigneeId),
    invoices: listInvoicesForCase(id),
    communications: listCommunicationsForCase(id),
    payments: listPaymentsForCase(id),
    tasks: listTasksForCase(id).filter((t) => !t.resolvedAt),
  };

  return <CaseDetail vm={vm} />;
}
