/**
 * Server-only Dashboard data assembly, kept in its own file for the same
 * reason as tanstack-shell.functions.ts -- getRepo() transitively imports
 * "server-only" and must not sit at module scope in a route file that also
 * exports a client-rendered component.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";

export const getDashboardData = createServerFn({ method: "GET" }).handler(async () => {
  const repo = await getRepo();
  const [k, queue, trend, ageing, stageFunnel] = await Promise.all([
    repo.dashboardKpis(),
    repo.urgentQueue(),
    repo.recoveryTrend(),
    repo.ageingBuckets(),
    repo.stageFunnel(),
  ]);
  return { k, queue, trend, ageing, stageFunnel };
});
