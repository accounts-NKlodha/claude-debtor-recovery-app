/**
 * P0-5-R1 permanent regression guard: statically computes the EXECUTE grant
 * state every migration file, applied in order, would leave each
 * `public`-schema function in, and fails if that computed state doesn't
 * match `rpc-manifest.ts`'s declared policy -- or if a function exists in
 * migrations with no manifest entry at all (no unclassified function is
 * allowed to pass silently).
 *
 * This is a STATIC guard, not a live-catalog query -- it cannot see
 * Supabase's actual default-privilege grants the way `has_function_
 * privilege()` against a real database can (see docs/security-audit/
 * p0-5-r1-rpc-exposure.md for that query and how to re-run it). What it
 * *can* guarantee, deterministically and in CI with no database: every
 * function a migration defines has an explicit, reviewed classification,
 * and the exact `revoke`/`grant execute` statements needed to enforce that
 * classification are actually present in the migration history -- so a
 * future function that forgets the revoke (the root cause of both the
 * raise_workflow_task/close_case_tasks_if_terminal incident and the
 * broader anon-execute finding this same review closed) fails this test
 * before it ever reaches a live database.
 *
 * Default-state model: Supabase's project bootstrap grants EXECUTE on every
 * new public-schema function directly to `anon` and `authenticated`,
 * independent of the `PUBLIC` pseudo-role (confirmed live, P0-5-R1) -- so
 * the first `create (or replace) function <name>` sighting for a name not
 * yet tracked initializes it to `{anon: true, authenticated: true}`. Only
 * an explicit `revoke`/`grant execute on function <name>(...) from/to
 * <role>` statement changes that tracked state, applied in the order those
 * statements appear across migrations (filename-sorted, matching how
 * `supabase db push` actually applies them). A later `create or replace`
 * of the same name does NOT reset previously-revoked grants (verified
 * empirically against production: CREATE OR REPLACE preserves existing
 * ACL entries when the signature is unchanged, which is always true in
 * this codebase -- no function here is ever overloaded).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RPC_MANIFEST } from "./rpc-manifest";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

function loadMigrationsInOrder(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort() // filename-sorted == application order, same as `supabase db push`
    .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS_DIR, file), "utf8") }));
}

interface GrantState {
  anon: boolean;
  authenticated: boolean;
}

function computeFinalGrantState(migrations: { file: string; sql: string }[]): Map<string, GrantState> {
  const state = new Map<string, GrantState>();

  const createRe = /create\s+(?:or\s+replace\s+)?function\s+(\w+)\s*\(/gi;
  const revokeRe = /revoke\s+execute\s+on\s+function\s+(\w+)\s*\([^)]*\)\s*from\s+([^;]+);/gi;
  const grantRe = /grant\s+execute\s+on\s+function\s+(\w+)\s*\([^)]*\)\s*to\s+([^;]+);/gi;

  for (const { sql } of migrations) {
    // 1. Register any function name seen for the first time at its Supabase
    // default-privilege state. Order within a file doesn't matter for this
    // step -- a create-or-replace never resets an already-tracked function.
    for (const m of sql.matchAll(createRe)) {
      const name = m[1];
      if (!state.has(name)) state.set(name, { anon: true, authenticated: true });
    }

    // 2. Apply every revoke/grant in the file, in the order they appear,
    // interleaved correctly by scanning the whole file's statements by
    // position rather than doing all revokes then all grants.
    type Op = { index: number; kind: "revoke" | "grant"; name: string; roles: string[] };
    const ops: Op[] = [];
    for (const m of sql.matchAll(revokeRe)) {
      ops.push({ index: m.index ?? 0, kind: "revoke", name: m[1], roles: splitRoles(m[2]) });
    }
    for (const m of sql.matchAll(grantRe)) {
      ops.push({ index: m.index ?? 0, kind: "grant", name: m[1], roles: splitRoles(m[2]) });
    }
    ops.sort((a, b) => a.index - b.index);

    for (const op of ops) {
      const s = state.get(op.name);
      if (!s) continue; // revoke/grant on a function not defined in any migration (shouldn't happen; caught separately below)
      for (const role of op.roles) {
        if (role === "anon") s.anon = op.kind === "grant";
        if (role === "authenticated") s.authenticated = op.kind === "grant";
        // "public"/"postgres"/other roles: not tracked here -- anon/
        // authenticated are what PostgREST actually authenticates as, and
        // are exactly the two roles this guard (and the manifest) cares
        // about, per the P0-5-R1 finding that PUBLIC-only revokes are not
        // the real enforcement layer.
      }
    }
  }

  return state;
}

function splitRoles(raw: string): string[] {
  return raw
    .split(",")
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
}

describe("RPC exposure regression guard (P0-5-R1)", () => {
  const migrations = loadMigrationsInOrder();
  const finalState = computeFinalGrantState(migrations);
  const manifestByName = new Map(RPC_MANIFEST.map((e) => [e.name, e]));

  it("finds at least the known public-schema functions (sanity check the parser itself works)", () => {
    expect(finalState.size).toBeGreaterThanOrEqual(RPC_MANIFEST.length);
  });

  it("every function defined in migrations has an explicit manifest entry -- no unclassified function", () => {
    const unclassified = [...finalState.keys()].filter((name) => !manifestByName.has(name));
    expect(unclassified, `Unclassified function(s) found in migrations with no rpc-manifest.ts entry: ${unclassified.join(", ")}. Add a classified entry before merging.`).toEqual([]);
  });

  it("every manifest entry corresponds to a function that actually exists in migrations", () => {
    const stale = RPC_MANIFEST.filter((e) => !finalState.has(e.name)).map((e) => e.name);
    expect(stale, `Manifest entries with no matching function in any migration (stale/renamed?): ${stale.join(", ")}`).toEqual([]);
  });

  it.each(RPC_MANIFEST)(
    "$name ($classification): computed grant state matches the declared policy",
    (entry) => {
      const actual = finalState.get(entry.name);
      expect(actual, `${entry.name} was in the manifest but never found defined in any migration`).toBeDefined();
      expect(actual!.anon, `${entry.name}: expected anon EXECUTE = ${entry.expectedAnonExecute}, computed ${actual!.anon}`).toBe(
        entry.expectedAnonExecute,
      );
      expect(
        actual!.authenticated,
        `${entry.name}: expected authenticated EXECUTE = ${entry.expectedAuthenticatedExecute}, computed ${actual!.authenticated}`,
      ).toBe(entry.expectedAuthenticatedExecute);
    },
  );

  it("no internal_helper is granted to anon or authenticated", () => {
    const violations = RPC_MANIFEST.filter(
      (e) => e.classification === "internal_helper" && (e.expectedAnonExecute || e.expectedAuthenticatedExecute),
    );
    expect(violations.map((v) => v.name), "internal_helper functions must never declare anon/authenticated execute").toEqual([]);
  });

  it("no public_rpc declares anon execute (every business RPC requires a real authenticated session)", () => {
    const violations = RPC_MANIFEST.filter((e) => e.classification === "public_rpc" && e.expectedAnonExecute);
    expect(violations.map((v) => v.name), "public_rpc functions must never declare anon execute").toEqual([]);
  });

  it("every public_rpc/internal_helper is defined with SECURITY DEFINER in its most recent migration", () => {
    // rls_helper functions are a mix (current_app_user_id/is_staff are plain
    // SQL, current_user_role/current_org_ids are SECURITY DEFINER) by
    // design -- only public_rpc/internal_helper are checked here.
    const checked = RPC_MANIFEST.filter((e) => e.classification !== "rls_helper");
    const missing: string[] = [];
    for (const entry of checked) {
      // Find the LAST `create (or replace) function <name>(` occurrence
      // across all migrations (in file order) and confirm `security
      // definer` appears before the next top-level `create` statement.
      let lastDefIndex = -1;
      let lastDefFile = "";
      for (const { file, sql } of migrations) {
        const re = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${entry.name}\\s*\\(`, "i");
        const m = re.exec(sql);
        if (m) {
          lastDefIndex = m.index;
          lastDefFile = file;
        }
      }
      if (lastDefFile === "") {
        missing.push(`${entry.name} (not found)`);
        continue;
      }
      const sql = migrations.find((m) => m.file === lastDefFile)!.sql;
      const tail = sql.slice(lastDefIndex, lastDefIndex + 4000); // function bodies here are all well under 4000 chars to their `$$;` close
      if (!/security\s+definer/i.test(tail)) {
        missing.push(`${entry.name} (in ${lastDefFile})`);
      }
    }
    expect(missing, `Functions missing SECURITY DEFINER in their latest definition: ${missing.join(", ")}`).toEqual([]);
  });
});
