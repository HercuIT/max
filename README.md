# HercuIT Burnrate

A Cloudflare Worker that ingests Claude Code and Codex OTLP telemetry into Supabase and serves per-organization token and cost dashboards.

Each organization has its own projects, members, ingestion keys, and usage. Users sign in with Supabase Auth email codes and can belong to several organizations. PostgreSQL RLS checks current membership on every read; dashboard queries use the user's JWT, never a service-role fallback. Owner/admin/viewer permissions are defined in the [multi-tenant contract](specs/multi-tenant-support.md).

## Development

Requires Node 24 (including native TypeScript imports for the DOM test runner) and npm 11. Install locked dependencies:

```sh
npm ci
npm test
npm run test:database
npm run test:dashboard
npx tsc --noEmit
npx wrangler deploy --dry-run
```

The Worker tests exercise auth, cookies, CSRF, tenant routing, administration, and ingestion with mocked external APIs, enforcing 90% coverage. The database runner executes the complete migration history in PGlite (PostgreSQL compiled to WASM), simulates Supabase roles and Auth identity, and checks RLS and lifecycle behavior. The fixture helpers also verify verbatim SQL inclusion and refuse initialized databases. Its UUID bootstrap substitute is test-only because PGlite lacks `uuid-ossp`. The DOM suite executes the actual page scripts and verifies source filtering, role controls, and stale-response isolation during tenant switches. These do not replace live Supabase email delivery, real-browser session validation, multi-connection lock checks, or production-scale query-plan review.

For local development, supply the variables below through a private `.dev.vars` file, then run `npx wrangler dev`. Cookie-authenticated manual testing requires HTTPS at the configured `APP_ORIGIN`; use Wrangler's HTTPS option/local trusted certificate or a dedicated HTTPS development origin. The `__Host-` cookies deliberately remain Secure/HttpOnly even in development. Never use a production database for automated integration tests.

## Runtime configuration

| Name | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase API origin |
| `SUPABASE_PUBLISHABLE_KEY` | Non-secret publishable/anon key for Auth and user-scoped database calls |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key for ingestion, rate limiting, and operator operations; configure as a Worker secret |
| `APP_ORIGIN` | Exact canonical HTTPS application origin, without trailing slash; used for CSRF and invitation links |
| `INVITATION_DELIVERY_URL` | Optional HTTPS delivery integration accepting the JSON contract below |
| `INVITATION_DELIVERY_TOKEN` | Optional server-only bearer credential for that integration |

The delivery integration receives `{ "to": "email", "subject": "text", "text": "text" }`; only a successful HTTP response counts as delivery. It must authenticate the Worker, send the message, preserve TLS verification, and avoid logging invitation tokens. Configure network access to the Supabase and delivery hosts. Without delivery configuration, invitations are persisted but the API/UI explicitly reports delivery failure and offers resend/revoke. Resend rotates the token and invalidates the old link.

The included Supabase Edge Function implements this contract with Resend. See [invitation email deployment](docs/invitation-email.md) for its secrets, deployment command, and Worker configuration.

Set Supabase Auth's Site URL to `APP_ORIGIN` and add the exact `APP_ORIGIN/auth/callback` URL to Redirect URLs. Default Confirm signup and Magic Link templates work with PKCE email links. To also offer code entry, include `{{ .Token }}` in both templates. Links must open in the same browser that requested them within ten minutes; only the latest requested link is supported. The callback exchanges the code server-side, clears the temporary HttpOnly verifier cookie, and always redirects to the dashboard; arbitrary return URLs are ignored. Configure a seven-day maximum session lifetime in Supabase to match the refresh cookie, a suitable idle timeout, and email OTP rate limits. The application additionally enforces shared database-backed limits: 20 Auth requests per IP/minute, 5 per email/10 minutes, 120 ingestion requests per IP/minute, 600 per key/minute, and 60 administration mutations per user/minute. Tune these in code with measured deployment traffic; do not replace them with per-isolate counters.

