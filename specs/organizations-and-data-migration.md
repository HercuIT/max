# Spec: Organizations and Existing Data Migration

Status: implementation authorized in chat; local code and verification are in progress. Operational instructions are in [online rollout](../docs/organizations-online.md). No production migration, deployment, credential change, or purge is authorized by this document alone.

## Purpose

Turn Burnrate into a shared-table SaaS while preserving every existing usage row. Assign historical data to one explicitly approved organization, provision organization-owned ingestion credentials, and authorize dashboard access through current user memberships.

Recommendation: retain the repository's existing tenant architecture, add an online compatibility phase for databases still on the legacy schema, and record model provenance without rewriting historical measurements. An organization is a tenant; keep the implemented SQL name `tenant_id` as the physical `organization_id`. Do not introduce a second ownership column or duplicate organization tables.

Companion contracts: [product and roles](multi-tenant-support.md), [Supabase architecture](supabase-tenancy.md), [rollout tests](multi-tenant-rollout.md), and [current operations](../docs/tenancy-operations.md). This proposal changes the proposed rollout and historical-model treatment; those documents and the deployment guards must be reconciled in a later approved implementation.

## Repository findings and differences from the request

The checked-out code is already substantially beyond the single-tenant baseline. These are repository facts, not evidence that production has been upgraded:

| Requested baseline | Observed code or migration history | Design consequence |
| --- | --- | --- |
| Shared ingest token and dashboard Basic Auth | `index.ts`, `auth.ts`, and `tenancy.ts` already use tenant keys, Supabase Auth, scoped APIs, and user JWT database clients; README/CLAUDE retire the old secrets | Preserve these paths; a legacy-token bridge is a proposed temporary addition only for a still-legacy production rollout |
| Organization tables not present | `20261028210000_multi_tenancy.sql` creates `tenants`, `tenant_memberships`, private keys/invitations/audit/deletion jobs, tenant/project links, RLS, and RPCs | Inspect deployed migration state before choosing a path; never replay tenancy on an upgraded database |
| Functions executable only by service role | Earlier migrations do that; the tenancy migration grants the five scoped dashboard functions to `authenticated` and revokes service-role execution | Retain and explicitly justify this exception below |
| Global spend view | Initially `security_invoker`; later restricted to service role, then dropped by the tenancy migration; current dashboard never queries it | Do not recreate it on upgraded databases; retain inaccessible during an additive legacy expansion |
| Every historical model is hardcoded | `telemetry.ts` hardcodes Claude's model; Codex logs already read reported model or `unknown_model` | Flag Claude history only; preserve Codex provenance separately |
| Only Claude metrics | Both Claude `/v1/metrics` and Codex `/v1/logs` exist; `source` is `claude` or `codex` | Preserve both, optional host/email, and `(source, session_id)` session counts |
| Online migration | The immutable tenancy migration and current staged runbook require stopping legacy writers and include drops | That procedure does not satisfy this request's continuous-ingest requirement; do not run it as this proposal's online plan |

Older specs mentioning Basic Auth, a live global spend view, or alternative Codex/Gemini source names are historical proposals. Follow current code and immutable SQL. No production database or deployment state was inspected for this document.

## Tenancy and data model

Use one Supabase Postgres database, shared public tables, explicit organization ownership, and RLS. This fits the existing queries and permits one migration history, indexes, backups, and operational process. Schema-per-organization would multiply DDL and PostgREST exposure/search-path configuration, complicate aggregate maintenance, and still require authorization. Dedicated databases can be considered for future contractual isolation; neither alternative is justified for this release.

In this spec, `organization_id` means `tenant_id`, `organizations` means `public.tenants`, and `memberships` means `public.tenant_memberships`. Preserve `/api/tenants` and `p_tenant_id` naming to avoid an unnecessary API/database rename.

