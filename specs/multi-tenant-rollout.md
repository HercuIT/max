# Multi-tenant rollout and acceptance tests

Status: implementation and release checklist for [multi-tenant support](multi-tenant-support.md) and its [Supabase architecture](supabase-tenancy.md).

The implemented [organizations/data design](organizations-and-data-migration.md) and [online runbook](../docs/organizations-online.md) add staged live-writer compatibility, model provenance, operator exports and a seven-day purge recovery window. Production cutover and retention decisions remain separate release gates. Use that runbook for continuous ingestion; the original maintenance cutover is a separate operational choice.

## Phase 1: schema expansion and historical ownership

1. Inventory deployed migrations, every callable RPC/view, Worker routes, grants, RLS state, exporter configurations, and backups. Include the Codex/source migration if not deployed yet; multi-tenancy builds on it.
2. Before touching production, rehearse migrations against a disposable copy with representative usage volumes. Record row counts and per-source token/cost totals, and verify the ability to restore a backup.
3. Create tenant/membership/private credential/invitation/audit tables and authorization helpers. Add nullable tenant/project columns to existing relations initially. Do not expose incomplete tables through the Data API.
4. Have the operator explicitly identify the legacy organization and verified first-owner Auth user UUID. Create that tenant/membership through a server-only bootstrap. Never infer ownership from telemetry `user_email`, a repository name, email domain, or first sign-in.
5. Assign every historical project/usage row to that legacy tenant. Populate missing project rows from distinct usage project names; ingestion currently does not maintain `projects`. Map usage to project UUIDs within its tenant, including projects present only in usage and old orphan project rows. Backfill large tables in bounded, restartable batches.
6. Replace global project-name uniqueness with `(tenant_id,name)` uniqueness. Add/validate composite project foreign keys, tenant indexes, source constraints, and finally NOT NULL constraints. Validate that no usage/project rows remain unowned or cross-linked.
7. Compare pre/post counts and sums, separated by source and project. Historical labels/tokens/costs must be unchanged. The new aggregate output must equal the prior output when scoped to the legacy tenant, except the documented cross-source session-ID correction already introduced by source support.

Pause writes during the ownership/backfill boundary or deploy a tested compatibility writer that assigns legacy writes to the explicitly configured legacy tenant. Do not allow unscoped writes to race the NOT NULL cutover. Restart/retry must not create duplicate tenants/projects or reassign already-mapped rows.

## Phase 2: authorization and application cutover

1. Enable Supabase Auth, allowed callback origins, session handling, and private-schema restrictions. Validate owner sign-in before exposing tenant data.
2. Add user-scoped dashboard and administration clients, tenant-scoped routes/RPCs, RLS, and safe views. Retire old RPC overloads and global grants in a coordinated migration. Schema expansion alone must not open authenticated access to global aggregates.
3. Add the tenant chooser and member/key administration UI. Retain Claude/Codex source filtering, existing date defaults, and dashboard behavior inside a tenant.
4. Provision replacement tenant ingestion keys and update both Claude and Codex exporters. If a temporary legacy global-key bridge is essential, it must map exclusively to the named legacy tenant, have an explicit expiry/removal date, and never serve another tenant. No browser Basic Auth fallback is permitted after multi-tenant data exists.
5. Deploy the Worker and schema together through a documented cutover. Old `/api/token-usage/*` and `/api/cost/*` routes must return an upgrade/migration error, or require a valid user session and exactly one authorized legacy tenant during a bounded transition. They must never retain global reads. The final release removes compatibility routes.
6. Revoke/remove `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD`, and `INGEST_SECRET_TOKEN`; verify missing/old credentials fail closed. The service-role key remains server-only and must not be used for dashboard reads.

A failed cutover does not justify restoring globally authorized code against a database containing multiple tenants. Before adding a second tenant, a rollback to the prior single-tenant snapshot may be possible after reconciling writes. Afterwards, use a tenant-safe previous version or maintenance mode and a forward fix. Document the exact safe rollback boundary before deployment.

## Phase 3: verification matrix

Create tenant A and tenant B, each with an owner, admin, and viewer; add one user who belongs to both and one user with no memberships. Use identical project names and session IDs in A/B, both Claude and Codex sources, different token/cost values, and distinct private host/email attribution. Execute all database tests with realistic `anon`, `authenticated`, and service-role contexts. A test run using only service role is insufficient.

