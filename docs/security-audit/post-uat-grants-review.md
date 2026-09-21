# Post-UAT security-hardening review item: broad Supabase table grants

Recorded 2026-09-21 during migration 0023 verification. **Review completed 2026-09-21 (go-live review): hardening applied to production as migration `0025_least_privilege_table_grants.sql` (verified 44/44 live checks).** See `docs/release/index.md` findings 2 and 9.

**Conclusion of the review:** yes, the grants were a meaningful (if RLS-mitigated) attack surface — TRUNCATE/TRIGGER bypass RLS, `system_settings` writes were blocked only by the absence of a policy, and client-role INSERT policies on `payment_records`/`documents`/`document_versions` allowed direct PostgREST inserts (e.g. a forged confirmed payment record). The app performs no direct table writes, so 0025 leaves `anon` with nothing and `authenticated` with SELECT only.

Observation (production, `igagfxgzlojqrkaawnzx`): in schema `public`, role `authenticated` holds `REFERENCES, TRIGGER, TRUNCATE`
(plus `SELECT`, and `INSERT` on `payment_records`) on the older tables (`invoices`, `communications`, `organisations`,
`payment_allocations`, `payment_records`, ...), and the same on the new `payment_promises` (0023 revoked only INSERT/UPDATE/DELETE
from `authenticated` and everything from `anon` on that table). Role `anon` additionally holds broad privileges on the older
tables. This matches Supabase's platform default privileges rather than something 0023 introduced: the pre-migration and
post-migration grant fingerprints excluding `payment_promises` were identical.

Mitigations in place: RLS is enabled on every public table and governs row access for SELECT/INSERT/UPDATE/DELETE; PostgREST does
not expose TRUNCATE; business writes go through SECURITY DEFINER RPCs whose EXECUTE is limited to `authenticated`/`service_role`.

Why review: `TRUNCATE` and `TRIGGER` bypass row-level security and should not be granted to API roles; least privilege says grant
only what the app uses.

Suggested review: enumerate actual privileges used by the app per table; `REVOKE TRUNCATE, TRIGGER, REFERENCES` (and unneeded
`anon` privileges) on all public tables; `ALTER DEFAULT PRIVILEGES` so future tables do not inherit them; add a migration-time
assertion / rpc-manifest-style test for table grants; re-run the security and RPC tests. Needs its own reviewed migration.
