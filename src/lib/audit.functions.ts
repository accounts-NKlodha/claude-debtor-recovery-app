/**
 * TanStack Start equivalent of src/app/(internal)/audit/page.tsx's data
 * assembly (M1 Batch 1, read-only).
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import { requireStaffSession } from "@/lib/auth/tanstack-session";

export const getAuditData = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaffSession();
  const repo = await getRepo();
  const entries = await repo.listAuditLog(200);
  return { entries };
});
