-- 0013_p0_5_close_internal_rpc_gap.sql
-- Live-verified finding (P0-5 security regression, 2026-09-14/15) against the
-- production Sydney project: `raise_workflow_task()` and
-- `close_case_tasks_if_terminal()` from 0012 were designed as "internal
-- only" helpers, reachable solely via `perform` from other SECURITY DEFINER
-- functions -- their only stated protection was omitting a `grant execute
-- ... to authenticated` (only `revoke ... from public` was present).
--
-- That assumption was wrong. Supabase's project bootstrap sets default
-- privileges that grant EXECUTE on every new function in `public` directly
-- to `anon` and `authenticated` (independent of the PUBLIC pseudo-role) --
-- `revoke ... from public` does not touch that direct grant. Live-confirmed:
-- an anonymous PostgREST call to `raise_workflow_task` executed far enough
-- to hit a NOT NULL constraint (proving it ran, not merely "was attempted"),
-- and a call to `close_case_tasks_if_terminal` returned 204 success.
-- Neither function had an internal auth check to fall back on -- unlike
-- every other RPC in this codebase (0005/0006/0007/0011/0012), which all
-- pair `revoke ... from public` with an explicit `auth.uid() is null` /
-- `is_staff()` check as the actual enforcement layer. This migration closes
-- the gap the same way: explicit `revoke ... from anon, authenticated`
-- (the real fix) plus an internal role check (defense in depth, matching
-- every other RPC here, in case a future grant change reopens the surface).
--
-- No data was exposed or corrupted by this gap: `raise_workflow_task`'s
-- failed anonymous call never committed (NOT NULL violation rolled back the
-- statement), and `close_case_tasks_if_terminal`'s anonymous call was made
-- with a non-existent case_id/organisation_id during verification, so it
-- matched zero rows and had no effect. Both were found and fixed within the
-- same verification pass, before this project carries any real case data.

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
  if auth.uid() is null then
    raise exception 'raise_workflow_task: no authenticated caller' using errcode = '28000';
  end if;
  if not is_staff() then
    raise exception 'raise_workflow_task: staff/admin session required' using errcode = '42501';
  end if;

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
revoke execute on function raise_workflow_task(uuid, uuid, task_type, text, waiting_on, boolean, timestamptz, text) from public, anon, authenticated;

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
  if auth.uid() is null then
    raise exception 'close_case_tasks_if_terminal: no authenticated caller' using errcode = '28000';
  end if;
  if not is_staff() then
    raise exception 'close_case_tasks_if_terminal: staff/admin session required' using errcode = '42501';
  end if;

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
revoke execute on function close_case_tasks_if_terminal(uuid, uuid, text, text) from public, anon, authenticated;
