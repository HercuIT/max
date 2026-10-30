# Organizations: online rollout and recovery

Implements [organizations and existing data](../specs/organizations-and-data-migration.md). These are operator procedures, not automatic deployment steps. The application keeps `tenant_id` as the organization key. No production operation follows merely from merging this code.

## Choose the deployment path

Inventory the deployed Worker, migration ledger, schema, callable signatures/grants, exporter configurations, table size and available storage. Verify which organization owns history and the verified first owner's Auth UUID. Never infer it from telemetry.

- **Tenancy already applied:** schedule a brief approved catalog-lock window for normal appended migration `20261030162837_organizations_model_provenance_and_recovery.sql`. It takes `ACCESS EXCLUSIVE NOWAIT` locks on usage and deletion-job tables; these conflict with active ingestion/reads and can fail immediately. Keep durable exporter retries active, drain long-running database transactions, and apply the whole migration transaction using the unchanged release package. If it fails with lock SQLSTATE `55P03`, inspect contention, back off, and retry the whole unapplied migration during the window; never repair its ledger entry to bypass a failed attempt. The locks are brief but are not lock-free availability. The migration adds nullable provenance plus a classifier trigger/view, bounded backfill RPC, seven-day purge eligibility, and operator cancellation. It never reassigns organization ownership or enables a legacy token. After backup rehearsal and successful application, run `node scripts/backfill-model-provenance.mjs --confirm-backup-rehearsed`; it commits batches, validates constraints, then makes provenance required. Its statement timeout defaults to 60 seconds; use `--statement-timeout-ms=<milliseconds>` (1,000–86,400,000) after measuring the time needed for full-table pending/validation scans. Stop/retry preserves completed work. No raw model/measurement is rewritten.
- **Tenancy pending, earlier six migrations applied:** use the online path below. Do not run an unrestricted migration push or the historical all-at-once tenancy SQL. The CI pending-cutover guard stays in place.
- **Partially staged or unrecognized:** stop and reconcile privately. The online runner refuses the maintenance runner's progress table and existing tenants without its own checksum state. Do not drop tables or repair ledger entries to bypass this check.

The old [maintenance procedure](tenancy-operations.md) remains available for installations that intentionally pause writers; it is not the online path. A restored/partly migrated database requires a separate recovery review.

## Preconditions for no lost points

Take an encrypted recoverable backup of schema/data/grants and migration ledger, record its recovery point, and rehearse restore into an isolated database. Confirm PITR/WAL retention and space for baseline manifests, new indexes, and backfill WAL. Keep the backup/restore record, intended owner UUID, and exporter inventory in the operator's restricted change record.

Every exporter must durably retain unacknowledged batches and replay on timeout/503 through the rollout. If its buffer/retry horizon cannot prove this, provision a durable store-and-forward collector first. This repository does not supply that collector or turn in-memory retries into durable delivery. The CLI requires an explicit durable-delivery attestation; do not provide it without evidence. Success is returned only after database commit. Delivery remains at least once and a lost commit response can produce a retry duplicate.

Provision Supabase Auth, HTTPS/callback origin, email delivery and the existing Worker runtime variables. Session/CSRF checks and real email validation still need environment-specific verification. Keep operator credentials in `TENANCY_DATABASE_URL`, using a direct or session-mode connection: advisory locks, transactions and concurrent DDL require a stable connection. Never use a transaction pooler or log the URL. No new Worker variables are needed.

## Stages 001–006: expand with writers live

The SQL files in `scripts/organizations/` are operator stages, deliberately outside automatic migration discovery. The runner takes the same singleton advisory lock as the old maintenance runner, enforces five-second lock and bounded statement timeouts, records a checksum, and commits resumable phases. Default batch size is 5,000; range is 1–10,000. Normal statements default to 60 seconds (`--statement-timeout-ms`, range 1,000–3,600,000); phase 004 uses a separate 30-minute limit (`--index-statement-timeout-ms`, range 1,000–86,400,000) and restores the normal timeout afterward. Measure representative index builds before choosing a larger bound; a longer statement timeout does not extend the five-second lock timeout.

```sh
node scripts/online-tenancy.mjs --through=6 --batch-size=5000 --confirm-backup-rehearsed --confirm-durable-delivery
```

