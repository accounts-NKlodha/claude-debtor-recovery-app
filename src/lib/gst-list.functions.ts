/**
 * TanStack Start equivalent of src/app/(internal)/gst/page.tsx's data
 * assembly (M1 Batch 4, read-only).
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";

export const getGstListData = createServerFn({ method: "GET" }).handler(async () => {
  const repo = await getRepo();
  const cases = await repo.listAllCases();
  const eligible = cases.filter((c) => c.eligibilityRoute === "gst" || c.status.startsWith("gst"));
  const rows = await Promise.all(
    eligible.map(async (c) => ({
      c,
      debtor: await repo.getDebtor(c.debtorId),
      org: await repo.getOrg(c.organisationId),
    })),
  );
  return { rows };
});
