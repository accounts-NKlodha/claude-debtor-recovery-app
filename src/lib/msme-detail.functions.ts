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

    const [debtor, org, draft] = await Promise.all([
      repo.getDebtor(kase.debtorId),
      repo.getOrg(kase.organisationId),
      repo.getMsmeDraft(caseId),
    ]);

    return {
      caseId,
      claimantName: org?.legalEntityName ?? "—",
      claimantUdyam: org?.udyamNumber ?? "",
      respondentName: debtor?.name ?? "—",
      respondentGstin: debtor?.gstin ?? "",
      claimAmount: formatInr(kase.principalOutstanding, { withSymbol: false }),
      clientName: org?.legalEntityName ?? "—",
      // The wizard's form is flat strings; narrowing here also keeps the payload serialisable.
      draft: draft
        ? {
            ...draft,
            formData: Object.fromEntries(
              Object.entries(draft.formData).filter((e): e is [string, string] => typeof e[1] === "string"),
            ),
          }
        : null,
    };
  });
