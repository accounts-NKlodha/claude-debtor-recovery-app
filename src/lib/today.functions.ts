/**
 * TanStack Start equivalent of src/app/(internal)/today/page.tsx's data
 * assembly (M1 Batch 1, read-only).
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";

export const getTodayData = createServerFn({ method: "GET" }).handler(async () => {
  const repo = await getRepo();
  const queue = await repo.urgentQueue();
  return { queue };
});
