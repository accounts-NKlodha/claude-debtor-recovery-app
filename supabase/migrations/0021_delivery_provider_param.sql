-- 0021_delivery_provider_param.sql
-- AiSensy WhatsApp production integration task: complete_delivery_attempt()
-- has hardcoded `provider = 'gmail-smtp'` on every completed delivery row
-- since 0018/0019, regardless of the actual channel/adapter used. That was
-- harmless while WhatsApp had no real production adapter (every real
-- delivery WAS gmail-smtp), but wiring a real AiSensy adapter through this
-- RPC unmodified would silently mislabel every WhatsApp delivery row as
-- 'gmail-smtp' in the database -- a genuine, pre-existing data-integrity
-- bug this task closes rather than perpetuates.
--
-- Adds a required `p_provider text` parameter; the TypeScript caller passes
-- the actual adapter's `.name` (e.g. "gmail-smtp", "aisensy", "mock-gmail",
-- "mock-whatsapp") explicitly instead of the SQL hardcoding a single value.
-- No other behavior change -- signature otherwise identical to 0019's
-- version, same auth checks, same idempotent-once-completed short-circuit.

create or replace function complete_delivery_attempt(
  p_delivery_id uuid,
  p_status delivery_status,
  p_adapter_outcome adapter_outcome,
  p_provider_message_id text,
  p_error_detail text,
  p_case_id uuid,
  p_case jsonb,
  p_reason text,
  p_provider text,
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
    select * into v_comm from communications where id = v_delivery.communication_id;
    select * into v_case from recovery_cases where id = p_case_id;
    return jsonb_build_object('delivery', to_jsonb(v_delivery), 'communication', to_jsonb(v_comm), 'case', to_jsonb(v_case));
  end if;

  update communication_deliveries set
    status = p_status,
    adapter_outcome = p_adapter_outcome,
    provider = p_provider,
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

    update recovery_cases set
      status                = (p_case->>'status')::case_status,
      waiting_on             = (p_case->>'waitingOn')::waiting_on,
      automation_started_at  = (p_case->>'automationStartedAt')::timestamptz,
      current_step           = p_case->>'currentStep',
      blocker                = p_case->>'blocker',
      next_scheduled_action   = p_case->>'nextScheduledAction',
      next_scheduled_at       = (p_case->>'nextScheduledAt')::timestamptz,
      eligibility_route       = (p_case->>'eligibilityRoute')::eligibility_route,
      principal_outstanding   = (p_case->>'principalOutstanding')::bigint,
      recovered_to_date       = (p_case->>'recoveredToDate')::bigint,
      activated_at            = (p_case->>'activatedAt')::timestamptz,
      closed_at               = (p_case->>'closedAt')::timestamptz
    where id = p_case_id
    returning * into v_case;

    perform close_case_tasks_if_terminal(p_case_id, v_org_id, v_case.status::text, p_reason);
    perform record_audit_event(v_org_id, v_action, 'recovery_case', p_case_id, p_reason, null);
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

-- The previous 9-argument signature (without p_provider) is superseded, not
-- overloaded -- drop it explicitly so PostgREST never has two ambiguous
-- overloads of the same RPC name to choose between.
drop function if exists complete_delivery_attempt(uuid, delivery_status, adapter_outcome, text, text, uuid, jsonb, text, uuid);

revoke execute on function complete_delivery_attempt(uuid, delivery_status, adapter_outcome, text, text, uuid, jsonb, text, text, uuid) from public, anon;
grant execute on function complete_delivery_attempt(uuid, delivery_status, adapter_outcome, text, text, uuid, jsonb, text, text, uuid) to authenticated;
