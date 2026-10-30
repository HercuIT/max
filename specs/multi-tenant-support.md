# Multi-tenant support

Status: implementation contract. Local implementation and tests are included; production cutover and operational release gates remain separate. See [operations](../docs/tenancy-operations.md).

Companion documents: [Supabase architecture](supabase-tenancy.md) and [rollout and acceptance tests](multi-tenant-rollout.md).

The implemented [organizations and existing data design](organizations-and-data-migration.md) adds online ingest compatibility, honest historical model provenance, full operator-assisted export and a seven-day deletion recovery window. Implementation was authorized in chat; production operations still require their release gates. See its [implementation runbook](../docs/organizations-online.md); the maintenance-only cutover remains an alternative, not a continuous-ingestion procedure.

## Goal and terminology

Allow independent organizations to use HercuIT Burnrate without seeing or modifying one another's telemetry. A **tenant** is an organization/workspace; a Supabase Auth **user** can belong to several tenants. A **project** belongs to exactly one tenant. Claude and Codex are telemetry sources within a tenant, not separate tenants.

Use one Supabase project and a shared PostgreSQL schema with tenant identifiers and row-level security (RLS). Keep the Cloudflare Worker as the HTTP entry point and OTLP ingestion service. Dedicated databases per customer, billing, enterprise SSO, cross-tenant reporting, and public dashboards are outside the initial release.

## Current behavior to replace

- `index.ts` authorizes all humans with `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` and all exporters with `INGEST_SECRET_TOKEN`.
- Dashboard requests use `SUPABASE_SERVICE_ROLE_KEY`; all five `get_token_usage_*` / `get_cost_*` RPCs aggregate globally.
- `token_usage_logs` has `project_name` and `source` but no tenant identifier. `projects.name` is globally unique and ingestion does not currently maintain that table.
- `/v1/metrics` persists Claude usage; `/v1/logs` persists Codex completion usage and reported cost estimates. Dashboard tabs already support independent source filters.

Adding a tenant selector without changing these authorization and database paths does not satisfy this specification.

## Membership and permissions

| Capability | Owner | Admin | Viewer |
| --- | --- | --- | --- |
| Read tenant projects, usage, token and cost dashboards | Yes | Yes | Yes |
| Read member display names and roles | Yes | Yes | Yes |
| Invite/remove viewers and admins; change those roles | Yes | Yes | No |
| Create, list metadata for, revoke, and rotate ingestion keys | Yes | Yes | No |
| Rename the tenant | Yes | Yes | No |
| Promote/demote/remove owners | Yes | No | No |
| Request tenant deletion | Yes | No | No |

A tenant must always have at least one owner. An admin cannot remove or demote an owner, including by first changing their role. A user may leave unless they are the last owner. Member removal takes effect on the next database operation even if their Supabase access token is still valid. Revoking membership does not automatically revoke tenant-owned exporter keys; show that explicitly in the removal confirmation.

Initial tenant creation is an operator-assisted workflow through a server-only bootstrap operation, with a supplied, verified Auth user UUID as first owner. There is no anonymous signup-to-tenant assignment or first-visitor ownership claim. Self-service tenant creation can be added separately.

## Sign-in and tenant selection

1. Use Supabase Auth email OTP sign-in with verified email ownership. Restrict callback URLs to configured application origins and validate return paths as same-origin relative paths.
2. Keep the dashboard at `/dashboard/token-usage`; unauthenticated navigation goes to sign-in. API requests without a valid session return JSON `401`.
3. After sign-in, list only current memberships. A single membership is selected automatically; several memberships show a tenant chooser. A signed-in user without memberships sees “You do not belong to an organization. Ask an organization owner for an invitation.”
4. Put the selected tenant UUID in tenant-scoped request paths. A remembered tenant is a convenience, never evidence of authorization. Recheck membership in PostgreSQL on every operation.
5. Switching tenants clears project selections, loaded rows, charts, errors, and in-flight requests before loading the new tenant. Never flash the previous tenant's data. Preserve each dashboard tab's source selection and date-range defaults, but reset project filters because project identities are tenant-specific.
6. Sign-out clears local dashboard state and session cookies. Auth failures should offer sign-in again; inaccessible tenants should offer the tenant chooser without revealing whether the tenant exists.

The browser uses secure, HttpOnly session cookies through Worker endpoints. Supabase tokens are not stored in localStorage or embedded in dashboard HTML. See the architecture document for user-scoped database calls and CSRF requirements.

## Tenant administration

Settings pages show tenant name, current role, members, pending invitations, and ingestion key metadata according to role. Viewer controls are hidden, but server/database authorization remains mandatory.

An owner/admin invites an email address with a requested role (admin or viewer). Invitations expire after seven days, can be revoked, and can be accepted only by a signed-in user with the same verified email. Owners grant ownership through a separate explicit role-change action after membership exists. Accepting an invitation must not downgrade or silently alter an existing member's role. Invite status is visible to owner/admin; ordinary members do not receive the list of invited email addresses.

Resending replaces the invitation token and invalidates the previous link; store only the new digest, preserve the intended tenant/email/role, and never recover an old plaintext token. If email delivery fails, say “The invitation was created, but the email could not be sent. Retry delivery or revoke it.” Never report delivery success from database insertion alone. Delivery uses an authenticated server-side provider configured at implementation time; writing this specification does not authorize sending invitations.

