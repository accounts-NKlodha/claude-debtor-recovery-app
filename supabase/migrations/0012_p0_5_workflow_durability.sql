-- 0012_p0_5_workflow_durability.sql
-- P0-5: durable recovery-workflow gaps closed. See docs/workflow-durability
-- for the full model this migration implements.
--
-- Scope (see docs/workflow-durability/index.md for what is deliberately
-- OUT of scope and why): workflow_tasks becomes a real operational primitive
-- driven by the existing workflow.ts `raise_task` effects; DD and hearing get
-- dedicated durable tables (both were previously represented only as a case
-- status + an audit-log text string, per 0006/0007's own comments); confirmed
-- payments now materialize `payment_allocations`; inbound debtor replies get
-- a real recording path. orchestration_runs/orchestration_step_attempts are
-- deliberately NOT touched here -- this product has no async job engine
-- (every mutation is a synchronous authenticated-session RPC call); building
-- run/step tracking for an orchestration engine that doesn't exist would be
-- speculative machinery, not durability. `eligibility_checks`,
-- `external_submissions`, `portal_artifacts`, `fee_ledger_entries`,
-- `documents`/`document_versions`, `notifications` also stay out of scope --
-- each is a materially separate feature (evidence store, fee billing,
-- portal-artifact capture) not named in this task's required steps 3-8.
--
-- Every new/changed RPC follows the exact security pattern already
-- established in 0006/0007: SECURITY DEFINER, `set search_path = public`,
-- explicit `auth.uid() is null` + `p_expected_actor_id` identity-mismatch
-- checks, an explicit role check (`is_staff()`), EXECUTE revoked from
-- `public` and (for the two internal-only helpers) not granted to
-- `authenticated` either -- reachable only via `perform` from inside another
-- SECURITY DEFINER function, never directly through PostgREST.

-- ---------------------------------------------------------------------------
-- New enum types
-- ---------------------------------------------------------------------------

create type dd_status as enum ('preparation_pending', 'prepared', 'submitted');

create type hearing_status as enum ('scheduled', 'adjourned', 'completed', 'cancelled');

-- ---------------------------------------------------------------------------
-- dd_records: one row per case's demand draft (MSEFC filing fee). A missing
-- row means "not yet started" -- there is no separate not_required flag
-- because nothing in the current product model triggers DD preparation
-- except the existing DD_PREPARED transition (msme_odr_filed -> msefc_dd),
-- which only fires when a case actually needs one.
-- ---------------------------------------------------------------------------

create table dd_records (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id),
  case_id          uuid not null references recovery_cases(id) on delete cascade,
  status           dd_status not null default 'preparation_pending',
  amount           bigint,                  -- paise
  payee            text,
  reference        text,
  prepared_at      timestamptz,
  submitted_at     timestamptz,
  document_id      uuid references documents(id),
  notes            text,
  created_by       uuid references app_users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (case_id)
);
create index dd_records_org_idx on dd_records(organisation_id);

-- ---------------------------------------------------------------------------
-- case_hearings: one row per hearing occurrence (not per case) so a
-- reschedule/adjournment produces real history instead of overwriting the
-- prior date. `rescheduled_from_id` chains an occurrence to the one it
-- replaced. At most one row per case may be `status = 'scheduled'` at a time
-- (enforced in reschedule_hearing/schedule_hearing below, not by a DB
-- constraint, since Postgres has no native "at most one non-distinct partial
-- unique" primitive across an open-ended history table without a generated
-- column -- the RPCs are the only write path, so this is sufficient).
-- ---------------------------------------------------------------------------

