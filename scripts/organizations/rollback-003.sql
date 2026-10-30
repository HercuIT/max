-- Reviewed compensation of completed online stage 003 only. Explicit transaction
-- fails closed after any error, even when psql continues after errors by default.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
 if not pg_try_advisory_xact_lock(hashtext('burnrate-staged-tenancy')) then
  raise exception 'Another tenancy rollout is running.';
 end if;
 if not coalesce((select phase=3 from private.organization_rollout_state where singleton),false) then
  raise exception 'Stage 003 compensation requires completed phase 3, before later stages.';
 end if;
end; $$;
lock table public.token_usage_logs in access exclusive mode;
lock table public.projects in access exclusive mode nowait;
alter table public.projects alter column tenant_id drop not null;
alter table public.token_usage_logs alter column tenant_id drop not null,
 alter column project_id drop not null,alter column model_provenance drop not null;
alter table public.projects drop constraint if exists projects_tenant_required;
alter table public.token_usage_logs drop constraint if exists usage_tenant_required,
 drop constraint if exists usage_project_required,drop constraint if exists usage_provenance_required;
update private.organization_rollout_state set phase=2,updated_at=now() where singleton;
commit;
