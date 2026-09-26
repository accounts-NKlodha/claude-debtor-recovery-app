/**
 * TanStack Start equivalent of src/app/(internal)/cases/page.tsx's data
 * assembly (M1 Batch 1, read-only). Authorization is enforced by the parent
 * _internal layout route; RLS is independent defense-in-depth -- same as
 * the Next.js route group (see src/app/(internal)/cases/page.tsx).
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import { requireStaffSession } from "@/lib/auth/tanstack-session";

export const getCasesListData = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaffSession();
  const repo = await getRepo();
  const rows = await repo.caseRows();
  return { rows };
});
