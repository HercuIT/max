-- Operator-only online stage; never discovered by supabase db push.

create unique index concurrently if not exists projects_tenant_name_key_stage on public.projects(tenant_id,name);
create unique index concurrently if not exists projects_tenant_id_key_stage on public.projects(tenant_id,id);
create index concurrently if not exists usage_tenant_time on public.token_usage_logs(tenant_id,recorded_at desc);
create index concurrently if not exists usage_tenant_source_time on public.token_usage_logs(tenant_id,source,recorded_at desc);
create index concurrently if not exists usage_tenant_project_time on public.token_usage_logs(tenant_id,project_id,recorded_at desc);
