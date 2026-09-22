/**
 * TanStack Start equivalent of src/app/(internal)/intake/page.tsx's data
 * assembly (M1 Batch 3, read-only).
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";

export const getIntakeData = createServerFn({ method: "GET" }).handler(async () => {
  const repo = await getRepo();
  const organisations = await repo.listOrganisations();
  return { organisations };
});
