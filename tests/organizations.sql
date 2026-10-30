begin;
create or replace function pg_temp.check_true(ok boolean,why text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %',why; end if; end; $$;
create or replace function pg_temp.denied(statement text,expected text) returns void language plpgsql as $$
begin begin execute statement; exception when others then
 if sqlstate=expected then return; end if; raise exception 'Expected %, got %: %',expected,sqlstate,sqlerrm;
end; raise exception 'Expected denial %',expected; end; $$;
insert into auth.users(id,email,email_confirmed_at) values
 ('30000000-0000-4000-8000-000000000001','owner@example.test',now()),
 ('30000000-0000-4000-8000-000000000002','other@example.test',now());
select set_config('test.org.a',public.bootstrap_tenant('HercuIT','30000000-0000-4000-8000-000000000001',true)::text,true);
select set_config('test.org.b',public.bootstrap_tenant('Other','30000000-0000-4000-8000-000000000002')::text,true);
select public.backfill_model_provenance(1);
select pg_temp.check_true((select model='unknown_model' and model_provenance='legacy_hardcoded' from public.token_usage_logs where project_name='legacy-repo'),'raw legacy model retained, provenance honest');
insert into public.projects(tenant_id,name) values(current_setting('test.org.a')::uuid,'api'),(current_setting('test.org.b')::uuid,'api');
insert into public.token_usage_logs(tenant_id,project_id,project_name,source,model,model_provenance,input_tokens,total_cost_usd)
 select tenant_id,id,name,'claude','claude-3-5-sonnet','reported',10,1 from public.projects where tenant_id=current_setting('test.org.a')::uuid and name='api';
insert into public.token_usage_logs(tenant_id,project_id,project_name,source,model,input_tokens,total_cost_usd)
 select tenant_id,id,name,'codex','gpt-reported',999,99 from public.projects where tenant_id=current_setting('test.org.b')::uuid and name='api';
select pg_temp.check_true((select model_provenance='legacy_hardcoded' from public.token_usage_logs where project_name='api' and source='claude'),'caller cannot assert reported Claude provenance');
select pg_temp.check_true((select bool_and(effective_model='unknown' and raw_model='claude-3-5-sonnet') from public.token_usage_model_attribution where tenant_id=current_setting('test.org.a')::uuid and raw_model='claude-3-5-sonnet'),'effective model suppresses hardcoded label');
select pg_temp.denied($q$insert into public.token_usage_logs(tenant_id,project_id,project_name) select current_setting('test.org.a')::uuid,id,name from public.projects where tenant_id=current_setting('test.org.b')::uuid$q$,'23503');
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',true);
select pg_temp.check_true(not exists(select 1 from public.token_usage_model_attribution where tenant_id=current_setting('test.org.b')::uuid),'model view respects RLS');
select pg_temp.check_true(not exists(select 1 from public.get_token_usage_projects(current_setting('test.org.b')::uuid)),'foreign projects hidden');
select pg_temp.check_true(not exists(select 1 from public.get_token_usage_series(current_setting('test.org.b')::uuid)),'foreign token series hidden');
select pg_temp.check_true(not exists(select 1 from public.get_token_usage_table(current_setting('test.org.b')::uuid)),'foreign token table hidden');
select pg_temp.check_true(not exists(select 1 from public.get_cost_series(current_setting('test.org.b')::uuid)),'foreign cost series hidden');
select pg_temp.check_true(not exists(select 1 from public.get_cost_table(current_setting('test.org.b')::uuid)),'foreign cost table hidden');
select pg_temp.denied('select public.backfill_model_provenance(1)','42501');
select pg_temp.denied($q$select public.cancel_tenant_deletion(current_setting('test.org.a')::uuid,auth.uid())$q$,'42501');
select public.manage_tenant(current_setting('test.org.a')::uuid,'keys.create',null,jsonb_build_object('label','Retired by delete','token_hash',repeat('7',64),'prefix','brk_7'));
select public.manage_tenant(current_setting('test.org.a')::uuid,'deletion-request',null,'{"confirmation":"HercuIT"}');
reset role;
select pg_temp.denied($q$select public.purge_tenant(current_setting('test.org.a')::uuid)$q$,'PT409');
select pg_temp.denied($q$select public.cancel_tenant_deletion(current_setting('test.org.a')::uuid,'30000000-0000-4000-8000-000000000002')$q$,'PT404');
select public.cancel_tenant_deletion(current_setting('test.org.a')::uuid,'30000000-0000-4000-8000-000000000001');
select pg_temp.check_true((select status='active' from public.tenants where id=current_setting('test.org.a')::uuid),'cancel restores org status');
select pg_temp.check_true((select revoked_at is not null from private.ingestion_keys where token_hash=repeat('7',64)),'cancel does not revive revoked key');
set local role authenticated;
select public.manage_tenant(current_setting('test.org.a')::uuid,'deletion-request',null,'{"confirmation":"HercuIT"}');
reset role;
select pg_temp.check_true((select purge_after>clock_timestamp()+interval '6 days' from private.tenant_deletion_jobs where tenant_id=current_setting('test.org.a')::uuid),'rerequest starts a new recovery window');
select pg_temp.check_true((select bool_and(not has_function_privilege('service_role',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute') and has_function_privilege('authenticated',p.oid,'execute') and not p.prosecdef and p.proargtypes[0]='uuid'::regtype)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('get_token_usage_projects','get_token_usage_series','get_token_usage_table','get_cost_series','get_cost_table')),'exact dashboard signatures/grants/invoker context');
rollback;