Key creation requires a descriptive label. Display the full key once with a copy action and instructions for Claude and Codex. Subsequent listings show only identifier/prefix, label, creator, creation/expiry/revocation dates, and last usage time. Losing a key requires replacement. Rotation creates a new key first, allows an explicit overlap while exporters are updated, and revokes the old key only on request. Creation alone does not silently revoke another key.

## Telemetry ingestion

Keep `POST /v1/metrics` and `POST /v1/logs` compatible with OTLP/HTTP JSON and the existing bearer header. Replace the global bearer token with opaque, tenant-owned ingestion keys.

- Resolve the tenant only from a valid, active ingestion key. Payload attributes, query parameters, project names, user emails, `source`, and submitted tenant IDs cannot select or override it.
- A key is write-only. It cannot access dashboards, membership, keys, or arbitrary database APIs.
- Both sources are permitted by a tenant key in the initial release. Preserve source tagging, Codex token-category mapping, and reported-cost semantics.
- The existing Codex `?project=` override may select a project name only within the key's tenant. Claude repository attributes have the same boundary. Identical project names in separate tenants remain separate projects.
- Resolve or create projects within the same authorized database transaction as usage insertion. Do not accept a caller-provided project UUID without verifying its tenant.
- Invalid, expired, revoked, or disabled-tenant keys return the same `401` response. Database unavailability returns retryable `503`, not a misleading authentication error. The accepted normalized rows in one OTLP batch are inserted atomically; malformed Codex records remain explicitly rejected through OTLP partial success.
- Apply bounded request sizes and batch counts before costly parsing/insertion; proposed initial limits are 1 MiB JSON bodies and 5,000 normalized usage rows per request. Return `413` for these limits. Make deployment limits explicit and compatible with the Worker platform limits.
- Never log tokens, raw OTLP bodies, prompts, or Supabase credentials. Log request ID, operation, safe failure category, and resolved tenant/key IDs when authorization succeeded.

Delivery remains at least once, matching the existing ingestion behavior. Exporter retries can duplicate usage; multi-tenancy must not claim exactly-once delivery. Event deduplication and cumulative Claude metric handling are separate accounting work.

## Dashboard behavior and API contract

All project listings, token tables/series, cost tables/series, totals, and session counts are scoped to one authorized tenant before applying project, source, date, and bucket filters. No endpoint permits an omitted tenant to mean “all tenants.”

Use these authenticated Worker routes:

| Route | Purpose |
| --- | --- |
| `GET /api/tenants` | List caller's current memberships and tenant names |
| `GET /api/tenants/:tenantId/token-usage/projects` | Tenant project names |
| `GET /api/tenants/:tenantId/token-usage/series` | Token chart |
| `GET /api/tenants/:tenantId/token-usage/table` | Token table |
| `GET /api/tenants/:tenantId/cost/series` | Cost chart |
| `GET /api/tenants/:tenantId/cost/table` | Cost table |
| `GET /api/tenants/:tenantId/members` | Member display information |
| `GET, POST /api/tenants/:tenantId/invitations` | List pending invitations / invite an admin/viewer |
| `POST /api/tenants/:tenantId/invitations/:inviteId/resend` | Retry delivery for a valid pending invitation |
| `DELETE /api/tenants/:tenantId/invitations/:inviteId` | Revoke pending invitation |
| `POST /api/invitations/accept` | Accept supplied one-time invitation token |
| `PATCH /api/tenants/:tenantId/members/:userId` | Change permitted role |
| `DELETE /api/tenants/:tenantId/members/:userId` | Remove member or leave |
| `GET, POST /api/tenants/:tenantId/ingestion-keys` | List metadata / create key |
| `DELETE /api/tenants/:tenantId/ingestion-keys/:keyId` | Revoke key |
| `PATCH /api/tenants/:tenantId` | Rename tenant |
| `POST /api/tenants/:tenantId/deletion-request` | Disable tenant and queue deletion |

Keep existing query names `projects`, `start`, `end`, `bucket`, and `source`; keep the successful dashboard response shapes. Preserve token defaults of seven days, cost defaults of all time, and per-source session counting. Unknown project names produce empty results within the selected tenant, not lookups in another tenant. Validate UUIDs, supported sources/buckets, timestamps, and start/end ordering; invalid inputs return `400` with actionable field errors.

Use `404` for an inaccessible tenant or tenant-owned object, `403` for an insufficient role within an accessible tenant, `409` for last-owner and invitation-state conflicts, and `429` for enforced rate limits. Error responses include a stable code, actionable message, and request ID; do not disclose another tenant's names, members, usage, or key metadata. Tenant responses and session endpoints use `Cache-Control: no-store` and are excluded from shared/CDN caching.

## Lifecycle and release outcome

Owner deletion requests first disable ingestion and dashboard access, revoke tenant keys and pending invitations, and enqueue audited deletion. Data purge is asynchronous and retryable, scoped by tenant UUID. Require a typed tenant-name confirmation. Auth users shared with other tenants must not be deleted. No retention deadline is promised until backup retention and operational recovery are defined.

The release is complete only when two independently owned tenants can ingest and view Claude/Codex usage with no cross-tenant access through either the Worker or Supabase APIs, historical data has an explicit owner, and shared credentials and global reads are removed. Detailed release gates are in the rollout document.
