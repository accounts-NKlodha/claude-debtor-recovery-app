-- 0018_email_delivery.sql
-- Production email delivery (Gmail SMTP + Google App Password, no OAuth).
-- See docs/email-delivery/index.md for the full design and the "SMTP
-- success + database failure" ambiguous-outcome handling this schema
-- exists to support.
--
-- Closes two durable-workflow gaps: `communications` had no idempotency
-- primitive (a retried sendInitialReminder call would insert a second row
-- and could re-trigger a real SMTP send with no duplicate protection at
-- all), and `communication_deliveries` -- designed for exactly this --
-- was never written to by any code path (confirmed in the P0-5 audit).
--
-- Every new RPC follows the P0-5-R1 manifest policy exactly: SECURITY
-- DEFINER, `set search_path = public`, explicit `auth.uid()` +
-- `p_expected_actor_id` + `is_staff()` checks, EXECUTE revoked from
-- `public` AND explicitly from `anon` (not just relying on the omitted
-- default-privilege grant, per the P0-5-R1 finding), granted only to
-- `authenticated`. `supabase/rpc-manifest.ts` is updated in the same
-- commit as this migration.

-- ---------------------------------------------------------------------------
-- Schema: durable idempotency key on communications (nullable -- existing
-- non-reminder communication paths, if any are ever added, are unaffected;
-- a NULL never conflicts with another NULL under a standard unique
-- constraint). Reuses the existing adapter_outcome enum (0001_init.sql) on
-- communication_deliveries to capture the retryable/terminal distinction
-- the delivery_status enum alone doesn't carry -- no new enum invented.
-- ---------------------------------------------------------------------------

alter table communications
  add column idempotency_key text unique;

alter table communication_deliveries
  add column adapter_outcome adapter_outcome;

-- ---------------------------------------------------------------------------
-- begin_communication_send: acquires (or, on retry, finds) the durable
-- "send intent" row BEFORE any SMTP call is made -- this is what makes a
-- retried sendInitialReminder call safe: the caller checks the returned
-- `isNew`/`status` and skips the SMTP call entirely if a prior attempt
-- already reached a terminal 'sent' status. Idempotent via
-- select-then-insert-on-conflict-then-reselect (safe under real
-- concurrency, not just single-request retries): whichever concurrent
-- caller's INSERT wins gets isNew=true; the other's INSERT affects zero
-- rows and it re-reads the winner's row.
-- ---------------------------------------------------------------------------

