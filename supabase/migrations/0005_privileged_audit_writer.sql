-- 0005_privileged_audit_writer.sql
-- Closes audit P1-4 / docs/PLAN.md M10: audit_events previously allowed any
-- authenticated caller to insert a row with an arbitrary actor_id/actor_role
-- and an arbitrary hash/prev_hash (`with check (true)`), which makes the
-- "tamper-evident" hash chain forgeable at the write path -- a caller could
-- attribute an action to someone else, or splice in a fabricated chain link.
--
-- Fix: revoke direct INSERT from authenticated/anon and replace it with a
-- SECURITY DEFINER function that:
--   * derives actor_id/actor_role from auth.uid()/current_user_role() only
--     (never a parameter -- so it cannot be forged by the caller),
--   * reads the true latest hash for the chain under a row lock (prevents a
--     race where two concurrent writers both read the same prev_hash),
--   * computes the row hash server-side from the row's own committed values.
--
-- P0-2 requirement 10: audit attribution must use authenticated server-side
-- identity, never a forgeable client-supplied value.

-- ---------------------------------------------------------------------------
-- Lock down direct writes
-- ---------------------------------------------------------------------------

drop policy if exists audit_events_insert_any on audit_events;
revoke insert on audit_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- record_audit_event: the only supported way to append an audit row
-- ---------------------------------------------------------------------------

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

  -- A client identity may only raise audit events for an organisation they
  -- belong to (mirrors the RLS scoping this function replaces for writes).
  if v_actor_role = 'client' and p_organisation_id is not null
     and p_organisation_id not in (select organisation_id from user_organisations where user_id = v_actor_id) then
    raise exception 'record_audit_event: caller is not a member of organisation %', p_organisation_id
      using errcode = '42501';
  end if;

  -- Lock the chain tail so concurrent callers cannot both read the same
  -- prev_hash and produce two "latest" links.
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
  v_hash := encode(digest(v_row_data, 'sha256'), 'hex');

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

-- Callers reach this only through the function, which enforces its own
-- authorization above -- so any authenticated caller may invoke it.
grant execute on function record_audit_event(uuid, text, text, uuid, text, jsonb) to authenticated;

-- pgcrypto's digest() is required for the hash computation (used elsewhere
-- in this schema already -- see 0001_init.sql's pgcrypto extension).
