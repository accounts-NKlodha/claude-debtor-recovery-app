-- 0024: payment business date is the IST calendar date (DRAFT -- NOT APPLIED).
--
-- record_payment_row() (0006) stamped payment_records.received_on with the
-- database's current_date. The database timezone is UTC, so between 00:00 and
-- 05:30 IST every day a payment recorded "today" in India was stored with
-- yesterday's date, and the WhatsApp "received on" / "settled on" dates
-- derived from it were wrong. This is an India-based application: business
-- dates are IST dates (same convention record_payment_promise() in 0023 uses).
--
-- Only the date expression changes. Signature, return type, SECURITY DEFINER,
-- search_path, authentication / expected-actor / staff checks, the insert
-- columns and the audit event are byte-for-byte those of 0006. Existing rows
-- are NOT rewritten (no historical payment is altered). CREATE OR REPLACE keeps
-- the existing ACL; the revoke/grant below only restates it (PUBLIC and anon
-- get no EXECUTE -- see 0016).

create or replace function record_payment_row(
  p_case_id uuid,
  p_kind payment_kind,
  p_amount bigint,
  p_reference text,
  p_expected_actor_id uuid default null
)
returns payment_records
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_payment payment_records;
begin
  if auth.uid() is null then
    raise exception 'record_payment_row: no authenticated caller' using errcode = '28000';
  end if;
  if p_expected_actor_id is not null and p_expected_actor_id is distinct from auth.uid() then
    raise exception 'record_payment_row: caller identity mismatch' using errcode = '28000';
  end if;
  if not is_staff() then
    raise exception 'record_payment_row: staff/admin session required' using errcode = '42501';
  end if;

  select organisation_id into v_org_id from recovery_cases where id = p_case_id;
  if v_org_id is null then
    raise exception 'record_payment_row: case % not found', p_case_id using errcode = 'P0002';
  end if;

  insert into payment_records (
    organisation_id, case_id, kind, amount, received_on, reference, client_confirmed, recorded_by
  ) values (
    v_org_id, p_case_id, p_kind, p_amount, (now() at time zone 'Asia/Kolkata')::date, p_reference, false, auth.uid()
  )
  returning * into v_payment;

  perform record_audit_event(
    v_org_id, 'payment.recorded', 'payment_record', v_payment.id,
    format('%s receipt of %s paise recorded for case %s', p_kind, p_amount, p_case_id),
    null
  );

  return v_payment;
end;
$$;

revoke execute on function record_payment_row(uuid, payment_kind, bigint, text, uuid) from public, anon;
grant execute on function record_payment_row(uuid, payment_kind, bigint, text, uuid) to authenticated;