create or replace function begin_communication_send(
  p_case_id uuid,
  p_channel channel,
  p_idempotency_key text,
  p_template_key text,
  p_template_version integer,
  p_subject text,
  p_body text,
  p_reason text,
  p_expected_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_comm communications;
begin
  if auth.uid() is null then
    raise exception 'begin_communication_send: no authenticated caller' using errcode = '28000';
  end if;
  if p_expected_actor_id is not null and p_expected_actor_id is distinct from auth.uid() then
    raise exception 'begin_communication_send: caller identity mismatch' using errcode = '28000';
  end if;
  if not is_staff() then
    raise exception 'begin_communication_send: staff/admin session required' using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'begin_communication_send: idempotency key required' using errcode = '22023';
  end if;

  select organisation_id into v_org_id from recovery_cases where id = p_case_id;
  if v_org_id is null then
    raise exception 'begin_communication_send: case % not found', p_case_id using errcode = 'P0002';
  end if;

  select * into v_comm from communications where idempotency_key = p_idempotency_key;
  if v_comm.id is not null then
    return jsonb_build_object('communication', to_jsonb(v_comm), 'isNew', false);
  end if;

  insert into communications (
    organisation_id, case_id, channel, direction, template_key, template_version,
    subject, body, delivery_status, idempotency_key
  ) values (
    v_org_id, p_case_id, p_channel, 'outbound', p_template_key, p_template_version,
    p_subject, p_body, 'queued', p_idempotency_key
  )
  on conflict (idempotency_key) do nothing
  returning * into v_comm;

  if v_comm.id is null then
    -- Lost a race against a concurrent identical call between the SELECT
    -- above and this INSERT -- the winner's row is now visible.
    select * into v_comm from communications where idempotency_key = p_idempotency_key;
    return jsonb_build_object('communication', to_jsonb(v_comm), 'isNew', false);
  end if;

  perform record_audit_event(v_org_id, 'communication.queued', 'communication', v_comm.id, p_reason, null);
  return jsonb_build_object('communication', to_jsonb(v_comm), 'isNew', true);
end;
$$;
revoke execute on function begin_communication_send(uuid, channel, text, text, integer, text, text, text, uuid) from public, anon;
grant execute on function begin_communication_send(uuid, channel, text, text, integer, text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- begin_delivery_attempt: records that an attempt is STARTING, before the
-- SMTP call -- this is the second half of what makes "SMTP success then a
-- crash before the outcome is persisted" detectable rather than silently
-- reattempted. If the most recent attempt for this communication is still
-- 'queued' (i.e. a prior begin_delivery_attempt was never followed by a
-- matching complete_delivery_attempt -- the exact ambiguous-outcome shape),
-- this call refuses to start a new attempt and reports it as blocked
-- unless the caller explicitly passes p_force_after_ambiguous -- an
-- operator-triggered "retry anyway, I've confirmed no duplicate was sent"
-- action, never an automatic one. `unique (communication_id, attempt)`
-- (0001_init.sql) makes a literal double-insert of the same attempt number
-- impossible regardless.
-- ---------------------------------------------------------------------------

create or replace function begin_delivery_attempt(
  p_communication_id uuid,
  p_attempt integer,
  p_reason text,
  p_expected_actor_id uuid default null,
  p_force_after_ambiguous boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_latest communication_deliveries;
  v_delivery communication_deliveries;
begin
  if auth.uid() is null then
    raise exception 'begin_delivery_attempt: no authenticated caller' using errcode = '28000';
  end if;
  if p_expected_actor_id is not null and p_expected_actor_id is distinct from auth.uid() then
    raise exception 'begin_delivery_attempt: caller identity mismatch' using errcode = '28000';
  end if;
  if not is_staff() then
    raise exception 'begin_delivery_attempt: staff/admin session required' using errcode = '42501';
  end if;

  select organisation_id into v_org_id from communications where id = p_communication_id;
  if v_org_id is null then
    raise exception 'begin_delivery_attempt: communication % not found', p_communication_id using errcode = 'P0002';
  end if;

  select * into v_latest from communication_deliveries
    where communication_id = p_communication_id
    order by attempt desc
    limit 1;

  if v_latest.id is not null and v_latest.status = 'queued' and not p_force_after_ambiguous then
    return jsonb_build_object(
      'blocked', true,
      'blockedReason', 'A previous delivery attempt (#' || v_latest.attempt || ') was started but never completed -- its outcome is unknown, so a duplicate send cannot be ruled out automatically. An operator must confirm before retrying.',
      'delivery', to_jsonb(v_latest)
    );
  end if;

  insert into communication_deliveries (organisation_id, communication_id, attempt, status)
  values (v_org_id, p_communication_id, p_attempt, 'queued')
  on conflict (communication_id, attempt) do nothing
  returning * into v_delivery;

  if v_delivery.id is null then
    select * into v_delivery from communication_deliveries
      where communication_id = p_communication_id and attempt = p_attempt;
  end if;

  return jsonb_build_object('blocked', false, 'blockedReason', null, 'delivery', to_jsonb(v_delivery));
end;
$$;
revoke execute on function begin_delivery_attempt(uuid, integer, text, uuid, boolean) from public, anon;
grant execute on function begin_delivery_attempt(uuid, integer, text, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- complete_delivery_attempt: persists the definitive outcome of one
-- attempt (must currently be 'queued' -- idempotent no-op if already
-- completed, matching every other retry-safe RPC in this codebase),
-- updates the parent communication's aggregate delivery state, applies the
-- case-state transition via the existing apply_case_mutation() (reused,
-- not reimplemented -- p_case is the full post-transition RecoveryCase
-- patch the TypeScript caller already computes via
-- applyReminderSent/applyReminderDelivered/applyReminderDeliveryFailed,
-- exactly as sendInitialReminder already did before this migration), and
-- audits the delivery attempt itself (sanitized error classification only
-- -- p_error_detail is always one of the fixed, non-sensitive error codes
-- src/adapters/gmail-smtp.ts produces, never a raw exception).
-- ---------------------------------------------------------------------------

create or replace function complete_delivery_attempt(
  p_delivery_id uuid,
  p_status delivery_status,
  p_adapter_outcome adapter_outcome,
  p_provider_message_id text,
  p_error_detail text,
  p_case_id uuid,
  p_case jsonb,
  p_reason text,
  p_expected_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery communication_deliveries;
  v_comm communications;
  v_case recovery_cases;
  v_org_id uuid;
  v_action text;
begin
  if auth.uid() is null then
    raise exception 'complete_delivery_attempt: no authenticated caller' using errcode = '28000';
  end if;
  if p_expected_actor_id is not null and p_expected_actor_id is distinct from auth.uid() then
    raise exception 'complete_delivery_attempt: caller identity mismatch' using errcode = '28000';
  end if;
  if not is_staff() then
    raise exception 'complete_delivery_attempt: staff/admin session required' using errcode = '42501';
  end if;

  select * into v_delivery from communication_deliveries where id = p_delivery_id for update;
  if v_delivery.id is null then
    raise exception 'complete_delivery_attempt: delivery attempt % not found', p_delivery_id using errcode = 'P0002';
  end if;

  if v_delivery.status <> 'queued' then
    -- Already completed -- idempotent no-op (e.g. a retried request that
    -- reached this call twice). Return current state unchanged, no new
    -- audit row, no re-applied case transition.
    select * into v_comm from communications where id = v_delivery.communication_id;
    select * into v_case from recovery_cases where id = p_case_id;
    return jsonb_build_object('delivery', to_jsonb(v_delivery), 'communication', to_jsonb(v_comm), 'case', to_jsonb(v_case));
  end if;

  update communication_deliveries set
    status = p_status,
    adapter_outcome = p_adapter_outcome,
    provider = 'gmail-smtp',
    provider_message_id = p_provider_message_id,
    error_detail = p_error_detail
  where id = p_delivery_id
  returning * into v_delivery;

  update communications set
    delivery_status = p_status,
    provider_message_id = coalesce(p_provider_message_id, provider_message_id),
    delivered_at = case when p_status = 'sent' then now() else delivered_at end
  where id = v_delivery.communication_id
  returning * into v_comm;
  v_org_id := v_comm.organisation_id;

  if p_case is not null then
    v_action := case when p_status = 'sent' then 'reminder.sent' else 'reminder.delivery_failed' end;
    select apply_case_mutation(p_case_id, p_case, v_action, 'recovery_case', p_reason, null, p_expected_actor_id)
      into v_case;
  else
    select * into v_case from recovery_cases where id = p_case_id;
  end if;

  perform record_audit_event(
    v_org_id, 'communication.delivery_attempted', 'communication', v_comm.id, p_reason,
    jsonb_build_object(
      'attempt', v_delivery.attempt,
      'status', p_status,
      'adapterOutcome', p_adapter_outcome,
      'errorCode', p_error_detail
    )
  );

  return jsonb_build_object('delivery', to_jsonb(v_delivery), 'communication', to_jsonb(v_comm), 'case', to_jsonb(v_case));
end;
$$;
revoke execute on function complete_delivery_attempt(uuid, delivery_status, adapter_outcome, text, text, uuid, jsonb, text, uuid) from public, anon;
grant execute on function complete_delivery_attempt(uuid, delivery_status, adapter_outcome, text, text, uuid, jsonb, text, uuid) to authenticated;
