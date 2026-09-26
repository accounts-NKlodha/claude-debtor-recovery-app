/**
 * TanStack Start equivalent of src/app/(internal)/msme/page.tsx's data
 * assembly (M1 Batch 4, read-only).
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import { requireStaffSession } from "@/lib/auth/tanstack-session";

const MSME_STATUSES = ["msme_odr_filed", "msefc_dd", "hearing_scheduled", "adjourned"];

export const getMsmeListData = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaffSession();
  const repo = await getRepo();
  const cases = await repo.listAllCases();
  const eligible = cases.filter(
    (c) => c.eligibilityRoute === "msme" || MSME_STATUSES.includes(c.status),
  );
  const rows = await Promise.all(
    eligible.map(async (c) => ({
      c,
      debtor: await repo.getDebtor(c.debtorId),
      org: await repo.getOrg(c.organisationId),
    })),
  );
  return { rows };
});
