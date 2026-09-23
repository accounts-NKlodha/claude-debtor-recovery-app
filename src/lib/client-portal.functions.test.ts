/**
 * The client portal must only ever send a client-safe projection of the
 * session organisation's own cases (never internal step/blocker/assignee/
 * scheduling fields). Exercised against the real in-memory repository.
 */
import { describe, expect, it } from "vitest";
import { MemoryRepository } from "@/server/repositories/memory";
import { CLIENT_SAFE_LABEL } from "@/contract/enums";
import { toClientCaseViews } from "./client-portal.functions";

const ALLOWED_KEYS = ["closed", "debtorName", "id", "principalOutstanding", "recoveredToDate", "reference", "stage"];

describe("toClientCaseViews", () => {
  it("projects only client-safe fields, with debtor names instead of internal ids", async () => {
    const repo = new MemoryRepository();
    const [org] = await repo.listOrganisations();
    const cases = await repo.listCasesForOrg(org.id);
    expect(cases.length).toBeGreaterThan(0);

    const views = await toClientCaseViews(repo, cases);

    for (const [i, v] of views.entries()) {
      expect(Object.keys(v).sort()).toEqual(ALLOWED_KEYS);
      const debtor = await repo.getDebtor(cases[i].debtorId);
      expect(v.debtorName).toBe(debtor?.name);
      expect(v.debtorName).not.toBe(cases[i].id);
      expect(v.stage).toBe(CLIENT_SAFE_LABEL[cases[i].status] ?? "In progress");
    }
    const serialized = JSON.stringify(views);
    for (const c of cases) {
      if (c.blocker) expect(serialized).not.toContain(c.blocker);
      if (c.currentStep) expect(serialized).not.toContain(c.currentStep);
      if (c.nextScheduledAction) expect(serialized).not.toContain(c.nextScheduledAction);
    }
  });

  it("only includes the requested organisation's cases", async () => {
    const repo = new MemoryRepository();
    const [orgA, orgB] = await repo.listOrganisations();
    const views = await toClientCaseViews(repo, await repo.listCasesForOrg(orgA.id));
    const orgBIds = new Set((await repo.listCasesForOrg(orgB.id)).map((c) => c.id));
    expect(views.some((v) => orgBIds.has(v.id))).toBe(false);
  });

  it("falls back to a neutral label when a debtor cannot be read", async () => {
    const repo = new MemoryRepository();
    const [org] = await repo.listOrganisations();
    const [kase] = await repo.listCasesForOrg(org.id);
    const [view] = await toClientCaseViews({ getDebtor: async () => undefined }, [kase]);
    expect(view.debtorName).toBe("Debtor");
  });
});
