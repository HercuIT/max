# Spec: Token Usage Dashboard

## Purpose

Give a tenant-scoped, per-project view of Claude Code and Codex token consumption over time, branded as HercuIT Burnrate, so usage trends and spikes are visible without querying Supabase directly.

## Data source

`public.token_usage_logs`, accessed only through the existing authenticated tenant APIs and their RLS-protected RPCs (see the initial schema and subsequent tenancy/source migrations). No API response shapes, authentication, or SQL functions change in this restyle.

| column | type | notes |
|---|---|---|
| `project_name` | text | grouping key |
| `session_id` | text | |
| `model` | text | Claude retains the historical placeholder; Codex reports its model |
| `input_tokens` | bigint | |
| `output_tokens` | bigint | |
| `cache_read_tokens` | bigint | |
| `cache_write_tokens` | bigint | |
| `recorded_at` | timestamptz | event time, indexed (`idx_token_usage_logs_recorded_at`) |

Project filtering uses the indexed `project_name` column (`idx_token_usage_logs_project_name`).
Session identity distinguishes `(source, session_id)` within a tenant. Preserve the existing per-project session counts; summing project counts for a KPI must be labeled as project sessions because sessions spanning projects cannot be deduplicated from these responses.

## Graph

- **Type:** stacked bar time series, preserving the current chart type.
- **X-axis:** time, bucketed by day (default) with a toggle for hour/week when the selected range is short/long.
- **Y-axis:** token count.
- **Series:** `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens` — one series per column, stacked.
- **Grouping:** one chart summed across the selected projects, with an all-projects default. Selecting a project scopes the same chart and table.
- **Legend:** keyboard-usable controls toggle the four series; tooltips show readable timestamps and formatted values. Input is `#FF6A1F`, output `#FFB627`, cache read `#3B82F6`, and cache creation (the existing `cache_write_tokens` field) `#8B93A1` in both themes.
- **Aggregation query shape:** `SUM(column) GROUP BY date_trunc(bucket, recorded_at)` filtered by `project_name IN (...)` and `recorded_at BETWEEN start AND end`.

## Table

Per-project summary rows below/beside the graph, for the same filtered range:

| column | source |
|---|---|
| Project | `project_name` |
| Input tokens | `SUM(input_tokens)` |
| Output tokens | `SUM(output_tokens)` |
| Cache read tokens | `SUM(cache_read_tokens)` |
| Cache write tokens | `SUM(cache_write_tokens)` |
| Total tokens | sum of the four columns above |
| Sessions | `COUNT(DISTINCT session_id)` |
| Last active | `MAX(recorded_at)` |

- Sortable by any column, default sort: Total tokens descending.
- Row click or a keyboard-usable project control scopes the entire dashboard to that project.
- Add a share-of-total bar per project, using the total for the active dashboard filters before table-only column filters. Keep existing text, numeric-range, and last-active column filters and their clear action.
- Right-align numeric cells in JetBrains Mono with tabular numbers. Sorting has keyboard controls and `aria-sort`; the table header sticks within its scroll container.

## Filters

- **Project:** multi-select, default = all projects.
- **Date range:** default last 7 days; presets (24h / 7d / 30d / custom).
- **Bucket:** hour/day/week, default day.
- **Source:** preserve All sources / Claude / Codex and independent source/date preferences for Token Usage and Cost tabs. Cost still defaults to all time and can return to all time after choosing a preset.
- **Refresh:** changing a valid project, source, date, preset, or bucket refreshes all data for the active tab, including KPIs. Retain Apply as an explicit refresh action. Reject invalid or reversed ranges with an actionable message before requesting data.
- **Active filters:** show the current project selection, source, date range, and bucket together in a concise summary; table-only column filters remain local to the table.
- **Tenant isolation:** preserve the organization chooser, settings link, sign-out, remembered tenant, and immediate clearing/aborting/invalidation of old tenant data. Preserve selected project names absent from a source so an empty intersection never becomes all projects.
- **Model:** hidden for this restyle; no new model filtering or model semantics.

## Layout and KPIs

- Header: theme-appropriate inline Burnrate logo, organization/navigation controls, manual theme toggle, and last successful update time. Failed or stale responses never advance this timestamp.
- Sticky filter bar below the header; wrap controls on phones without covering the content or keyboard focus.
- KPI row above the chart: total tokens, reported cost when available, project sessions, and token change versus the immediately preceding equal-duration period. Use large compact mono values (for example, `1.2M`) with exact values available accessibly.
- Obtain KPIs from the existing tenant token/cost table endpoints using matching projects, source, and range. For bounded ranges, request the preceding token table with the same filters and duration; calculate `(current - previous) / previous`. A zero baseline shows no percentage (or no change when both totals are zero); all-time/unbounded ranges show comparison unavailable.
- Never invent model-price cost estimates. Existing responses cannot distinguish a true zero cost from missing cost telemetry; when no positive reported cost is present, show an unavailable/zero-reported explanation rather than asserting complete cost coverage. Preserve the Codex cost availability notice.
- Main chart spans the content width, followed by the project table. Keep the Cost tab's by-project bar chart, cumulative trend toggle, sortable table, and column filters working with the same shared theme and responsive layout.

