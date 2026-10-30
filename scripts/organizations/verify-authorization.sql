do $$
begin
 if not (select count(*)=5 and bool_and(p.proargtypes[0]='uuid'::regtype and not p.prosecdef
  and not has_function_privilege('anon',p.oid,'EXECUTE')
  and not has_function_privilege('service_role',p.oid,'EXECUTE')
  and has_function_privilege('authenticated',p.oid,'EXECUTE'))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in ('get_token_usage_projects','get_token_usage_series','get_token_usage_table','get_cost_series','get_cost_table')) then
  raise exception 'Canonical dashboard signatures or grants are unsafe.';
 end if;
 if not (select count(*)=4 and bool_and(relrowsecurity) from pg_class where oid in
  ('public.tenants'::regclass,'public.tenant_memberships'::regclass,'public.projects'::regclass,'public.token_usage_logs'::regclass))
  or has_table_privilege('anon','public.token_usage_logs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  or has_table_privilege('authenticated','public.token_usage_logs','INSERT,UPDATE,DELETE,TRUNCATE')
  or has_table_privilege('service_role','public.token_usage_logs','INSERT,UPDATE,DELETE,TRUNCATE')
  or has_table_privilege('service_role','public.project_spend_summary','SELECT') then
  raise exception 'RLS, legacy view or direct-write grants are unsafe.';
 end if;
 if not (select count(*)=3 and bool_and(convalidated) from pg_constraint where conname in
  ('projects_tenant_id_fkey','token_usage_logs_tenant_id_fkey','usage_tenant_project_fk')) then
  raise exception 'Required tenant foreign keys are missing or unvalidated.';
 end if;
 if not (select count(*)=5 and bool_and(indisvalid) from pg_index where indexrelid in
  (to_regclass('public.projects_tenant_name_key'),to_regclass('public.projects_tenant_id_key'),to_regclass('public.usage_tenant_time'),
   to_regclass('public.usage_tenant_source_time'),to_regclass('public.usage_tenant_project_time'))) then
  raise exception 'Tenant indexes are missing or invalid.';
 end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
  and p.proname in ('get_token_usage_projects','get_token_usage_series','get_token_usage_table','get_cost_series','get_cost_table')
  and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')
   or has_function_privilege('service_role',p.oid,'EXECUTE'))) then
  raise exception 'A retained legacy function is still executable by an API role.';
 end if;
end; $$;
