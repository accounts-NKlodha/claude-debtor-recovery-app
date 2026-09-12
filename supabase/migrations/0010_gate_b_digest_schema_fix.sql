-- 0010_gate_b_digest_schema_fix.sql
-- P0-4 Gate B LIVE finding: record_audit_event() called digest() unqualified.
-- On Supabase-hosted Postgres, `create extension pgcrypto` installs into the
-- dedicated `extensions` schema, not `public` (confirmed live on this
-- project via a temporary diagnostic RPC, now dropped below). Every
-- SECURITY DEFINER function here deliberately pins `set search_path = public`
-- (correct hardening against search-path injection), which means bare
-- `digest(...)` was never resolvable -- every RPC that writes an audit row
-- (i.e. all of them; every 0006/0007 write RPC calls record_audit_event
-- internally) failed with `function digest(text, unknown) does not exist`
-- the first time any of them actually ran against a live database.
--
-- Fix: schema-qualify the call (`extensions.digest`) instead of widening
-- search_path -- preserves the hardened, single-schema search_path this
-- project already committed to for every privileged function, rather than
-- trading that safety away to fix a resolution problem.
--
-- Also drops gate_b_probe_digest_schema(), the temporary diagnostic
-- function used to confirm the correct schema live -- purely diagnostic,
-- served its purpose, not needed going forward.

create or replace function record_audit_event(
  p_organisation_id uuid,
  p_action text,
  p_entity text,
  p_entity_id uuid,
  p_reason text,
  p_metadata_json jsonb
)
returns audit_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text; -- audit_events.actor_role is text (allows 'system'); see 0001_init.sql
  v_prev_hash text;
  v_row_data text;
  v_hash text;
  v_result audit_events;
begin
  if v_actor_id is null then
    raise exception 'record_audit_event: no authenticated caller' using errcode = '28000';
  end if;

  select role::text into v_actor_role from app_users where id = v_actor_id;
  if v_actor_role is null then
    raise exception 'record_audit_event: caller is not a provisioned app user' using errcode = '28000';
  end if;

  if v_actor_role = 'client' and p_organisation_id is not null
     and p_organisation_id not in (select organisation_id from user_organisations where user_id = v_actor_id) then
    raise exception 'record_audit_event: caller is not a member of organisation %', p_organisation_id
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('audit_events_chain'));

  select hash into v_prev_hash
  from audit_events
  order by created_at desc, id desc
  limit 1;

  v_row_data := coalesce(p_organisation_id::text, '') || '|' ||
                v_actor_id::text || '|' ||
                v_actor_role::text || '|' ||
                p_action || '|' ||
                p_entity || '|' ||
                coalesce(p_entity_id::text, '') || '|' ||
                coalesce(p_reason, '') || '|' ||
                coalesce(p_metadata_json::text, '') || '|' ||
                coalesce(v_prev_hash, '');
  v_hash := encode(extensions.digest(v_row_data, 'sha256'), 'hex');

  insert into audit_events (
    organisation_id, actor_id, actor_role, action, entity, entity_id,
    reason, metadata_json, prev_hash, hash
  ) values (
    p_organisation_id, v_actor_id, v_actor_role, p_action, p_entity, p_entity_id,
    p_reason, p_metadata_json, v_prev_hash, v_hash
  )
  returning * into v_result;

  return v_result;
end;
$$;

drop function if exists gate_b_probe_digest_schema();