## Brand and theme

Define these CSS custom properties on `:root`, with dark as the fallback, light through `prefers-color-scheme`, and an explicit saved choice taking precedence. Read/write the theme preference in `localStorage` only inside `try/catch`; storage failures must not break the page. Follow system changes when there is no saved manual choice.

| Token | Dark | Light |
|---|---|---|
| `surface-100` (page) | `#0B0C10` | `#FAF8F5` |
| `surface-200` (card) | `#15171D` | `#FFFFFF` |
| `surface-300` (hover) | `#1F222A` | `#F1EDE7` |
| `border` | `#2A2E38` | `#E3DED6` |
| `border-strong` | `#5A6070` | `#8C8478` |
| `ink` | `#F3F1EE` | `#111318` |
| `muted` | `#9BA1AD` | `#5B606B` |
| `brand-text` | `#FF8A4C` | `#C2410C` |
| `action` | `#FF6A1F` | `#C2410C` |
| `on-action` | `#111318` | `#FFFFFF` |
| `success` | `#4ADE80` | `#15803D` |
| `danger` | `#F87171` | `#B91C1C` |

- Google Fonts: Space Grotesk headings, Inter body/UI, JetBrains Mono with tabular numbers for figures, table numbers, and chart ticks. Supply usable fallback fonts.
- Use a 4px spacing grid, 6px input/chip radius, 10px card/button radius, and 1px card borders without shadows. Ember/amber are fills only; orange text uses `brand-text`.
- Pin Chart.js to an exact CDN version (the existing `4.4.1` is already pinned). Theme changes update both charts' text, ticks, grids, legends, and tooltips while preserving the fixed token-series colors and visibility choices.
- Asset inventory: this checkout has no `brand/` directory. Existing assets are embedded in `brand.ts`, `assets.ts`, and the dashboard's inline light SVG. Reuse these supplied assets, extracting the inline logo into a shared constant if useful; do not substitute invented branding. If original `brand/` files are supplied, use those instead.
- `/favicon.ico`, `/favicon.svg`, and `/apple-touch-icon.png` already have public routes in `index.ts` backed by `assets.ts`, and head links already exist. Preserve these and the existing PNG sizes; verify/add route tests for status, MIME type, bytes, caching, and unauthenticated access.

## States, responsiveness, and accessibility

- Skeletons indicate loading across KPIs/chart/table with an accessible busy/live status. Scope all responses and failure states to the current request version and tenant; never show stale data as current.
- Empty: "No data in this range" with guidance to check `OTEL_METRIC_EXPORT_INTERVAL` (usually 60000 ms) and `OTEL_METRICS_INCLUDE_REPOSITORY=true` for Claude repository attribution, and to check the range/source/projects. Keep Codex guidance source-appropriate.
- API failure: actionable error and Retry button using the current filters. Handle optional comparison/cost failures explicitly without fabricating zero values or losing successfully fetched primary data.
- Support 360px phones through wide monitors without horizontal page scrolling; the table scrolls inside its card on small screens.
- Text contrast at least 4.5:1 in both themes, visible focus rings, explicit labels on every control (including table filter inputs), and keyboard-usable project filtering, sorting, and chart legends. Respect reduced-motion preferences.
- Application-owned copy remains in `UIStrings`. Escape project names before HTML insertion or use `textContent`/DOM creation.

## Non-functional

- Read-only; no write path needed.
- Use existing `/api/tenants/:id/token-usage/{projects,series,table}` and `/api/tenants/:id/cost/{series,table}` calls. Keep `projects`, `start`, `end`, `bucket`, and `source` semantics and existing response shapes. Do not restore retired global API routes.
- Access: authenticated current tenant members only, with existing auth and authorization unchanged.
- `dashboard.ts` remains a self-contained HTML/CSS/plain-JavaScript template with no framework or new build step.

## Verification and delivery

- Run `npm test` with the existing 90% coverage floor, `npm run test:database`, `npm run test:dashboard`, `npx tsc --noEmit`, and `npx wrangler deploy --dry-run`.
- Run `npx wrangler dev`, capture and inspect dark/light screenshots at 1440px and 390px, and fix layout issues. Also check the 360px overflow boundary. If browser validation uses synthetic authenticated API fixtures, disclose that; do not weaken production authentication for screenshots.
- Report layout changes, screenshots, spec deviations, and any checks that could not be completed. Do not commit or deploy without user approval.

## Out of scope

- Per-session drill-down (list of individual requests within a session).
- Alerting on usage spikes.
- Fixing the hardcoded `model` field in `index.ts` (tracked separately).
