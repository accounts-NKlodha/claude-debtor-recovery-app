/**
 * TanStack Start equivalent of src/app/(internal)/cases/[id]/page.tsx's
 * data assembly (M1 Batch 2). Identical repository calls, identical
 * "view-only, must not take the page down" failure tolerance for
 * promises/WhatsApp-offers/activation-gates. Authorization is enforced by
 * the parent _internal layout route; RLS is independent defense-in-depth,
 * same as every other Batch 1/2 route.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import { toOfferView } from "@/domain/whatsapp-messages";
import { isPreActivation } from "@/domain/activation";

export const getCaseDetailData = createServerFn({ method: "GET" })
  .validator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    const { id } = data;
    const repo = await getRepo();
    const kase = await repo.getCase(id);
    if (!kase) return null;

    const [
      debtor,
      org,
      invoices,
      communications,
      payments,
      tasks,
      allocations,
      ddRecord,
      hearings,
      debtorReplies,
      promises,
      whatsAppOffers,
      activationGates,
    ] = await Promise.all([
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

    return {
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
  });