1. `001_expand_organizations.sql`: create organization/private tables and nullable ownership fields; install legacy project/usage triggers atomically. Old inserts with missing ownership resolve exclusively to `00000000-0000-4000-8000-000000000001`. Install provenance classification. New organization admission is blocked until stage 007.
2. `002_backfill_organization_ownership.sql`: capture one consistent fixed-ID baseline of projects/usage, then commit bounded ownership/project/provenance assignments with an undo manifest. The baseline contains customer attribution and must remain private. New inserts continue through the trigger, including resolving an existing unassigned project. Interrupted batches resume without a highest-UUID or timestamp assumption.
3. `003_require_organization_ownership.sql`: add/validate temporary null-proof checks independently, then set ownership/project/provenance NOT NULL and drop those proof checks in the same short catalog transaction.
4. `004_index_organization_data.sql`: create tenant/project and usage indexes concurrently, outside transactions, under the separate index timeout. Retry transient lock/deadlock failures and recover invalid interrupted builds before each retry. Keep global name uniqueness during compatibility.
5. `005_validate_organization_relationships.sql`: attach unique indexes and add/validate tenant/composite-project FKs and provenance values. No measurement changes.
6. `006_add_scoped_authorization.sql`: add RLS, lifecycle and atomic ingestion operations, a separate `organization_get_*` RPC family for coexistence, plus provenance and purge safeguards. Keep legacy readers/writers only while the sole admitted organization is the historical one.

Do not edit committed stage SQL or runner logic halfway through a rollout: the checksum refuses changed scripts (line endings are normalized across operating systems). Reconcile an interrupted rollout using its original release package or an explicitly reviewed progress transition. Catalog transactions acquire the usage table first and use NOWAIT for additional tables, avoiding lock-order inversion between legacy direct inserts and tenant-first RPCs. Lock/deadlock failures allow seven retries (eight attempts total) with bounded backoff; persistent failures stop for inspection. Expensive baseline comparisons run outside catalog-exclusive locks. Completed stages remain committed. The runner never modifies Supabase's ledger.

Claim the legacy organization with the existing parameterized `bootstrap_tenant` operation, supplying display name `HercuIT`, the independently verified owner UUID, and `p_claim_legacy=true`. It can be claimed only once. It is unreadable to ordinary users before this claim. Keep `default-project` and existing UUIDs/names unchanged.

## Compatibility Worker and shared-token bridge

The normal entry point `index.ts` rejects non-`brk_` credentials. `compatibility.ts` is a separately selectable, temporary build: it uses the `organization_get_*` reads and routes legacy-format bearers to `ingest_legacy_telemetry`. The database must have an unexpired, unrevoked bridge record, scoped to HercuIT. A missing/failed bridge never falls back to global inserts or Basic Auth. This artifact can be bundle-checked without deploying:

```sh
npx wrangler deploy compatibility.ts --dry-run
```

During stage 006 only, set the **operator-only** `LEGACY_INGEST_TOKEN` to the existing shared secret through a secure environment, and register it with an explicit ISO expiry no more than seven days away:

```sh
node scripts/register-legacy-ingest.mjs --expires-at=<ISO-UTC-expiry>
```

Only SHA-256 is sent to the database. The expiry must include `Z` or an explicit UTC offset and is bound unchanged so PostgreSQL validates its calendar date and timezone. No token is written to a migration or printed. Remove the operator variable after registration. Registration is one-time and cannot be invoked on the normal already-upgraded path. Any exceptional extension/replacement requires a reviewed operator change; the application never automatically extends it.

After the separate production deployment authorization, deploy the compatibility entry point using Wrangler's entry-point argument. Validate owner login, scoped token/cost reads, empty-batch auth, both exporters, generic cross-org denials and real HTTPS cookie/CSRF behavior. Create normal organization keys and begin rotating exporters. Keep the old readers drained before proceeding; dashboard maintenance is acceptable while ingestion stays live. Never admit a second organization while the original global reads remain callable.

## Stage 007: cut over and admit organizations

```sh
node scripts/online-tenancy.mjs --through=7 --confirm-backup-rehearsed --confirm-durable-delivery --confirm-auth-cutover --confirm-old-readers-drained
```

`007_cut_over_organization_access.sql` revokes old API-role function access, moves old signatures into non-exposed `private`, revokes the unused global spend view, creates canonical tenant-required RPCs, revokes legacy direct writes, and removes global project-name uniqueness after tenant uniqueness exists. Its transaction also opens the admission gate. Definitions/history are retained; no usage is deleted. Old requests must not be allowed to read globally after this point. The compatibility artifact remains tenant-safe and can keep serving requests through the rest of rotation.

Run `scripts/organizations/verify.sql` with the operator connection. It compares exact baseline-ID payloads, which is stronger than sums alone, and verifies ownership/project links. Privately compare row counts, integer category sums, exact decimal cost, timestamp bounds and session counts by source/project/time bucket for that same baseline cohort against the snapshot. Track later accepted batches separately with the durable delivery ledger. Do not compare changing unrestricted totals and mistake new ingestion for a mismatch. Preserve all new writes during rollback/recovery.

The online result intentionally differs from `20261028210000`: inaccessible old definitions/view remain, extra provenance/recovery safeguards are installed, and private manifests/gates exist. Verify all tenancy invariants and RLS/grants using the tests/runbook before an operator explicitly attests that the original cutover's security/data contract is satisfied. Only then may the already-executed cutover be recorded with the CLI's `migration repair --status applied 20261028210000 --linked`. This is a separately authorized ledger reconciliation, not a runner feature or workaround for an incomplete stage. Normal migration push then applies the appended provenance/recovery migration idempotently and future history. Keep the original migration immutable.

