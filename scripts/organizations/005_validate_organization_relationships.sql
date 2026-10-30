-- Operator-only online stage; never discovered by supabase db push.

alter table public.projects add constraint projects_tenant_name_key unique using index projects_tenant_name_key_stage;
alter table public.projects add constraint projects_tenant_id_key unique using index projects_tenant_id_key_stage;
alter table public.projects add constraint projects_tenant_id_fkey foreign key(tenant_id) references public.tenants(id) on delete cascade not valid;
alter table public.token_usage_logs add constraint token_usage_logs_tenant_id_fkey foreign key(tenant_id) references public.tenants(id) on delete cascade not valid;
alter table public.token_usage_logs add constraint usage_tenant_project_fk foreign key(tenant_id,project_id) references public.projects(tenant_id,id) on delete cascade not valid;
alter table public.token_usage_logs add constraint usage_model_provenance_values check(model_provenance in ('legacy_hardcoded','reported','unknown')) not valid;
