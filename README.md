# max — Claude Code Telemetry Ingest

A Cloudflare Worker that receives Claude Code's OpenTelemetry (OTLP) metrics/logs export and writes token usage and cost data into Supabase.

## What it does

Claude Code can export usage telemetry (tokens, cost, sessions) via OTLP. This worker exposes two endpoints for that exporter and persists metric data points into a Supabase Postgres table for later querying/reporting.

## Endpoints

- `POST /v1/metrics` — accepts an OTLP metrics payload, extracts token/cost data points, and inserts rows into `token_usage_logs`.
- `POST /v1/logs` — accepts an OTLP logs payload and acknowledges it (not persisted).

Both endpoints require:
```
Authorization: Bearer <INGEST_SECRET_TOKEN>
```
Requests that aren't `POST`, aren't JSON, or don't match a known path return `405`/`404`/`401` as appropriate.

## Project layout

- `index.ts` — Worker entrypoint: auth check, OTLP payload parsing, Supabase insert.
- `supabase/migrations/` — Supabase schema migrations: `projects`, `token_usage_logs`, and a `project_spend_summary` view (per-project token/cost rollups).
- `wrangler.toml` — Cloudflare Worker config (name: `claude-code-telemetry-ingest`).
- `.github/workflows/deploy-migrations.yml` — pushes pending migrations in `supabase/migrations/` to the linked Supabase project whenever they change on `main`.

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
   ```
4. Deploy:
   ```
   npx wrangler deploy
   ```

## Pointing Claude Code at it

In Claude Code's settings (e.g. `.claude/settings.json`), configure the OTLP exporter env vars to point at your deployed worker, using the same token as `INGEST_SECRET_TOKEN`:
```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "https://<your-worker>.workers.dev",
    "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer <INGEST_SECRET_TOKEN>"
  }
}
```

**Never commit a real token in this file.** Keep secrets out of version control — use a local, gitignored settings file or a secrets manager instead.

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
