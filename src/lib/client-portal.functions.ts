/**
 * TanStack Start data assembly for the client portal. Kept in its own file
 * for the same server-only-isolation reason as dashboard.functions.ts.
 * Authorization is the parent /client layout guard; the organisation is
 * always resolved from the session (never from the request), and only the
 * client-safe projection below leaves the server.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import type { Repository } from "@/server/repository";
import { resolveClientOrganisationId } from "@/lib/auth/tanstack-session";
import { CLIENT_SAFE_LABEL } from "@/contract/enums";
import type { RecoveryCase } from "@/contract/types";
import type { ClientOverview } from "@/lib/mock-data";

/** What a client may see about one of its own cases: no internal step,
 * blocker, assignee, automation mode or scheduling detail. */
export interface ClientCaseView {
  id: string;
  debtorName: string;
  reference: string | null;
  stage: string;
  closed: boolean;
  principalOutstanding: number;
  recoveredToDate: number;
}

/** Explicit whitelist of what the client overview page renders. The repository
 * ClientOverview also carries orgId, stageWise and fee billed/currency; those
 * (and anything added to it later) never reach the client browser unless they
 * are added here on purpose. */
export interface ClientOverviewView {
  actionsRequired: number;
  totalOutstanding: number;
  recovered: number;
  recoveryRatePct: number;
  upcomingAction: { label: string; when: string | null } | null;
  feeSummary: { estimatedFee: number };
  ageing: Array<{ bucket: string; amount: number }>;
}

export function toClientOverviewView(o: ClientOverview): ClientOverviewView {
  return {
    actionsRequired: o.actionsRequired,
    totalOutstanding: o.totalOutstanding,
    recovered: o.recovered,
    recoveryRatePct: o.recoveryRatePct,
    upcomingAction: o.upcomingAction ? { label: o.upcomingAction.label, when: o.upcomingAction.when } : null,
    feeSummary: { estimatedFee: o.feeSummary.estimatedFee },
    ageing: o.ageing.map((a) => ({ bucket: a.bucket, amount: a.amount })),
  };
}

const CLOSED_STATUSES: RecoveryCase["status"][] = ["recovered", "closed", "withdrawn", "archived"];

export async function toClientCaseViews(
  repo: Pick<Repository, "getDebtor">,
  cases: RecoveryCase[],
): Promise<ClientCaseView[]> {
  const debtorIds = [...new Set(cases.map((c) => c.debtorId))];
  const debtors = await Promise.all(debtorIds.map((id) => repo.getDebtor(id)));
  const nameById = new Map(debtors.flatMap((d) => (d ? [[d.id, d.name] as const] : [])));
  return cases.map((c) => ({
    id: c.id,
    debtorName: nameById.get(c.debtorId) ?? "Debtor",
    reference: c.groupKey,
    stage: CLIENT_SAFE_LABEL[c.status] ?? "In progress",
    closed: CLOSED_STATUSES.includes(c.status),
    principalOutstanding: c.principalOutstanding,
    recoveredToDate: c.recoveredToDate,
  }));
}

async function resolveClientOrg(repo: Repository) {
  const orgs = await repo.listOrganisations();
  const organisationId = await resolveClientOrganisationId(orgs);
  return orgs.find((o) => o.id === organisationId) ?? orgs[0];
}

export const getClientOverviewData = createServerFn({ method: "GET" }).handler(async () => {
  const repo = await getRepo();
  const org = await resolveClientOrg(repo);
  const [overview, cases, trend, stageFunnel] = await Promise.all([
    repo.clientOverview(org.id),
    repo.listCasesForOrg(org.id),
    repo.recoveryTrend(),
    repo.stageFunnel(),
  ]);
  return {
    org: { legalEntityName: org.legalEntityName },
    overview: toClientOverviewView(overview),
    cases: await toClientCaseViews(repo, cases),
    trend,
    stageFunnel,
  };
});

export const getClientCasesData = createServerFn({ method: "GET" }).handler(async () => {
  const repo = await getRepo();
  const org = await resolveClientOrg(repo);
  const cases = await repo.listCasesForOrg(org.id);
  return { org: { legalEntityName: org.legalEntityName }, cases: await toClientCaseViews(repo, cases) };
});