create table case_hearings (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references organisations(id),
  case_id             uuid not null references recovery_cases(id) on delete cascade,
  calendar_event_id   uuid references calendar_events(id),
  forum               text,
  authority            text,
  case_reference       text,
  assigned_staff_id    uuid references app_users(id),
  scheduled_at         timestamptz not null,
  status               hearing_status not null default 'scheduled',
  result               text,
  rescheduled_from_id  uuid references case_hearings(id),
  notes                text,
  created_by           uuid references app_users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index case_hearings_org_idx on case_hearings(organisation_id);
create index case_hearings_case_idx on case_hearings(case_id);
create index case_hearings_open_idx on case_hearings(case_id) where status = 'scheduled';

-- ---------------------------------------------------------------------------
-- RLS + grants for the two new tables: staff/admin read-only, same shape as
-- every table 0011 closed -- no direct INSERT/UPDATE/DELETE for any role;
-- every write goes through the RPCs below.
-- ---------------------------------------------------------------------------

alter table dd_records enable row level security;
create policy dd_records_staff_read on dd_records for select using (is_staff());
create policy dd_records_client_read on dd_records for select
  using (organisation_id in (select current_org_ids()));
revoke insert, update, delete on dd_records from anon, authenticated;
grant select on dd_records to anon, authenticated;

alter table case_hearings enable row level security;
create policy case_hearings_staff_read on case_hearings for select using (is_staff());
create policy case_hearings_client_read on case_hearings for select
  using (organisation_id in (select current_org_ids()));
revoke insert, update, delete on case_hearings from anon, authenticated;
grant select on case_hearings to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internal helper: auto-resolve every open workflow_tasks row for a case
-- that has just reached a terminal status (case-state invariant, P0-5 §10 --
-- "closed case should not keep active recovery tasks"). Not directly
-- reachable via PostgREST (no grant to authenticated); called via `perform`
-- from apply_case_mutation and apply_payment_confirmation below, which
-- already ran under SECURITY DEFINER, so this executes with the same
-- elevated privilege regardless of the outer caller's own grants.
-- ---------------------------------------------------------------------------

create or replace function close_case_tasks_if_terminal(
  p_case_id uuid,
  p_organisation_id uuid,
  p_status text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status in ('recovered', 'closed', 'withdrawn', 'archived') then
    update workflow_tasks
      set resolved_at = now()
      where case_id = p_case_id and resolved_at is null;
    if found then
      perform record_audit_event(
        p_organisation_id, 'task.auto_resolved', 'recovery_case', p_case_id,
        coalesce(p_reason, 'Case reached terminal status ' || p_status || ' -- auto-resolving open tasks'),
        null
      );
    end if;
  end if;
end;
$$;
revoke execute on function close_case_tasks_if_terminal(uuid, uuid, text, text) from public;

-- ---------------------------------------------------------------------------
-- Internal helper: idempotently raise a workflow task -- if an unresolved
-- task of the same (case_id, type) already exists, return it unchanged
-- instead of creating a duplicate. This is what makes every caller below
-- (prepare_dd, schedule_hearing, record_debtor_reply, ...) safe to retry:
-- a retried mutation re-computes the same effect and re-calls this function,
-- which is a no-op on the task side the second time.
-- ---------------------------------------------------------------------------

create or replace function raise_workflow_task(
  p_case_id uuid,
  p_organisation_id uuid,
  p_type task_type,
  p_title text,
  p_waiting_on waiting_on,
  p_urgent boolean,
  p_due_at timestamptz,
  p_reason text
)
returns workflow_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task workflow_tasks;
begin
  select * into v_task from workflow_tasks
    where case_id = p_case_id and type = p_type and resolved_at is null
    limit 1;
  if found then
    return v_task;
  end if;

  insert into workflow_tasks (
    organisation_id, case_id, type, title, waiting_on, urgent, due_at
  ) values (
    p_organisation_id, p_case_id, p_type, p_title, p_waiting_on, p_urgent, p_due_at
  )
  returning * into v_task;

  perform record_audit_event(p_organisation_id, 'task.raised', 'workflow_task', v_task.id, p_reason, null);
  return v_task;
end;
$$;
revoke execute on function raise_workflow_task(uuid, uuid, task_type, text, waiting_on, boolean, timestamptz, text) from public;

-- ---------------------------------------------------------------------------
-- resolve_workflow_task: the one staff/admin-facing, directly callable task
-- mutation ("workflow task completion", P0-5 §9). Idempotent by design: an
-- already-resolved task is returned unchanged with no new audit row on a
-- retry -- a resolved task carries no further business effect either way, so
-- a friendly no-op is correct here (contrast with apply_payment_confirmation
-- below, where a retry could double-count money and so must be rejected).
-- ---------------------------------------------------------------------------

create or replace function resolve_workflow_task(
  p_task_id uuid,
  p_reason text,
  p_expected_actor_id uuid default null
)
returns workflow_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task workflow_tasks;
begin
  if auth.uid() is null then
    raise exception 'resolve_workflow_task: no authenticated caller' using errcode = '28000';
  end if;
  if p_expected_actor_id is not null and p_expected_actor_id is distinct from auth.uid() then
    raise exception 'resolve_workflow_task: caller identity mismatch' using errcode = '28000';
  end if;
  if not is_staff() then
    raise exception 'resolve_workflow_task: staff/admin session required' using errcode = '42501';
  end if;

  select * into v_task from workflow_tasks where id = p_task_id;
  if v_task.id is null then
    raise exception 'resolve_workflow_task: task % not found', p_task_id using errcode = 'P0002';
  end if;
  if v_task.resolved_at is not null then
    return v_task;
  end if;

  update workflow_tasks set resolved_at = now() where id = p_task_id returning * into v_task;
  perform record_audit_event(v_task.organisation_id, 'task.resolved', 'workflow_task', p_task_id, p_reason, null);
  return v_task;
end;
$$;
revoke execute on function resolve_workflow_task(uuid, text, uuid) from public;
grant execute on function resolve_workflow_task(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- prepare_dd: create-or-update the case's DD record (amount/payee/reference/
-- notes may be filled incrementally), apply the case's DD_PREPARED
-- transition (a no-op on the case row if already past msme_odr_filed --
-- applyDdPrepared / advance() is naturally idempotent there), and raise the
-- dd_preparation task. Rejects further edits once the DD has been submitted
-- (an operational record, not silently overwritable after the fact).
-- ---------------------------------------------------------------------------

create or replace function prepare_dd(
  p_case_id uuid,
  p_case jsonb,
  p_amount bigint,
  p_payee text,
  p_reference text,
  p_notes text,
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
  v_case recovery_cases;
  v_dd dd_records;
  v_existing_status dd_status;
begin
  if auth.uid() is null then
    raise exception 'prepare_dd: no authenticated caller' using errcode = '28000';
  end if;
  if p_expected_actor_id is not null and p_expected_actor_id is distinct from auth.uid() then
    raise exception 'prepare_dd: caller identity mismatch' using errcode = '28000';
  end if;
  if not is_staff() then
    raise exception 'prepare_dd: staff/admin session required' using errcode = '42501';
  end if;

  select organisation_id into v_org_id from recovery_cases where id = p_case_id;
  if v_org_id is null then
    raise exception 'prepare_dd: case % not found', p_case_id using errcode = 'P0002';
  end if;

  select status into v_existing_status from dd_records where case_id = p_case_id;
  if v_existing_status = 'submitted' then
    raise exception 'prepare_dd: DD for case % is already submitted -- cannot re-prepare', p_case_id
      using errcode = '22023';
  end if;

  update recovery_cases set
    status                = (p_case->>'status')::case_status,
    waiting_on             = (p_case->>'waitingOn')::waiting_on,
    current_step           = p_case->>'currentStep',
    blocker                = p_case->>'blocker',
    next_scheduled_action   = p_case->>'nextScheduledAction',
    next_scheduled_at       = (p_case->>'nextScheduledAt')::timestamptz,
    eligibility_route       = (p_case->>'eligibilityRoute')::eligibility_route,
    principal_outstanding   = (p_case->>'principalOutstanding')::bigint,
    recovered_to_date       = (p_case->>'recoveredToDate')::bigint
  where id = p_case_id
  returning * into v_case;

  insert into dd_records (organisation_id, case_id, status, amount, payee, reference, prepared_at, notes, created_by)
  values (v_org_id, p_case_id, 'prepared', p_amount, p_payee, p_reference, now(), p_notes, auth.uid())
  on conflict (case_id) do update set
    amount     = coalesce(excluded.amount, dd_records.amount),
    payee      = coalesce(excluded.payee, dd_records.payee),
    reference  = coalesce(excluded.reference, dd_records.reference),
    notes      = coalesce(excluded.notes, dd_records.notes),
    status     = case when dd_records.status = 'preparation_pending' then 'prepared'::dd_status else dd_records.status end,
    prepared_at = coalesce(dd_records.prepared_at, now()),
    updated_at  = now()
  returning * into v_dd;

  perform raise_workflow_task(
    p_case_id, v_org_id, 'dd_preparation',
    'Prepare and dispatch MSEFC demand draft',
    'client', false, null, p_reason
  );

  perform record_audit_event(v_org_id, 'dd.prepared', 'recovery_case', p_case_id, p_reason, null);

  return jsonb_build_object('case', to_jsonb(v_case), 'dd', to_jsonb(v_dd));
end;
$$;
revoke execute on function prepare_dd(uuid, jsonb, bigint, text, text, text, text, uuid) from public;
grant execute on function prepare_dd(uuid, jsonb, bigint, text, text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- record_dd_submitted: mark the DD handed over/submitted. Idempotent no-op
-- on retry (unlike a payment confirmation, resubmitting the same DD has no
-- financial double-application risk -- it is a status flag, not money).
-- ---------------------------------------------------------------------------

create or replace function record_dd_submitted(
  p_case_id uuid,
  p_submitted_at timestamptz,
  p_document_id uuid,
  p_reason text,
  p_expected_actor_id uuid default null
)
returns dd_records
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_dd dd_records;
begin
  if auth.uid() is null then
    raise exception 'record_dd_submitted: no authenticated caller' using errcode = '28000';
  end if;
  if p_expected_actor_id is not null and p_expected_actor_id is distinct from auth.uid() then
    raise exception 'record_dd_submitted: caller identity mismatch' using errcode = '28000';
  end if;
  if not is_staff() then
    raise exception 'record_dd_submitted: staff/admin session required' using errcode = '42501';
  end if;

  select * into v_dd from dd_records where case_id = p_case_id;
  if v_dd.id is null then
    raise exception 'record_dd_submitted: no DD prepared for case %', p_case_id using errcode = 'P0002';
  end if;
  if v_dd.status = 'submitted' then
    return v_dd; -- idempotent no-op, see header note
  end if;
  v_org_id := v_dd.organisation_id;

  update dd_records set
    status = 'submitted',
    submitted_at = coalesce(p_submitted_at, now()),
    document_id = coalesce(p_document_id, document_id),
    updated_at = now()
  where case_id = p_case_id
  returning * into v_dd;

  update workflow_tasks
    set resolved_at = now()
    where case_id = p_case_id and type = 'dd_preparation' and resolved_at is null;

  perform record_audit_event(v_org_id, 'dd.submitted', 'recovery_case', p_case_id, p_reason, null);
  return v_dd;
end;
$$;
revoke execute on function record_dd_submitted(uuid, timestamptz, uuid, text, uuid) from public;
grant execute on function record_dd_submitted(uuid, timestamptz, uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- schedule_hearing: first scheduling for a case. Idempotent on an exact
-- repeat of the same date (returns the existing row); rejects a *different*
-- date while one is already open, directing the caller to reschedule_hearing
-- instead -- an explicit, auditable transition rather than a silent
-- overwrite (P0-5 §6/§10 "reallocation/reversal must be explicit").
-- ---------------------------------------------------------------------------

create or replace function schedule_hearing(
  p_case_id uuid,
  p_case jsonb,
  p_scheduled_at timestamptz,
  p_forum text,
  p_authority text,
  p_case_reference text,
  p_assigned_staff_id uuid,
  p_notes text,
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
  v_case recovery_cases;
  v_hearing case_hearings;
  v_event calendar_events;
  v_existing case_hearings;
begin
  if auth.uid() is null then
    raise exception 'schedule_hearing: no authenticated caller' using errcode = '28000';
  end if;
  if p_expected_actor_id is not null and p_expected_actor_id is distinct from auth.uid() then
    raise exception 'schedule_hearing: caller identity mismatch' using errcode = '28000';
  end if;
  if not is_staff() then
    raise exception 'schedule_hearing: staff/admin session required' using errcode = '42501';
  end if;

  select organisation_id into v_org_id from recovery_cases where id = p_case_id;
  if v_org_id is null then
    raise exception 'schedule_hearing: case % not found', p_case_id using errcode = 'P0002';
  end if;

  select * into v_existing from case_hearings where case_id = p_case_id and status = 'scheduled';
  if v_existing.id is not null then
    if v_existing.scheduled_at = p_scheduled_at then
      select * into v_case from recovery_cases where id = p_case_id;
      return jsonb_build_object('case', to_jsonb(v_case), 'hearing', to_jsonb(v_existing));
    end if;
    raise exception 'schedule_hearing: a hearing is already scheduled for case % -- use reschedule_hearing to change the date', p_case_id
      using errcode = '22023';
  end if;

  update recovery_cases set
    status                = (p_case->>'status')::case_status,
    waiting_on             = (p_case->>'waitingOn')::waiting_on,
    current_step           = p_case->>'currentStep',
    blocker                = p_case->>'blocker',
    next_scheduled_action   = p_case->>'nextScheduledAction',
    next_scheduled_at       = (p_case->>'nextScheduledAt')::timestamptz,
    eligibility_route       = (p_case->>'eligibilityRoute')::eligibility_route,
    principal_outstanding   = (p_case->>'principalOutstanding')::bigint,
    recovered_to_date       = (p_case->>'recoveredToDate')::bigint
  where id = p_case_id
  returning * into v_case;

  insert into calendar_events (organisation_id, case_id, kind, title, starts_at, notes, created_by)
  values (v_org_id, p_case_id, 'hearing', coalesce(p_forum, 'MSEFC hearing') || ' — case ' || p_case_id, p_scheduled_at, p_notes, auth.uid())
  returning * into v_event;

  insert into case_hearings (
    organisation_id, case_id, calendar_event_id, forum, authority, case_reference,
    assigned_staff_id, scheduled_at, notes, created_by
  ) values (
    v_org_id, p_case_id, v_event.id, p_forum, p_authority, p_case_reference,
    p_assigned_staff_id, p_scheduled_at, p_notes, auth.uid()
  )
  returning * into v_hearing;

  perform raise_workflow_task(
    p_case_id, v_org_id, 'hearing_followup',
    'Attend hearing and record outcome',
    'staff', false, p_scheduled_at, p_reason
  );

  perform record_audit_event(v_org_id, 'hearing.scheduled', 'recovery_case', p_case_id, p_reason, null);

  return jsonb_build_object('case', to_jsonb(v_case), 'hearing', to_jsonb(v_hearing), 'calendarEvent', to_jsonb(v_event));
end;
$$;
revoke execute on function schedule_hearing(uuid, jsonb, timestamptz, text, text, text, uuid, text, text, uuid) from public;
grant execute on function schedule_hearing(uuid, jsonb, timestamptz, text, text, text, uuid, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- reschedule_hearing: marks the current scheduled occurrence 'adjourned' and
-- inserts a new 'scheduled' occurrence (full history preserved). Rejects a
-- hearing that is not currently 'scheduled' (already adjourned/completed/
-- cancelled) -- an explicit precondition, not a silent state overwrite.
-- ---------------------------------------------------------------------------

create or replace function reschedule_hearing(
  p_hearing_id uuid,
  p_case_id uuid,
  p_case jsonb,
  p_new_scheduled_at timestamptz,
  p_forum text,
  p_authority text,
  p_case_reference text,
  p_assigned_staff_id uuid,
  p_notes text,
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
  v_case recovery_cases;
  v_old case_hearings;
  v_new case_hearings;
  v_event calendar_events;
begin
  if auth.uid() is null then
    raise exception 'reschedule_hearing: no authenticated caller' using errcode = '28000';
  end if;
  if p_expected_actor_id is not null and p_expected_actor_id is distinct from auth.uid() then
    raise exception 'reschedule_hearing: caller identity mismatch' using errcode = '28000';
  end if;
  if not is_staff() then
    raise exception 'reschedule_hearing: staff/admin session required' using errcode = '42501';
  end if;

  select * into v_old from case_hearings where id = p_hearing_id and case_id = p_case_id;
  if v_old.id is null then
    raise exception 'reschedule_hearing: hearing % not found on case %', p_hearing_id, p_case_id using errcode = 'P0002';
  end if;
  if v_old.status <> 'scheduled' then
    raise exception 'reschedule_hearing: hearing % is not currently scheduled (status %)', p_hearing_id, v_old.status
      using errcode = '22023';
  end if;
  v_org_id := v_old.organisation_id;

  update case_hearings set status = 'adjourned', updated_at = now() where id = p_hearing_id;

  update recovery_cases set
    status                = (p_case->>'status')::case_status,
    waiting_on             = (p_case->>'waitingOn')::waiting_on,
    current_step           = p_case->>'currentStep',
    blocker                = p_case->>'blocker',
    next_scheduled_action   = p_case->>'nextScheduledAction',
    next_scheduled_at       = (p_case->>'nextScheduledAt')::timestamptz,
    eligibility_route       = (p_case->>'eligibilityRoute')::eligibility_route,
    principal_outstanding   = (p_case->>'principalOutstanding')::bigint,
    recovered_to_date       = (p_case->>'recoveredToDate')::bigint
  where id = p_case_id
  returning * into v_case;

  insert into calendar_events (organisation_id, case_id, kind, title, starts_at, notes, created_by)
  values (v_org_id, p_case_id, 'hearing', coalesce(p_forum, v_old.forum, 'MSEFC hearing') || ' — case ' || p_case_id, p_new_scheduled_at, p_notes, auth.uid())
  returning * into v_event;

  insert into case_hearings (
    organisation_id, case_id, calendar_event_id, forum, authority, case_reference,
    assigned_staff_id, scheduled_at, notes, created_by, rescheduled_from_id
  ) values (
    v_org_id, p_case_id, v_event.id,
    coalesce(p_forum, v_old.forum), coalesce(p_authority, v_old.authority), coalesce(p_case_reference, v_old.case_reference),
    coalesce(p_assigned_staff_id, v_old.assigned_staff_id), p_new_scheduled_at, p_notes, auth.uid(), p_hearing_id
  )
  returning * into v_new;

  -- hearing_followup stays open across a reschedule (still real operator
  -- work pending); no new task is raised.

  perform record_audit_event(v_org_id, 'hearing.rescheduled', 'recovery_case', p_case_id, p_reason, null);

  return jsonb_build_object('case', to_jsonb(v_case), 'hearing', to_jsonb(v_new), 'calendarEvent', to_jsonb(v_event));
end;
$$;
revoke execute on function reschedule_hearing(uuid, uuid, jsonb, timestamptz, text, text, text, uuid, text, text, uuid) from public;
grant execute on function reschedule_hearing(uuid, uuid, jsonb, timestamptz, text, text, text, uuid, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- record_hearing_outcome: 'completed' or 'cancelled', with the case's
-- resulting status (recovered/closed) computed by the caller via
-- applyHearingOutcome. Idempotent: a hearing already in a terminal status
-- returns unchanged -- a genuine correction is out of scope for this phase
-- (see docs/workflow-durability); this is a deliberate, documented
-- restriction, not an oversight.
-- ---------------------------------------------------------------------------

create or replace function record_hearing_outcome(
  p_hearing_id uuid,
  p_case_id uuid,
  p_case jsonb,
  p_status hearing_status,
  p_result text,
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
  v_case recovery_cases;
  v_hearing case_hearings;
begin
  if auth.uid() is null then
    raise exception 'record_hearing_outcome: no authenticated caller' using errcode = '28000';
  end if;
  if p_expected_actor_id is not null and p_expected_actor_id is distinct from auth.uid() then
    raise exception 'record_hearing_outcome: caller identity mismatch' using errcode = '28000';
  end if;
  if not is_staff() then
    raise exception 'record_hearing_outcome: staff/admin session required' using errcode = '42501';
  end if;
  if p_status not in ('completed', 'cancelled') then
    raise exception 'record_hearing_outcome: status must be completed or cancelled, got %', p_status
      using errcode = '22023';
  end if;

  select * into v_hearing from case_hearings where id = p_hearing_id and case_id = p_case_id;
  if v_hearing.id is null then
    raise exception 'record_hearing_outcome: hearing % not found on case %', p_hearing_id, p_case_id using errcode = 'P0002';
  end if;
  if v_hearing.status in ('completed', 'cancelled') then
    select * into v_case from recovery_cases where id = p_case_id;
    return jsonb_build_object('case', to_jsonb(v_case), 'hearing', to_jsonb(v_hearing)); -- idempotent no-op
  end if;
  v_org_id := v_hearing.organisation_id;

  update case_hearings set status = p_status, result = p_result, updated_at = now()
    where id = p_hearing_id
    returning * into v_hearing;

  update recovery_cases set
    status                = (p_case->>'status')::case_status,
    waiting_on             = (p_case->>'waitingOn')::waiting_on,
    current_step           = p_case->>'currentStep',
    blocker                = p_case->>'blocker',
    next_scheduled_action   = p_case->>'nextScheduledAction',
    next_scheduled_at       = (p_case->>'nextScheduledAt')::timestamptz,
    eligibility_route       = (p_case->>'eligibilityRoute')::eligibility_route,
    principal_outstanding   = (p_case->>'principalOutstanding')::bigint,
    recovered_to_date       = (p_case->>'recoveredToDate')::bigint,
    closed_at               = (p_case->>'closedAt')::timestamptz
  where id = p_case_id
  returning * into v_case;

  update workflow_tasks
    set resolved_at = now()
    where case_id = p_case_id and type = 'hearing_followup' and resolved_at is null;

  perform close_case_tasks_if_terminal(p_case_id, v_org_id, v_case.status::text, p_reason);
  perform record_audit_event(v_org_id, 'hearing.outcome_recorded', 'recovery_case', p_case_id, p_reason, null);

  return jsonb_build_object('case', to_jsonb(v_case), 'hearing', to_jsonb(v_hearing));
end;
$$;
revoke execute on function record_hearing_outcome(uuid, uuid, jsonb, hearing_status, text, text, uuid) from public;
grant execute on function record_hearing_outcome(uuid, uuid, jsonb, hearing_status, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- record_debtor_reply: staff records + classifies an inbound reply (no AI
-- classification is wired in this phase -- classification_confidence stays
-- null, reviewed_by_id/reviewed_at are always set since a human just made
-- the call). Drives the same REPLY_CLASSIFIED transition workflow.ts already
-- implements, raising payment_confirmation/dispute_resolution/
-- staff_validation as the state machine decides -- idempotent via
-- raise_workflow_task's existing-open-task dedup.
-- ---------------------------------------------------------------------------

create or replace function record_debtor_reply(
  p_case_id uuid,
  p_case jsonb,
  p_channel channel,
  p_raw_body text,
  p_communication_id uuid,
  p_classification reply_classification,
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
  v_case recovery_cases;
  v_reply debtor_replies;
begin
  if auth.uid() is null then
    raise exception 'record_debtor_reply: no authenticated caller' using errcode = '28000';
  end if;
  if p_expected_actor_id is not null and p_expected_actor_id is distinct from auth.uid() then
    raise exception 'record_debtor_reply: caller identity mismatch' using errcode = '28000';
  end if;
  if not is_staff() then
    raise exception 'record_debtor_reply: staff/admin session required' using errcode = '42501';
  end if;

  select organisation_id into v_org_id from recovery_cases where id = p_case_id;
  if v_org_id is null then
    raise exception 'record_debtor_reply: case % not found', p_case_id using errcode = 'P0002';
  end if;

  insert into debtor_replies (
    organisation_id, case_id, communication_id, channel, raw_body,
    classification, reviewed_by_id, reviewed_at
  ) values (
    v_org_id, p_case_id, p_communication_id, p_channel, p_raw_body,
    p_classification, auth.uid(), now()
  )
  returning * into v_reply;

  update recovery_cases set
    status                = (p_case->>'status')::case_status,
    waiting_on             = (p_case->>'waitingOn')::waiting_on,
    current_step           = p_case->>'currentStep',
    blocker                = p_case->>'blocker',
    next_scheduled_action   = p_case->>'nextScheduledAction',
    next_scheduled_at       = (p_case->>'nextScheduledAt')::timestamptz,
    eligibility_route       = (p_case->>'eligibilityRoute')::eligibility_route,
    principal_outstanding   = (p_case->>'principalOutstanding')::bigint,
    recovered_to_date       = (p_case->>'recoveredToDate')::bigint
  where id = p_case_id
  returning * into v_case;

  if p_classification = 'payment_made' then
    perform raise_workflow_task(p_case_id, v_org_id, 'payment_confirmation',
      'Client to confirm receipt claimed by debtor', 'client', false, null, p_reason);
  elsif p_classification in ('dispute', 'settlement_offer', 'document_request') then
    perform raise_workflow_task(p_case_id, v_org_id, 'dispute_resolution',
      'Staff to resolve debtor ' || p_classification::text, 'staff', false, null, p_reason);
  elsif p_classification = 'unclear' then
    perform raise_workflow_task(p_case_id, v_org_id, 'staff_validation',
      'Staff to review unclear debtor reply', 'staff', false, null, p_reason);
  end if;

  perform record_audit_event(v_org_id, 'debtor_reply.recorded', 'recovery_case', p_case_id, p_reason, null);

  return jsonb_build_object('case', to_jsonb(v_case), 'reply', to_jsonb(v_reply));
end;
$$;
revoke execute on function record_debtor_reply(uuid, jsonb, channel, text, uuid, reply_classification, text, uuid) from public;
grant execute on function record_debtor_reply(uuid, jsonb, channel, text, uuid, reply_classification, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- apply_case_mutation: add the terminal-task-closure hook (defence in depth
-- for any current/future caller that drives a case to a terminal status
-- through this generic path -- e.g. a future "withdraw case" action).
-- Everything else is unchanged from 0006's definition.
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

  perform close_case_tasks_if_terminal(p_case_id, v_org_id, v_case.status::text, p_reason);
  perform record_audit_event(v_org_id, p_action, p_entity, p_case_id, p_reason, null);

  return v_case;
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_payment_confirmation: add payment_allocations persistence + the
-- terminal-task-closure hook. Row lock / already-confirmed guard (0007) is
-- unchanged -- that is what makes the allocation insert loop below safe from
-- a retry (a second call never reaches this far; it is rejected first).
-- New guards: allocation sum cannot exceed the payment's own amount; each
-- invoice's resulting balance cannot go negative. Allocation rows are
-- inserted with `on conflict do nothing` against the existing
-- (payment_record_id, invoice_id) unique constraint as defence in depth,
-- even though the confirmation-level lock already prevents a real duplicate
-- call from reaching this code twice.
-- ---------------------------------------------------------------------------

create or replace function apply_payment_confirmation(
  p_payment_id uuid,
  p_case jsonb,
  p_invoice_updates jsonb, -- [{ "id": uuid, "outstandingBalance": bigint, "applied": bigint }, ...]
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
  v_already_confirmed boolean;
  v_payment_amount bigint;
  v_allocated_total bigint;
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

  -- Row lock: a concurrent second confirm() on the same payment blocks here
  -- until this transaction commits or rolls back, instead of both readers
  -- seeing client_confirmed = false and both proceeding to double-apply.
  select case_id, organisation_id, client_confirmed, amount
  into v_case_id, v_org_id, v_already_confirmed, v_payment_amount
  from payment_records where id = p_payment_id
  for update;

  if v_case_id is null then
    raise exception 'apply_payment_confirmation: payment % not found', p_payment_id using errcode = 'P0002';
  end if;
  if v_already_confirmed then
    raise exception 'apply_payment_confirmation: payment % is already confirmed -- refusing to re-apply',
      p_payment_id using errcode = '22023';
  end if;

  select coalesce(sum((e->>'applied')::bigint), 0) into v_allocated_total
    from jsonb_array_elements(coalesce(p_invoice_updates, '[]'::jsonb)) e;
  if v_allocated_total > v_payment_amount then
    raise exception 'apply_payment_confirmation: allocations (%) exceed payment amount (%) for payment %',
      v_allocated_total, v_payment_amount, p_payment_id using errcode = '22023';
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
    if (v_item->>'outstandingBalance')::bigint < 0 then
      raise exception 'apply_payment_confirmation: invoice % outstanding balance would go negative', v_item->>'id'
        using errcode = '22023';
    end if;

    update invoices
    set outstanding_balance = (v_item->>'outstandingBalance')::bigint
    where id = (v_item->>'id')::uuid and organisation_id = v_org_id and case_id = v_case_id;

    if (v_item->>'applied') is not null and ((v_item->>'applied')::bigint) > 0 then
      insert into payment_allocations (organisation_id, payment_record_id, invoice_id, amount)
      values (v_org_id, p_payment_id, (v_item->>'id')::uuid, (v_item->>'applied')::bigint)
      on conflict (payment_record_id, invoice_id) do nothing;
    end if;
  end loop;

  perform close_case_tasks_if_terminal(v_case_id, v_org_id, v_case.status::text, p_reason);
  perform record_audit_event(v_org_id, 'payment.confirmed', 'recovery_case', v_case_id, p_reason, null);

  return v_case;
end;
$$;
