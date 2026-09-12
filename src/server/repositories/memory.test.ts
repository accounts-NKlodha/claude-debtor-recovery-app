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

  it("validates a bulk-import CSV without persisting anything", async () => {
    const csv = [
      "client_code,legal_entity_name,creditor_gstin,debtor_name,debtor_gstin,debtor_mobile,debtor_email,invoice_number,invoice_date,due_date,taxable_value,tax_rate,tax_amount,invoice_total,adjustments,total_due,ledger_as_of,client_certified,group_key,notes",
      "NKL-X,X Pvt Ltd,08AAAAA0000A1Z5,New Debtor,29ZZZZZ9999Z1Z1,9876543210,x@example.com,NEW-1,2026-06-01,2026-07-01,100000,18,18000,118000,0,118000,2026-08-01,yes,,",
    ].join("\n");
    const result = await repo.validateBulkImport(csv);
    expect(result.validRows).toBe(1);
    expect(await repo.listAllCases()).toHaveLength(mock.CASES.length); // unchanged
  });

  it("commits valid rows as new draft cases, one per row, never partially", async () => {
    const before = (await repo.listAllCases()).length;
    const org = mock.ORGANISATIONS[0];
    const csv = [
      "client_code,legal_entity_name,creditor_gstin,debtor_name,debtor_gstin,debtor_mobile,debtor_email,invoice_number,invoice_date,due_date,taxable_value,tax_rate,tax_amount,invoice_total,adjustments,total_due,ledger_as_of,client_certified,group_key,notes",
      "NKL-X,X Pvt Ltd,08AAAAA0000A1Z5,Committed Debtor,29ZZZZZ8888Z1Z1,9876543211,y@example.com,COMMIT-1,2026-06-01,2026-07-01,50000,18,9000,59000,0,59000,2026-08-01,yes,,",
      "NKL-X,X Pvt Ltd,08AAAAA0000A1Z5,Committed Debtor,,bad-phone,,COMMIT-2,not-a-date,,abc,18,9000,59000,0,59000,2026-08-01,yes,,",
    ].join("\n");
    const { result, casesCreated } = await repo.commitBulkImport(org.id, csv);
    expect(result.validRows).toBe(1);
    expect(result.errorRows).toBe(1);
    expect(casesCreated).toBe(1);
    expect((await repo.listAllCases()).length).toBe(before + 1);
  });

  it("requires a reason to change the global automation switch, and audits it", async () => {
    const { enabled: before } = await repo.getAutomationState();
    await expect(repo.setAutomationState(!before, "")).rejects.toThrow(/reason/i);

    const { enabled: after } = await repo.setAutomationState(!before, "pausing for a drift investigation");
    expect(after).toBe(!before);

    const log = await repo.listAuditLog(5);
    expect(log[0].action).toMatch(/automation\.(enabled|disabled)/);
    expect(log[0].reason).toBe("pausing for a drift investigation");

    // restore so other tests in this file see the default state
    await repo.setAutomationState(before, "test cleanup");
  });

  it("rejects a duplicate client code", async () => {
    const existing = mock.ORGANISATIONS[0];
    await expect(
      repo.createOrganisation({
        clientCode: existing.clientCode,
        legalEntityName: "Some Other Entity Pvt Ltd",
        creditorGstin: null,
        udyamNumber: null,
        jitoMember: false,
        confirmDuplicateName: false,
        duplicateOverrideReason: null,
      }),
    ).rejects.toThrow(/client code/i);
  });

  it("rejects a duplicate creditor GSTIN outright, with no override", async () => {
    const existing = mock.ORGANISATIONS.find((o) => o.creditorGstin)!;
    await expect(
      repo.createOrganisation({
        clientCode: "NKL-DUPGSTIN",
        legalEntityName: "A Totally Different Name Pvt Ltd",
        creditorGstin: existing.creditorGstin,
        udyamNumber: null,
        jitoMember: false,
        confirmDuplicateName: false,
        duplicateOverrideReason: null,
      }),
    ).rejects.toThrow(/gstin/i);
  });

  it("warns instead of creating on a legal-entity-name collision, then requires a reason to override", async () => {
    const existing = mock.ORGANISATIONS[0];
    const before = (await repo.listOrganisations()).length;

    const warned = await repo.createOrganisation({
      clientCode: "NKL-NAMECLASH",
      legalEntityName: `  ${existing.legalEntityName.toUpperCase()}  `, // whitespace/case-insensitive match
      creditorGstin: null,
      udyamNumber: null,
      jitoMember: false,
      confirmDuplicateName: false,
      duplicateOverrideReason: null,
    });
    expect(warned.status).toBe("duplicate_name_warning");
    expect((await repo.listOrganisations()).length).toBe(before); // nothing created yet

    const created = await repo.createOrganisation({
      clientCode: "NKL-NAMECLASH",
      legalEntityName: `  ${existing.legalEntityName.toUpperCase()}  `,
      creditorGstin: null,
      udyamNumber: null,
      jitoMember: false,
      confirmDuplicateName: true,
      duplicateOverrideReason: "separate branch, confirmed by staff",
    });
    expect(created.status).toBe("created");
    expect((await repo.listOrganisations()).length).toBe(before + 1);
  });
});