| Relation | Recommended fields and invariants |
| --- | --- |
| Organizations: `public.tenants` | UUID `id`, display `name`, `status=active|deleting`, `created_at`, nullable `created_by`; names need not be globally unique |
| Memberships: `public.tenant_memberships` | `(tenant_id,user_id)` primary key, Auth user FK, `role=owner|admin|viewer`, creation timestamp; `(user_id,tenant_id)` index; at least one owner after bootstrap |
| `public.projects` | Preserve UUID/name/creation timestamp; required `tenant_id`; unique `(tenant_id,name)` and `(tenant_id,id)` |
| `public.token_usage_logs` | Preserve every existing field; required `tenant_id` and `project_id`; composite FK `(tenant_id,project_id)` to projects; keep `project_name` as immutable snapshot |
| `private.ingestion_keys` | UUID, tenant FK, label, unique SHA-256 token hash, display prefix, creator/timestamps, expiry/revocation/last-use; multiple active keys per organization |
| Private invitations | Tenant, normalized invited email, admin/viewer role, unique token digest, creator, expiry/acceptance/revocation timestamps |
| Private audit/deletion records | Tenant ID, allowlisted action/actor/target/timestamp/request ID; deletion status and recovery metadata; no plaintext credentials |

The existing tables that acquire organization ownership are **projects and token_usage_logs**. The old view has no stored rows to backfill. Auth users remain global and may belong to several organizations. Existing private operational tables keep their current ownership conventions; global rate-limit buckets are not customer telemetry.

Index logs by `(tenant_id,recorded_at DESC)`, `(tenant_id,source,recorded_at DESC)`, and `(tenant_id,project_id,recorded_at DESC)`. Index foreign keys and key hashes. Keep existing indexes until representative query plans justify removal. Shared project names such as `api` resolve to different UUIDs in different organizations. Do not merge projects, rename historical projects, or move telemetry between organizations through user APIs.

## Ingestion and credential transition

Keep bearer authentication and existing OTLP routes. Recommend opaque `brk_` keys containing 32 cryptographically random bytes encoded as 64 hexadecimal characters, matching current code. Store SHA-256 of the entire key in the non-exposed private schema. High-entropy tokens permit a digest lookup; human passwords would require a password-specific hash. Plaintext storage and one permanent token per organization are rejected because compromise and rotation would be harder to contain.

Show a key once when created; later list only safe metadata. Owners/admins create or revoke keys. Rotation means create replacement, update exporters, verify usage, then explicitly revoke the old key. A membership removal does not revoke organization-owned keys; offboarding must review those keys separately.

The Worker hashes the bearer and calls the service-role-only `ingest_telemetry(p_token_hash,p_rows)`. Within one transaction the database resolves the organization, locks organization then key, rechecks active status/expiry/revocation, resolves projects by organization/name, and inserts the batch. It derives ownership from the key, never `organization.id`, repository, host, email, query parameter, or caller-provided tenant/project UUID. Reject submitted ownership UUIDs at the normalized RPC boundary. Codex's `?project=` and Claude's repository fallback select only a name within the key's organization.

Authenticate even empty batches. Invalid/revoked/expired keys and disabled organizations return the same `401`; database outages return retryable `503`. Preserve atomic insertion of accepted normalized records and OTLP partial-success accounting for rejected records. A failed transaction acknowledges no accepted rows. Never log payloads, tokens, digests, Auth cookies, or service credentials.

For a production database still using the shared token, recommend a **bounded legacy bridge**, exclusively for HercuIT:

1. Register a digest of the existing secret as a legacy credential for the fixed historical organization through a secure operator channel. Do not put its value in migration files. Give it an explicit expiry, proposed seven days after the compatibility release.
2. A compatibility Worker accepts its existing bearer format as well as `brk_` keys, hashes both, and uses the database credential lookup. A private legacy marker limits the old credential to HercuIT. Never fall back to a global insert when lookup fails. Do not weaken the normal key-creation format.
3. Provision replacement keys, update Claude and Codex clients, and confirm each exporter has switched. Record legacy-key last usage without logging its material. Never re-enable Basic Auth as part of this bridge.
4. Revoke the legacy digest, disable legacy-format acceptance, remove `INGEST_SECRET_TOKEN`, and verify the old token fails. If clients remain, delay the retirement gate or explicitly extend expiry before it elapses; do not silently discard their events.

On an already upgraded deployment, leave the retired token rejected. Do not resurrect an old credential to follow this plan.

## Dashboard login and database isolation

Recommend Supabase Auth email-link/OTP login and the existing Worker session flow. Keep validated access/refresh tokens in Secure, HttpOnly, SameSite cookies; same-origin Origin validation and CSRF protect mutations. Auth identifies the user; current database membership authorizes the organization. Never authorize by email domain, telemetry email, unverified JWT contents, or user-editable metadata.

