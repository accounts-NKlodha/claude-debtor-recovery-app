import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guard for the least-privilege model of migration 0025: the API roles
 * get no direct table writes and `anon` gets nothing. Any later migration that
 * re-opens that must fail here and be reviewed deliberately.
 */
const dir = join(process.cwd(), "supabase", "migrations");
const migrations = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ f, sql: readFileSync(join(dir, f), "utf8").replace(/--.*$/gm, "") }));

describe("least-privilege table grants (0025)", () => {
  const m0025 = migrations.find((m) => m.f.startsWith("0025_"));

  it("0025 exists and removes anon access and every authenticated privilege except SELECT", () => {
    expect(m0025).toBeDefined();
    const sql = m0025!.sql.toLowerCase();
    expect(sql).toMatch(/revoke all on all tables in schema public from anon/);
    expect(sql).toMatch(/revoke insert, update, delete, truncate, trigger, references\s+on all tables in schema public from authenticated/);
    expect(sql).toMatch(/grant select on all tables in schema public to authenticated/);
    expect(sql).toMatch(/alter default privileges for role postgres revoke execute on functions from public/);
  });

  it("no migration after 0025 grants table privileges to anon, or write/TRUNCATE privileges to authenticated", () => {
    const after = migrations.filter((m) => Number(m.f.slice(0, 4)) > 25);
    for (const { f, sql } of after) {
      const grants = sql.toLowerCase().split(";").filter((s) => /\bgrant\b/.test(s) && /\bon\b/.test(s) && !/on function|on schema|on all functions/.test(s));
      for (const g of grants) {
        expect(g, `${f} must not grant table privileges to anon`).not.toMatch(/\bto\b[^;]*\banon\b/);
        expect(g, `${f} must not grant write/truncate to authenticated`).not.toMatch(/(insert|update|delete|truncate|trigger|references|all)[^;]*\bto\b[^;]*\bauthenticated\b/);
      }
    }
  });
});