`TENANCY_DATABASE_URL` is a separate operator-only database connection for the [staged maintenance rollout](docs/tenancy-operations.md), never a Worker binding. `TEST_DATABASE_URL` is reserved for fresh disposable PostgreSQL integration databases.

The former `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD`, and `INGEST_SECRET_TOKEN` are retired. Basic Auth and the shared exporter token are not fallback paths.

## Dashboard and administration

- `/sign-in`: email-link sign-in, with optional code entry.
- `/dashboard/token-usage`: tenant chooser plus Token Usage and Cost (USD) tabs.
- `/settings`: members, roles, invitations, key creation/revocation, organization rename, leave, and owner-only deletion requests.
- `/invite#<one-time-token>`: removes the fragment immediately, then accepts via authenticated POST. Sign in in another tab if necessary; keep the invitation page open until acceptance.

Each tab remembers **All sources / Claude / Codex** and its date range independently. Token usage defaults to seven days; cost defaults to all time. A tenant switch clears project selections and visible data before loading the next tenant. Project selections absent from a source stay selected, so an empty intersection never becomes all projects.

A newly created key is shown once. Copy it securely; only its hash is stored. To rotate, create a replacement, update exporters, then revoke the old key. Removing a member does not revoke organization-owned exporter keys. Owners must transfer ownership before removing the last owner or deleting that Auth user.

Initial organizations are created by an operator with `bootstrap_tenant`, assigning a verified Auth user UUID. There is no automatic first-visitor claim or self-service organization creation. See [operations and cutover](docs/tenancy-operations.md).

## HTTP API

