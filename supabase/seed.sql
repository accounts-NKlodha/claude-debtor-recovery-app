-- supabase/seed.sql
-- Deterministic DEMO/TEST data (fictional companies -- Acme Traders, Bharat
-- Steel Industries, Comet Logistics LLP). All ids are fixed so tests can
-- reference them:
--   orgs      00000000-0000-0000-0000-0000000000{01..04}
--   users     ...{11 staff, 12 admin, 13 client-Acme, 14 client-Bharat/Comet}
--   debtors   ...{21..26}
--   cases     ...{31..39}
--   invoices  ...{41..4e}
--
-- Gate B finding (P0-4 Gate B, live verification): this file used to be
-- supabase/migrations/0003_seed.sql. A migration file is applied by
-- `supabase db push` on every fresh database with no way to opt out --
-- meaning every future production deployment would silently receive this
-- fictional data merely by replaying the migration chain, in direct
-- contradiction of docs/DEPLOYMENT.md's "0003_seed is demo data -- run ONLY
-- in staging, never production" rule the file itself never actually
-- enforced.
--
-- Moved to Supabase's dedicated seed-file convention instead (declared in
-- supabase/config.toml's [db.seed] section). This is NOT a migration and is
-- never applied by a plain `supabase db push`:
--   * `supabase db reset` (local Docker dev) applies it automatically --
--     convenient for local development, never touches a remote project.
--   * `supabase db push --include-seed` applies it to a LINKED project --
--     an explicit, deliberate opt-in a human must type; ordinary
--     `supabase db push` (the command in docs/DEPLOYMENT.md's production
--     runbook) never does this.
-- A fresh production database that only ever runs `supabase db push`
-- (without `--include-seed`) will never see this file at all.
--
-- Was applied to the live Gate B project (lsuudervqofienqabmaz) as
-- migrations/0003_seed.sql before this move -- that history entry is left
-- in place deliberately (see docs/adr/0002-seed-data-is-not-a-migration.md
-- and supabase/README.md) rather than rewritten, per the project's
-- no-reckless-history-rewrite convention. Fresh databases going forward
-- never see 0003 as a migration at all -- it no longer exists in
-- supabase/migrations/.
--
-- Two data bugs found and fixed during that first-ever live execution
-- (never successfully applied anywhere before): a short VALUES row on the
-- second recovery_cases tuple, and two rows using waiting_on = 'debtor',
-- which is not a valid enum value (the model only knows
-- system|client|staff|portal -- the debtor is external to the app).
--
-- Safe to (re-)run any time after 0001/0002/0004-0007: every insert uses
-- ON CONFLICT DO NOTHING. RLS does not apply to the role that loads this
-- (migration/seed execution runs with elevated privileges, same as any
-- other migration).

