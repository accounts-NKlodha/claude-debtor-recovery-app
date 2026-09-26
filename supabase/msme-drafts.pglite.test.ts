/**
 * Executes the REAL 0026_msme_drafts.sql against an in-process Postgres
 * (pglite) with minimal stand-ins for the Supabase pieces it depends on
 * (auth.uid(), is_staff(), record_audit_event, the referenced tables/roles).
 * Proves the behaviour the static tests can only infer: authorization, the
 * merge/resume semantics, the optimistic version check, and that a filed
 * submission is immutable even against direct table writes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATION = readFileSync(join(__dirname, "migrations", "0026_msme_drafts.sql"), "utf8");

const STAFF = "00000000-0000-0000-0000-0000000000a1";
const OTHER_STAFF = "00000000-0000-0000-0000-0000000000a2";
const CLIENT = "00000000-0000-0000-0000-0000000000c1";
const ORG = "00000000-0000-0000-0000-0000000000f1";
const CASE = "00000000-0000-0000-0000-0000000000e1";
const CASE_FILED = "00000000-0000-0000-0000-0000000000e2";
const CASE_2 = "00000000-0000-0000-0000-0000000000e3";

let db: PGlite;

type Row = Record<string, unknown> & { version?: number; form_data?: Record<string, string> };

async function as(uid: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  try {
    return await db.query<Row>(sql, params);
  } finally {
    await db.exec("reset role;");
  }
}
const save = (uid: string | null, caseId: string, stage: string, payload: object, expected: number | null = null) =>
  as(uid, "select * from save_msme_stage($1, $2, $3::jsonb, 'r', $4, $5)", [
    caseId,
    stage,
    JSON.stringify(payload),
    expected,
    uid,
  ]);
const lock = (uid: string | null, caseId: string, diary: string) =>
  as(uid, "select * from lock_msme_draft($1, $2, 'pdf-key', 'r', $3)", [caseId, diary, uid]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table organisations (id uuid primary key);
    create table app_users (id uuid primary key, role text not null);
    create table recovery_cases (id uuid primary key, organisation_id uuid not null references organisations(id), status text not null);
    create table audit_events (id serial primary key, action text, entity_id uuid, reason text, metadata jsonb, actor_id uuid);
    create function is_staff() returns boolean language sql stable security definer as
      $$ select exists (select 1 from app_users where id = auth.uid() and role in ('staff','admin')) $$;
    create function record_audit_event(p_organisation_id uuid, p_action text, p_entity text, p_entity_id uuid, p_reason text, p_metadata_json jsonb)
      returns audit_events language plpgsql security definer as $$
      declare r audit_events; begin
        insert into audit_events(action, entity_id, reason, metadata, actor_id)
        values (p_action, p_entity_id, p_reason, p_metadata_json, auth.uid()) returning * into r; return r; end $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on all functions in schema public to anon, authenticated;
    grant select on all tables in schema public to authenticated;
    insert into organisations values ('${ORG}');
    insert into app_users values ('${STAFF}','staff'), ('${OTHER_STAFF}','admin'), ('${CLIENT}','client');
    insert into recovery_cases values
      ('${CASE}','${ORG}','msme_eligibility_review'),
      ('${CASE_FILED}','${ORG}','msme_odr_filed'),
      ('${CASE_2}','${ORG}','msme_eligibility_review');
  `);
  await db.exec(MIGRATION);
});
afterAll(async () => db.close());

describe("0026_msme_drafts.sql (executed)", () => {
  it("staff can save a stage; the form data, stage and audit event are persisted", async () => {
    const r = await save(STAFF, CASE, "claimant", { claimantName: "Acme", claimantAddress: "Jaipur" });
    const row = r.rows[0];
    expect(row.version).toBe(1);
    expect(row.current_stage).toBe("claimant");
    expect(row.saved_stages).toEqual(["claimant"]);
    expect(row.created_by).toBe(STAFF);
    const audit = await db.query("select action, metadata from audit_events where entity_id = $1", [CASE]);
    expect(audit.rows).toEqual([{ action: "msme.stage_saved", metadata: { stage: "claimant", version: 1 } }]);
  });

  it("a later stage resumes from the saved row and merges rather than replaces", async () => {
    const r = await save(OTHER_STAFF, CASE, "respondent", { respondentName: "Kaveri", claimantName: "Acme Ltd" }, 1);
    const row = r.rows[0];
    expect(row.version).toBe(2);
    expect(row.current_stage).toBe("respondent");
    expect(row.saved_stages).toEqual(["claimant", "respondent"]);
    expect(row.form_data).toEqual({
      claimantName: "Acme Ltd",
      claimantAddress: "Jaipur",
      respondentName: "Kaveri",
    });
    expect(row.updated_by).toBe(OTHER_STAFF);
    expect(row.created_by).toBe(STAFF);
  });

  it("re-saving a stage does not duplicate it in saved_stages", async () => {
    const r = await save(STAFF, CASE, "respondent", { respondentAddress: "Delhi" }, 2);
    expect(r.rows[0].saved_stages).toEqual(["claimant", "respondent"]);
  });

  it("rejects a stale write (another session saved in between)", async () => {
    await expect(save(STAFF, CASE, "advocate", { advocateName: "X" }, 1)).rejects.toThrow(/changed by another session/);
    await expect(save(STAFF, CASE_2, "claimant", { a: "b" }, 5)).rejects.toThrow(/changed by another session/);
  });

  it("staff can read drafts; a client sees none (no client policy) and cannot write", async () => {
    const staffRead = await as(STAFF, "select case_id from msme_drafts");
    expect(staffRead.rows.length).toBeGreaterThan(0);
    const clientRead = await as(CLIENT, "select case_id from msme_drafts");
    expect(clientRead.rows).toEqual([]);
    await expect(save(CLIENT, CASE, "claimant", { a: "b" })).rejects.toThrow(/staff\/admin session required/);
    await expect(lock(CLIENT, CASE, "D-1")).rejects.toThrow(/staff\/admin session required/);
  });

  it("no API role can write the table directly", async () => {
    await expect(
      as(STAFF, `insert into msme_drafts (organisation_id, case_id) values ('${ORG}','${CASE_2}')`),
    ).rejects.toThrow(/permission denied/);
    await expect(as(STAFF, "update msme_drafts set form_data = '{}'")).rejects.toThrow(/permission denied/);
    await expect(as(STAFF, "delete from msme_drafts")).rejects.toThrow(/permission denied/);
    await db.exec("set role anon;");
    await expect(db.query("select * from msme_drafts")).rejects.toThrow(/permission denied/);
    await db.exec("reset role;");
  });

  it("fails closed with no caller, a mismatched actor id, or bad input", async () => {
    await expect(save(null, CASE, "claimant", {})).rejects.toThrow(/no authenticated caller/);
    await expect(
      as(STAFF, "select * from save_msme_stage($1, 'claimant', '{}'::jsonb, 'r', null, $2)", [CASE, OTHER_STAFF]),
    ).rejects.toThrow(/identity mismatch/);
    await expect(save(STAFF, CASE, "not_a_stage", {})).rejects.toThrow(/unknown ODR stage/);
    await expect(
      as(STAFF, "select * from save_msme_stage($1, 'claimant', '[1]'::jsonb, 'r')", [CASE]),
    ).rejects.toThrow(/JSON object/);
    await expect(save(STAFF, CASE, "claimant", { big: "x".repeat(50_001) })).rejects.toThrow(/too large/);
    await expect(save(STAFF, "00000000-0000-0000-0000-00000000ffff", "claimant", {})).rejects.toThrow(/not found/);
  });

  it("refuses to draft a case that has already been filed", async () => {
    await expect(save(STAFF, CASE_FILED, "claimant", { a: "b" })).rejects.toThrow(/draft is locked/);
  });

  it("locking records the diary number, is idempotent, and rejects a different diary", async () => {
    const r = await lock(STAFF, CASE, "DIARY-1");
    const row = r.rows[0];
    expect(row.status).toBe("locked");
    expect(row.diary_number).toBe("DIARY-1");
    expect(row.locked_at).not.toBeNull();
    const again = await lock(STAFF, CASE, "DIARY-1");
    expect(again.rows[0].version).toBe(row.version);
    await expect(lock(STAFF, CASE, "DIARY-2")).rejects.toThrow(/already locked with a different diary/);
    await expect(lock(STAFF, CASE_2, "  ")).rejects.toThrow(/diary number is required/);
  });

  it("a locked (filed) draft cannot be edited again, through the RPC or by any direct write", async () => {
    await expect(save(STAFF, CASE, "claimant", { claimantName: "Tampered" })).rejects.toThrow(/draft is locked/);
    // even the table owner (e.g. a future buggy code path) is stopped by the trigger
    await expect(
      db.exec(`update msme_drafts set form_data = '{"claimantName":"Tampered"}' where case_id = '${CASE}'`),
    ).rejects.toThrow(/immutable/);
    await expect(db.exec(`delete from msme_drafts where case_id = '${CASE}'`)).rejects.toThrow(/immutable/);
    const kept = await db.query<Row>("select form_data from msme_drafts where case_id = $1", [CASE]);
    expect(kept.rows[0].form_data?.claimantName).toBe("Acme Ltd");
  });

  it("filing without ever saving still creates a locked record", async () => {
    const r = await lock(STAFF, CASE_2, "DIARY-9");
    expect(r.rows[0].status).toBe("locked");
    await expect(save(STAFF, CASE_2, "claimant", { a: "b" })).rejects.toThrow(/draft is locked/);
  });

  it("audits the lock", async () => {
    const audit = await db.query(
      "select action from audit_events where action = 'msme.draft_locked' and entity_id = $1",
      [CASE],
    );
    expect(audit.rows).toHaveLength(1);
  });
});
