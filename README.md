# HercuIT Burnrate

A Cloudflare Worker (`claude-code-telemetry-ingest`) that receives Claude Code's OpenTelemetry (OTLP) metrics/logs export and writes token usage and cost data into Supabase. This repo's directory is still named `max`.

## What it does

Claude Code can export usage telemetry (tokens, cost, sessions) via OTLP. This worker exposes two endpoints for that exporter and persists metric data points into a Supabase Postgres table for later querying/reporting.

## Endpoint

- `POST /v1/metrics` — accepts an OTLP metrics payload and inserts rows into `token_usage_logs`. Matches on the exact metric name (`claude_code.token.usage`, `claude_code.cost.usage`); for token usage, reads the `type` attribute (`input`/`output`/`cacheRead`/`cacheCreation`) off each data point rather than off the metric name, since Claude Code doesn't send a separate metric name per token type. Every inserted row currently hardcodes `model` to `'claude-3-5-sonnet'` regardless of the model actually used — a known simplification, not yet wired up to real model data.
- `POST /v1/logs` — accepts an OTLP logs payload and acknowledges it (not persisted).

Both endpoints require:
```
Authorization: Bearer <INGEST_SECRET_TOKEN>
```
Requests that aren't `POST`, aren't JSON, or don't match a known path return `405`/`404`/`401` as appropriate.

- `GET /dashboard/token-usage` — serves the token usage dashboard page (HTML). Requires HTTP Basic Auth (`DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`).
- `GET /api/token-usage/projects` — distinct project names. Basic Auth required.
- `GET /api/token-usage/series?projects=a,b&start=<ISO>&end=<ISO>&bucket=hour|day|week` — time-bucketed token sums (summed across the selected projects, or all projects if omitted). Basic Auth required.
- `GET /api/token-usage/table?projects=a,b&start=<ISO>&end=<ISO>` — per-project token/session summary for the range. Basic Auth required.
- `GET /api/cost/table?projects=a,b&start=<ISO>&end=<ISO>` — per-project cost/token summary for the range (all-time if `start`/`end` are omitted). Basic Auth required.
- `GET /api/cost/series?projects=a,b&start=<ISO>&end=<ISO>&bucket=hour|day|week` — per-project cost time series (per-bucket and cumulative), backing the Cost (USD) tab's trend view. Basic Auth required.
- `GET /favicon.ico`, `/favicon.svg`, `/favicon-{16,32,192,512}.png`, `/apple-touch-icon.png` — static brand assets (see `specs/branding-theme.md`). Unauthenticated, like any site's favicon.

See `specs/token-usage-dashboard.md` and `specs/usd-per-project-dashboard.md` for the full specs these implement.

## Project layout

- `index.ts` — Worker entrypoint: routing, ingest auth/parsing, dashboard Basic Auth, dashboard API handlers.
- `dashboard.ts` — static HTML/CSS/JS for the token usage dashboard page (Chart.js via CDN), served by `index.ts`.
- `specs/` — dashboard specs (e.g. `token-usage-dashboard.md`) written before implementation. Check here first before changing dashboard behavior — it's the intended design, not just a description of what exists.
- `supabase/migrations/` — Supabase schema migrations: `projects`, `token_usage_logs`, `project_spend_summary` view (access-controlled but unused by any code path), the `get_token_usage_*` functions backing the token-usage tab, and `get_cost_table`/`get_cost_series` backing the Cost (USD) tab (all service_role-only — EXECUTE is revoked from `anon`/`authenticated`).
- `index.test.ts` / `vitest.config.ts` — unit tests for `index.ts` (ingest parsing/auth, dashboard API routing) and their coverage config.
- `assets.ts` — base64-encoded favicon files served at `/favicon.*`, `/favicon-*.png`, `/apple-touch-icon.png` (see `specs/branding-theme.md`).
- `wrangler.toml` — Cloudflare Worker config (name: `claude-code-telemetry-ingest`).
- `.github/workflows/deploy-migrations.yml` — pushes pending migrations in `supabase/migrations/` to the linked Supabase project whenever they change on `main`.
- `.github/workflows/deploy-worker.yml` — runs `wrangler deploy` whenever `index.ts`, `dashboard.ts`, `wrangler.toml`, or the lockfile change on `main` (or on manual dispatch). This is what actually puts Worker code changes live — committing them alone does not deploy.

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Apply migrations to your Supabase project:
   ```
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```
   (or let CI do it — see "CI: migration deploys" below.)
3. Configure Worker secrets (do **not** put these in `wrangler.toml` or commit them):
   ```
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   npx wrangler secret put INGEST_SECRET_TOKEN
   npx wrangler secret put DASHBOARD_USERNAME
   npx wrangler secret put DASHBOARD_PASSWORD
   ```
4. Deploy:
   ```
   npx wrangler deploy
   ```

## Pointing Claude Code at it

**A project's `.claude/settings.json` cannot be used for this.** Claude Code only lets project-level settings files *disable* telemetry (e.g. setting `OTEL_METRICS_EXPORTER` to `none`) — `CLAUDE_CODE_ENABLE_TELEMETRY`, `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER`, `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_EXPORTER_OTLP_ENDPOINT`, and `OTEL_EXPORTER_OTLP_HEADERS` are silently ignored if set there (run `/status` in Claude Code to see this confirmed under "System diagnostics"). These vars only take effect in one of:

- your **shell environment** (exported before launching `claude`), or
- your **user settings** (`~/.claude/settings.json`), or
- **managed settings**.

Since telemetry applies per-process, setting this in your user settings is normally what you want — it then covers every project you work in on that machine, not just one:
```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "https://<your-worker>.workers.dev",
    "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer <INGEST_SECRET_TOKEN>",
    "OTEL_METRICS_INCLUDE_REPOSITORY": "true"
  }
}
```

