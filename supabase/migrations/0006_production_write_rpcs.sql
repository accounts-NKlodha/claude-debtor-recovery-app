-- 0006_production_write_rpcs.sql
-- P0-4: privileged, atomic write paths for the business operations that
-- touch more than one row (a case update alongside a communication insert,
-- a payment confirmation alongside invoice-balance updates, a case created
-- alongside its debtor and first invoice). Mirrors the pattern established
-- by 0005_privileged_audit_writer.sql: SECURITY DEFINER functions that
-- derive the actor from auth.uid() (never a parameter), do their own
-- authorization check, and are the *only* way ordinary staff/client
-- sessions may perform these writes -- direct multi-statement writes from
-- application code would not be atomic and are not how SupabaseRepository
-- performs them (see src/server/repositories/supabase.ts).
--
-- Business logic itself (allocation math, workflow transitions, OCR
-- correction) stays in already-unit-tested TypeScript (src/domain/*.ts).
-- These functions only persist an already-computed result atomically --
-- they do not re-derive or duplicate that logic in PL/pgSQL, which would
-- create two sources of truth for the same rule with no way to keep them
-- in sync from this environment (no live Postgres is available to test
-- against -- see the honesty note in docs/DEPLOYMENT.md).
--
-- Every function also takes `p_expected_actor_id uuid` and, when supplied,
-- asserts it equals auth.uid() before writing anything. This does not
-- change who the actor IS -- attribution always comes from auth.uid(),
-- never from this parameter -- it is a defense-in-depth consistency check:
-- SupabaseRepository's caller already resolved a MutationActor from the
-- same request's session (src/lib/auth/session.ts), and the RPC runs
-- inside that same session's Postgres role, so the two must agree. A
-- mismatch would mean the JS-layer session and DB-layer session have
-- drifted -- a bug worth failing loudly on, not proceeding past.
--
-- NOT executed against a live database in this build (none is
-- provisioned). Written and cross-referenced against 0001_init.sql's exact
-- column set; type-checked from the TypeScript caller side
-- (src/server/repositories/supabase.ts), not live-tested.
--
-- P0-4 static migration audit finding: PostgreSQL grants EXECUTE on a newly
-- created function to PUBLIC by default, and 0005_privileged_audit_writer.sql
-- did not revoke it from record_audit_event -- so, before this migration,
-- every role (including `anon`) technically had EXECUTE on it, relying
-- solely on that function's own `auth.uid() is null` check to reject
-- unauthenticated callers. That check is sufficient (anon requests carry no
-- auth.uid()), but leaving the broad grant in place is not best practice and
-- obscures the intended access list. Fixed here, additively, rather than by
-- editing the historical migration (see the project convention above this
-- migration's own grants, applied consistently below).

revoke execute on function record_audit_event(uuid, text, text, uuid, text, jsonb) from public;

-- ---------------------------------------------------------------------------
-- system_settings -- backs the global automation kill switch.
-- No such table existed before this migration; getAutomationState/
-- setAutomationState (Repository interface) had nothing to persist to.
-- ---------------------------------------------------------------------------

create table system_settings (
  key         text primary key,
  value_json  jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references app_users(id)
);

insert into system_settings (key, value_json) values ('automation', jsonb_build_object('enabled', true));

alter table system_settings enable row level security;

-- Staff/admin may read the current state directly; only the privileged
-- function below may write it (mirrors audit_events' insert-only-via-function
-- shape) so app-layer authorization (P0-1/P0-2-R1's authorizeAdminMutation)
-- has a matching database-level control, not just an application-level one.
create policy system_settings_staff_read on system_settings
  for select using (is_staff());

-- ---------------------------------------------------------------------------
-- set_automation_state: the only way to change the global kill switch.
-- Admin-only (docs/LAUNCH_CHECKLIST.md: "Kill switch reachable by Admin";
-- docs/product-brief/index.md Admin row: "kill switch"), enforced here as
-- well as at the application layer (src/app/actions/settings.ts) -- defense
-- in depth, not a substitute for it.
-- ---------------------------------------------------------------------------

create or replace function set_automation_state(
  p_enabled boolean,
  p_reason text,
  p_expected_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'set_automation_state: no authenticated caller' using errcode = '28000';
  end if;
  if p_expected_actor_id is not null and p_expected_actor_id is distinct from auth.uid() then
    raise exception 'set_automation_state: caller identity mismatch' using errcode = '28000';
  end if;
  select role::text into v_actor_role from app_users where id = auth.uid();
  if v_actor_role is distinct from 'admin' then
    raise exception 'set_automation_state: admin session required' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'set_automation_state: a reason is required' using errcode = '22004';
  end if;

  update system_settings
  set value_json = jsonb_build_object('enabled', p_enabled),
      updated_at = now(),
      updated_by = auth.uid()
  where key = 'automation'
  returning value_json into v_result;

  perform record_audit_event(
    null,
    case when p_enabled then 'automation.enabled' else 'automation.disabled' end,
    'organisation',
    null,
    p_reason,
    null
  );

  return v_result;
end;
$$;

revoke execute on function set_automation_state(boolean, text, uuid) from public;
grant execute on function set_automation_state(boolean, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- apply_case_mutation: update a recovery_cases row, optionally insert one
-- accompanying communications row, and audit it -- atomically. Backs every
-- case-state-transition mutation that does not also touch invoices/payments:
-- sendInitialReminder, prepareGstNotification, captureGstFiling,
-- captureMsmeAcknowledgement, prepareDdTask, scheduleHearing.
--
-- p_case carries the FULL post-transition case object computed by the
-- relevant pure src/domain/*.ts function (applyReminderSent, applyGstFiled,
-- etc.) -- every key is always present (TypeScript's RecoveryCase type has
-- no optional fields here), so there is no ambiguity between "field not
-- supplied" and "field explicitly cleared to null".
-- ---------------------------------------------------------------------------

create or replace function apply_case_mutation(
  p_case_id uuid,
  p_case jsonb,
  p_action text,
  p_entity text,
  p_reason text,
  p_communication jsonb default null,
  p_expected_actor_id uuid default null
)
returns recovery_cases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case recovery_cases;
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'apply_case_mutation: no authenticated caller' using errcode = '28000';
  end if;
  if p_expected_actor_id is not null and p_expected_actor_id is distinct from auth.uid() then
    raise exception 'apply_case_mutation: caller identity mismatch' using errcode = '28000';
  end if;
  if not is_staff() then
    raise exception 'apply_case_mutation: staff/admin session required' using errcode = '42501';
  end if;

  select organisation_id into v_org_id from recovery_cases where id = p_case_id;
  if v_org_id is null then
    raise exception 'apply_case_mutation: case % not found', p_case_id using errcode = 'P0002';
  end if;

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

  if p_communication is not null then
    insert into communications (
      id, organisation_id, case_id, channel, direction, template_key, template_version,
      subject, body, provider_message_id, thread_ref, delivery_status, has_secure_link,
      created_at, delivered_at
    ) values (
      coalesce((p_communication->>'id')::uuid, gen_random_uuid()),
      v_org_id,
      p_case_id,
      (p_communication->>'channel')::channel,
      (p_communication->>'direction')::communication_direction,
      p_communication->>'templateKey',
      (p_communication->>'templateVersion')::integer,
      p_communication->>'subject',
      p_communication->>'body',
      p_communication->>'providerMessageId',
      p_communication->>'threadRef',
      (p_communication->>'deliveryStatus')::delivery_status,
      coalesce((p_communication->>'hasSecureLink')::boolean, false),
      coalesce((p_communication->>'createdAt')::timestamptz, now()),
      (p_communication->>'deliveredAt')::timestamptz
    );
  end if;

  perform record_audit_event(v_org_id, p_action, p_entity, p_case_id, p_reason, null);

  return v_case;
end;
$$;

revoke execute on function apply_case_mutation(uuid, jsonb, text, text, text, jsonb, uuid) from public;
grant execute on function apply_case_mutation(uuid, jsonb, text, text, text, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- record_payment_row: insert one payment_records row and audit it.
-- Separate from confirmation (below) -- recordPayment() may run without
-- clientConfirmed, matching MemoryRepository.recordPayment.
-- ---------------------------------------------------------------------------

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
    v_org_id, p_case_id, p_kind, p_amount, current_date, p_reference, false, auth.uid()
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

revoke execute on function record_payment_row(uuid, payment_kind, bigint, text, uuid) from public;
grant execute on function record_payment_row(uuid, payment_kind, bigint, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- apply_payment_confirmation: mark a payment confirmed, apply the
-- already-computed case patch (src/domain/apply-payment.ts
-- applyConfirmedPayment) and per-invoice balance updates, and audit it --
-- atomically. This is the one place a partial write would corrupt business
-- state (a confirmed payment with stale invoice balances, or vice versa),
-- so it is a single function call rather than three sequential
-- application-level requests.
-- ---------------------------------------------------------------------------

create or replace function apply_payment_confirmation(
  p_payment_id uuid,
  p_case jsonb,
  p_invoice_updates jsonb, -- [{ "id": uuid, "outstandingBalance": bigint }, ...]
  p_reason text,
  p_expected_actor_id uuid default null
)
returns recovery_cases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case_id uuid;
  v_org_id uuid;
  v_case recovery_cases;
  v_item jsonb;
begin
  if auth.uid() is null then
    raise exception 'apply_payment_confirmation: no authenticated caller' using errcode = '28000';
  end if;
  if p_expected_actor_id is not null and p_expected_actor_id is distinct from auth.uid() then
    raise exception 'apply_payment_confirmation: caller identity mismatch' using errcode = '28000';
  end if;
  if not is_staff() then
    raise exception 'apply_payment_confirmation: staff/admin session required' using errcode = '42501';
  end if;

  select case_id, organisation_id into v_case_id, v_org_id
  from payment_records where id = p_payment_id;
  if v_case_id is null then
    raise exception 'apply_payment_confirmation: payment % not found', p_payment_id using errcode = 'P0002';
  end if;

  update payment_records set client_confirmed = true where id = p_payment_id;

  update recovery_cases set
    status                = (p_case->>'status')::case_status,
    waiting_on             = (p_case->>'waitingOn')::waiting_on,
    current_step           = p_case->>'currentStep',
    blocker                = p_case->>'blocker',
    next_scheduled_action   = p_case->>'nextScheduledAction',
    next_scheduled_at       = (p_case->>'nextScheduledAt')::timestamptz,
    principal_outstanding   = (p_case->>'principalOutstanding')::bigint,
    recovered_to_date       = (p_case->>'recoveredToDate')::bigint,
    closed_at               = (p_case->>'closedAt')::timestamptz
  where id = v_case_id
  returning * into v_case;

  for v_item in select * from jsonb_array_elements(coalesce(p_invoice_updates, '[]'::jsonb))
  loop
    update invoices
    set outstanding_balance = (v_item->>'outstandingBalance')::bigint
    where id = (v_item->>'id')::uuid and organisation_id = v_org_id;
  end loop;

  perform record_audit_event(v_org_id, 'payment.confirmed', 'recovery_case', v_case_id, p_reason, null);

  return v_case;
end;
$$;

revoke execute on function apply_payment_confirmation(uuid, jsonb, jsonb, text, uuid) from public;
grant execute on function apply_payment_confirmation(uuid, jsonb, jsonb, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- correct_invoice_row: apply a staff OCR correction to one invoice, apply
-- the accompanying case patch (src/domain/ocr.ts applyOcrCorrected), and
-- audit it -- atomically (an invoice correction without the matching case
-- activation/principal update, or vice versa, would be an inconsistent read
-- for any caller in between).
-- ---------------------------------------------------------------------------

create or replace function correct_invoice_row(
  p_invoice_id uuid,
  p_corrections jsonb,
  p_case_id uuid,
  p_case jsonb,
  p_reason text,
  p_expected_actor_id uuid default null
)
returns invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_invoice invoices;
begin
  if auth.uid() is null then
    raise exception 'correct_invoice_row: no authenticated caller' using errcode = '28000';
  end if;
  if p_expected_actor_id is not null and p_expected_actor_id is distinct from auth.uid() then
    raise exception 'correct_invoice_row: caller identity mismatch' using errcode = '28000';
  end if;
  if not is_staff() then
    raise exception 'correct_invoice_row: staff/admin session required' using errcode = '42501';
  end if;

  select organisation_id into v_org_id from recovery_cases where id = p_case_id;
  if v_org_id is null then
    raise exception 'correct_invoice_row: case % not found', p_case_id using errcode = 'P0002';
  end if;

  update invoices set
    invoice_number        = coalesce(p_corrections->>'invoiceNumber', invoice_number),
    invoice_date           = coalesce((p_corrections->>'invoiceDate')::date, invoice_date),
    due_date                = case when p_corrections ? 'dueDate'
                                 then (p_corrections->>'dueDate')::date else due_date end,
    taxable_value           = coalesce((p_corrections->>'taxableValue')::bigint, taxable_value),
    tax_rate                = coalesce((p_corrections->>'taxRate')::numeric, tax_rate),
    tax_amount              = coalesce((p_corrections->>'taxAmount')::bigint, tax_amount),
    invoice_total           = coalesce((p_corrections->>'invoiceTotal')::bigint, invoice_total),
    outstanding_balance     = coalesce((p_corrections->>'outstandingBalance')::bigint, outstanding_balance),
    extraction_confidence   = 0.99
  where id = p_invoice_id and organisation_id = v_org_id
  returning * into v_invoice;

  if v_invoice.id is null then
    raise exception 'correct_invoice_row: invoice % not found on case %', p_invoice_id, p_case_id
      using errcode = 'P0002';
  end if;

  update recovery_cases set
    status                = (p_case->>'status')::case_status,
    waiting_on             = (p_case->>'waitingOn')::waiting_on,
    principal_outstanding   = (p_case->>'principalOutstanding')::bigint,
    activated_at            = (p_case->>'activatedAt')::timestamptz
  where id = p_case_id;

  perform record_audit_event(
    v_org_id, 'ocr.corrected', 'invoice', p_invoice_id, p_reason, null
  );

  return v_invoice;
end;
$$;

revoke execute on function correct_invoice_row(uuid, jsonb, uuid, jsonb, text, uuid) from public;
grant execute on function correct_invoice_row(uuid, jsonb, uuid, jsonb, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- create_case_from_invoice: find-or-create the debtor, insert the case,
-- insert the first invoice, and audit it -- atomically (an orphaned case
-- with no invoice, or an invoice pointing at a not-yet-committed case,
-- would violate the tenant-consistency composite FKs from
-- 0004_tenant_consistency.sql and corrupt intake state). Backs both
-- createCaseFromManualInvoice and commitBulkImport (which calls this once
-- per valid row).
-- ---------------------------------------------------------------------------

create or replace function create_case_from_invoice(
  p_organisation_id uuid,
  p_debtor jsonb,   -- { name, gstin, outstandingBalance }
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
    insert into debtors (organisation_id, name, gstin, total_due, contact_verified)
    values (
      p_organisation_id, p_debtor->>'name', p_debtor->>'gstin',
      (p_debtor->>'outstandingBalance')::bigint, false
    )
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

-- ---------------------------------------------------------------------------
-- create_organisation: insert a new organisation row and audit it --
-- atomically. P0-4 static audit finding: SupabaseRepository.createOrganisation
-- previously did these as two sequential Supabase calls (an INSERT, then a
-- separate record_audit_event RPC) -- already fail-loud if the second call
-- errored, but not atomic: a crash or transient failure between the two
-- could leave an organisation row with no audit trail. Duplicate checks
-- (client_code/creditor_gstin/legal_entity_name collisions) stay as
-- pre-flight reads in TypeScript -- they are not mutations, so they carry
-- no atomicity requirement of their own; client_code additionally has a DB
-- unique constraint (0001_init.sql) as defence in depth.
--
-- Admin-only (P0-1/P0-2-R2: onboarding a new client reads as Admin's
-- "Configuration" responsibility, not staff's case-operational one --
-- src/app/actions/organisations.ts), enforced here as well as at the
-- application layer.
-- ---------------------------------------------------------------------------

create or replace function create_organisation(
  p_client_code text,
  p_legal_entity_name text,
  p_creditor_gstin text,
  p_udyam_number text,
  p_jito_member boolean,
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
  v_org organisations;
begin
  if auth.uid() is null then
    raise exception 'create_organisation: no authenticated caller' using errcode = '28000';
  end if;
  if p_expected_actor_id is not null and p_expected_actor_id is distinct from auth.uid() then
    raise exception 'create_organisation: caller identity mismatch' using errcode = '28000';
  end if;
  select role::text into v_actor_role from app_users where id = auth.uid();
  if v_actor_role is distinct from 'admin' then
    raise exception 'create_organisation: admin session required' using errcode = '42501';
  end if;

  insert into organisations (client_code, legal_entity_name, creditor_gstin, udyam_number, jito_member)
  values (p_client_code, p_legal_entity_name, p_creditor_gstin, p_udyam_number, p_jito_member)
  returning * into v_org;

  perform record_audit_event(v_org.id, 'organisation.created', 'organisation', v_org.id, p_reason, null);

  return v_org;
end;
$$;

revoke execute on function create_organisation(text, text, text, text, boolean, text, uuid) from public;
grant execute on function create_organisation(text, text, text, text, boolean, text, uuid) to authenticated;