A user can belong to multiple organizations. List only their current memberships; automatically select a single membership, otherwise use the chooser. Remembering a UUID is a UI preference. Every request supplies its organization in the path and checks membership again. With no memberships, show invitation guidance and no usage. On switch/sign-out, clear both tabs' data, charts, project filters, comparison KPIs, and any export state; abort requests and invalidate late results. Preserve independent source/date preferences. This behavior already exists in `dashboard.ts` and must remain.

Recommend **both required function parameters and RLS**:

| Boundary | Enforcement |
| --- | --- |
| Worker dashboard APIs | Validated user session; list/check current memberships; required tenant UUID; fresh publishable-key client with that user's JWT |
| Three `get_token_usage_*` RPCs | Required `p_tenant_id uuid`, explicit tenant predicate before aggregation, project join on tenant and project ID, `SECURITY INVOKER`, fixed empty search path |
| `get_cost_table` and `get_cost_series` | Same required parameter, predicate, join, and invoker RLS; cumulative windows cannot cross organizations |
| Public organization/membership/project/log tables | Authenticated SELECT only under current-membership/active-organization RLS; no anonymous policy or direct user mutations |
| Management/invitation RPCs | Explicit tenant/target pairing, current `auth.uid()` and role checks inside checked transactions; last-owner guard under organization lock |
| Private credential/audit/invitation data | Private schema not exposed by PostgREST; no direct anon/authenticated table grants; safe metadata only through checked RPCs |
| Ingest/bootstrap/purge | Explicit service-role-only grants; narrow operations with their own checks because service role bypasses RLS |

The private membership helper derives identity from `auth.uid()`, checks the active tenant, and prevents recursive membership RLS through a tightly owned definer function. Fully qualify relations, fix its search path, and grant only the schema usage/execution needed for policies. No arbitrary user-ID impersonation argument. Membership removal affects the next database statement, including with an existing JWT; already running snapshot reads cannot be recalled.

**Explicit grant-pattern exception:** retain the tenancy migration's authenticated-only execution for the five *scoped invoker* dashboard functions. Keep `PUBLIC`, `anon`, and `service_role` revoked on those signatures. Earlier service-role-only functions bypassed RLS and made Worker filtering the sole read boundary; retaining that design would sacrifice database enforcement. Authenticated execution allows direct Supabase RPC calls, so direct-table and direct-RPC isolation tests are mandatory. It grants no ingestion, bootstrap, purge, or credential-table access. Never give dashboard code a service-role fallback. This follows the [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) and [function security guidance](https://supabase.com/docs/guides/database/functions).

Legacy unscoped functions must become uncallable before another organization is admitted. For additive rollout, retain their definitions but revoke all API-role execution; a database owner remains a trusted operator. Do not leave ambiguous defaulted overloads at the public RPC name: use separately named scoped RPCs during coexistence, and an audited signature/name cutover only after old readers drain. If the tenancy migration already removed old overloads, do not restore them.

If still present, retain `project_spend_summary` inaccessible to every API role, including service role, rather than rebuilding it during this migration. It is unused by current code. A future view must group by organization/project and use invoker RLS; a multi-membership user's unfiltered global grouping could otherwise combine their organizations. No materialized rollup, debug/export endpoint, or shared cache may bypass tenant authorization.

## HTTP contract and impact on dashboard.ts

All successful dashboard envelopes and row fields stay unchanged. Preserve `projects`, `start`, `end`, `bucket`, and `source`; missing source means both within the selected organization. Token range defaults to seven days and cost to all time. Unknown projects return empty results in that organization. Do not change token/cost semantics or estimate costs from model names.

| Surface | Contract and dashboard impact |
| --- | --- |
| Project names | `GET /api/tenants/:id/token-usage/projects` returns `{ projects: string[] }`; organization-prefixed URL, same dropdown data |
| Token series/table | `GET /api/tenants/:id/token-usage/{series,table}` returns `{ series: [...] }` or `{ rows: [...] }`; preserve bucket/category/table columns |
| Cost series/table | `GET /api/tenants/:id/cost/{series,table}` uses the same envelopes; preserve cost/token/session fields and cumulative series fields |
| Legacy global routes | `/api/token-usage/*` and `/api/cost/*` return `410`; no redirect to all organizations or implicit default |
| Sessions and selection | `/api/session`, `/api/tenants` plus `/auth/*`; chooser/sign-in/CSRF replaces the legacy Basic Auth challenge |
| Administration | Existing tenant-scoped member/key/invitation/rename/deletion routes remain; object IDs are always checked against the tenant path |
| Ingest | Keep metrics `{ success: true, count }`, logs acknowledgement, and optional OTLP `partialSuccess`; internal returned tenant/key IDs never appear in exporter success data |
| Errors | JSON `{ error, code, requestId }`; `401` session/key, generic `404` inaccessible tenant/object, `403` insufficient role, `400` invalid input, `409` conflicts, `503` retryable database outage; existing `413`/`429` protections remain |

