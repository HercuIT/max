# Supabase tenancy architecture

Status: implementation contract; production cutover is not automatic. Implements the [multi-tenant product contract](multi-tenant-support.md); migration and test sequencing are in [rollout](multi-tenant-rollout.md).

The implemented [organizations/data design](organizations-and-data-migration.md) extends this contract with an [online staged rollout](../docs/organizations-online.md), classified model provenance, a model-safe invoker view, operator-assisted full exports, and checked seven-day purge eligibility. Production release gates remain separate. Authenticated usage grants cover dashboard-safe columns, while raw host/email attribution is available through the authorized operator-assisted full export. The normal Worker keeps retired global credentials disabled; only the explicit compatibility artifact can use the database-gated historical bridge.

## Trust boundaries

Supabase Auth establishes user identity. PostgreSQL membership records establish current tenant access; do not use user-editable `user_metadata`, an email domain, an exporter attribute, or a browser-selected tenant as authority. Do not put roles/membership lists into JWT claims as the only authorization check: removal must take effect without waiting for JWT expiry.

The Worker separates three database clients:

| Client | Credential/context | Permitted work |
| --- | --- | --- |
| Public Auth client | Supabase publishable key | OTP initiation and Auth exchanges |
| User database client | Publishable key plus caller's validated access JWT | RLS-protected dashboard reads and authorized administration RPCs |
| Ingestion/operations client | Server-only service-role key | Narrow ingestion and bootstrap/background operations |

Never substitute the service-role client when a user request is unauthenticated, fails RLS, or returns no rows. It bypasses RLS. The frontend must never receive that key. Use separate constructors/modules so a dashboard handler cannot accidentally obtain the privileged client.

## Proposed data model

Use `gen_random_uuid()` for new UUID defaults and `timestamptz` for timestamps. Add named constraints and foreign-key indexes in new migrations; do not edit applied migration history.

| Relation | Required fields and invariants |
| --- | --- |
| `public.tenants` | `id`, `name`, `status` (`active`, `deleting`), `created_at`, `created_by`; no globally unique display-name requirement |
| `public.tenant_memberships` | `tenant_id`, `user_id` referencing `auth.users`, `role` (`owner`, `admin`, `viewer`), `created_at`; primary key `(tenant_id,user_id)`; index `(user_id,tenant_id)` |
| `public.projects` | Existing UUID `id`; add `tenant_id`; unique `(tenant_id,name)` replaces global `name` uniqueness; unique `(tenant_id,id)` supports composite foreign keys |
| `public.token_usage_logs` | Add required `tenant_id`, `project_id`; composite foreign key `(tenant_id,project_id)` to `projects(tenant_id,id)`; retain `project_name` as an immutable ingestion snapshot for compatibility, but use the related project as identity |
| `private.ingestion_keys` | `id`, `tenant_id`, `label`, globally unique `token_hash`, non-secret display prefix, `created_by`, `created_at`, optional `expires_at`, `revoked_at`, `last_used_at`; never plaintext token |
| `private.tenant_invitations` | `id`, `tenant_id`, normalized email, requested role (`admin`, `viewer`), unique `token_hash`, creator/timestamps, `expires_at`, `accepted_at`, `revoked_at`; pending invitation uniqueness per tenant/email enforced transactionally |
| `private.tenant_audit_events` | `id`, `tenant_id`, nullable actor user/key ID, action, target ID, time, request ID, allowlisted metadata; no tokens, payloads, or arbitrary exception dumps |

`private` is excluded from the Supabase Data API exposed schemas. Revoke schema/table access from `anon` and `authenticated`; access only through narrowly granted RPCs. Public tables have RLS enabled, explicit grants, and policies. Never grant default public access to newly created functions.

Telemetry rows cannot move between tenants or projects through user operations. There is no direct authenticated INSERT/UPDATE/DELETE grant on telemetry or project creation. Project creation in the initial release is automatic during ingestion. Project renaming and tenant merging are outside scope, avoiding drift between project identity and stored name snapshots.

Keep `source` constrained to `claude`/`codex`. Count sessions by `(source,session_id)` within tenant-scoped aggregates. Do not create a global session-name uniqueness constraint. Historical host names and user emails are telemetry attributes, not authenticated membership identities.

