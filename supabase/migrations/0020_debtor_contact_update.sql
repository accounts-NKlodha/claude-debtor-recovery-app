-- 0020_debtor_contact_update.sql
-- P0/P1 core workflow remediation: final UAT found that no mechanism exists
-- anywhere in the application to capture or correct a debtor's mobile/email
-- -- the `debtors.mobile`/`debtors.email` columns have existed since
-- 0001_init.sql, but every intake path only ever inserted `name`/`gstin`,
-- and 0011_close_direct_write_bypass.sql already made `debtors` staff-read-
-- only via RLS (INSERT/UPDATE/DELETE revoked from anon/authenticated), so a
-- new SECURITY DEFINER RPC is the only way to add this without reopening
-- direct table writes. Mirrors the exact pattern established in
-- 0006_production_write_rpcs.sql (auth.uid() check, expected-actor
-- consistency check, is_staff() check, record_audit_event, revoke-then-
-- grant EXECUTE).

-- ---------------------------------------------------------------------------
-- update_debtor_contact: the only way to change a debtor's mobile/email.
-- Staff/admin only (client must never modify debtor contact information --
-- final-UAT go-live task). Full-replace semantics (whatever is passed
-- becomes the new value, including null to clear a field) -- the calling
-- UI always pre-fills the edit form with the debtor's current values, so
-- there is no partial-update ambiguity to resolve here.
-- ---------------------------------------------------------------------------

create or replace function update_debtor_contact(
  p_debtor_id uuid,
  p_email text,
  p_mobile text,
  p_reason text,
  p_expected_actor_id uuid default null
)
returns debtors
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_old debtors;
  v_new debtors;
  v_email_changed boolean;
  v_mobile_changed boolean;
begin
  if auth.uid() is null then
    raise exception 'update_debtor_contact: no authenticated caller' using errcode = '28000';
  end if;
  if p_expected_actor_id is not null and p_expected_actor_id is distinct from auth.uid() then
    raise exception 'update_debtor_contact: caller identity mismatch' using errcode = '28000';
  end if;
  if not is_staff() then
    raise exception 'update_debtor_contact: staff/admin session required' using errcode = '42501';
  end if;

  -- Light format backstop, defense in depth -- the application layer
  -- (src/contract/schemas.ts) already validates properly; this only guards
  -- against a caller that bypasses the app (e.g. a direct RPC call).
  if p_email is not null and p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'update_debtor_contact: malformed email' using errcode = '22000';
  end if;
  if p_mobile is not null and p_mobile !~ '^(\+?91)?[6-9]\d{9}$' then
    raise exception 'update_debtor_contact: malformed Indian mobile number' using errcode = '22000';
  end if;

  select * into v_old from debtors where id = p_debtor_id;
  if v_old.id is null then
    raise exception 'update_debtor_contact: debtor % not found', p_debtor_id using errcode = 'P0002';
  end if;
  v_org_id := v_old.organisation_id;

  update debtors
  set email = p_email,
      mobile = p_mobile,
      updated_at = now()
  where id = p_debtor_id
  returning * into v_new;

  v_email_changed := v_old.email is distinct from v_new.email;
  v_mobile_changed := v_old.mobile is distinct from v_new.mobile;

  -- Change indicators only, never the actual contact values -- final-UAT
  -- go-live task: prefer this over duplicating PII into immutable audit
  -- history (audit_events is append-only forever; debtors.email/mobile are
  -- correctable, so a historical audit row should not become the one place
  -- a stale/wrong value survives indefinitely).
  perform record_audit_event(
    v_org_id, 'debtor.contact_updated', 'debtor', p_debtor_id, p_reason,
    jsonb_build_object('emailChanged', v_email_changed, 'mobileChanged', v_mobile_changed)
  );

  return v_new;
end;
$$;

