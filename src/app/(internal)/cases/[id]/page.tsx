import { notFound } from "next/navigation";
import { CaseDetail, type CaseDetailVM } from "@/components/screens/case-detail";
import { getRepo } from "@/server/repo";
import { toOfferView } from "@/domain/whatsapp-messages";
import { isPreActivation } from "@/domain/activation";

// Client users cannot reach this page at all -- it lives under (internal),
// gated to staff/admin sessions only by the shared layout
// (src/app/(internal)/layout.tsx, authorization hardening task). RLS
// remains independent defense-in-depth for row-level tenant isolation (see
// docs/authorization-hardening); staff/admin sessions intentionally see
// cases across every client organisation (PRD §4).
export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const repo = getRepo();
  const kase = await repo.getCase(id);
  if (!kase) notFound();

  const [debtor, org, invoices, communications, payments, tasks, allocations, ddRecord, hearings, debtorReplies, promises, whatsAppOffers, activationGates] =
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
      // View-only: must not take the page down (e.g. before migration 0023 is applied).
      repo.listPromisesForCase(id).catch(() => []),
      // View-only: a failure here must never take the case page down.
      repo.getWhatsAppOffers(id).catch(() => []),
      // View-only, and only meaningful before activation.
      isPreActivation(kase.status) ? repo.getActivationGates(id).catch(() => null) : Promise.resolve(null),
    ]);

  const vm: CaseDetailVM = {
    kase,
    clientName: org?.legalEntityName ?? "—",
    debtorId: kase.debtorId,
    debtorName: debtor?.name ?? "—",
    debtorGstin: debtor?.gstin ?? null,
    debtorAddress: debtor?.address ?? null,
    debtorEmail: debtor?.email ?? null,
    debtorMobile: debtor?.mobile ?? null,
    assignee: await repo.assigneeName(kase.assigneeId),
    invoices,
    communications,
    payments,
    tasks: tasks.filter((t) => !t.resolvedAt),
    allocations,
    ddRecord,
    hearings,
    debtorReplies,
    promises,
    whatsAppOffers: whatsAppOffers.map(toOfferView),
    activationGates,
  };

  return <CaseDetail vm={vm} />;
}