Indexes must support `(tenant_id, recorded_at DESC)`, `(tenant_id, source, recorded_at DESC)`, and `(tenant_id, project_id, recorded_at DESC)`. Confirm query plans using representative multi-tenant volumes before retaining redundant existing indexes. Key hash lookup requires its unique index.

## RLS and authorization helpers

Use a private helper such as `private.is_tenant_member(tenant_uuid)` that derives the user exclusively from `auth.uid()`, checks a current membership and active tenant, and returns only a boolean. Use a corresponding role helper for administrative RPCs. These narrowly scoped helpers may be `SECURITY DEFINER` to avoid recursive membership RLS; use a controlled owner, fully qualified object references, and a fixed safe `search_path`. They must not accept an arbitrary user ID to impersonate. Grant only the execution/schema usage necessary for authenticated policy evaluation; do not expose the private schema through PostgREST.

| Public relation | Authenticated policy | Mutation policy |
| --- | --- | --- |
| `tenants` | SELECT when current caller belongs to the active tenant | RPCs only |
| `tenant_memberships` | SELECT member UUID/role within caller's active tenants | RPCs only |
| `projects` | SELECT when caller belongs to the row's active tenant | Ingestion RPC only |
| `token_usage_logs` | SELECT when caller belongs to the row's active tenant | Ingestion RPC only |

No anonymous policies. Grant authenticated SELECT only on safe public columns. Do not expose `auth.users` as a public directory: a member-list RPC returns minimal display information after checking membership, without exposing another tenant's identities or arbitrary auth profile fields. Owner/admin-only invitation metadata is returned through its own checked RPC.

RLS is a second authorization boundary even when the Worker validates tenant membership. Tests must call tables and RPCs through the same roles/JWT context available to a normal Supabase client, not only through the Worker.

## Dashboard RPCs and the existing view

Replace all five RPC signatures with versions requiring `p_tenant_id uuid` and preserving the existing optional project/date/bucket/source arguments. No default tenant or global “all tenants” option. Remove old callable overloads to avoid ambiguous PostgREST dispatch and retained global reads.

Use `SECURITY INVOKER`, fixed safe `search_path`, authenticated-only execute grants, required tenant predicate, and ordinary RLS-protected table reads. Return the existing response column shapes. Join projects on both project ID and tenant ID; apply the project-name filter to tenant-owned projects. Reject inaccessible tenants at the Worker boundary; direct RPCs may return no rows under RLS, but must never return another tenant's data.

`project_spend_summary` is currently unused but aggregates globally. Replace it with a tenant-keyed `security_invoker` view grouping by tenant/project, or drop it if confirmed unused. Do not leave a globally aggregated view, legacy definer RPC, materialized view, debug endpoint, export, or cache reachable under old grants. Any retained view must obey the underlying RLS and include tenant identity in its grouping.

## Atomic ingestion RPC

The Worker generates/accepts exporter bearer credentials but never chooses a tenant from the request body. Generate at least 256 bits of random token entropy with Web Crypto; use a versioned, recognizable prefix and base64url encoding. Store SHA-256 of the entire token, not plaintext or a reversible encryption. High-entropy API keys do not need password-style hashing. Treat the digest as sensitive server-only material because it is the lookup proof accepted by the RPC.

After enforcing body limits and normalizing Claude/Codex telemetry, the Worker hashes the received token and calls a service-role-only public RPC with `p_token_hash` and normalized rows. Do not pass an authoritative `p_tenant_id`. This is a narrow `SECURITY DEFINER` operation with fixed `search_path`, controlled ownership, explicit revoke from public/anon/authenticated, and execute granted only to the ingestion service role.

Inside one transaction:

1. Look up the key digest to identify its tenant without yet authorizing the request. Lock the tenant row first, then the key row, and recheck the digest/tenant association, revocation, expiry, and active tenant status under those locks. Revocation/deletion use the same ordering, so either an ingestion transaction completes before revocation or it is rejected after revocation commits.
2. Validate row shape, count, supported source, non-negative amounts, integer token bounds, project-name limits, and required fields again at the database boundary. Ignore/reject any submitted tenant IDs or foreign project UUIDs.
3. Derive every row's tenant UUID from the resolved key. Resolve/create each project with `(tenant_id,name)` uniqueness and set both tenant/project keys internally. Concurrent first ingestion for a project must converge on one project row.
4. Insert the normalized rows, update last-used metadata, and return inserted count and resolved tenant/key UUIDs to the service-only caller for safe request logging; expose only count to the exporter. On any failure, roll back the entire batch.

