# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

`max` is a small Cloudflare Worker (`claude-code-telemetry-ingest`) that ingests Claude Code's OTLP telemetry export (metrics + logs) and writes token usage/cost rows into Supabase. See `README.md` for the full description, endpoints, and setup/deploy steps.

## Key files

- `index.ts` — the entire Worker (routing, auth, OTLP parsing, Supabase insert). This is currently the only source file.
- `schema.sql` — Supabase schema (`projects`, `token_usage_logs`, `project_spend_summary` view). Treat this as the source of truth for the DB shape; if `index.ts` inserts a field, it should exist here.
- `wrangler.toml` — Worker name/entry/compatibility date only. Secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INGEST_SECRET_TOKEN`) are configured via `wrangler secret put`, not in this file.

## Working in this repo

- This is TypeScript targeting the Cloudflare Workers runtime (`@cloudflare/workers-types`), not Node — don't assume Node built-ins are available in `index.ts`.
- `index.ts:55` hardcodes `model: 'claude-3-5-sonnet'` on every inserted row regardless of the actual model in the payload — be aware of this when touching the metric-parsing loop, it's a known simplification, not a typo to silently "fix" without checking intent.
- The metric parser (`index.ts:42-63`) infers `input`/`output`/`cost` fields by substring-matching on `metric.name`. If you add new metric kinds, follow the same pattern rather than introducing a different dispatch mechanism.
- Auth is a single static bearer token compared with `===` (`index.ts:22`). Keep this simple unless asked to change the auth model.

## Secrets — handle with care

- `.claude/settings.json` in this repo currently has `OTEL_EXPORTER_OTLP_HEADERS` wired to a live bearer token for the deployed worker. **Never commit a real secret value here.** If you edit this file, flag to the user whether the token is a placeholder or a real credential before staging/committing it.
- Never print or log `SUPABASE_SERVICE_ROLE_KEY` or `INGEST_SECRET_TOKEN` values.

## Testing / running

- There is no real test suite yet (`npm test` is a stub that exits 1). Don't assume test coverage exists.
- To exercise the worker locally: `npx wrangler dev`, then `curl` the `/v1/metrics` or `/v1/logs` endpoints with a Bearer token matching your local `INGEST_SECRET_TOKEN`.