Relative to the single-tenant baseline, URLs, login, errors, and tenant discovery change; successful usage response shapes do not. Current `dashboard.ts.fetchJson` already translates its internal old-looking paths into tenant paths, so do not mistake its string literals for global HTTP access. Its `load`, project list, previous-period and cost KPI requests must all retain this translation. Disable exports on empty/cleared state if export controls are added later; older export specs are not proof those controls exist today. All tenant/session/key responses remain `Cache-Control: no-store`.

## Existing data and honest model reporting

Assign **all pre-tenancy projects and usage** to the fixed legacy organization `00000000-0000-4000-8000-000000000001`, proposed display name **HercuIT**. Explicitly verify the first owner's Auth UUID with the operator; never let the first visitor claim history. The existing migration initially names this organization `Legacy organization` and `bootstrap_tenant(...,p_claim_legacy=true)` assigns its verified first owner and display name. Preserve this UUID. If production already contains several organizations, retain all current ownership; never repeat the historical blanket update.

Backfill missing project rows from distinct usage names, including usage whose project was never added to `projects`. Preserve original project UUIDs and orphan projects that have no usage. Each log links to the matching name within HercuIT. Keep `default-project` unchanged as a real project name; renaming or splitting would invent attribution and break comparisons. New exporters should provide better names for future events. A UI explanation can call it unattributed without rewriting stored names.

Recommend an additive `model_provenance` text field on logs with values `legacy_hardcoded`, `reported`, and `unknown`. Preserve raw `model`, every row UUID, timestamps, tokens, costs, source, host, email, session, and project snapshot.

- Existing Claude rows are `legacy_hardcoded`, even when the raw label coincidentally matches the model actually used. No stored evidence can recover the truth.
- Existing Codex rows with a non-placeholder parsed model are `reported` (exporter-reported, not independently verified); missing/placeholder labels are `unknown`.
- Future Claude writes from the unchanged parser remain `legacy_hardcoded`. A later approved parser change may use a verified telemetry model attribute and mark those writes `reported`; absent model becomes `unknown`. Do not declare a calendar cutoff to imply the current parser has been fixed.
- Model-aware queries/exports use the effective label `unknown` unless provenance is `reported`. They may expose the raw label as explicitly unverified audit data. No model charts or filters ship in this scope; add a plain dashboard notice that historical Claude models are unavailable.

Use provenance rather than replacing `model` with `unknown` before a guessed date: it is reversible, preserves evidence, and handles rolling Worker versions and late events. Record the actual parser release and final old-writer drain time in the rollout manifest if model parsing is later changed. `recorded_at` currently defaults to database insertion time in the ingestion RPC, so do not treat it as verified client event time. Token and reported-dollar totals remain usable as stored; this migration does not correct cumulative metrics, deduplicate retries, or infer historical model prices.

## Ordered migration plan

### Deployment-state gate

Before execution, inspect the deployed migration ledger, actual schema/grants, Worker version, exporter retry behavior, and whether tenancy is already active. These checks are future operator work, not performed by writing this spec.

If tenancy is **already applied**, skip legacy ownership expansion/backfill and the shared-token bridge; verify existing invariants and append only missing provenance/export-support changes. Do not alter other organizations' rows or weaken current authorization.

If `20261028210000` is **pending**, simply appending migrations cannot make its earlier maintenance-only transaction online. Keep the current CI refusal. A later implementation must supply a separately reviewed staged release/ledger reconciliation that replaces execution of that pending cutover with the approved online stages, preserves the immutable file, and verifies the resulting schema. Do not falsely mark it applied while its required state is missing, run unrestricted migration push, or run the current `stage-tenancy.mjs --confirm-maintenance` procedure with live writers. Any retained old view/function definitions versus the original migration must be explicit in that reconciliation. Approval of this design alone does not approve a ledger repair.

The following are **logical numbered migration filenames**, not files created by this change or timestamps claimed to be ready for Supabase discovery. Generate real versions with the project's migration tooling after approval and deployment-history reconciliation. Split concurrent-index operations into a runner that permits nontransactional statements. Each stage has its own precondition, verification, and compensating rollback below.