-- ---------------------------------------------------------------------------
-- Organisations: 1 recovery firm + 3 client firms
-- ---------------------------------------------------------------------------
insert into organisations (id, client_code, legal_entity_name, creditor_gstin, udyam_number, jito_member, is_firm) values
  ('00000000-0000-0000-0000-000000000001', 'LODHA',  'Lodha CFO & Recovery Services LLP', null,              null,                 false, true),
  ('00000000-0000-0000-0000-000000000002', 'ACME',   'Acme Traders Private Limited',      '27AACCA1111A1Z5', 'UDYAM-RJ-17-0011111', true,  false),
  ('00000000-0000-0000-0000-000000000003', 'BHARAT', 'Bharat Steel Industries',           '24AAACB2222B1Z3', 'UDYAM-GJ-01-0022222', false, false),
  ('00000000-0000-0000-0000-000000000004', 'COMET',  'Comet Logistics LLP',               '29AAECC3333C1Z1', 'UDYAM-KA-03-0033333', false, false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- App users + client org memberships
-- ---------------------------------------------------------------------------
insert into app_users (id, role, email, mobile, display_name) values
  ('00000000-0000-0000-0000-000000000011', 'staff',  'staff@lodha.example',  '+919800000011', 'Priya (Recovery Staff)'),
  ('00000000-0000-0000-0000-000000000012', 'admin',  'admin@lodha.example',  '+919800000012', 'Rohit (Admin)'),
  ('00000000-0000-0000-0000-000000000013', 'client', 'ap@acme.example',      '+919800000013', 'Acme Accounts Payable'),
  ('00000000-0000-0000-0000-000000000014', 'client', 'finance@bharat.example','+919800000014','Bharat/Comet Finance')
on conflict (id) do nothing;

insert into user_organisations (user_id, organisation_id) values
  ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000004')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Debtors (2 per client org)
-- ---------------------------------------------------------------------------
insert into debtors (id, organisation_id, name, mobile, email, gstin, address, contact_verified, total_due) values
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000002', 'Nova Retail Pvt Ltd',      '+919811100021', 'pay@novaretail.example',  '27AAACN4444N1Z9', 'Andheri East, Mumbai',    true,  185000000),
  ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000002', 'Sunrise Distributors',     '+919811100022', null,                       null,               'Pune',                    false, 42000000),
  ('00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000003', 'Ironclad Fabricators',     '+919811100023', 'accounts@ironclad.example','24AAACI5555I1Z7', 'Rajkot, Gujarat',         true,  260000000),
  ('00000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-000000000003', 'Girish Hardware Stores',   '+919811100024', 'girish@ghs.example',       null,               'Ahmedabad',               true,  73500000),
  ('00000000-0000-0000-0000-000000000025', '00000000-0000-0000-0000-000000000004', 'Skyline Freight Movers',   '+919811100025', 'ops@skylinefreight.example','29AAACS6666S1Z5','Whitefield, Bengaluru',   true,  151000000),
  ('00000000-0000-0000-0000-000000000026', '00000000-0000-0000-0000-000000000004', 'Deccan Warehousing Co',    '+919811100026', null,                       '29AAACD7777D1Z3', 'Hosur Road, Bengaluru',   false, 98000000)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Recovery cases -- 9 cases across varied statuses
-- ---------------------------------------------------------------------------
insert into recovery_cases
  (id, organisation_id, debtor_id, status, automation_mode, waiting_on, automation_started_at,
   current_step, blocker, next_scheduled_action, next_scheduled_at, eligibility_route,
   principal_outstanding, recovered_to_date, assignee_id, group_key, activated_at, closed_at) values
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000021',
   'received', 'prepare', 'staff', null,
   'intake', 'Awaiting staff validation of imported invoices', null, null, null,
   85000000, 0, '00000000-0000-0000-0000-000000000011', 'ACME-Q2', null, null),

  ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000022',
   'under_validation', 'prepare', 'staff', null,
   'validate_invoices', 'OCR confidence below threshold on invoice SUN-0092', null, null,
   null,
   42000000, 0, '00000000-0000-0000-0000-000000000011', 'ACME-Q2', null, null),

  ('00000000-0000-0000-0000-000000000033', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000021',
   'active', 'assist', 'system', now() - interval '6 days',
   'schedule_initial_communication', null, 'Send initial WhatsApp + email reminder', now() + interval '1 day', 'gst',
   100000000, 0, '00000000-0000-0000-0000-000000000011', 'ACME-Q2', now() - interval '6 days', null),

  ('00000000-0000-0000-0000-000000000034', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000023',
   'initial_communication_sent', 'assist', 'system', now() - interval '9 days',
   'await_debtor_reply', null, 'Send first follow-up reminder', now() + interval '2 days', 'msme',
   120000000, 0, '00000000-0000-0000-0000-000000000011', 'BHARAT-2026', now() - interval '9 days', null),

  ('00000000-0000-0000-0000-000000000035', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000024',
   'promise_to_pay', 'assist', 'client', now() - interval '14 days',
   'track_promise', null, 'Verify promised payment received', now() + interval '3 days', 'msme',
   73500000, 0, '00000000-0000-0000-0000-000000000011', 'BHARAT-2026', now() - interval '14 days', null),

  ('00000000-0000-0000-0000-000000000036', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000023',
   'gst_notification_filed', 'assist', 'portal', now() - interval '25 days',
   'monitor_gst_response', null, 'Check GST portal for debtor response', now() + interval '5 days', 'gst',
   140000000, 0, '00000000-0000-0000-0000-000000000011', 'BHARAT-2026', now() - interval '25 days', null),

  ('00000000-0000-0000-0000-000000000037', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000025',
   'msme_odr_filed', 'assist', 'portal', now() - interval '30 days',
   'await_msefc_acknowledgement', null, 'Poll MSME Samadhaan for reference update', now() + interval '7 days', 'msme',
   151000000, 0, '00000000-0000-0000-0000-000000000011', 'COMET-A', now() - interval '30 days', null),

  ('00000000-0000-0000-0000-000000000038', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000026',
   'hearing_scheduled', 'manual', 'staff', now() - interval '45 days',
   'prepare_for_hearing', null, 'Prepare hearing bundle', now() + interval '4 days', 'msme',
   98000000, 0, '00000000-0000-0000-0000-000000000012', 'COMET-A', now() - interval '45 days', null),

  ('00000000-0000-0000-0000-000000000039', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000025',
   'recovered', 'assist', 'staff', now() - interval '60 days',
   'closed', null, null, null, 'gst',
   0, 62000000, '00000000-0000-0000-0000-000000000011', 'COMET-A', now() - interval '60 days', now() - interval '3 days')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Invoices -- 14 rows across the 9 cases (all 18% GST, paise)
