/**
 * TanStack Start equivalent of src/app/(client)/client/page.tsx's data
 * assembly (M1 Batch 1). Kept in its own file for the same server-only-
 * isolation reason as dashboard.functions.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import { resolveClientOrganisationId } from "@/lib/auth/tanstack-session";

export const getClientOverviewData = createServerFn({ method: "GET" }).handler(async () => {
  const repo = await getRepo();
  const orgs = await repo.listOrganisations();
  const organisationId = await resolveClientOrganisationId(orgs);
  const org = orgs.find((o) => o.id === organisationId) ?? orgs[0];
  const [overview, cases, trend, stageFunnel] = await Promise.all([
    repo.clientOverview(org.id),
    repo.listCasesForOrg(org.id),
    repo.recoveryTrend(),
    repo.stageFunnel(),
  ]);
  return { org, overview, cases, trend, stageFunnel };
});
