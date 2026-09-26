/**
 * TanStack Start equivalent of src/app/(internal)/msme/[caseId]/page.tsx's
 * data assembly (M1 Batch 4, read-only).
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import { requireStaffSession } from "@/lib/auth/tanstack-session";
import { formatInr } from "@/lib/utils";

export const getMsmeDetailData = createServerFn({ method: "GET" })
  .validator((data: unknown) => data as { caseId: string })
  .handler(async ({ data }) => {
    const { caseId } = data;
    await requireStaffSession();
    const repo = await getRepo();
    const kase = await repo.getCase(caseId);
    if (!kase) return null;

    const [debtor, org] = await Promise.all([repo.getDebtor(kase.debtorId), repo.getOrg(kase.organisationId)]);

    return {
      caseId,
      claimantName: org?.legalEntityName ?? "—",
      claimantUdyam: org?.udyamNumber ?? "",
      respondentName: debtor?.name ?? "—",
      respondentGstin: debtor?.gstin ?? "",
      claimAmount: formatInr(kase.principalOutstanding, { withSymbol: false }),
      clientName: org?.legalEntityName ?? "—",
    };
  });
