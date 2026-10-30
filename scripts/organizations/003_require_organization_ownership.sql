-- Operator-only online stage; never discovered by supabase db push.

alter table public.projects add constraint projects_tenant_required check(tenant_id is not null) not valid;
alter table public.token_usage_logs add constraint usage_tenant_required check(tenant_id is not null) not valid;
alter table public.token_usage_logs add constraint usage_project_required check(project_id is not null) not valid;
alter table public.token_usage_logs add constraint usage_provenance_required check(model_provenance is not null) not valid;
