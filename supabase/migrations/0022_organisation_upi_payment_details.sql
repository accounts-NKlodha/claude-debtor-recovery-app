-- 0022_organisation_upi_payment_details.sql
-- V2 AiSensy WhatsApp reminder (payment_reminder_initial_v2): the approved
-- template prints the creditor's UPI ID and UPI payee name, and both belong
-- to the creditor/client organisation. V1 payment method is UPI only.
--
-- Schema change: two NULLABLE text columns on organisations -- no default,
-- no rewrite (metadata-only ALTER in Postgres), every existing row simply
-- has NULL/NULL, which satisfies every check below. No data backfill: a
-- creditor with no payment details on file cannot have a WhatsApp reminder
-- sent (enforced in the application, src/domain/whatsapp-reminder.ts) --
-- the columns are never defaulted to a synthetic/placeholder value.
--
-- Constraints (defense in depth -- the application layer validates the same
-- shapes in src/contract/schemas.ts):
--   * both-or-neither: a UPI ID with no payee name (or vice versa) can never
--     be stored, so "configured" is always a single unambiguous state;
--   * UPI ID (VPA) shape: handle@psp;
--   * payee name: trimmed, 2-100 chars, no control characters and no run of
--     2+ spaces (WhatsApp template parameters may not contain newlines/tabs
--     or consecutive spaces).
--
-- New RPC update_organisation_payment_details(): the only way to change
-- these columns (organisations is already write-closed to anon/authenticated
-- by 0011, so a SECURITY DEFINER RPC is the established pattern). ADMIN only
-- -- these fields decide where a debtor is told to send money, the most
-- fraud-sensitive configuration in the product, so it follows the same
-- Admin-only "Configuration" boundary as create_organisation (0006) rather
-- than the broader staff boundary. Full-replace semantics; passing NULL/NULL
-- clears the details. The audit event records change indicators only, never
-- the UPI values themselves (same rationale as update_debtor_contact in
-- 0020: audit_events is append-only forever).

alter table organisations
  add column upi_id text,
  add column upi_payee_name text;

alter table organisations
  add constraint organisations_upi_pair_chk
    check ((upi_id is null) = (upi_payee_name is null)),
  add constraint organisations_upi_id_fmt_chk
    check (upi_id is null or upi_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,63}@[A-Za-z][A-Za-z0-9]{1,31}$'),
  add constraint organisations_upi_payee_fmt_chk
    check (
      upi_payee_name is null
      or (
        upi_payee_name = btrim(upi_payee_name)
        and char_length(upi_payee_name) between 2 and 100
        and upi_payee_name !~ '[[:cntrl:]]'
        and upi_payee_name !~ '  '
      )
    );

create or replace function update_organisation_payment_details(
  p_organisation_id uuid,
  p_upi_id text,
  p_upi_payee_name text,
  p_reason text,
  p_expected_actor_id uuid default null
)
returns organisations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_old organisations;
  v_new organisations;
begin
  if auth.uid() is null then
    raise exception 'update_organisation_payment_details: no authenticated caller' using errcode = '28000';
  end if;
  if p_expected_actor_id is not null and p_expected_actor_id is distinct from auth.uid() then
    raise exception 'update_organisation_payment_details: caller identity mismatch' using errcode = '28000';
  end if;
  select role::text into v_actor_role from app_users where id = auth.uid();
  if v_actor_role is distinct from 'admin' then
    raise exception 'update_organisation_payment_details: admin session required' using errcode = '42501';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'update_organisation_payment_details: a reason is required' using errcode = '22000';
  end if;
  if (p_upi_id is null) <> (p_upi_payee_name is null) then
    raise exception 'update_organisation_payment_details: UPI ID and payee name must be provided together' using errcode = '22000';
  end if;

  select * into v_old from organisations where id = p_organisation_id for update;
  if v_old.id is null then
    raise exception 'update_organisation_payment_details: organisation % not found', p_organisation_id using errcode = 'P0002';
  end if;

  -- Format violations surface as the table's own CHECK constraint errors
  -- (organisations_upi_id_fmt_chk / organisations_upi_payee_fmt_chk).
  update organisations
  set upi_id = p_upi_id,
      upi_payee_name = p_upi_payee_name
  where id = p_organisation_id
  returning * into v_new;

  perform record_audit_event(
    p_organisation_id, 'organisation.payment_details_updated', 'organisation', p_organisation_id, p_reason,
    jsonb_build_object(
      'configured', v_new.upi_id is not null,
      'upiIdChanged', v_old.upi_id is distinct from v_new.upi_id,
      'payeeNameChanged', v_old.upi_payee_name is distinct from v_new.upi_payee_name
    )
  );

  return v_new;
end;
$$;

revoke execute on function update_organisation_payment_details(uuid, text, text, text, uuid) from public, anon;
grant execute on function update_organisation_payment_details(uuid, text, text, text, uuid) to authenticated;
