/** Static guards on 0026_msme_drafts.sql, complementing the executed pglite test. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(__dirname, "migrations", "0026_msme_drafts.sql"), "utf8");
const code = sql.replace(/--.*$/gm, "");

describe("0026_msme_drafts.sql", () => {
  it("enables RLS and defines only a staff SELECT policy (no client policy)", () => {
    expect(code).toMatch(/alter table msme_drafts enable row level security/i);
    const policies = [...code.matchAll(/create policy (\w+) on msme_drafts for (\w+)/gi)];
    expect(policies.map((p) => [p[1], p[2].toLowerCase()])).toEqual([["msme_drafts_staff_read", "select"]]);
    expect(code).toMatch(/for select using \(is_staff\(\)\)/i);
  });

  it("grants no write privilege to any API role and nothing to anon", () => {
    expect(code).not.toMatch(/grant\s+(insert|update|delete|truncate|all)[^;]*on\s+msme_drafts/i);
    expect(code).toMatch(/revoke all on msme_drafts from anon/i);
    expect(code).toMatch(/grant select on msme_drafts to authenticated/i);
  });

  it("both write RPCs are SECURITY DEFINER with auth.uid(), actor and is_staff() checks and audit", () => {
    for (const fn of ["save_msme_stage", "lock_msme_draft"]) {
      const body = code.slice(code.indexOf(`function ${fn}(`), code.indexOf("$$;", code.indexOf(`function ${fn}(`) + 200));
      expect(body).toMatch(/security definer/i);
      expect(body).toMatch(/set search_path = public/i);
      expect(body).toMatch(/auth\.uid\(\) is null/i);
      expect(body).toMatch(/p_expected_actor_id/i);
      expect(body).toMatch(/not is_staff\(\)/i);
      expect(body).toMatch(/record_audit_event\(/i);
      expect(code).toMatch(new RegExp(`revoke execute on function ${fn}\\([^)]*\\) from public, anon`, "i"));
      expect(code).toMatch(new RegExp(`grant execute on function ${fn}\\([^)]*\\) to authenticated`, "i"));
    }
  });

  it("makes a locked row immutable with a trigger that no API role can call", () => {
    expect(code).toMatch(/before update or delete on msme_drafts/i);
    expect(code).toMatch(/revoke execute on function msme_drafts_block_locked_change\(\) from public, anon, authenticated/i);
  });
});
