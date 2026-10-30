# Working on HercuIT Burnrate

This repository (`max`) serves a multi-tenant Claude/Codex telemetry dashboard through a Cloudflare Worker and Supabase. Read README.md, specs/multi-tenant-support.md, specs/supabase-tenancy.md, and docs/tenancy-operations.md before changing authorization or deployment.

## Repository map

- `index.ts`: request routing, bounded ingestion, safe response/error handling.
- `auth.ts`: Supabase email OTP, validated user sessions, Secure/HttpOnly cookies, refresh, CSRF, sign-out.
- `tenancy.ts`: tenant-scoped dashboard/admin APIs, invitation delivery contract.
- `http.ts`: shared validation, body limits, credential generation/hashing, database errors and distributed rate limiting.
- `telemetry.ts`: pure Claude metric / Codex log normalization. Other log bodies are not persisted.
- `ui-strings.ts`: single `UIStrings` class for all application-owned UI, email, validation and error copy. Reuse existing keys before adding new wording; use parameterized templates for dynamic values. Plain-JS pages receive its generated catalog/formatter rather than a second copy source. Never inline UI wording in templates/handlers or edit historical SQL migrations just to change copy; database domain messages resolve through this catalog.
- `dashboard.ts`, `pages.ts`: static HTML with plain browser JS inside template strings; no TypeScript/imports in the emitted scripts. Escape user-supplied text before inserting HTML.
- `supabase/migrations/`: immutable applied history, tenant schema/RLS/RPCs, narrow service operations, role/key/invitation/deletion transactions.
- `scripts/test-database.mjs`, `tests/tenancy.sql`, `tests/source-filter.sql`: PostgreSQL/RLS assertions including historical ownership and source filtering.
- `scripts/test-dashboard.mjs`: execute real page scripts in a DOM.
- `scripts/test-postgres.mjs`, `scripts/test-auth-live.mjs`: optional disposable local service integration tests.

## Authorization rules

1. Auth identifies a user; current database memberships authorize a tenant. Never derive tenant access from telemetry email/host/project, user-editable metadata, or a browser-selected tenant UUID.
2. Human requests use a fresh user-scoped Supabase client with their validated JWT and publishable key. Never fall back to service role on denied/empty/failed reads. Every dashboard RPC requires a tenant ID and uses invoker RLS. No global aggregate routes or legacy overloads may be restored.
3. Exporters use opaque tenant keys. Only the service-role ingestion RPC may resolve a hash to a tenant and create projects/usage. Payload tenant IDs/foreign project IDs are not authoritative. Empty batches still authenticate. Never expose hash or plaintext after the one-time key creation response.
4. Membership mutations, key revocations, invitation acceptance and deletion serialize on tenant rows before child locks. Preserve last-owner checks, including Auth-user deletion. Removing membership takes effect immediately with a still-valid JWT.
5. Private credential/invitation/audit tables are not exposed through PostgREST. Definer functions use fixed safe search paths, qualified relations, explicit grants, and current `auth.uid()`. Authenticated clients have read-only RLS access to safe public data and mutation rights only through checked RPCs.
6. CSRF tokens plus exact Origin checking protect all cookie-authenticated mutations. No wildcard credentialed CORS. Never remove Secure/HttpOnly cookies to make a production request work. All tenant/session/key responses are no-store.
7. Never print/log service keys, bearer/session/invitation tokens, hashes, raw OTLP bodies, prompts, or arbitrary provider errors. Log request IDs and safe failure categories. All exceptions reaching the user need specific actionable errors; catch failures in the responsible flow, not by silently swallowing them.

## Telemetry semantics

Claude metrics match exact names `claude_code.token.usage` / `claude_code.cost.usage`. Token type comes from each data point (`input`, `output`, `cacheRead`, `cacheCreation`), never a metric-name substring. Project attribution prefers data-point `vcs.repository.name`, then resource `project.name`, `service.name`, and the default. Claude's existing `claude-3-5-sonnet` model simplification is unchanged. Host/email are optional attribution only.

Codex uses usage-bearing `codex.sse_event` / `response.completed` logs plus reported `codex.turn_cost` estimates. Generic/failed completion notices are ignored. Read OTLP string/int/double AnyValues. Both cached-read and cache-write input are subtracted for disjoint categories; reasoning is already included in output. Invalid records count toward OTLP partial success; insert the accepted normalized records atomically. Do not invent dollars for versions without cost events. Do not double ingest usage from an additional translated metric stream.

Source filters are independent per tab, while project names are tenant-scoped. Preserve source and date preferences during tenant switches but immediately clear old data/projects and invalidate/abort old requests. Keep unavailable selected project names to preserve an empty source/project intersection. Token defaults are seven days; cost defaults are all time. Session counts distinguish `(source,session_id)` within a tenant.

Claude exporter settings must be set in the shell, user settings, or managed settings; project `.claude/settings.json` cannot enable/configure telemetry. Repository attribution needs CLI ≥2.1.269, `OTEL_METRICS_INCLUDE_REPOSITORY=true`, and a URL-shaped Git origin. Export flushes periodically, usually every 60 seconds. Codex uses user `[otel]` JSON log exporter configuration; `?project=` names a project only within the key's tenant.

