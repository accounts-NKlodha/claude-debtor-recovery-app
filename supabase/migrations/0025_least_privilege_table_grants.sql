-- 0025: least-privilege table grants for the API roles (DRAFT until reviewed/applied).
--
-- Finding (go-live security review): Supabase's default privileges gave
-- `anon` and `authenticated` ALL privileges (SELECT, INSERT, UPDATE, DELETE,
-- TRUNCATE, TRIGGER, REFERENCES) on every public table. Row-level security
-- blocks row access, but:
--   * RLS does not govern TRUNCATE, TRIGGER or REFERENCES at all;
--   * system_settings (the global kill switch) had no write protection except
--     the absence of a write policy;
--   * documents / document_versions / payment_records have client-role INSERT
--     policies, so a client login could insert rows straight through
--     PostgREST (e.g. a forged, "confirmed" payment record) -- a path the
--     application never uses.
-- The application performs NO direct table writes: every mutation is a
-- SECURITY DEFINER RPC (which runs as the function owner, so it does not need
-- any table privilege on the caller). Reads are RLS-filtered SELECTs by
-- signed-in staff/admin/client sessions. Nothing reads or writes tables as `anon`.
--
-- After this migration:
--   anon           : no privileges on any public table or sequence
--   authenticated  : SELECT only (still RLS-filtered)
--   service_role   : unchanged (bypasses RLS; not used by the app)
--   future tables  : created by `postgres` without anon access and without
--                    write/TRUNCATE/TRIGGER/REFERENCES for `authenticated`
--                    (a new migration must GRANT what it needs, explicitly)
--
-- The (now inert) client INSERT / recipient UPDATE RLS policies are left in
-- place: this migration changes privileges only, not policies.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

revoke insert, update, delete, truncate, trigger, references
  on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;

-- RLS helper functions: callable only by signed-in sessions (RLS policies
-- evaluate them as the caller) and the service role -- never anonymously.
revoke execute on function current_org_ids(), current_user_role(), current_app_user_id(), is_staff()
  from public, anon;
grant execute on function current_org_ids(), current_user_role(), current_app_user_id(), is_staff()
  to authenticated, service_role;

-- Future objects created by the migration role.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, trigger, references on tables from authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
-- PostgreSQL grants EXECUTE to PUBLIC on every new function by default; a schema-scoped
-- default cannot remove that, so it is removed globally for the migration role. Every
-- migration already revokes/grants EXECUTE explicitly per function (see 0016, 0023).
alter default privileges for role postgres revoke execute on functions from public;