1. `001_expand_organizations.sql` — Create/reuse organization and private lifecycle tables, add nullable `tenant_id`/`project_id` and nullable model provenance, and install the bounded legacy compatibility writer atomically.
2. `002_backfill_organization_ownership.sql` — Run restartable bounded batches assigning legacy ownership, creating missing projects, linking usage, and classifying model provenance with a progress/undo manifest.
3. `003_require_organization_ownership.sql` — Prove no null ownership remains, validate temporary not-null checks, then set ownership/project/provenance columns NOT NULL under brief locks.
4. `004_index_organization_data.sql` — Build organization/project unique and usage lookup indexes concurrently, preserving old indexes and global project uniqueness temporarily.
5. `005_validate_organization_relationships.sql` — Attach new uniqueness, add tenant and composite project foreign keys as NOT VALID, then validate independently without rewriting measurements.
6. `006_add_scoped_authorization.sql` — Add separate scoped invoker read RPCs, RLS/helpers and checked lifecycle/ingestion operations; keep legacy readers available only during the single-organization bridge.
7. `007_cut_over_organization_access.sql` — After the Auth Worker switches and old readers drain, revoke legacy reads/direct writes, switch canonical RPC signatures, and replace global project uniqueness with tenant uniqueness before admitting another organization.
8. `008_retire_legacy_compatibility.sql` — After exporters and old writers drain, revoke the legacy token and disable compatibility filling; retain inaccessible definitions, manifests, and historical data for recovery.

