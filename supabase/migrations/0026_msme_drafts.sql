-- 0026_msme_drafts.sql
-- MSME ODR "Save & resume": persist the wizard's actual form data.
--
-- Finding (Supabase UAT): saveMsmeStage only wrote an audit line, so the
-- values an operator entered never survived a reload or a fresh login. This
-- adds the smallest durable model: ONE draft row per case holding the merged
-- form data, which stages were saved, where the operator left off, an
-- optimistic-concurrency version, and a lock that becomes permanent once the
-- filing is submitted (diary number captured).
--
-- Security model (mirrors 0006/0012/0020 exactly):
--   * RLS on, staff/admin SELECT only. NO client policy at all -- drafts hold
--     claim data, so clients can neither read nor write them.
--   * No table write privilege for any API role; every write is a SECURITY
--     DEFINER RPC that checks auth.uid(), the expected-actor id and is_staff().
--   * Every write audits through record_audit_event.
--   * A locked draft is immutable at the database level (trigger), so a
--     future code path or a mistaken RPC cannot silently edit a filed
--     submission.

create table msme_drafts (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id),
  case_id          uuid not null references recovery_cases(id) on delete cascade,
  -- The wizard's flat form object, merged across saves (never audit text).
  form_data        jsonb not null default '{}'::jsonb,
  saved_stages     text[] not null default '{}',
  current_stage    text not null default 'claimant',
  status           text not null default 'draft',
  diary_number     text,
  petition_pdf_key text,
  locked_at        timestamptz,
  version          integer not null default 1,
  created_by       uuid references app_users(id),
  updated_by       uuid references app_users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (case_id),
  constraint msme_drafts_status_chk check (status in ('draft', 'locked')),
  constraint msme_drafts_stage_chk check (
    current_stage in ('claimant', 'respondent', 'advocate', 'statement_of_claim', 'documents', 'checklist', 'preview')
  ),
  constraint msme_drafts_form_object_chk check (jsonb_typeof(form_data) = 'object'),
  constraint msme_drafts_locked_chk check (
    status <> 'locked' or (diary_number is not null and locked_at is not null)
  )
);
create index msme_drafts_org_idx on msme_drafts(organisation_id);

alter table msme_drafts enable row level security;
create policy msme_drafts_staff_read on msme_drafts for select using (is_staff());
revoke all on msme_drafts from anon;
revoke insert, update, delete, truncate, trigger, references on msme_drafts from authenticated;
grant select on msme_drafts to authenticated;

-- ---------------------------------------------------------------------------
-- A locked draft can never be changed or deleted again, by anyone.
-- ---------------------------------------------------------------------------
create or replace function msme_drafts_block_locked_change()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'locked' then
    raise exception 'msme_drafts: a submitted (locked) MSME filing is immutable' using errcode = '55006';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function msme_drafts_block_locked_change() from public, anon, authenticated;

create trigger msme_drafts_locked_immutable
  before update or delete on msme_drafts
  for each row execute function msme_drafts_block_locked_change();

-- ---------------------------------------------------------------------------
-- save_msme_stage: create-or-update the case's draft. Merge semantics (the
-- wizard sends its whole flat form object every time, so a later save only
-- adds/overwrites the keys it carries). Refuses once the case has reached the
-- filed statuses or the draft is locked. p_expected_version (optional) makes
-- the update safe against a second session having saved in between; pass 0 to
-- assert "no draft exists yet".
-- ---------------------------------------------------------------------------
create or replace function save_msme_stage(
  p_case_id uuid,
  p_stage text,
  p_payload jsonb,
  p_reason text,
  p_expected_version integer default null,
  p_expected_actor_id uuid default null
)
returns msme_drafts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_case_status text;
  v_draft msme_drafts;
