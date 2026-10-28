# Tenant operations and cutover

This is a breaking, fail-closed authorization cutover. Preparing code/tests does not run these production steps. Use an operator-controlled maintenance window. Keep all credentials out of shell tracing, source, logs, and shared reports.

## Before migration

1. Back up the database and rehearse restore and migrations on a disposable copy. Record usage counts, per-project/source token sums and cost totals, and project names. Review table size and available lock/disk headroom; the current cutover migration backfills in one transaction. For very large production tables, split expansion/backfill/constraint validation into bounded migration phases before deploying; do not run a long unmeasured transaction on a live write-heavy table.
2. Provision Supabase Auth email OTP delivery, exact application origins, site URL and email template (`{{ .Token }}`). Identify the legacy owner's verified Auth UUID through an operator-controlled process. Never derive ownership from telemetry attributes or the first visitor.
3. Configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_ORIGIN`, and optionally the authenticated invitation delivery integration. Provide secret values securely through Worker/environment settings. No values are supplied by these docs.
4. Pause legacy exporters/writes. Do not add a second tenant until schema, authorization, user sessions, and key cutover are validated. The previous Worker cannot write the new non-null tenant/project fields or call the new required-tenant RPC signatures.

## Migration and explicit ownership

Apply the complete migration history through Supabase CLI (`supabase link` then `supabase db push`) or the controlled CI pipeline. The tenancy migration creates the legacy tenant with UUID `00000000-0000-4000-8000-000000000001`, assigns existing projects and usage to it, creates missing projects, and enforces composite tenant/project foreign keys. It creates **no membership or exporter key**. Until claimed, no ordinary user can read this tenant.

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
