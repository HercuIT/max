-- Run after the tenancy migration in a disposable database.
-- Tests run inside the broader tenancy fixture in tests/tenancy.sql.
-- Use an authenticated member JWT context and a caller-owned tenant UUID.
-- This file is included by scripts/test-database.mjs within tests/tenancy.sql's transaction.
select pg_temp.check_true((select sum(input_tokens)=20 from public.get_token_usage_series(current_setting('test.a')::uuid,p_source=>'codex')),'Codex series remains tenant-scoped');
select pg_temp.check_true((select sum(input_tokens)=19 from public.get_token_usage_series(current_setting('test.a')::uuid,p_source=>'claude')),'Claude series includes historical ownership');
select pg_temp.check_true((select sum(total_cost_usd)=2 from public.get_cost_table(current_setting('test.a')::uuid,p_source=>'codex',p_projects=>array['shared'])),'source/project intersection');
select pg_temp.check_true((select count(*)=0 from public.get_cost_table(current_setting('test.a')::uuid,p_source=>'codex',p_projects=>array['missing'])),'empty intersection stays empty');
select pg_temp.check_true((select count(*)=0 from public.get_token_usage_projects(current_setting('test.b')::uuid)),'project RPC enforces RLS');
select pg_temp.check_true((select count(*)=0 from public.get_cost_table(current_setting('test.a')::uuid,p_start=>now()+interval '1 day')),'date/source intersection');

-- Keep direct API grants in the regression contract, not just the Worker mocks.
select pg_temp.check_true((
 select count(*)=5 and bool_and(not has_function_privilege('anon',p.oid,'EXECUTE'))
  and bool_and(has_function_privilege('authenticated',p.oid,'EXECUTE'))
  and bool_and(p.proargtypes[0]='uuid'::regtype)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('get_token_usage_projects','get_token_usage_series','get_token_usage_table','get_cost_table','get_cost_series')
),'five required-tenant dashboard RPCs allow authenticated execute but no anonymous execute or legacy overloads');
select pg_temp.check_true(
 not has_table_privilege('anon','public.token_usage_logs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 and has_column_privilege('authenticated','public.token_usage_logs','tenant_id','SELECT')
 and not has_column_privilege('authenticated','public.token_usage_logs','host_name','SELECT')
 and not has_column_privilege('authenticated','public.token_usage_logs','user_email','SELECT')
 and not has_table_privilege('authenticated','public.token_usage_logs','INSERT,UPDATE,DELETE,TRUNCATE')
 and (select relrowsecurity from pg_class where oid='public.token_usage_logs'::regclass)
,'safe usage columns are authenticated read-only under RLS, with raw attribution excluded');
select pg_temp.check_true((select sum(total_tokens)=19 from public.get_token_usage_table(current_setting('test.a')::uuid,p_source=>'claude')),'Claude token table includes only Claude rows');
select pg_temp.check_true((select count(*)=0 from public.get_token_usage_projects(current_setting('test.a')::uuid,'claude') where project_name='codex-only'),'Claude project list excludes Codex-only projects');
select pg_temp.check_true((select count(*)=1 from public.get_token_usage_projects(current_setting('test.a')::uuid,'codex') where project_name='codex-only'),'Codex-only project is present in its own source list');
