# Tenant operations and cutover

This is a breaking, fail-closed authorization cutover. Preparing code/tests does not run these production steps. Use an operator-controlled maintenance window. Keep all credentials out of shell tracing, source, logs, and shared reports.

## Before migration

1. Back up the database and rehearse restore and migrations on a disposable copy. Record usage counts, per-project/source token sums and cost totals, and project names. Review table size and available lock/disk headroom. The committed all-at-once migration is retained as immutable history, but automatic deployment now refuses to apply it while pending. Use the staged procedure below for historical databases; never run its original large transaction against production.
2. Provision Supabase Auth email OTP delivery, exact application origins, Site URL and exact `/auth/callback` redirect URL. Default email confirmation/magic-link templates work; optionally include `{{ .Token }}` for code entry. Identify the legacy owner's verified Auth UUID through an operator-controlled process. Never derive ownership from telemetry attributes or the first visitor.
3. Configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_ORIGIN`, and optionally the authenticated invitation delivery integration. Provide secret values securely through Worker/environment settings. No values are supplied by these docs.
4. Pause legacy exporters/writes. Do not add a second tenant until schema, authorization, user sessions, and key cutover are validated. The previous Worker cannot write the new non-null tenant/project fields or call the new required-tenant RPC signatures.

## Migration and explicit ownership

First verify that all migration versions **before** `20261028210000` are recorded as applied. If any are pending, deploy the preceding release package containing only that earlier history before starting this procedure. Check the pending version list before execution; do not run an unrestricted push of the current package while this cutover is pending. CI’s migration-preview preflight intentionally stops such a push.

The existing `20261028210000_multi_tenancy.sql` is not rewritten: it may already be recorded in another environment. For a database where it is pending, run its staged equivalent with an owner-level database connection supplied securely (never paste the connection string into logs):

```sh
node scripts/stage-tenancy.mjs --confirm-maintenance --batch-size=5000 --statement-timeout-ms=60000
```

Set `TENANCY_DATABASE_URL` in the operator's secure environment before running. The script requires an explicit maintenance confirmation, takes a singleton advisory lock, and refuses an existing tenant schema without its own matching checksum/progress record. It performs these independently committed phases:

1. Add nullable tenant/project columns and `NOT VALID` tenant foreign keys; create the new empty tenant/private tables. Existing data is not scanned while taking the expansion locks.
2. Assign historical projects and resolve/create projects for usage in bounded batches (default 5,000 rows, maximum 10,000). Each batch commits independently. A private checksum/progress record permits restart after interruption without reassigning completed rows. Keep legacy writers paused throughout; project-name uniqueness stays global until cutover.
3. Build the two unique tenant/project indexes and three usage indexes with `CREATE INDEX CONCURRENTLY`, outside transaction blocks. Interrupted invalid indexes are removed concurrently before a retry.
4. Attach the prebuilt unique indexes, add not-null checks and the composite foreign key as `NOT VALID`, and validate each constraint in its own transaction. Validated checks let the later `SET NOT NULL` use a brief catalog lock rather than another full table scan. Every statement has an explicit timeout and every table-lock acquisition has a five-second timeout; adjust the statement timeout only after measuring the failed phase.
5. Commit the short RLS/grant/RPC cutover, remove old aggregate signatures/global uniqueness, and verify required columns, all foreign keys, RLS, index validity and API grants. The script prints safe phase/count progress, never connection values, and does **not** modify Supabase's migration ledger.

After independently comparing historical counts/per-source/project sums against the backup and reviewing the final verification, explicitly record the already-executed equivalent migration:

```sh
supabase migration repair --status applied 20261028210000 --linked
```

This is an operator attestation after schema completion, never a workaround for a failed phase. Then retry the normal CI migration/deployment workflow; the pending-cutover guard will no longer match. Environments where the immutable migration is already applied must not replay staging or repair their ledger. If its transaction is currently running, investigate its actual locks and follow the database recovery runbook rather than launching a competing migration.

The staged tenancy cutover creates the legacy tenant with UUID `00000000-0000-4000-8000-000000000001`, assigns existing projects and usage to it, creates missing projects, and enforces composite tenant/project foreign keys. It creates **no membership or exporter key**. Until claimed, no ordinary user can read this tenant.

As a trusted operator, supply a verified owner's UUID through a parameterized SQL client or Supabase SQL editor:

```sql
-- Replace the example UUID with the verified owner's real Auth UUID.
select public.bootstrap_tenant('Your organization', '00000000-0000-4000-8000-000000000000'::uuid, true);
```

The function rejects unverified/missing users and repeated legacy claims. Create a new independent tenant with the same function and `p_claim_legacy=false` (the default). Only `service_role` and the database owner can execute it. There is no HTTP bootstrap endpoint.

Verify no null/mismatched tenant/project keys, compare historical counts/sums to the backup, and inspect all exposed grants/RLS. The unused globally aggregated spend view is dropped and old aggregate overloads are removed. Tenant readers use `authenticated` RLS; no anonymous read grant remains.

## Worker and exporter cutover

Deploy the tenant-aware Worker only after schema application. CI now runs validation, migrations, then Worker deployment in a serialized release. Configure secrets and Auth settings before enabling user traffic. Sign in as the verified owner, select the organization, create tenant ingestion keys, and update Claude/Codex exporter headers. Revoke/remove the former `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD`, and `INGEST_SECRET_TOKEN` settings. No global-token or Basic Auth compatibility bridge exists.

Verify both sources and empty-batch authentication. Resume exporters and monitor accepted/rejected records, request IDs, rate limits and database failures. A `503` means retry; a `401` with a previously valid exporter key requires checking key expiry/revocation and tenant status. Do not add an anonymous bypass or service-role dashboard fallback to work around a failure.

Sign-out always clears local session cookies after same-origin CSRF validation, even during Auth outages. Upstream revocation is attempted and safe failure categories are logged; a failed remote revocation cannot guarantee that an already-stolen refresh token was invalidated. Review session security if an outage coincides with credential compromise.

The Worker uses `CF-Connecting-IP` for IP-based rate limits. Outside Cloudflare it deliberately falls back to a shared unknown bucket rather than trusting caller-controlled forwarding headers. Configure distinct development origins; do not weaken Secure cookies for a production origin.

## Membership, invitation and credential operations

The tenant row serializes membership, invitation, key and ingestion changes. Two concurrent removals cannot eliminate the last owner. Auth-user deletion is also guarded; transfer ownership before using Supabase Auth Admin delete. Removing a user membership immediately changes RLS visibility, independent of JWT expiry. Exporter keys belong to tenants; rotate/revoke them explicitly during offboarding when appropriate.

Keys contain 256 bits of randomness, are returned once, and are stored only as SHA-256 digests in a non-exposed private schema. List operations omit digests. If a browser loses a creation response, use the key's metadata to revoke it and create a replacement; there is no recovery endpoint. On rotation, update exporters before revoking the old key. All creation responses are no-store.

Invitations expire after seven days. Acceptance checks the current verified Auth email server-side and preserves any existing membership role. Resending replaces the digest; previous links become invalid. The delivery integration's success is separate from database insertion. Delivery failures remain visible and can be retried/revoked; do not manually log/recover token plaintext.

## Deletion, retention and recovery

An owner confirms the organization name to request deletion. This disables RLS access/ingestion, revokes keys/invitations and inserts a row in `private.tenant_deletion_jobs`. A trusted operator processes pending jobs with:

```sql
select public.purge_tenant('00000000-0000-4000-8000-000000000000'::uuid);
```

Replace the placeholder with the explicitly approved deleting tenant's UUID. The function rejects active tenants and is idempotent for already-purged jobs. It cascades tenant data/memberships/keys/invitations, preserves other tenants and shared Auth users, and retains audit events/job completion metadata. No automatic background purge or real invitation delivery is initiated by implementing this feature.

Audit retention and backup expiry are operator policy decisions. Keep private audit access restricted; set and document a retention interval consistent with customer commitments before production launch. No immediate backup erasure guarantee is made. Recovery from backups must reapply tenant RLS/grants and preserve credential revocations. Treat missing rows after RLS as denied access, not a signal to retry with service role.

Before the second tenant exists, restoring the single-tenant snapshot is possible only after reconciling writes. After multi-tenant data exists, never roll back to global-auth code. Use maintenance mode or a known tenant-safe version and a forward fix. Keep database backups, migrations and Worker versions aligned.

## Reproducible validation

- `npm test`: Worker/Auth mocks and existing parser behavior with ≥90% backend coverage.
- `npm run test:database`: complete history and tenant/RLS SQL assertions in disposable PGlite.
- `npm run test:dashboard`: actual HTML scripts in a DOM; source and tenant state isolation, stale requests, and role controls.
- `npm run test:postgres`: optional PostgreSQL 17 multi-connection suite. Supply `TEST_DATABASE_URL` for a fresh disposable database; it refuses initialized Auth/usage schemas. It checks actual locks for concurrent last-owner removal and key revocation, and prints a measured 10k-row query execution time. Do not use production.
- `npm run test:auth-live`: optional local official Supabase Auth check, using `TEST_AUTH_URL` (default loopback port 55433) and `TEST_AUTH_JWT_SECRET` matching a disposable container. It creates/deletes one synthetic `example.test` account via admin-generated OTP, verifies the OTP through the public client, tests refresh and sign-out, and sends no real email. It refuses non-loopback origins.

For local container tests, use PostgreSQL 17 and the official `supabase/gotrue:v2.197.0` image on an isolated Docker network. Initialize a separate database and empty `auth` schema for GoTrue migrations, and set that database’s search path to `auth,public` before starting GoTrue. Bind their ports only to loopback. Use an ephemeral local JWT secret and database password, never real Supabase credentials. Give GoTrue the usual `GOTRUE_DB_DRIVER=postgres`, its local DB URL, API host/port, `API_EXTERNAL_URL`, `GOTRUE_SITE_URL`, email enabled, auto-confirm disabled, and `GOTRUE_JWT_*` settings. The optional Auth runner maps the SDK's `/auth/v1` prefix to the standalone GoTrue root. Keep the managed proxy/CA settings for image pulls; no TLS verification bypass is needed.

Production release still needs a real-browser HTTPS cookie/CSRF check on the configured application origin, verified email delivery, representative production query plans/volume, backup/retention decisions, and the operator cutover above. Local tests are evidence of development behavior, not proof of production configuration.