-- ---------------------------------------------------------------------------
insert into invoices
  (id, organisation_id, case_id, debtor_id, invoice_number, invoice_date, due_date,
   taxable_value, tax_rate, tax_amount, invoice_total, outstanding_balance, extraction_confidence) values
  ('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000021','ACM-1001','2026-04-05','2026-05-05', 72033898,18.00,12966102, 85000000, 85000000,0.982),
  ('00000000-0000-0000-0000-000000000042','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000022','SUN-0092','2026-03-18','2026-04-17', 19491525,18.00, 3508475, 23000000, 23000000,0.611),
  ('00000000-0000-0000-0000-000000000043','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000022','SUN-0104','2026-04-02','2026-05-02', 16101695,18.00, 2898305, 19000000, 19000000,0.874),
  ('00000000-0000-0000-0000-000000000044','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000033','00000000-0000-0000-0000-000000000021','ACM-0980','2026-02-10','2026-03-12', 46610169,18.00, 8389831, 55000000, 55000000,0.991),
  ('00000000-0000-0000-0000-000000000045','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000033','00000000-0000-0000-0000-000000000021','ACM-0991','2026-02-24','2026-03-26', 38135593,18.00, 6864407, 45000000, 45000000,0.988),
  ('00000000-0000-0000-0000-000000000046','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000034','00000000-0000-0000-0000-000000000023','BSI-2201','2026-01-15','2026-02-14',101694915,18.00,18305085,120000000,120000000,0.956),
  ('00000000-0000-0000-0000-000000000047','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000035','00000000-0000-0000-0000-000000000024','BSI-2240','2026-02-01','2026-03-03', 33898305,18.00, 6101695, 40000000, 40000000,0.933),
  ('00000000-0000-0000-0000-000000000048','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000035','00000000-0000-0000-0000-000000000024','BSI-2251','2026-02-19','2026-03-21', 28389831,18.00, 5110169, 33500000, 33500000,0.902),
  ('00000000-0000-0000-0000-000000000049','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000036','00000000-0000-0000-0000-000000000023','BSI-2150','2025-12-05','2026-01-04', 67796610,18.00,12203390, 80000000, 80000000,0.977),
  ('00000000-0000-0000-0000-00000000004a','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000036','00000000-0000-0000-0000-000000000023','BSI-2168','2025-12-20','2026-01-19', 50847458,18.00, 9152542, 60000000, 60000000,0.965),
  ('00000000-0000-0000-0000-00000000004b','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000037','00000000-0000-0000-0000-000000000025','CML-5501','2025-11-10','2025-12-10',127966102,18.00,23033898,151000000,151000000,0.949),
  ('00000000-0000-0000-0000-00000000004c','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000038','00000000-0000-0000-0000-000000000026','CML-5410','2025-10-08','2025-11-07', 42372881,18.00, 7627119, 50000000, 50000000,0.918),
  ('00000000-0000-0000-0000-00000000004d','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000038','00000000-0000-0000-0000-000000000026','CML-5423','2025-10-22','2025-11-21', 40677966,18.00, 7322034, 48000000, 48000000,0.887),
  ('00000000-0000-0000-0000-00000000004e','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000039','00000000-0000-0000-0000-000000000025','CML-5300','2025-09-01','2025-10-01', 52542373,18.00, 9457627, 62000000,        0,0.994)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Communications (a handful)
-- ---------------------------------------------------------------------------
insert into communications
  (id, organisation_id, case_id, channel, direction, template_key, template_version,
   subject, body, delivery_status, has_secure_link, reply_classification, created_at, delivered_at) values
  ('00000000-0000-0000-0000-000000000051','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000034','whatsapp','outbound','initial_reminder',1,
   null,'Reminder: invoice BSI-2201 for Rs.12,00,000 is overdue. Please arrange payment.','delivered',true,null, now() - interval '9 days', now() - interval '9 days'),
  ('00000000-0000-0000-0000-000000000052','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000034','email','outbound','initial_reminder',1,
   'Overdue invoice BSI-2201','Please find the outstanding statement attached. Kindly clear the dues.','delivered',true,null, now() - interval '9 days', now() - interval '9 days'),
  ('00000000-0000-0000-0000-000000000053','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000035','whatsapp','inbound',null,null,
   null,'We will pay 50% by next week and the balance by month end.','delivered',false,'promise_to_pay', now() - interval '13 days', now() - interval '13 days'),
  ('00000000-0000-0000-0000-000000000054','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000033','email','outbound','initial_reminder',1,
   'Payment due - Acme Traders','Invoices ACM-0980 and ACM-0991 totalling Rs.10,00,000 are pending.','queued',true,null, now(), null),
  ('00000000-0000-0000-0000-000000000055','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000039','whatsapp','inbound',null,null,
   null,'Payment of Rs.6,20,000 done via NEFT, UTR N2026...','read',false,'payment_made', now() - interval '5 days', now() - interval '5 days')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Workflow tasks
