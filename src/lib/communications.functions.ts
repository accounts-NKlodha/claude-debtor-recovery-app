/**
 * TanStack Start equivalent of src/app/(internal)/communications/page.tsx's
 * data assembly (M1 Batch 1, read-only). Same per-row client/debtor name
 * join as the Next.js page.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import type { CommRow } from "@/components/tanstack/comms-log";

export const getCommunicationsData = createServerFn({ method: "GET" }).handler(async (): Promise<{ rows: CommRow[] }> => {
  const repo = await getRepo();
  const comms = await repo.listAllCommunications();
  const rows: CommRow[] = await Promise.all(
    comms.map(async (c) => {
      const kase = await repo.getCase(c.caseId);
      const [org, debtor] = await Promise.all([
        repo.getOrg(c.organisationId),
        kase ? repo.getDebtor(kase.debtorId) : Promise.resolve(undefined),
      ]);
      return {
        ...c,
        clientName: org?.legalEntityName ?? "—",
        debtorName: debtor?.name ?? "—",
      };
    }),
  );
  return { rows };
});
