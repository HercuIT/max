-- Tenant-safe compensations. Operator chooses statements for the failed stage;
-- this file is NOT an automatic "down" script and must not be executed wholesale.
do $$ begin raise exception 'Selective rollback reference: copy only reviewed statements for the failed stage.'; end $$;
-- 001/002: retain expansion, manifests and completed assignments; stop the runner.
-- Restore erroneous assignments only by reviewed manifest-listed UUIDs with a
-- comparison against current links; never clear/reassign later customer writes.
-- 003: relax proof constraints without modifying measurements.
alter table public.projects alter column tenant_id drop not null;
alter table public.token_usage_logs alter column tenant_id drop not null,
 alter column project_id drop not null,alter column model_provenance drop not null;
alter table public.projects drop constraint if exists projects_tenant_required;
alter table public.token_usage_logs drop constraint if exists usage_tenant_required,
 drop constraint if exists usage_project_required,drop constraint if exists usage_provenance_required;
-- 004/005: remove newly attached dependent constraints before removing their
-- indexes CONCURRENTLY; never do this while another organization can be admitted.
-- 006/007: deploy compatibility.ts, retain RLS and scoped RPCs. Never restore
-- global auth or global project uniqueness after a second organization writes.
-- 008: keep tenant keys running; do not automatically un-revoke a legacy key.
-- Model/deletion expansion rollback: retain added columns/view/functions dormant;
-- never restore the old purge RPC (it would bypass the seven-day recovery window).