For existing ownership columns the required sequence is explicitly: **(1) nullable addition, (2) backfill, (3) NOT NULL, (4) relational constraints and indexes**. The validated temporary CHECK in stage 3 is solely the proof used to avoid a second full-table scan for SET NOT NULL. New empty organization tables may have their own keys from creation. Keep the initial single-tenant uniqueness until the new unique index/constraint is valid. PostgreSQL supports [constraint validation and NOT NULL checks](https://www.postgresql.org/docs/current/sql-altertable.html); [concurrent indexes](https://www.postgresql.org/docs/current/sql-createindex.html) require special execution and retry handling.

### Keeping ingestion live

Stage 1 installs columns and a **temporary database compatibility trigger in the same transaction**. It maps old direct service-role inserts with missing ownership only to the fixed legacy organization, resolves/creates their project, and marks their model provenance. It also fills tenant ownership on legacy project inserts. Existing explicit tenant/project links are checked, never overwritten. No user-facing insert rights are granted. This closes the race for old Worker requests still in flight before any backfill or NOT NULL step.

Before new unique indexes exist, legacy project resolution uses the old globally unique name and atomically handles conflicts; no second organization may write yet. After the new constraint is ready, use `(tenant_id,name)` resolution. Synchronize resolver changes and the uniqueness swap in the short cutover transaction so no writer relies on a removed conflict target. A compatibility RPC/Worker supports both versions through this interval. Do not deploy today's final Worker unchanged against the expanded legacy schema and assume it will work.

Backfill by primary-key batches with row locks, update only unmapped legacy rows, commit each batch, and record completed row IDs/old values privately. UUIDs are not chronological; use explicit remaining-row scans/manifests rather than a timestamp/highest-UUID watermark. Concurrent new writes receive ownership through the trigger. Repeat until there are no unmapped or mismatched rows. Do not rerun a whole-table assignment against explicit tenants. Project upsert must converge under concurrent backfill/ingest.

Use short lock timeouts (proposed five seconds), measured statement limits, and back off/retry DDL rather than blocking ingest behind a long migration lock queue. Build indexes concurrently outside transactions, detect invalid interrupted indexes, and recreate them safely. Validate foreign keys separately. Keep ingest routes running while dashboard reads may briefly enter maintenance. A second organization is gated on all constraints, RLS, RPC, Auth, and old-read revocations passing.

Acknowledgement means the database transaction committed, never merely that a request arrived. Existing exporters/ingest are at least once, so retries may duplicate data. For **no lost data points**, verify that each exporter or an upstream collector durably retains unacknowledged batches across migration errors/restarts and retries `503`/timeouts. If client buffers/retry horizons cannot prove this, a durable store-and-forward collector with replay is a prerequisite before rollout; the current repository provides no such guarantee. Do not cut over, expire the legacy key, or claim no loss on the strength of in-memory retries. No exactly-once guarantee is introduced here.

## Backup, reconciliation, and rollback

Before stage 1, take an encrypted recoverable snapshot/backup of data, schema, grants, and migration state; record its recovery point and rehearse restoring it into an isolated database. Confirm available PITR/WAL retention rather than assuming a Supabase plan includes it. Keep secrets outside reports. A backup alone cannot preserve writes accepted after its recovery point.

For live comparisons, capture a transactionally consistent baseline of **exact existing row IDs** and measurements in an operator-only manifest or isolated backup. Compare that identical cohort after every stage, not two unrestricted totals collected at different times. Track later inserts separately through reconciliation snapshots and the durable delivery ledger. Verify:

- Every baseline usage UUID remains exactly once; project UUIDs remain; additions are only the new project catalog entries required by previously uncatalogued usage.
- Row counts and exact integer sums for input/output/cache-read/cache-write, exact NUMERIC cost sum, min/max timestamps, and `(source,session_id)` distinct counts agree globally and by source/project/time bucket for the fixed cohort.
- Original payload-column values or canonical per-row checksums agree; only ownership/project-link/provenance columns may differ. Model provenance counts reconcile with the baseline source/model categories.
- No null ownership/project keys, missing referenced organization/project, cross-organization link, or duplicate `(tenant_id,name)` exists; every baseline row belongs to HercuIT.
- Scoped HercuIT dashboard results match pre-cutover aggregates for fixed filters; a new organization's fixture changes none of those results. Compare cents/microdollars as decimal values, not floating-point approximations.
- Every acknowledged post-baseline accepted row/batch is accounted for in the database or recovery replay. Test process death, timeouts after commit, and resumed backfill; report expected retry duplicates separately from loss.

| Stage | Compensating rollback, preserving all accepted usage |
| --- | --- |
| 001 | Stop rollout and keep the compatibility trigger while legacy writers exist; leave new nullable columns/tables dormant. Remove a trigger only after writers no longer need it. Do not drop populated tables/columns to undo expansion. |
| 002 | Stop batches and retain completed ownership as harmless metadata. If assignment was wrong, restore only manifest-listed preexisting values after a guarded comparison, with constraints relaxed as necessary; never reassign/delete rows accepted later. Prefer correcting ownership from the manifest over clearing it. |
| 003 | Drop NOT NULL and its temporary proof checks in a compensating migration; retain backfilled values and compatibility filling. No measurements change. |
| 004 | Remove only newly built invalid/unneeded indexes concurrently; do not remove an index supporting an attached constraint. Reverse stage 005 first if needed. Keep original indexes. |
| 005 | Remove the newly attached FKs/unique constraints only after dependent writers are made safe; keep ownership and indexes where possible. Re-enable enforcement after repair. Do not admit another organization with constraints disabled. |
| 006 | Switch off the new user/API path and keep new objects dormant, or deploy the previous tenant-safe version. Retain deny policies and private grants; never disable RLS to recover availability. Legacy reads may resume only before multi-organization admission and after proving the database contains solely HercuIT. |
| 007 | Roll back to the compatibility release with scoped reads and tenant-safe writes. Before another organization writes, global uniqueness and old signatures can be restored from saved DDL if validated. Afterwards never restore global reads or require global uniqueness; retain tenant schema and use a forward fix. |
| 008 | If still inside the approved bridge window and the credential is not compromised, restore compatibility filling or issue a new legacy-organization credential under an audited decision. Never automatically un-revoke a compromised/expired key. Existing valid tenant keys continue; retained definitions permit a tenant-safe code rollback. |

Migrations expand data structures and preserve measurements. **Unavoidable metadata contractions** are revoking unsafe permissions, replacing callable function signatures, disabling legacy defaults/triggers, and removing `projects.name` global uniqueness. They are needed to prevent global access and allow two organizations to use `api`. Keep old definitions privately/inaccessible for reversal instead of dropping history. A literal requirement that no constraint ever be removed conflicts with per-organization project uniqueness; this limited metadata replacement is the proposed interpretation of additive and reversible.

No migration truncates/deletes usage, rewrites raw models, drops populated columns, or purges organizations. Physical cleanup is deferred. Rollback means a compensating change with no data loss, not necessarily restoration of the original single-tenant schema. Once same-name projects/multiple organizations exist, a lossless reversal to global uniqueness/global authorization is impossible; the reversible operational target is the compatibility **tenant-safe** release. Do not merge/delete customer data just to restore an old constraint.

A full snapshot restore is disaster recovery, not ordinary migration rollback: isolate writes, preserve/reconcile all later accepted batches using WAL/PITR or the durable ledger, restore into a separate database, validate tenant isolation and revocations, then switch safely. Never overwrite production with a stale backup and call it a rollback.

## Organization lifecycle and export

Recommend operator-assisted creation initially. Atomically create organization plus first owner with `bootstrap_tenant` using a verified Auth UUID; claim history only once. No self-service first-visitor ownership. Owners administer other owners and deletion; owners/admins manage settings, keys, and admin/viewer invitations; viewers read only. Serialize changes on the organization row and reject removing/demoting/deleting the last owner, including through Auth Admin deletion.

Invitations are expiring one-time secrets stored as digests, proposed seven-day lifetime. Accept only with the matching verified Auth email; revocation, expiry, replay, and resend rotation are checked transactionally. Preserve an existing member's role on acceptance. Delivery failure is reported separately from invitation persistence. Removing membership blocks subsequent reads without waiting for JWT expiry.

Provide export before deletion: retain any implemented table download behavior, but distinguish summaries from a complete organization export. Recommend an owner/admin-requested, operator-assisted export initially rather than adding a new public endpoint. Export organization/project metadata and all usage (including source, raw model and provenance) from one consistent organization-scoped snapshot, with row counts, totals, schema version and timestamps. Omit credential/invitation digests and unrelated Auth profiles; deliver securely after current-role verification. Record export in audit. It requires no dashboard response-shape change. A later asynchronous export service must scope every job/result by organization and recheck access on retrieval.

An owner types the organization name to request deletion. Disable reads/ingest, revoke keys/invitations, and enqueue purge in one transaction. Recommend a seven-day recovery window before an explicit operator purge, subject to retention approval. The current purge RPC has no delay guard, so enforcing this policy needs a future checked eligibility timestamp; it is not already guaranteed by code. Cancellation before purge may reactivate access after authorization review, but revoked secrets stay revoked and replacement keys are issued.

Purge usage, projects, memberships, keys and invitations by organization; preserve other organizations and shared Auth users. It is intentionally **destructive and not reversible without backup**, and is a separately authorized lifecycle operation, never part of these migrations. Keep minimal restricted audit/job metadata for the approved retention period. Explain when backups expire and that deletion does not immediately erase every backup. Restores must reapply deletion requests and revocations to avoid reviving deleted data or access.

Billing, plans, and new rate-limit/quotas design are explicitly out of scope. Existing request limits and rate-limit protections remain. Also defer new telemetry sources, project renames/merges, enterprise SSO, cross-organization reporting, exact-once ingestion, cumulative-metric corrections, model pricing, and automated exports/purge scheduling.

## Cross-organization and migration test plan

Use isolated organizations A/B with identical `api` project names and session IDs but different token/cost/host/email values. Create owner/admin/viewer users, a member of both, and a user with no memberships. Cover both sources, unknown model provenance, empty batches, and disabled organizations. Extend existing tests rather than treating mocked Supabase results as proof of RLS.

| Cases to add or retain in `index.test.ts` | Required assertion |
| --- | --- |
| Every one of the five dashboard routes and KPI/comparison requests | User JWT client and required tenant argument; no service-role read; A cannot request B or omit tenant to aggregate globally |
| Missing/expired/forged/wrong-project session, Basic Auth and exporter-key attempts | Human APIs reject; old Basic Auth never becomes a fallback; no-membership user gets no data |
| Foreign project/member/key/invitation IDs under A's path | Generic denial, no B names/data/metadata in body/errors; valid membership in A is insufficient |
| Shared-name projects and source/date filters | Correct A-only arguments/results; unknown A project cannot discover B; sessions remain source-aware |
| Key hash resolution and spoofed payload tenant/project/email | Only key's organization selected; normalized foreign IDs rejected; hashes/plaintext never returned or logged |
| Rotation, revoke, expiry, deleting tenant, empty metrics/logs | Both overlap keys work, revoked/expired keys fail including empty batches, batch errors never falsely acknowledge success |
| Legacy bridge enabled/disabled/expired | Maps solely to HercuIT, final Worker rejects shared token, no bridge is enabled on an upgraded deployment |
| Membership removed after session issued, viewer/admin escalation | Current authorization denies; admins cannot manage owners; no service fallback after denied/empty/error RPCs |
| CSRF/Origin, no-store and database/Auth outage | Cookie mutations protected; no shared caching; safe `503` rather than success/data exposure |
| Responses and model provenance | Envelopes/row fields unchanged; notice does not claim Claude history is reported; Codex models remain intact |

SQL-level tests in `tests/tenancy.sql` and source-filter checks must actually `SET ROLE`/JWT claims as `anon`, `authenticated` A, B, multi-member, and no-membership users. Reset role/claims between cases. Assert direct SELECT and all five direct RPCs cannot reveal inaccessible tenants; no default/global signature is callable; `has_function_privilege`/catalog checks verify each exact signature and `PUBLIC` grants. Test service role cannot execute dashboard RPCs, users cannot execute ingestion/bootstrap/purge, and private-table reads/telemetry writes fail.

Test RLS on tenants, memberships, projects, logs and any retained/replacement view; require enabled RLS, intended policies and fixed function search paths. Test composite FK rejection of A log/B project, duplicate name within A rejected but same name across A/B accepted, no user row moves/self-enrollment, last-owner protection including Auth deletion, invitation email/replay/role preservation, and immediate membership revocation under a still-valid JWT. Test org deletion/export preserves B and shared users.

Use real multi-connection PostgreSQL tests for ingest versus revoke/delete, simultaneous last-owner removals, competing project upserts, backfill versus legacy inserts, and lock-timeout/retry behavior. Rehearse every numbered stage and compensating rollback from a realistic legacy snapshot with ingest running. Verify fixed-cohort counts/checksums/sums, late writes, interrupted batch/index restart, RPC dispatch during coexistence, legacy expiry, and no successful acknowledgement without commit. Test already-upgraded databases skip legacy reassignment. Inject crashes/commit-response loss and prove the durable collector replays pending batches without loss; document possible duplicate retries.

In dashboard DOM/browser tests, switch A to B while A projects/table/series/comparison requests are delayed; no stale data, error, KPI, or export can render. Verify only current memberships appear, no-membership state, sign-in/sign-out, source/date preference retention, and same-name project selection reset. Use real HTTPS sessions and disposable Auth for integration evidence.

Later implementation gates include Worker tests, database tests, dashboard tests, type checking and bundle dry-run, plus representative query plans, restore rehearsal and real concurrency checks. None of those tests or operational actions are needed to execute this documentation-only change; no test results or production readiness are claimed here.

## Assumptions

- The current checkout is authoritative for naming and parser behavior; production's applied migration/Worker state is unknown and will be inventoried before implementation.
- All genuinely pre-tenancy data belongs to one organization; proposed HercuIT and its owner must be confirmed explicitly. Existing multi-organization ownership is authoritative and will not be reassigned.
- Continuous ingest means no planned writer pause and preservation of every accepted point; lossless recovery of unacknowledged points additionally requires durable retry/replay evidence before rollout.
- Preserving `tenant_id` as the physical organization key is preferable to renaming implemented APIs/schema. Display names are not security identifiers.
- Additive/reversible means preserving customer data and providing tenant-safe compensating changes; required metadata constraint/permission replacement has the explicit boundaries described above.
- Current reported token/cost amounts are retained as evidence, not independently certified accounting; historical model identity cannot be reconstructed from the stored data.

## Open questions

1. Confirm HercuIT as owner of all pre-tenancy data and identify its verified first-owner Auth UUID. Are there any historical rows that belong elsewhere and require an explicit ownership mapping?
2. Is production still pre-tenancy, already upgraded, or partially staged? Approve deployment-history reconciliation only after that inventory; the existing maintenance runbook cannot be used unchanged for this online requirement.
3. Approve the limited metadata contractions and tenant-safe rollback boundary: after a second organization writes, rollback cannot restore single-tenant global uniqueness/auth without losing isolation or data.
4. Approve a seven-day legacy-token overlap where needed, and identify all exporters plus their durable retry/collector guarantees. If those guarantees are absent, should a durable collector be provisioned before the rollout?
5. Approve preserving raw model labels with provenance and reporting hardcoded Claude models as unknown. Should reading real Claude model attributes be a separately reviewed follow-up?
6. Approve operator-assisted organization creation/full export, seven-day invitation expiry, and a seven-day deletion recovery window. Decide export delivery, audit retention, backup retention/PITR and eventual purge policy before enabling deletion.
7. Approve this spec before any implementation. This document alone does not authorize production migration, deployment, invitations, credential retirement, deletion, or ledger repair.
