/**
 * In-memory Repository implementation, backed by the demo dataset in
 * `src/lib/mock-data.ts`. This is the default until a Supabase project is
 * configured (see `../repo.ts`). Every method is async to match the
 * interface real storage will need, and returns defensive copies so callers
 * can't mutate shared demo state.
 */

import * as mock from "@/lib/mock-data";
import type { AgeingBucket, DashboardKpis, Repository, StagePoint, TrendPoint } from "../repository";

async function tick<T>(value: T): Promise<T> {
  // Yield a microtask so this behaves like a real async boundary in tests
  // and doesn't let callers accidentally rely on synchronous resolution.
  return Promise.resolve(value);
}

export class MemoryRepository implements Repository {
  async getOrg(id: string) {
    return tick(mock.getOrg(id));
  }
  async listOrganisations() {
    return tick([...mock.ORGANISATIONS]);
  }
  async getDebtor(id: string) {
    return tick(mock.getDebtor(id));
  }
  async assigneeName(id: string | null) {
    return tick(mock.assigneeName(id));
  }

  async getCase(id: string) {
    return tick(mock.getCase(id));
  }
  async listAllCases() {
    return tick([...mock.CASES]);
  }
  async listCasesForOrg(orgId: string) {
    return tick(mock.listCasesForOrg(orgId));
  }
  async caseRows(orgId?: string) {
    return tick(mock.caseRows(orgId));
  }

  async listInvoicesForCase(caseId: string) {
    return tick(mock.listInvoicesForCase(caseId));
  }
  async listCommunicationsForCase(caseId: string) {
    return tick(mock.listCommunicationsForCase(caseId));
  }
  async listPaymentsForCase(caseId: string) {
    return tick(mock.listPaymentsForCase(caseId));
  }
  async listTasksForCase(caseId: string) {
    return tick(mock.listTasksForCase(caseId));
  }

  async listAllCommunications() {
    return tick([...mock.COMMUNICATIONS]);
  }
  async listAllPayments() {
    return tick([...mock.PAYMENTS]);
  }
  async openTasks(orgId?: string) {
    const open = mock.openTasks();
    return tick(orgId ? open.filter((t) => t.organisationId === orgId) : open);
  }
  async urgentQueue(orgId?: string) {
    return tick(mock.urgentQueue(orgId));
  }

  async dashboardKpis(): Promise<DashboardKpis> {
    return tick({ ...mock.DASHBOARD_KPIS });
  }
  async recoveryTrend(): Promise<TrendPoint[]> {
    return tick([...mock.RECOVERY_TREND]);
  }
  async ageingBuckets(): Promise<AgeingBucket[]> {
    return tick([...mock.AGEING_BUCKETS]);
  }
  async stageFunnel(): Promise<StagePoint[]> {
    return tick([...mock.STAGE_FUNNEL]);
  }
  async clientOverview(orgId: string) {
    return tick(mock.clientOverview(orgId));
  }

  async bulkImport(fileName: string) {
    return tick(mock.stubBulkImport(fileName));
  }
}