## Secrets and variables reference

Add every new runtime/test/client environment variable to this inventory. Never include values.

| Worker name | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase API origin |
| `SUPABASE_PUBLISHABLE_KEY` | Non-secret key for Auth/user-scoped requests |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only ingestion, rate-limit and operator credential; never dashboard reads |
| `APP_ORIGIN` | Exact canonical HTTPS origin for CSRF and invitation links |
| `INVITATION_DELIVERY_URL` | Optional HTTPS mail integration accepting `{to,subject,text}` |
| `INVITATION_DELIVERY_TOKEN` | Optional secret bearer credential for delivery integration |

`DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD`, and `INGEST_SECRET_TOKEN` are retired and must not authorize any route in the normal `index.ts` release. The separate `compatibility.ts` entry point is only for the [online rollout](docs/organizations-online.md): its legacy bearer requires a one-time database registration scoped to the historical tenant, expires within seven days, and is revoked before retiring that build. It never supports Basic Auth.

| Supabase Edge Function secret | Purpose |
| --- | --- |
| `INVITATION_DELIVERY_TOKEN` | Shared server-to-server bearer token; must match the Worker secret |
| `RESEND_API_KEY` | Resend sending credential, restricted to the verified sending domain where possible |
| `INVITATION_FROM_EMAIL` | Sender address on a Resend-verified domain; optionally includes a display name |

These are set on Supabase, not as additional Worker bindings. Never log email payloads or provider errors.

| Operator and optional test variable | Purpose |
| --- | --- |
| `TENANCY_DATABASE_URL` | Operator-only database credential for online/maintenance rollout, provenance backfill and full organization export; never a Worker binding, never log or commit |
| `LEGACY_INGEST_TOKEN` | Operator-only existing exporter secret for one-time online bridge registration; never a Worker binding, log, command argument, or committed value; unset after registration |
| `TEST_DATABASE_URL` | Fresh disposable PostgreSQL connection string for `test:postgres`; local-only, never a Worker binding; do not log or commit |
| `TEST_AUTH_URL` | Loopback-only disposable GoTrue origin for `test:auth-live`; defaults to port 55433 |
| `TEST_AUTH_JWT_SECRET` | Synthetic local Auth-container JWT signing secret for `test:auth-live`; never a production binding |

| GitHub Actions secret | Purpose |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI authentication |
| `SUPABASE_PROJECT_ID` | Supabase project ref for migration link |
| `SUPABASE_DB_PASSWORD` | Migration database access |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Worker deployment |

| Telemetry client name (outside this Worker) | Purpose |
| --- | --- |
| `CLAUDE_CODE_ENABLE_TELEMETRY` | Enable Claude telemetry |
| `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER` | Exporters (`otlp`, or `none` for opt-out) |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | Claude uses `http/json` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Worker base origin |
| `OTEL_EXPORTER_OTLP_HEADERS` | Tenant bearer header, never commit a real value |
| `OTEL_METRICS_INCLUDE_REPOSITORY` | Include repository attribution |
| `OTEL_METRIC_EXPORT_INTERVAL` | Export flush interval, default 60000 ms |
| `OTEL_RESOURCE_ATTRIBUTES` | Optional literal host/user attribution |
| `OTEL_METRICS_INCLUDE_RESOURCE_ATTRIBUTES` | Attach resource attributes |

## Development and verification

Use the existing checkout in this isolated task; do not create worktrees unless requested. Node 24/npm 11 and `npm ci` reproduce dependencies. Application code targets workerd, not Node built-ins. New migrations append history; never edit an applied migration or weaken verification to install dependencies.

Run `npm test`, `npm run test:database`, `npm run test:dashboard`, `npx tsc --noEmit`, and `npx wrangler deploy --dry-run`. Coverage includes backend modules with a 90% floor; static HTML scripts have separate DOM tests. Mocked Supabase tests cannot prove RLS. Use the PostgreSQL suite for actual concurrent lock behavior and the optional Auth suite for OTP/refresh assumptions. Do not claim live email delivery or production validation from mocks.

When fixing a bug: identify the precise symptom, examine parser/server/UI/Auth/database/CI cause categories, trace the actual root cause, check every affected path, and add positive/negative/edge regressions for each. Preserve existing telemetry behavior while closing authorization gaps. Do not stop at the first passing symptom check.

CI validates, applies migrations, then deploys through one serialized workflow. A pending tenancy cutover requires the separately approved online stages in docs/organizations-online.md or an intentional maintenance cutover; automatic execution is refused. Historical data remains unclaimed until an operator assigns a verified owner. Do not deploy old global-auth code once multiple tenants exist. Provenance is classified at the database boundary; never report hardcoded Claude labels as verified models. Full organization exports are operator-assisted and model-aware; purge requires the seven-day recovery window. Do not perform production migration, publication, email sends or deletion merely to test a local change.
