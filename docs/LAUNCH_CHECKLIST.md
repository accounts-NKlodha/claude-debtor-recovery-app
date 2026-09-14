# Pre-launch checklist (controlled pilot)

Derived from `shipping-and-launch` + PRD §18 acceptance criteria and §10 pilot
controls. Pilot is **admin-only, synthetic/redacted cases, no unattended
government filing**.

## Correctness gates (must pass — PRD §18)

- [ ] 0. Authorised upload auto-starts draft + trigger + scan + immutable
      evidence + extraction + duplicate check; replaying the trigger creates no
      duplicate effect. *(engine: `orchestration_runs` unique key — wire in M2/M3)*
- [ ] 1. Phone-photo OCR → correct fields → source checksummed & versioned.
- [ ] 2. 50-row Excel import reports malformed + duplicate rows correctly.
      *(covered: `src/domain/bulk-import.test.ts`)*
- [ ] 3. Routing: ordinary / GST-ineligible / GST-eligible / MSME-eligible /
      MSME-ineligible. *(covered: `workflow.test.ts`, `eligibility.ts`)*
- [ ] 4. Sends at 11:00 IST, roll Sunday, 24h timer starts only on delivery.
      *(covered: `scheduling.test.ts`, `workflow.test.ts`)*
- [ ] 5. Both-channel delivery failure → escalation paused + contact task.
      *(covered: `workflow.test.ts`)*
- [ ] 6. Reply classification (payment/promise/dispute/doc-request) → staff
      approves draft before any material response.
- [ ] 7. Client-confirmed full/partial/TDS payment cancels escalation
      immediately. *(covered: `workflow.test.ts`, `allocation.test.ts`)*
- [ ] 8. GST assist validates field limits, stops for CAPTCHA + final Send,
      captures reference/screenshot/PDF. *(adapter + UI done; live portal pending)*
- [ ] 9. Portal drift → fail closed + urgent task. *(covered: `run-adapter.test.ts`)*
- [ ] 10. MSME seven-stage pack saves/resumes + immutable preview snapshot.
- [ ] 11. DD evidence + hearing calendar task.
- [ ] 12. Client cannot access another client's case/document/rating/AI context.
      *(RLS: `supabase/migrations/0002_rls.sql`; test plan in `supabase/README.md`)*
- [ ] 13. Backup restore reconstructs a full case audit trail.
      *(disaster-recovery task, 2026-09-15: a real backup+restore was performed
      and `audit_events` restored intact (65/65 rows, matching production
      exactly) — but production currently has zero real case data, so no
      case-linked audit trail exists yet to reconstruct as a concrete example.
      Mechanism proven; re-verify with a real case once one exists. See
      `docs/disaster-recovery/index.md` §7-§9.)*
- [ ] 14. High-confidence intake advances through deterministic prep but stops at
      every client/staff/legal/portal gate. *(covered: `workflow.test.ts`)*
- [ ] 15. Human checkpoint completion auto-resumes the recorded next step, no
      duplicate send/filing.
- [ ] 16. Retryable failure retries once; repeat failure → one urgent task, no
      duplicate. *(covered: `run-adapter.test.ts`)*
- [ ] 17. Test vault credential reaches a portal checkpoint; OTP/CAPTCHA
      unstored/unbypassed; auto-resume after operator step.
- [ ] 18. Every state shows automation-start / current-step / blocker /
      next-action / waiting-on. *(UI: case detail + `/today`; e2e assertion)*

## Operational readiness

- [ ] `npm run verify` green on CI for the release commit.
- [ ] `npm run e2e` green (smoke + axe, chromium + mobile).
- [ ] Supabase project provisioned (region per business decision 2026-09-15 —
      `ap-south-1` is no longer mandatory; the current production project is
      `ap-southeast-2` (Sydney), business-accepted, see
      `docs/MUMBAI_BOOTSTRAP.md`); migrations applied; RLS test plan run.
- [x] Daily backup + one successful restore test recorded.
      *(2026-09-15: one successful real backup+restore test is recorded
      (`docs/disaster-recovery/index.md` §7-§9), and the
      `DebtorRecovery-Production-Backup` Windows Task Scheduler task is now
      registered and proven — manually triggered through Task Scheduler
      itself, `LastTaskResult = 0`, produced a genuine new checksum-verified
      backup set (§16a-§16b of that doc). One real limitation: the task
      only runs while `NKLODHALAPTOP6\lovel` stays logged on — a fully
      logged-off laptop at 23:30 skips that day's run (`StartWhenAvailable`
      is enabled and should catch up at next logon per Task Scheduler's
      documented behavior, not separately proven in this session). Off-site
      encrypted copy is still NOT configured — see that doc's §15.)*
- [ ] Kill switch reachable by Admin; pause/resume/skip require a reason (audited).
- [ ] Manual send + manual portal filing paths verified working alongside automation.
- [ ] Error budget + weekly automation-error review scheduled.
- [ ] Rollback: previous release build retained; DB migrations are additive /
      reversible; documented `git revert` + redeploy path.

## Legal / privacy sign-off (blocking for anything beyond synthetic pilot)

- [ ] Retention period + legal-hold procedure.
- [ ] DPDP notice, grievance contact, deletion/anonymisation workflow.
- [ ] GST + MSME browser-automation position; credential-vault threat model.
- [ ] MSME interest formula (3× RBI repo, compounded monthly) — versioned policy,
      not enforced live until approved.
- [ ] Debtor-profiling / cross-client rating usage.

## Monitoring (from launch)

- Delivery rate, OCR correction rate, portal failure rate, automation completion
  rate, autonomous-run exception rate, time-waiting-per-actor.
- Recovery rate + time-to-recovery + staff minutes/case (the business targets).
- Alert on: verify-gate failure, adapter `permanent_failure`/`drift_detected`
  spikes, task escalations to Admin, backup failure.