-- ---------------------------------------------------------------------------
insert into workflow_tasks
  (id, organisation_id, case_id, type, title, waiting_on, assignee_id, urgent, due_at, resolved_at) values
  ('00000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000031','staff_validation','Validate imported invoices for Nova Retail','staff','00000000-0000-0000-0000-000000000011',false, now() + interval '2 days', null),
  ('00000000-0000-0000-0000-000000000062','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000032','ocr_low_confidence','Review low-confidence OCR on SUN-0092','staff','00000000-0000-0000-0000-000000000011',true, now() + interval '1 day', null),
  ('00000000-0000-0000-0000-000000000063','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000035','payment_confirmation','Confirm 50% promised payment from Girish Hardware','client','00000000-0000-0000-0000-000000000014',false, now() + interval '3 days', null),
  ('00000000-0000-0000-0000-000000000064','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000036','gst_portal_run','File GST taxpayer communication for Ironclad','portal','00000000-0000-0000-0000-000000000011',false, null, now() - interval '25 days'),
  ('00000000-0000-0000-0000-000000000065','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000038','hearing_followup','Prepare hearing bundle for Deccan Warehousing','staff','00000000-0000-0000-0000-000000000012',true, now() + interval '4 days', null),
  ('00000000-0000-0000-0000-000000000066','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000039','payment_confirmation','Verify final NEFT receipt from Skyline Freight','staff','00000000-0000-0000-0000-000000000011',false, null, now() - interval '4 days')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Payment records
-- ---------------------------------------------------------------------------
insert into payment_records
  (id, organisation_id, case_id, kind, amount, received_on, reference, client_confirmed, recorded_by) values
  ('00000000-0000-0000-0000-000000000071','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000039','bank', 62000000,'2026-09-06','NEFT-N2026-889001', true,  '00000000-0000-0000-0000-000000000011'),
  ('00000000-0000-0000-0000-000000000072','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000035','bank', 20000000,'2026-09-08','UPI-4471X', false, '00000000-0000-0000-0000-000000000011'),
  ('00000000-0000-0000-0000-000000000073','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000037','tds',  1710000,'2026-08-30','TDS-Q2-26AS', false, '00000000-0000-0000-0000-000000000012')
on conflict (id) do nothing;

insert into payment_allocations (id, organisation_id, payment_record_id, invoice_id, amount) values
  ('00000000-0000-0000-0000-000000000075','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000071','00000000-0000-0000-0000-00000000004e', 62000000),
  ('00000000-0000-0000-0000-000000000076','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000072','00000000-0000-0000-0000-000000000047', 20000000)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Eligibility checks
-- ---------------------------------------------------------------------------
insert into eligibility_checks (id, organisation_id, case_id, route, passed, reasons_json, evaluated_by) values
  ('00000000-0000-0000-0000-000000000081','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000036','gst', true,
   '{"debtor_gstin_active": true, "invoice_age_days_gt_90": true}'::jsonb, '00000000-0000-0000-0000-000000000011'),
  ('00000000-0000-0000-0000-000000000082','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000037','msme', true,
   '{"creditor_udyam_valid": true, "supply_accepted": true, "within_limitation": true}'::jsonb, '00000000-0000-0000-0000-000000000011')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Audit trail -- genesis + a couple of chained rows (illustrative hashes)
-- ---------------------------------------------------------------------------
insert into audit_events
  (id, organisation_id, actor_id, actor_role, action, entity, entity_id, reason, prev_hash, hash) values
  ('00000000-0000-0000-0000-000000000091','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000011','staff','create','recovery_cases','00000000-0000-0000-0000-000000000031','import committed', null, 'seed-hash-0001'),
  ('00000000-0000-0000-0000-000000000092','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000011','staff','external','external_submissions','00000000-0000-0000-0000-000000000036','GST communication filed', 'seed-hash-0001', 'seed-hash-0002'),
  ('00000000-0000-0000-0000-000000000093','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000011','staff','update','payment_records','00000000-0000-0000-0000-000000000071','final payment recorded, case recovered', 'seed-hash-0002', 'seed-hash-0003')
on conflict (id) do nothing;
