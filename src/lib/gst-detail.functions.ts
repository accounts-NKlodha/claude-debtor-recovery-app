/**
 * TanStack Start equivalent of src/app/(internal)/gst/[caseId]/page.tsx's
 * data assembly (M1 Batch 4, read-only).
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import { requireStaffSession } from "@/lib/auth/tanstack-session";

export const getGstDetailData = createServerFn({ method: "GET" })
  .validator((data: unknown) => data as { caseId: string })
  .handler(async ({ data }) => {
    const { caseId } = data;
    await requireStaffSession();
    const repo = await getRepo();
    const kase = await repo.getCase(caseId);
    if (!kase) return null;

    const [debtor, org, invoices] = await Promise.all([
      repo.getDebtor(kase.debtorId),
      repo.getOrg(kase.organisationId),
      repo.listInvoicesForCase(caseId),
    ]);

    return {
      caseId,
      debtorName: debtor?.name ?? "—",
      recipientGstin: debtor?.gstin ?? "08AAAAA0000A1Z0",
      clientName: org?.legalEntityName ?? "—",
      principalOutstanding: kase.principalOutstanding,
      invoiceCount: Math.max(1, invoices.length),
    };
  });
