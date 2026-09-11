import { describe, expect, it } from "vitest";
import { MemoryRepository } from "./memory";
import * as mock from "@/lib/mock-data";

const repo = new MemoryRepository();

describe("MemoryRepository", () => {
  it("resolves reference data by id", async () => {
    const org = await repo.getOrg(mock.ORGANISATIONS[0].id);
    expect(org?.legalEntityName).toBe(mock.ORGANISATIONS[0].legalEntityName);

    const debtor = await repo.getDebtor(mock.DEBTORS[0].id);
    expect(debtor?.name).toBe(mock.DEBTORS[0].name);

    expect(await repo.getOrg("nope")).toBeUndefined();
  });

  it("scopes cases and sub-resources to an organisation / case", async () => {
    const org = mock.ORGANISATIONS[0];
    const cases = await repo.listCasesForOrg(org.id);
    expect(cases.every((c) => c.organisationId === org.id)).toBe(true);
    expect(cases.length).toBeGreaterThan(0);

    const first = cases[0];
    const invoices = await repo.listInvoicesForCase(first.id);
    expect(invoices.every((i) => i.caseId === first.id)).toBe(true);
  });

  it("matches the pure caseRows / urgentQueue selectors", async () => {
    const rows = await repo.caseRows();
    expect(rows).toEqual(mock.caseRows());

    const queue = await repo.urgentQueue();
    expect(queue).toEqual(mock.urgentQueue());
  });

  it("returns defensive copies, not the shared demo arrays", async () => {
    const orgs = await repo.listOrganisations();
    orgs.push({ ...orgs[0], id: "mutated" });
    expect(await repo.listOrganisations()).toHaveLength(mock.ORGANISATIONS.length);
  });

  it("computes a client overview scoped to one organisation", async () => {
    const org = mock.ORGANISATIONS[0];
    const overview = await repo.clientOverview(org.id);
    expect(overview.orgId).toBe(org.id);
    expect(overview.totalOutstanding).toBeGreaterThanOrEqual(0);
  });

  it("passes through the bulk-import stub", async () => {
    const result = await repo.bulkImport("debtors.csv");
    expect(result.totalRows).toBeGreaterThan(0);
  });
});
