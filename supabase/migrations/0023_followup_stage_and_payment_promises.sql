-- 0023_followup_stage_and_payment_promises.sql
-- WhatsApp V1 (complete approved AiSensy message families). Two things:
--
-- 1. An explicit follow-up reminder stage. The pure state machine
--    (src/domain/workflow.ts) previously moved `initial_communication_sent`
--    straight to GST eligibility review when the 24h timer elapsed. The
--    approved business rule is that a follow-up reminder comes BEFORE any
--    GST/MSME/statutory escalation review, so a new case status
--    `follow_up_sent` is added: reached when an operator sends the follow-up
--    reminder, followed by a second response window, and only then GST
--    review. (Adding an enum value is purely additive; no existing row or
--    function changes. The value is referenced only via text casts at run
--    time, never inside this transaction.)
--
-- 2. A durable promise-to-pay record. Nothing previously stored a promised
--    date or amount -- the case only carried the status `promise_to_pay`.
--    `payment_promises` holds one row per promise; when the debtor changes
--    the date the earlier promise is marked `superseded` (never
--    overwritten), so history is preserved and the new promise gets its own
--    identity -- which is what the WhatsApp commitment-reminder idempotency
--    key is built on.
--
-- Write access follows the established pattern (0011): the table is
-- staff-read via RLS, direct INSERT/UPDATE/DELETE is revoked from
-- anon/authenticated, and the only writer is the SECURITY DEFINER RPC below
-- (auth.uid() check, expected-actor check, is_staff() check, audit).

alter type case_status add value if not exists 'follow_up_sent';

create table payment_promises (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references organisations(id),
  case_id           uuid not null references recovery_cases(id) on delete cascade,
  -- Nullable ("where applicable"); a WhatsApp commitment reminder still
  -- requires an unambiguous invoice (see src/domain/whatsapp-messages.ts).
  invoice_id        uuid references invoices(id),
  promised_on       date not null,
  promised_amount   bigint check (promised_amount is null or promised_amount > 0), -- paise, optional
  status            text not null default 'active' check (status in ('active', 'superseded')),
  source_reply_id   uuid references debtor_replies(id) on delete set null,
  supersedes_id     uuid references payment_promises(id),
  recorded_by_id    uuid not null references app_users(id),
  created_at        timestamptz not null default now(),
  superseded_at     timestamptz
);
create index payment_promises_org_idx on payment_promises(organisation_id);
create index payment_promises_case_idx on payment_promises(case_id);
-- At most one ACTIVE promise per (case, invoice); a case-level promise (no
-- invoice) counts as its own slot. Also serialises a concurrent double
-- submit at the database level.
create unique index payment_promises_one_active_idx
  on payment_promises (case_id, coalesce(invoice_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'active';

alter table payment_promises enable row level security;
create policy payment_promises_staff_read on payment_promises for select using (is_staff());
revoke insert, update, delete on payment_promises from anon, authenticated;
revoke all on payment_promises from anon;

-- ---------------------------------------------------------------------------
-- record_payment_promise: the only way to create a promise. Supersedes the
-- previous ACTIVE promise for the same case+invoice (kept, marked
-- superseded), optionally applies the workflow transition the caller
-- computed (p_case, same convention as record_debtor_reply), and audits.
-- Audit metadata carries the promised date and indicators only.
-- ---------------------------------------------------------------------------
create or replace function record_payment_promise(
  p_case_id uuid,
  p_invoice_id uuid,
  p_promised_on date,
  p_promised_amount bigint,
  p_source_reply_id uuid,
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
  v_case recovery_cases;
  v_invoice invoices;
  v_prev payment_promises;
  v_new payment_promises;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.uid() is null then
    raise exception 'record_payment_promise: no authenticated caller' using errcode = '28000';
  end if;
  if p_expected_actor_id is not null and p_expected_actor_id is distinct from auth.uid() then
    raise exception 'record_payment_promise: caller identity mismatch' using errcode = '28000';
  end if;
  if not is_staff() then
    raise exception 'record_payment_promise: staff/admin session required' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'record_payment_promise: a reason is required' using errcode = '22000';
  end if;

  -- Row lock on the case serialises concurrent promise recordings.
  select * into v_case from recovery_cases where id = p_case_id for update;
  if v_case.id is null then
    raise exception 'record_payment_promise: case % not found', p_case_id using errcode = 'P0002';
  end if;
  if v_case.status::text not in ('initial_communication_sent', 'follow_up_sent', 'promise_to_pay') then
    raise exception 'record_payment_promise: a promise can only be recorded while awaiting the debtor''s response (case is %)',
      v_case.status using errcode = '22023';
  end if;

  if p_promised_on is null or p_promised_on < v_today or p_promised_on > v_today + 180 then
    raise exception 'record_payment_promise: promised date must be between today and 180 days ahead' using errcode = '22000';
  end if;

  if p_invoice_id is not null then
    select * into v_invoice from invoices where id = p_invoice_id and case_id = p_case_id;
    if v_invoice.id is null then
      raise exception 'record_payment_promise: invoice % does not belong to this case', p_invoice_id using errcode = '22023';
    end if;
  end if;
  if p_promised_amount is not null then
    if p_promised_amount <= 0 then
      raise exception 'record_payment_promise: promised amount must be positive' using errcode = '22000';
    end if;
    if v_invoice.id is not null and p_promised_amount > v_invoice.outstanding_balance then
      raise exception 'record_payment_promise: promised amount exceeds the invoice''s outstanding balance' using errcode = '22000';
    end if;
  end if;
  if p_source_reply_id is not null
     and not exists (select 1 from debtor_replies where id = p_source_reply_id and case_id = p_case_id) then
    raise exception 'record_payment_promise: reply % does not belong to this case', p_source_reply_id using errcode = '22023';
  end if;

  select * into v_prev from payment_promises
   where case_id = p_case_id
     and coalesce(invoice_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_invoice_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and status = 'active'
   for update;
  if v_prev.id is not null then
    update payment_promises set status = 'superseded', superseded_at = now() where id = v_prev.id;
  end if;

  insert into payment_promises (
    organisation_id, case_id, invoice_id, promised_on, promised_amount,
    source_reply_id, supersedes_id, recorded_by_id
  ) values (
    v_case.organisation_id, p_case_id, p_invoice_id, p_promised_on, p_promised_amount,
    p_source_reply_id, v_prev.id, auth.uid()
  )
  returning * into v_new;

  if p_case is not null then
    update recovery_cases set
      status                = (p_case->>'status')::case_status,
      waiting_on             = (p_case->>'waitingOn')::waiting_on,
      current_step           = p_case->>'currentStep',
      blocker                = p_case->>'blocker',
      next_scheduled_action   = p_case->>'nextScheduledAction',
      next_scheduled_at       = (p_case->>'nextScheduledAt')::timestamptz
    where id = p_case_id
    returning * into v_case;
  end if;

  perform record_audit_event(
    v_case.organisation_id, 'promise.recorded', 'recovery_case', p_case_id, p_reason,
    jsonb_build_object(
      'promisedOn', p_promised_on,
      'invoiceLinked', p_invoice_id is not null,
      'amountRecorded', p_promised_amount is not null,
      'supersededPrevious', v_prev.id is not null
    )
  );

  return jsonb_build_object('promise', to_jsonb(v_new), 'case', to_jsonb(v_case));
end;
$$;

revoke execute on function record_payment_promise(uuid, uuid, date, bigint, uuid, jsonb, text, uuid) from public, anon;
grant execute on function record_payment_promise(uuid, uuid, date, bigint, uuid, jsonb, text, uuid) to authenticated;
