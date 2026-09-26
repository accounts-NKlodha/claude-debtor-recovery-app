/**
 * Inventory + ordering check for every TanStack read (GET) server function.
 * A new read endpoint must be classified here on purpose:
 *  - INTERNAL reads must call requireStaffSession() BEFORE getRepo();
 *  - CLIENT_SAFE reads live in the client portal files and must never use the
 *    staff guard (they resolve the organisation from the session instead);
 *  - SHARED_SAFE reads return no business data to any role.
 * An unclassified GET function fails this test, so it can't ship unguarded by
 * accident (the layout route guard alone is not a data boundary).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const INTERNAL = [
  "getAuditData",
  "getCaseDetailData",
  "getCasesListData",
  "getClientsPolicyData",
  "getCommunicationsData",
  "getDashboardData",
  "getGstDetailData",
  "getGstListData",
  "getIntakeData",
  "getMsmeDetailData",
  "getMsmeListData",
  "getPaymentsPageData",
  "getTodayData",
];
const CLIENT_SAFE = ["getClientCasesData", "getClientOverviewData", "getClientShellData"];
const SHARED_SAFE = ["getInternalShellData", "getLandingRedirect", "getNewClientPageAccess"];

function collectFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? collectFiles(join(dir, e.name)) : e.name.endsWith(".functions.ts") ? [join(dir, e.name)] : [],
  );
}

const libDir = join(process.cwd(), "src", "lib");
const reads: Array<{ name: string; file: string; body: string }> = [];
for (const file of collectFiles(libDir)) {
  const src = readFileSync(file, "utf8");
  const re = /export const (\w+) = createServerFn\(\{ method: "GET" \}\)/g;
  const starts = [...src.matchAll(re)];
  starts.forEach((m, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index! : src.length;
    reads.push({ name: m[1], file, body: src.slice(m.index!, end) });
  });
}

describe("read server function inventory", () => {
  it("finds every classified read function (and nothing unclassified)", () => {
    const known = new Set([...INTERNAL, ...CLIENT_SAFE, ...SHARED_SAFE]);
    const found = new Set(reads.map((r) => r.name));
    expect([...found].filter((n) => !known.has(n))).toEqual([]);
    expect([...known].filter((n) => !found.has(n))).toEqual([]);
    expect(reads).toHaveLength(19);
  });

  it.each(INTERNAL)("%s calls requireStaffSession() before getRepo()", (name) => {
    const fn = reads.find((r) => r.name === name)!;
    const guard = fn.body.indexOf("requireStaffSession()");
    const repo = fn.body.indexOf("getRepo()");
    expect(guard).toBeGreaterThan(-1);
    expect(repo).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(repo);
  });

  it.each(CLIENT_SAFE)("%s is a dedicated client read that does not use the staff guard", (name) => {
    const fn = reads.find((r) => r.name === name)!;
    expect(fn.file).toMatch(/client-portal\.functions\.ts$|tanstack-client-shell\.functions\.ts$/);
    expect(fn.body).not.toContain("requireStaffSession");
  });
});