| Area | Required assertions |
| --- | --- |
| Auth | Missing/expired/forged/wrong-project JWT is rejected; valid verified user can sign in; no-membership user sees onboarding state; session refresh and sign-out work |
| Direct database reads | Anonymous cannot read tenant data; A member cannot read B tenants/members/projects/logs; membership helper has no recursion; direct RPC/table/view access cannot bypass isolation |
| Dashboard RPCs | All five queries isolate tenant before project/source/date filtering; tenant is required; legacy overloads cannot expose global data; same-name projects remain separate |
| Data mutation | Viewers cannot create keys/invite/change roles; admins cannot create or remove owners; user cannot self-add membership or move telemetry; foreign tenant/project IDs fail |
| Membership lifecycle | Removing a member immediately blocks reads with their still-valid JWT; leaving/removing/demoting last owner fails; concurrent owner removals cannot leave zero owners; Auth-user deletion cannot remove the last owner |
| Invitations | Wrong email/unverified email/expired/revoked token rejected; replay safe; existing role unchanged; concurrent acceptance creates one membership; delivery failure is reported without pretending delivery succeeded |
| Ingestion | A key can insert only into A; supplied tenant IDs and B project UUIDs cannot override ownership; Claude metrics and Codex logs retain parser behavior; empty batches still authenticate |
| Key lifecycle | Raw key shown once; listings never expose key/digest; rotation overlap works; expiry and revocation block ingestion; concurrent revoke/ingest respects transaction ordering |
| Transactions | Invalid row/batch rolls back all usage/project changes; duplicate project creation under concurrency resolves to one project; DB unavailable gives retryable error; limits produce `413` |
| UI | Tenant switch clears old rows/projects/charts; delayed A responses cannot render after switching to B; both dashboard tabs retain independent source selection and date semantics; error states offer actionable recovery |
| API security | Cross-tenant object access returns generic `404`; insufficient role gives `403`; validation gives `400`; CSRF/cross-origin mutations fail; tenant/session responses are not shared-cacheable |
| Credentials and logs | No token/hash/service-role key/session/prompt in logs, browser storage, HTML, bundles, or audit payloads; exporter keys cannot call dashboard/admin RPCs |
| Historical data | Counts and per-source sums match backup; default legacy tenant owns all old rows; no null tenant/project links; same-name projects in a new tenant do not affect legacy data |
| Deletion | Only owner requests deletion; disabled tenant rejects ingestion/reads; purge retries are tenant-scoped; another tenant and shared Auth users survive; audit and backup retention follow an explicit operational policy |

Run the existing Worker tests, `npx tsc --noEmit`, and `npx wrangler deploy --dry-run` in addition to new authorization tests. Evolve `tests/source-filter.sql` to supply tenant IDs and prove source filtering within each tenant. Add real PostgreSQL/RLS integration tests and browser session/tenant-switch tests; mocked Supabase unit tests cannot demonstrate database isolation. Test Auth integration against a local/disposable Supabase environment, never production customer accounts.

Performance validation must include multi-tenant indexes, representative large date ranges, many projects, and concurrent ingestion/reads. Record query plans, timings, platform limits, and operational thresholds in the implementation PR; an empty database is not performance evidence.

## Release gates and operations

- Product roles and the operator-assisted tenant bootstrap are implemented as specified; any deviations are explicit decisions in the implementation PR.
- All cross-tenant negative tests pass for Worker and direct Supabase access; authenticated reads use user JWTs, not service-role bypass.
- All historical data has verified ownership and correct tenant/project relationships.
- Both exporter families work with tenant keys; legacy shared-key access and Basic Auth are disabled.
- Every aggregate/view/export/cache respects tenant boundaries; no global fallback exists.
- Tenant data access/mutations, key management, rate-limit enforcement, audit retention, incident response, and deletion/backup behavior have operator runbooks.
- Runtime variables, redirect origins, and necessary delivery credentials are configured securely. No production migration, invitation delivery, deployment, or environment publication occurs merely by approving these specs.

Initial implementation should proceed as separate reviewable changes: schema/backfill rehearsal; RLS/RPC authorization; Auth and tenant dashboard; membership/key administration; ingestion-key cutover; and removal of legacy paths. Each change includes tests and a compatibility/rollback statement. No phase is considered complete solely because its tables or UI exist.