## Stage 008: retire shared access

Once every exporter uses normal keys and old writers have drained:

```sh
node scripts/online-tenancy.mjs --through=8 --confirm-backup-rehearsed --confirm-durable-delivery --confirm-auth-cutover --confirm-old-readers-drained --confirm-exporters-rotated --confirm-old-writers-drained
```

`008_retire_legacy_compatibility.sql` locks HercuIT before revoking its bridge key/record and disabling legacy filling triggers. Normal keys continue working. Deploy the normal `index.ts` artifact after its separate deployment authorization; remove the obsolete `INGEST_SECRET_TOKEN`, `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD` bindings. Verify the old bearer and Basic Auth fail. No credential is revived when a previous build is selected.

## Export, deletion, and recovery

After verifying the current requesting owner/admin, prepare an operator-assisted full export:

```sh
node scripts/export-organization.mjs --organization=<tenant-uuid> --requester=<verified-owner-or-admin-uuid> --output=<private-new-file.jsonl>
```

The export uses one repeatable-read snapshot without locking ingestion, pages usage with a cursor, includes organization/projects/usage and exact totals, and writes a restricted, exclusively created file. Integer/decimal usage fields are strings to preserve precision. `model` is the effective label (`unknown` for hardcoded history), `raw_model` preserves evidence, and `model_provenance` explains it. No key/invitation hashes or unrelated Auth profiles appear. Role is rechecked after the snapshot before publication. Existing output files are never overwritten, failures remove partials, and `export.prepared` audit does not claim delivery. Check the recipient's current access again when delivering securely. On Windows, verify the destination directory's ACL restricts the requesting organization/operator; POSIX mode alone is not a Windows ACL guarantee.

Authenticated dashboard access uses explicit safe usage-column grants under RLS. Raw `host_name` and `user_email` attribution is excluded from ordinary member reads; the authorized operator-assisted full export includes those stored fields. Already-upgraded installations must apply appended migration `20261030171018_restrict_usage_attribution_columns.sql` as well as the provenance/recovery migration. Never edit applied history to retrofit grants.

Deletion immediately disables reads/ingest and revokes keys/invitations. The new `purge_after` column prevents `purge_tenant` before seven days; existing pending jobs get a fresh recovery window when the additive migration is applied. During the window an operator can use parameterized `public.cancel_tenant_deletion(tenant_uuid,verified_owner_uuid)`, executable only by `service_role` and the database owner. Cancellation restores active status but never revives revoked keys/invitations. Re-request starts another seven-day window. Purge remains a separately authorized destructive operation; other tenants/shared Auth users survive. No cron or automatic email is added. Audit/backup retention and secure export delivery remain operator policy decisions.

Each failed rollout stage has a compensating rollback in the implementation spec. `scripts/organizations/rollback.sql` is an inert reference containing comments only. For the isolated phase-003 compensation, execute reviewed `scripts/organizations/rollback-003.sql` through the operator's secure database connection with stop-on-error enabled; never pass a credential-bearing URL as a command argument. The script runs in one transaction, takes the rollout advisory lock, requires current phase 3, uses a five-second lock timeout, relaxes the ownership/provenance NOT NULL flags and proof checks, and returns progress to phase 2 for a resumable forward retry. It refuses later phases where these changes could weaken admitted-tenant invariants. Retain expansion/manifests and accepted usage; stop backfills or deploy the compatibility tenant-safe artifact. Keep RLS and revocations. After a second organization writes, never restore global auth/uniqueness. Full restore is disaster recovery: isolate writes and reconcile every later committed batch/WAL before switching, including deletion/revocation history. Never overwrite production with a stale snapshot.

## Validation

`npm run test:online` runs every SQL stage verbatim in PGlite, including interruption/restart and interleaved legacy inserts. `npm run test:organizations` checks bounded provenance and full export isolation/precision. `npm run test:database` checks the complete immutable/appended history and direct SQL role/RLS assertions. `npm run test:online:postgres`, `npm run test:postgres`, and `npm run test:staged` require distinct fresh disposable PostgreSQL databases and a superuser login in `TEST_DATABASE_URL`; fixtures create cluster roles and configure the synthetic service role's `BYPASSRLS` to match Supabase. Use a dedicated local/CI test cluster, never production, and do not weaken this fixture requirement for a non-superuser login. The suites refuse initialized application databases. Real PostgreSQL adds concurrent-index and multiple-connection evidence beyond single-connection PGlite. CI runs those suites against isolated service databases.

Run Worker coverage, dashboard DOM tests, type check and dry-run bundles for both entry points. Live email, HTTPS browser sessions, production query plans/volume, durable collector behavior, retention choices and backup rehearsal remain deployment gates, not claims established by local mocks.
