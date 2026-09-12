-- 0007_gate_b_hardening.sql
-- Gate B (live Supabase connection) static-audit findings, left behind by a
-- prior session that prepared this migration set but had no live project to
-- verify against (see docs/SUPABASE_GATE_B.md's "Static concerns to
-- reproduce before release"). Fixed here, additively -- 0002/0006 are left
-- untouched; this migration only DROPs the one defective policy and
-- CREATE OR REPLACEs the two defective functions with corrected bodies.
--
-- Not executed against a live database in this repository session until the
-- live-verification steps below actually run it -- see the Gate B report.

-- ---------------------------------------------------------------------------
-- Finding 1 (CRITICAL): app_users_staff_all granted ordinary staff FOR ALL
-- (select/insert/update/delete) on app_users, gated only by is_staff() --
-- which is true for BOTH 'staff' and 'admin'. Because the same predicate
-- applies to USING and WITH CHECK, a plain staff session could
--   update app_users set role = 'admin' where id = auth.uid();
-- directly via the Data API: both before and after that write, is_staff()
-- still evaluates true, so nothing in the policy rejects it. That silently
-- defeats every admin-only RPC (create_organisation, set_automation_state)
-- from 0005/0006, which check current_user_role() = 'admin' -- a
-- self-promoted "admin" would pass them.
--
-- Fix: staff/user role management is Admin's documented responsibility
-- (docs/product-brief/index.md: Admin = "Configuration, staff/user
-- control..."; Internal staff's list has nothing about managing identities).
-- Split the policy: admin keeps full read/write; staff gets read-only
-- (needed for assignee lookups etc. -- "Broad operational access; all cases
-- visible"); app_users_self_read (unchanged) still lets any authenticated
-- identity read its own row.
-- ---------------------------------------------------------------------------

drop policy if exists app_users_staff_all on app_users;

create policy app_users_admin_all on app_users
  for all using (current_user_role() = 'admin') with check (current_user_role() = 'admin');

create policy app_users_staff_read on app_users
  for select using (is_staff());

-- ---------------------------------------------------------------------------
-- Finding 2 (CRITICAL): apply_payment_confirmation had no already-confirmed
-- guard. A retried request, a duplicate client action, or two concurrent
-- confirmation attempts on the same payment would each re-run the update --
-- the TypeScript caller (src/server/repositories/supabase.ts#confirmPayment)
-- recomputes the allocation patch from the case/invoices' CURRENT state each
-- call, so a second confirmation would apply the same payment amount a
-- second time: double-counted recovered-to-date, double-decremented invoice
-- balances, from a single real payment.
--
-- Fix: SELECT ... FOR UPDATE locks the payment_records row so a genuinely
-- concurrent second call blocks until the first commits, then observes
-- client_confirmed = true and is rejected -- not a lost update, not a
-- silent double-apply. A sequential retry after the first call already
-- committed is rejected the same way.
--
-- Finding 3 (invoice/case mismatch): the per-invoice balance UPDATE only
-- constrained organisation_id, not case_id. Invoice ids reachable through
-- the app are always case-scoped already (computed server-side from
-- listInvoicesForCase(caseId) in the TypeScript caller, never client
-- input), so this was not an externally exploitable hole -- but it means a
-- coding bug or a compromised/misused session could silently corrupt an
-- unrelated case's invoice in the same organisation. Adding
-- `and case_id = v_case_id` makes that structurally impossible rather than
-- relying on the caller always behaving.
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
  v_already_confirmed boolean;
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
  select case_id, organisation_id, client_confirmed
  into v_case_id, v_org_id, v_already_confirmed
  from payment_records where id = p_payment_id
  for update;

  if v_case_id is null then
    raise exception 'apply_payment_confirmation: payment % not found', p_payment_id using errcode = 'P0002';
  end if;
  if v_already_confirmed then
    raise exception 'apply_payment_confirmation: payment % is already confirmed -- refusing to re-apply',
      p_payment_id using errcode = '22023';
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
    where id = (v_item->>'id')::uuid and organisation_id = v_org_id and case_id = v_case_id;
  end loop;

  perform record_audit_event(v_org_id, 'payment.confirmed', 'recovery_case', v_case_id, p_reason, null);

  return v_case;
end;
$$;

-- ---------------------------------------------------------------------------
-- Finding 3, continued: same organisation_id-only constraint existed in
-- correct_invoice_row's UPDATE. Same fix, same rationale.
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
  where id = p_invoice_id and organisation_id = v_org_id and case_id = p_case_id
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

-- create or replace preserves the grants/revokes 0006 already applied to
-- these two functions' signatures (unchanged here), so they are not
-- reissued -- Postgres does not reset privileges on CREATE OR REPLACE.

-- ---------------------------------------------------------------------------
-- Finding 4 (documented, NOT fixed here -- an architecture decision, not a
-- contained bug): 0002_rls.sql's generic tenant-table loop grants staff
-- FOR ALL directly on recovery_cases, invoices, workflow_tasks, and others,
-- alongside the audited RPCs this migration set adds. A staff session using
-- the Data API directly (not through this app) could still write those
-- tables without going through apply_case_mutation/record_payment_row/etc.,
-- bypassing the audit trail those RPCs produce. This predates P0-4 (it was
-- already the case in the approved 0002 baseline) and every write path this
-- application's own code takes now goes through the RPCs -- but the
-- database itself does not yet force that for an arbitrary Data API caller.
-- Closing it fully would mean restricting several tables' staff policies
-- from FOR ALL to SELECT-only and routing every remaining write through a
-- dedicated RPC, which is a broader RLS redesign than a Gate B connectivity
-- task should decide unilaterally. Flagged for an explicit follow-up
-- decision, not silently accepted.
