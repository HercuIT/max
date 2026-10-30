-- Operator-only online stage; never discovered by supabase db push.

create or replace function private.backfill_organization_batch(p_limit integer) returns integer language plpgsql security definer set search_path='' as $$
declare ids uuid[]; n integer;
begin
 if p_limit is null or p_limit not between 1 and 10000 then raise exception 'Invalid batch size'; end if;
 select array_agg(id) into ids from (select id from public.projects where tenant_id is null order by id limit p_limit for update) b;
 if ids is not null then
  insert into private.organization_assignment_undo select 'project',id,tenant_id,null from public.projects where id=any(ids) on conflict do nothing;
  update public.projects set tenant_id='00000000-0000-4000-8000-000000000001' where id=any(ids);
  return cardinality(ids);
 end if;
 select array_agg(id) into ids from (select id from public.token_usage_logs where tenant_id is null or project_id is null or model_provenance is null order by id limit p_limit for update) b;
 if ids is null then return 0; end if;
 if exists(select 1 from public.token_usage_logs where id=any(ids) and tenant_id is not null and tenant_id<>'00000000-0000-4000-8000-000000000001'::uuid) then
  raise exception 'Non-legacy ownership encountered; stop and reconcile.';
 end if;
 insert into private.organization_assignment_undo select 'usage',id,tenant_id,project_id from public.token_usage_logs where id=any(ids) on conflict do nothing;
 insert into public.projects(tenant_id,name) select distinct '00000000-0000-4000-8000-000000000001'::uuid,project_name from public.token_usage_logs where id=any(ids) on conflict(name) do nothing;
 update public.token_usage_logs t set tenant_id='00000000-0000-4000-8000-000000000001',project_id=p.id,model_provenance=private.model_provenance(t.source,t.model)
  from public.projects p where t.id=any(ids) and p.tenant_id='00000000-0000-4000-8000-000000000001'::uuid and p.name=t.project_name;
 get diagnostics n=row_count;
 if n<>cardinality(ids) then raise exception 'A historical project could not be resolved.'; end if;
 return n;
end; $$;
revoke all on function private.backfill_organization_batch(integer) from public,anon,authenticated,service_role;