The same authorization check applies to an otherwise empty batch; revoked keys must not receive a success response just because the payload has no usable metrics. Non-usage log records are not stored. No user or exporter can call a general SQL or arbitrary-tenant insert operation.

Key creation/revocation is an authenticated administrative RPC; never grant users read access to hashes. Generate the raw token server-side, insert only its digest through a checked operation, then show plaintext once. Protect the response with `no-store`, never log it, and make retry behavior explicit: if delivery to the browser fails, revoke the unknown key and create a replacement. Do not persist plaintext to make it retrievable.

## Administration transactions and concurrency

Membership/invitation/key/deletion mutations use narrow checked RPCs rather than direct table writes. Every RPC derives `auth.uid()` and checks the actor's current role in the target tenant. Use `(tenant_id,target_id)` lookups so a valid object ID cannot be operated on through a different tenant path. Explicitly revoke default function execute permissions.

Serialize role changes, member removals, leave operations, and deletion requests by locking the tenant row before reading/modifying memberships. Compute the last-owner invariant under that lock. All functions must acquire locks in the same order (tenant before child rows), including ingestion, to avoid deadlocks. An admin cannot promote themself to owner. Audit changes in the same transaction; audit insertion failure fails the administrative transaction.

Invitation acceptance locks the invitation and tenant, checks active/unexpired/unrevoked/unaccepted state and verified email against the current Auth identity, then inserts membership and marks accepted atomically. Email comparison uses normalized case/whitespace only; do not apply provider-specific dot/plus rewriting. Read verified Auth data server-side rather than trusting browser-submitted email or user metadata. Resolve all tenant locks before child locks. A replay must not create a second membership or change an existing role. Invitation token material must not remain in browser URLs, analytics, or referrers after redemption; use a same-origin landing flow and POST body for acceptance.

User deletion through Auth must not cascade away the last owner. Add a database-enforced guard on Auth-user deletion, covering privileged Auth Admin API deletion as well as application paths: lock all affected tenant rows in UUID order, recheck surviving owners, and block deletion if any tenant would lose its last owner. Reassign ownership first through the same serialized management path. Tenant purge deletes memberships rather than shared Auth users. Background jobs must supply explicit tenant IDs and recheck their job authorization/status.

## Auth sessions and Worker security

Use Supabase's supported server-side session handling and PKCE/OTP verification. Refresh cookies on the response, validate access tokens via the Auth service or verified project JWKS with issuer/audience/expiry checks, and never trust a decoded unverified JWT. RLS remains authoritative for membership. Avoid cross-request reuse of a mutable Supabase client with another user's Authorization header.

Cookies: `Secure`, `HttpOnly`, `SameSite=Lax`, narrowly scoped domain/path. Mutating cookie-authenticated endpoints require CSRF tokens plus same-origin Origin validation. Limit CORS to configured application origins; no wildcard credentialed CORS. OTP initiation must have generic account-discovery-safe responses and rate limits. Define idle/session expiry and refresh behavior using Supabase configuration at implementation time.

New runtime configuration: `SUPABASE_PUBLISHABLE_KEY` (non-secret), `APP_ORIGIN` (non-secret canonical HTTPS origin), and an email delivery integration if invitations cannot use existing Supabase-supported delivery. Reuse `SUPABASE_URL`; retain the service-role key only for restricted server operations. Remove dashboard Basic Auth and the shared ingestion token after cutover. No credential values belong in specifications, migrations, source, logs, or frontend bundles.

Rate limits should distinguish unauthenticated sign-in/key failures, authenticated tenant/key ingestion, and administrative mutations. Specify deployment-specific thresholds and a shared enforcement store during implementation; an isolate-local counter is insufficient for a distributed Worker. Do not use the service-role credential as a tenant identifier for quotas, logs, or caching.