All tenant API responses are `no-store`. Cookie-authenticated mutations require a same-origin `Origin` and the `X-CSRF-Token` returned by `GET /api/session`. Supabase access/refresh tokens are kept in Secure, HttpOnly, SameSite=Lax cookies; the browser never receives the service-role key or stores Auth tokens in localStorage. Remembered tenant UUIDs are not authorization.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/session` | Signed-in state and CSRF token |
| `POST /auth/sign-in`, `/auth/verify`, `/auth/sign-out` | Email code and cookie lifecycle |
| `GET /auth/callback` | PKCE email-link exchange; fixed dashboard redirect |
| `GET /api/tenants` | Current memberships only |
| `GET /api/tenants/:id/token-usage/projects` | Project names within tenant/source |
| `GET /api/tenants/:id/token-usage/series`, `/token-usage/table` | Token chart/table |
| `GET /api/tenants/:id/cost/series`, `/cost/table` | Cost chart/table |
| `GET /api/tenants/:id/members` | Safe member display information |
| `PATCH, DELETE /api/tenants/:id/members/:userId` | Authorized role change/removal/leave |
| `GET, POST /api/tenants/:id/ingestion-keys` | Metadata list / one-time raw key creation |
| `DELETE /api/tenants/:id/ingestion-keys/:keyId` | Revoke |
| `GET, POST /api/tenants/:id/invitations` | Admin-only list / create and deliver |
| `POST /api/tenants/:id/invitations/:inviteId/resend` | Rotate token and redeliver |
| `DELETE /api/tenants/:id/invitations/:inviteId` | Revoke |
| `POST /api/invitations/accept` | Redeem one-time token for verified invited email |
| `PATCH /api/tenants/:id` | Rename |
| `POST /api/tenants/:id/deletion-request` | Owner confirms tenant name; disables tenant and queues purge |

Dashboard query parameters remain `projects` (comma-separated names), `start`/`end` (ISO timestamps), `bucket=hour|day|week`, and `source=claude|codex` (omitted means both within that tenant). Successful response shapes remain `projects`, `series`, or `rows`. Old global `/api/token-usage/*` and `/api/cost/*` routes return `410`; they never aggregate globally. Errors include a stable code and request ID. Unauthenticated APIs return `401`, inaccessible tenants/objects `404`, insufficient roles `403`, validation errors `400`, conflicts `409`, request/batch limits `413`, enforced rate limits `429`, and database failures `503`.

## Telemetry exporters

Both `POST /v1/metrics` and `POST /v1/logs` accept OTLP/HTTP JSON with:

```text
Authorization: Bearer <organization-ingestion-key>
Content-Type: application/json
```

The key is an opaque `brk_` credential with 256 bits of random entropy. The database resolves its tenant and creates projects/inserts usage in one transaction. Supplied tenant IDs cannot override it. Revoked, expired, invalid, and disabled-tenant keys all fail with `401`, including empty batches. Requests are limited to 1 MiB and 5,000 normalized rows. Ingestion is at least once; retries can duplicate usage. This change does not implement event deduplication or change Claude cumulative-metric accounting.

Claude: set exporter variables in the shell, user `~/.claude/settings.json`, or managed settings; project `.claude/settings.json` cannot enable/configure telemetry.

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "https://<your-worker>.workers.dev",
    "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer <organization-ingestion-key>",
    "OTEL_METRICS_INCLUDE_REPOSITORY": "true"
  }
}
```

Project attribution prefers data-point `vcs.repository.name` (Claude CLI ≥2.1.269, URL-shaped origin, repository inclusion enabled), then resource `project.name`, `service.name`, and `default-project`. Exact metric names `claude_code.token.usage` and `claude_code.cost.usage` remain supported. Token types are read from data-point attributes. The historical Claude model simplification remains `claude-3-5-sonnet`. Optional `host.name` and `user.email` are attribution, never authorization. Allow at least the metrics export interval (default 60 seconds) before expecting new data.

Codex: configure user `~/.codex/config.toml` (literal placeholders; not environment interpolation):

```toml
[otel]
log_user_prompt = false
exporter = { otlp-http = { endpoint = "https://<your-worker>.workers.dev/v1/logs?project=my-repo", protocol = "json", headers = { "Authorization" = "Bearer <organization-ingestion-key>" } } }
```

Use a URL-encoded `project` value per repository; it selects a project only within the key's organization. Otherwise collector attributes `vcs.repository.name` / `project.name` are used, then `codex`. Codex emits usage-bearing `codex.sse_event` / `response.completed` log events, and newer versions emit `codex.turn_cost` / `usage.estimated_usd`. Both cached-read and cache-write input are subtracted from total input for disjoint categories. Reasoning output is not counted again. Costs are reported estimates and may be unavailable on older versions; no model-price estimates are invented. Invalid individual records from both sources are skipped with OTLP partial-success counts (`rejectedLogRecords` for Codex, `rejectedDataPoints` for Claude); the accepted normalized batch is inserted atomically. Other log bodies, prompts, and tool output are not stored.

## Project layout and deployment

`index.ts` routes requests; `auth.ts` handles cookies/Auth/CSRF; `tenancy.ts` handles tenant APIs; `http.ts` owns safe errors, body bounds and service helpers; `telemetry.ts` normalizes both exporters. `dashboard.ts` and `pages.ts` serve plain JavaScript-in-HTML pages. The `UIStrings` class in `ui-strings.ts` owns shared UI/email/error copy and supplies the browser catalog; reuse its existing labels and parameterized messages before adding wording. `supabase/migrations/` is immutable migration history; `scripts/` and `tests/` provide isolation checks.

Pull requests run validation without deployment. Main-branch releases validate tests/type/bundle, apply migrations, then deploy the Worker in one serialized workflow. CI refuses the original pending tenancy cutover until its staged rollout is verified and explicitly recorded as applied by an operator. See the [cutover runbook](docs/tenancy-operations.md) before merging the tenancy migration: stop legacy writers, back up/rehearse, claim historical ownership, provision Supabase Auth and runtime variables, and update exporters. A code merge is not proof that credentials, Auth/email settings, or live production behavior work. Tenant purge is operator-run and idempotent; no purge cron runs automatically.

Design contracts: [product](specs/multi-tenant-support.md), [Supabase architecture](specs/supabase-tenancy.md), [rollout acceptance gates](specs/multi-tenant-rollout.md).