begin
  if auth.uid() is null then
    raise exception 'save_msme_stage: no authenticated caller' using errcode = '28000';
  end if;
  if p_expected_actor_id is not null and p_expected_actor_id is distinct from auth.uid() then
    raise exception 'save_msme_stage: caller identity mismatch' using errcode = '28000';
  end if;
  if not is_staff() then
    raise exception 'save_msme_stage: staff/admin session required' using errcode = '42501';
  end if;

  if p_stage is null
     or p_stage not in ('claimant', 'respondent', 'advocate', 'statement_of_claim', 'documents', 'checklist', 'preview') then
    raise exception 'save_msme_stage: unknown ODR stage' using errcode = '22000';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'save_msme_stage: stage data must be a JSON object' using errcode = '22000';
  end if;
  if octet_length(p_payload::text) > 50000 then
    raise exception 'save_msme_stage: stage data is too large' using errcode = '22000';
  end if;

  select organisation_id, status::text into v_org_id, v_case_status
  from recovery_cases where id = p_case_id;
  if v_org_id is null then
    raise exception 'save_msme_stage: case % not found', p_case_id using errcode = 'P0002';
  end if;
  if v_case_status in ('msme_odr_filed', 'msefc_dd', 'hearing_scheduled', 'adjourned') then
    raise exception 'save_msme_stage: the ODR filing was submitted; the draft is locked' using errcode = '55006';
  end if;

  select * into v_draft from msme_drafts where case_id = p_case_id for update;

  if found then
    if v_draft.status = 'locked' then
      raise exception 'save_msme_stage: the ODR filing was submitted; the draft is locked' using errcode = '55006';
    end if;
    if p_expected_version is not null and p_expected_version is distinct from v_draft.version then
      raise exception 'save_msme_stage: the draft was changed by another session (expected version %, found %)',
        p_expected_version, v_draft.version using errcode = '40001';
    end if;
    update msme_drafts
    set form_data     = form_data || p_payload,
        saved_stages  = case when p_stage = any(saved_stages) then saved_stages else array_append(saved_stages, p_stage) end,
        current_stage = p_stage,
        version       = version + 1,
        updated_by    = auth.uid(),
        updated_at    = now()
    where id = v_draft.id
    returning * into v_draft;
  else
    if p_expected_version is not null and p_expected_version <> 0 then
      raise exception 'save_msme_stage: the draft was changed by another session (expected version %, found none)',
        p_expected_version using errcode = '40001';
    end if;
    begin
      insert into msme_drafts (organisation_id, case_id, form_data, saved_stages, current_stage, created_by, updated_by)
      values (v_org_id, p_case_id, p_payload, array[p_stage], p_stage, auth.uid(), auth.uid())
      returning * into v_draft;
    exception when unique_violation then
      raise exception 'save_msme_stage: the draft was created by another session; reload and retry' using errcode = '40001';
    end;
  end if;

  perform record_audit_event(
    v_org_id, 'msme.stage_saved', 'recovery_case', p_case_id, p_reason,
    jsonb_build_object('stage', p_stage, 'version', v_draft.version)
  );

  return v_draft;
end;
$$;

revoke execute on function save_msme_stage(uuid, text, jsonb, text, integer, uuid) from public, anon;
grant execute on function save_msme_stage(uuid, text, jsonb, text, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- lock_msme_draft: called when the filing is submitted (diary number
-- captured). Idempotent for the same diary number; a different diary number
-- on an already-locked draft is refused. Creates a locked (empty) record if
-- the operator filed without ever saving a stage, so the filing is still
-- represented and cannot be silently re-drafted.
-- ---------------------------------------------------------------------------
create or replace function lock_msme_draft(
  p_case_id uuid,
  p_diary_number text,
  p_petition_pdf_key text,
  p_reason text,
  p_expected_actor_id uuid default null
)
returns msme_drafts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_draft msme_drafts;
begin
  if auth.uid() is null then
    raise exception 'lock_msme_draft: no authenticated caller' using errcode = '28000';
  end if;
  if p_expected_actor_id is not null and p_expected_actor_id is distinct from auth.uid() then
    raise exception 'lock_msme_draft: caller identity mismatch' using errcode = '28000';
  end if;
  if not is_staff() then
    raise exception 'lock_msme_draft: staff/admin session required' using errcode = '42501';
  end if;
  if p_diary_number is null or btrim(p_diary_number) = '' then
    raise exception 'lock_msme_draft: a diary number is required to lock a filing' using errcode = '22000';
  end if;

  select organisation_id into v_org_id from recovery_cases where id = p_case_id;
  if v_org_id is null then
    raise exception 'lock_msme_draft: case % not found', p_case_id using errcode = 'P0002';
  end if;

  select * into v_draft from msme_drafts where case_id = p_case_id for update;

  if found then
    if v_draft.status = 'locked' then
      if v_draft.diary_number is distinct from p_diary_number then
        raise exception 'lock_msme_draft: the filing is already locked with a different diary number' using errcode = '55006';
      end if;
      return v_draft;
    end if;
    update msme_drafts
    set status = 'locked', diary_number = p_diary_number, petition_pdf_key = p_petition_pdf_key,
        locked_at = now(), version = version + 1, updated_by = auth.uid(), updated_at = now()
    where id = v_draft.id
    returning * into v_draft;
  else
    insert into msme_drafts (organisation_id, case_id, current_stage, status, diary_number, petition_pdf_key,
                             locked_at, created_by, updated_by)
    values (v_org_id, p_case_id, 'preview', 'locked', p_diary_number, p_petition_pdf_key, now(), auth.uid(), auth.uid())
    returning * into v_draft;
  end if;

  perform record_audit_event(
    v_org_id, 'msme.draft_locked', 'recovery_case', p_case_id, p_reason,
    jsonb_build_object('diaryNumber', p_diary_number)
  );

  return v_draft;
end;
$$;

revoke execute on function lock_msme_draft(uuid, text, text, text, uuid) from public, anon;
grant execute on function lock_msme_draft(uuid, text, text, text, uuid) to authenticated;
