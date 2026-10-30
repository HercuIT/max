-- Fixed cohort: ownership/provenance alone may change. No event-date watermark.
do $$
begin
 if exists(select 1 from private.organization_baseline_usage b left join public.token_usage_logs t using(id)
  where t.id is null or (to_jsonb(t)-'tenant_id'-'project_id'-'model_provenance')<>b.original) then
  raise exception 'Historical usage cohort differs from baseline.';
 end if;
 if exists(select 1 from private.organization_baseline_projects b left join public.projects p using(id)
  where p.id is null or (to_jsonb(p)-'tenant_id')<>b.original) then
  raise exception 'Historical project cohort differs from baseline.';
 end if;
 if exists(select 1 from public.projects where tenant_id is null)
  or exists(select 1 from public.token_usage_logs t left join public.projects p on p.id=t.project_id and p.tenant_id=t.tenant_id
   where t.tenant_id is null or p.id is null or p.name<>t.project_name or t.model_provenance is null) then
  raise exception 'Ownership, model provenance or project links are incomplete.';
 end if;
 if exists(select 1 from private.organization_baseline_usage b join public.token_usage_logs t using(id)
  where t.tenant_id<>'00000000-0000-4000-8000-000000000001'::uuid) then
  raise exception 'Historical cohort is not owned by the legacy organization.';
 end if;
end; $$;