If you only want a specific other project to opt out of reporting here, set `OTEL_METRICS_EXPORTER`/`OTEL_LOGS_EXPORTER` to `"none"` in *that* project's own `.claude/settings.json` — that's the one thing project-level settings are allowed to do.

**Never commit a real token in this file.** Keep secrets out of version control — use a local, gitignored settings file or a secrets manager instead.

### Getting per-project data on the dashboard

`index.ts` resolves each row's project name from `vcs.repository.name` (falling back to the `project.name` resource attribute, then `service.name`, then `'default-project'`). Note that `vcs.repository.name` is a **data-point** attribute, not a resource attribute like the other two — it's only sent when:

- The Claude Code CLI is v2.1.269 or later, **and**
- `OTEL_METRICS_INCLUDE_REPOSITORY=true` is set (default `false`), **and**
- The session's working directory is a git repository with a URL-shaped `origin` remote (it's omitted if there's no `origin` remote, the remote isn't URL-shaped, or the only enclosing repo is your home directory).

`project.name` reflects the session's custom name (set via `/rename`) if one was given — it is *not* derived from the repo or folder. A session with no custom name, and no working `vcs.repository.name`, falls through to the fixed literal `service.name` value `claude-code`, which is why several unrelated sessions can appear to pile up under one generic bucket.

So your user settings (or shell env/managed settings — see above, **not** a project's `.claude/settings.json`) need both the OTLP exporter env vars above **and** `"OTEL_METRICS_INCLUDE_REPOSITORY": "true"` for a project to show up as itself rather than collapsing into `default-project`.

Also note: the metrics exporter flushes periodically, not instantly — the interval is `OTEL_METRIC_EXPORT_INTERVAL` (default `60000`ms). Give it at least one interval before concluding ingestion is broken.

### Dashboard tabs

`/dashboard/token-usage` has two tabs sharing one filter bar: **Token Usage** (default, last 7 days) and **Cost (USD)** (defaults to all-time — clearing the date range switches back to all-time; the project multi-select is shared between both tabs). Each tab remembers its own date range independently, so switching tabs doesn't clobber the other tab's custom range. See `specs/usd-per-project-dashboard.md`.

## CI: migration deploys

`.github/workflows/deploy-migrations.yml` runs `supabase db push` against the linked project whenever a push to `main` touches `supabase/migrations/**` (or is triggered manually). It requires these repo secrets:

- `SUPABASE_ACCESS_TOKEN` — a scoped personal access token (read access to Project Settings/API Keys is enough; needed for `supabase link`).
- `SUPABASE_PROJECT_ID` — the target project's ref.
- `SUPABASE_DB_PASSWORD` — the target project's database password.

To add a new migration locally:
```
npx supabase migration new <name>
# edit the generated supabase/migrations/<timestamp>_<name>.sql
```
Commit the generated file — CI applies whatever is new in `supabase/migrations/` on merge to `main`.

## CI: deploying the Worker

`.github/workflows/deploy-worker.yml` runs `wrangler deploy` on pushes to `main` that touch `index.ts`, `dashboard.ts`, `wrangler.toml`, or `package-lock.json` (or on manual dispatch). It requires:

- `CLOUDFLARE_API_TOKEN` — a token with permission to deploy this Worker.
- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID.

(Same two secrets as `set-dashboard-credentials.yml`, if you've already added those.) Without this workflow having run at least once, code changes to `index.ts`/`dashboard.ts` only exist in the repo — the live Worker keeps serving whatever was last deployed.

## Testing

```
npm test
```

Runs the `index.ts` unit suite (`index.test.ts`) with `vitest` + `@cloudflare/vitest-plugin` (handlers execute in a real `workerd` isolate) and Istanbul coverage, enforcing a 90% floor on statements/branches/functions/lines. `@supabase/supabase-js` is mocked, so no real network calls or secrets are needed to run it. `dashboard.ts` is excluded from the coverage run — it's a plain-JS-in-a-template-string HTML page with no bundler and no Workers-side logic to unit test (see `CLAUDE.md`).

After touching `index.ts` or `dashboard.ts`, also run:
```
npx tsc --noEmit          # type-check
npx wrangler deploy --dry-run   # bundles without deploying
```

## Local development

```
npx wrangler dev
```

This needs the same secrets as production (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INGEST_SECRET_TOKEN`, `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD`) available locally — e.g. via `.dev.vars` (gitignored) — and a real Supabase connection with the `get_token_usage_*` functions migrated in; there's no mock data path for manual local testing (the automated test suite above mocks Supabase instead).

With `wrangler dev` running:
```
curl -X POST http://localhost:8787/v1/metrics \
  -H "Authorization: Bearer <INGEST_SECRET_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"resourceMetrics": []}'

curl -X POST http://localhost:8787/v1/logs \
  -H "Authorization: Bearer <INGEST_SECRET_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{}'
```
Or open `http://localhost:8787/dashboard/token-usage` in a browser and enter `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` at the Basic Auth prompt.

## CI: setting dashboard credentials

`.github/workflows/set-dashboard-credentials.yml` is manual-only (`workflow_dispatch`) — it pushes `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` to the Worker via `wrangler secret put`, reading the values from GitHub Actions secrets so they never appear in the workflow file or logs. It requires these repo secrets:

- `CLOUDFLARE_API_TOKEN` — a token with permission to edit secrets for this Worker.
- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID.
- `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` — the credentials to push. There is no default; both must be set before running the workflow.

Run it from the Actions tab whenever you need to set or rotate the dashboard's Basic Auth credentials.