revoke execute on function update_debtor_contact(uuid, text, text, text, uuid) from public, anon;
grant execute on function update_debtor_contact(uuid, text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- create_case_from_invoice: additively extended (same name/signature,
-- p_debtor is an opaque jsonb blob so no signature change is needed) to
-- also persist debtor mobile/email at intake time -- both optional, never
-- fabricated if absent. When an existing debtor is matched by name (the
-- existing find-or-reuse behavior, unchanged), backfill only whichever
-- contact field is currently null on that debtor; an already-set field is
-- left untouched rather than silently overwritten by a new intake row
-- (final-UAT go-live task's approved bulk-import behavior: "populate
-- missing debtor contact information", never overwrite a conflicting
-- existing value here).
-- ---------------------------------------------------------------------------

create or replace function create_case_from_invoice(
  p_organisation_id uuid,
  p_debtor jsonb,   -- { name, gstin, outstandingBalance, mobile?, email? }
  p_case jsonb,      -- full new recovery_cases row (see column list below)
  p_invoice jsonb,   -- full new invoices row
  p_reason text,
  p_expected_actor_id uuid default null
)
returns jsonb -- { "case": recovery_cases, "invoice": invoices, "debtor": debtors }
language plpgsql
security definer
set search_path = public
as $$
declare
  v_debtor debtors;
  v_case recovery_cases;
  v_invoice invoices;
begin
  if auth.uid() is null then
    raise exception 'create_case_from_invoice: no authenticated caller' using errcode = '28000';
  end if;
  if p_expected_actor_id is not null and p_expected_actor_id is distinct from auth.uid() then
    raise exception 'create_case_from_invoice: caller identity mismatch' using errcode = '28000';
  end if;
  if not is_staff() then
    raise exception 'create_case_from_invoice: staff/admin session required' using errcode = '42501';
  end if;

  select * into v_debtor from debtors
  where organisation_id = p_organisation_id and lower(name) = lower(p_debtor->>'name')
  limit 1;

  if v_debtor.id is null then
    insert into debtors (organisation_id, name, gstin, mobile, email, total_due, contact_verified)
    values (
      p_organisation_id, p_debtor->>'name', p_debtor->>'gstin',
      p_debtor->>'mobile', p_debtor->>'email',
      (p_debtor->>'outstandingBalance')::bigint, false
    )
    returning * into v_debtor;
  elsif (p_debtor->>'mobile' is not null and v_debtor.mobile is null)
     or (p_debtor->>'email' is not null and v_debtor.email is null) then
    update debtors
    set mobile = coalesce(v_debtor.mobile, p_debtor->>'mobile'),
        email = coalesce(v_debtor.email, p_debtor->>'email'),
        updated_at = now()
    where id = v_debtor.id
    returning * into v_debtor;
  end if;

  insert into recovery_cases (
    organisation_id, debtor_id, status, automation_mode, waiting_on, automation_started_at,
    current_step, blocker, next_scheduled_action, eligibility_route, principal_outstanding,
    recovered_to_date, activated_at
  ) values (
    p_organisation_id, v_debtor.id,
    (p_case->>'status')::case_status,
    'assist',
    (p_case->>'waitingOn')::waiting_on,
    now(),
    p_case->>'currentStep',
    p_case->>'blocker',
    p_case->>'nextScheduledAction',
    (p_case->>'eligibilityRoute')::eligibility_route,
    (p_case->>'principalOutstanding')::bigint,
    0,
    null
  )
  returning * into v_case;

  insert into invoices (
    organisation_id, case_id, debtor_id, invoice_number, invoice_date, due_date,
    taxable_value, tax_rate, tax_amount, invoice_total, outstanding_balance
  ) values (
    p_organisation_id, v_case.id, v_debtor.id,
    p_invoice->>'invoiceNumber',
    (p_invoice->>'invoiceDate')::date,
    (p_invoice->>'dueDate')::date,
    (p_invoice->>'taxableValue')::bigint,
    (p_invoice->>'taxRate')::numeric,
    (p_invoice->>'taxAmount')::bigint,
    (p_invoice->>'invoiceTotal')::bigint,
    (p_invoice->>'outstandingBalance')::bigint
  )
  returning * into v_invoice;

  perform record_audit_event(
    p_organisation_id, 'case.created_from_intake', 'recovery_case', v_case.id, p_reason, null
  );

  return jsonb_build_object(
    'case', to_jsonb(v_case),
    'invoice', to_jsonb(v_invoice),
    'debtor', to_jsonb(v_debtor)
  );
end;
$$;

revoke execute on function create_case_from_invoice(uuid, jsonb, jsonb, jsonb, text, uuid) from public;
grant execute on function create_case_from_invoice(uuid, jsonb, jsonb, jsonb, text, uuid) to authenticated;
