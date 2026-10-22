# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

`max` is a small Cloudflare Worker (`claude-code-telemetry-ingest`) that ingests Claude Code's OTLP telemetry export (metrics + logs) and writes token usage/cost rows into Supabase. See `README.md` for the full description, endpoints, and setup/deploy steps.

## Key files

- `index.ts` — the Worker: routes requests to `handleIngest` (`/v1/metrics`, `/v1/logs`) or the dashboard/API handlers (`/dashboard/token-usage`, `/api/token-usage/*`).
- `dashboard.ts` — the token usage dashboard page as a single exported HTML string (`tokenUsageDashboardHtml`), served as-is by `index.ts`. Chart.js is loaded from cdnjs; there's no bundler step for this file, so keep it plain JS inside the template string (no TS syntax, no imports).
- `specs/` — dashboard specs (e.g. `token-usage-dashboard.md`) written before implementation. Check here first before changing dashboard behavior — it's the intended design, not just a description of what exists.
- `supabase/migrations/` — imperative migration history: `projects`, `token_usage_logs`, `project_spend_summary` view, and `get_token_usage_projects`/`get_token_usage_series`/`get_token_usage_table` (the dashboard's read functions). This is the source of truth for the DB shape; if `index.ts` inserts or queries a field, it should exist here. Don't hand-edit old migration files — add a new one with `supabase migration new <name>`.
- `.github/workflows/deploy-migrations.yml` — CI job that runs `supabase link` + `supabase db push` on pushes to `main` that touch `supabase/migrations/**`. Needs `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD` as repo secrets.
- `wrangler.toml` — Worker name/entry/compatibility date only. Secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INGEST_SECRET_TOKEN`, `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD`) are configured via `wrangler secret put`, not in this file.

## Working in this repo

- This is TypeScript targeting the Cloudflare Workers runtime (`@cloudflare/workers-types`), not Node — don't assume Node built-ins are available in `index.ts`. `tsconfig.json` uses `moduleResolution: bundler` (TS 7 removed the old `node` alias).
- `handleIngest` in `index.ts` hardcodes `model: 'claude-3-5-sonnet'` on every inserted row regardless of the actual model in the payload — be aware of this when touching the metric-parsing loop or the dashboard's per-model breakdowns (currently out of scope for the same reason), it's a known simplification, not a typo to silently "fix" without checking intent.
- The metric parser in `handleIngest` infers `input`/`output`/`cost` fields by substring-matching on `metric.name`. If you add new metric kinds, follow the same pattern rather than introducing a different dispatch mechanism.
- Ingest auth is a single static bearer token compared with `===` (`INGEST_SECRET_TOKEN`, checked in `handleIngest`). Keep this simple unless asked to change the auth model.
- Dashboard/API auth is HTTP Basic (`isDashboardAuthorized` in `index.ts`), separate from the ingest token, checked against `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`. It's deliberately a different credential — the ingest token is meant for the OTLP exporter, not for humans typing a password into a browser prompt.
- The `get_token_usage_*` Postgres functions have `EXECUTE` revoked from `anon`/`authenticated` and granted only to `service_role` (see the migration). This data isn't scoped by RLS/ownership, so if `anon`/`authenticated` could call them, anyone with the public anon key could read every project's usage. Keep that revoke/grant pattern for any new dashboard RPC.

## Secrets — handle with care

- `.claude/settings.json` in this repo currently has `OTEL_EXPORTER_OTLP_HEADERS` wired to a live bearer token for the deployed worker. **Never commit a real secret value here.** If you edit this file, flag to the user whether the token is a placeholder or a real credential before staging/committing it.
- Never print or log `SUPABASE_SERVICE_ROLE_KEY`, `INGEST_SECRET_TOKEN`, or `DASHBOARD_PASSWORD` values.

## Testing / running

- There is no real test suite yet (`npm test` is a stub that exits 1). Don't assume test coverage exists.
- `npx tsc --noEmit` type-checks; `npx wrangler deploy --dry-run` bundles without deploying — run both after touching `index.ts` or `dashboard.ts`.
- To exercise the worker locally: `npx wrangler dev`, then `curl` the `/v1/metrics` or `/v1/logs` endpoints with a Bearer token matching your local `INGEST_SECRET_TOKEN`, or open `/dashboard/token-usage` in a browser with `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` for Basic Auth. The dashboard needs a real Supabase connection (local or remote) with the `get_token_usage_*` functions migrated in, since there's no mock data path.
