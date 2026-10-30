begin;
create function pg_temp.check_true(ok boolean, explanation text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %',explanation; end if; end; $$;
create function pg_temp.denied(statement text, expected text) returns void language plpgsql as $$
begin
 begin execute statement; exception when others then
  if sqlstate=expected then return; end if;
  raise exception 'Expected %; got %: %',expected,sqlstate,sqlerrm;
 end;
 raise exception 'Expected denial % for %',expected,statement;
end; $$;
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000001','a@example.test',now()),
 ('10000000-0000-4000-8000-000000000002','b@example.test',now()),
 ('10000000-0000-4000-8000-000000000003','viewer@example.test',now()),
 ('10000000-0000-4000-8000-000000000004','admin@example.test',now()),
 ('10000000-0000-4000-8000-000000000005','both@example.test',now()),
 ('10000000-0000-4000-8000-000000000006','invite@example.test',now()),
 ('10000000-0000-4000-8000-000000000007','unverified@example.test',null);
set local role service_role;
select pg_temp.denied($q$select public.bootstrap_tenant('No','10000000-0000-4000-8000-000000000007')$q$,'22023');
select set_config('test.a',public.bootstrap_tenant('Legacy A','10000000-0000-4000-8000-000000000001',true)::text,true);
select set_config('test.b',public.bootstrap_tenant('B','10000000-0000-4000-8000-000000000002')::text,true);
select pg_temp.denied($q$select public.bootstrap_tenant('Again','10000000-0000-4000-8000-000000000001',true)$q$,'23505');
reset role;
select pg_temp.check_true((select count(*)=1 and sum(input_tokens)=9 from public.token_usage_logs where tenant_id=current_setting('test.a')::uuid),'historical rows preserve their totals and owner');
insert into public.tenant_memberships(tenant_id,user_id,role) values
 (current_setting('test.a')::uuid,'10000000-0000-4000-8000-000000000003','viewer'),
 (current_setting('test.a')::uuid,'10000000-0000-4000-8000-000000000004','admin'),
 (current_setting('test.a')::uuid,'10000000-0000-4000-8000-000000000005','viewer'),
 (current_setting('test.b')::uuid,'10000000-0000-4000-8000-000000000005','viewer');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select set_config('test.keya',(public.manage_tenant(current_setting('test.a')::uuid,'keys.create',null,
 jsonb_build_object('label','A exporter','token_hash',repeat('a',64),'prefix','brk_a')))->>'id',true);
select pg_temp.check_true((select (public.manage_tenant(current_setting('test.a')::uuid,'keys.list')->0) ? 'token_hash')=false,'key list does not expose hashes');
select pg_temp.denied($q$select * from private.ingestion_keys$q$,'42501');
select pg_temp.denied($q$select public.ingest_telemetry(repeat('a',64),'[]')$q$,'42501');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select public.manage_tenant(current_setting('test.b')::uuid,'keys.create',null,jsonb_build_object('label','B exporter','token_hash',repeat('b',64),'prefix','brk_b'));
reset role;
set local role service_role;
select public.ingest_telemetry(repeat('a',64),'[{"source":"claude","project_name":"shared","session_id":"same","input_tokens":10,"total_cost_usd":1},{"source":"codex","project_name":"shared","session_id":"same","input_tokens":20,"total_cost_usd":2},{"source":"codex","project_name":"codex-only","session_id":"codex-only","input_tokens":0,"total_cost_usd":0}]');
select public.ingest_telemetry(repeat('b',64),'[{"source":"codex","project_name":"shared","session_id":"same","input_tokens":999,"total_cost_usd":99}]');
select pg_temp.denied($q$select public.ingest_telemetry(repeat('a',64),'[{"source":"codex","project_name":"bad","tenant_id":"10000000-0000-4000-8000-000000000002","total_cost_usd":1}]')$q$,'22023');
select pg_temp.denied($q$select public.ingest_telemetry(repeat('f',64),'[]')$q$,'PT401');
select pg_temp.check_true(public.check_rate_limit(repeat('a',64),1,60),'first rate-limit request allowed');
select pg_temp.check_true(not public.check_rate_limit(repeat('a',64),1,60),'distributed rate limit denies next request');
select pg_temp.denied($q$insert into public.token_usage_logs(project_name,tenant_id,project_id) values ('bad',current_setting('test.a')::uuid,gen_random_uuid())$q$,'42501');
reset role;
set local role anon;
select pg_temp.denied('select * from public.token_usage_logs','42501');
select pg_temp.denied('select * from public.tenants','42501');
select pg_temp.denied('select public.list_tenants()','42501');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select pg_temp.check_true((select count(*)=1 from public.list_tenants()),'only own organization listed');
select pg_temp.check_true((select count(*)=0 from public.token_usage_logs where tenant_id=current_setting('test.b')::uuid),'RLS hides other tenant raw usage');
select pg_temp.check_true((select count(*)=0 from public.get_cost_table(current_setting('test.b')::uuid)),'direct aggregate cannot bypass RLS');
select pg_temp.check_true((select sum(total_cost_usd)=3 from public.get_cost_table(current_setting('test.a')::uuid)),'costs exclude B');
select pg_temp.check_true((select sessions=2 and total_tokens=30 from public.get_token_usage_table(current_setting('test.a')::uuid,p_projects=>array['shared'])),'source-aware session counts');
select pg_temp.check_true((select sum(input_tokens)=20 from public.get_token_usage_series(current_setting('test.a')::uuid,p_source=>'codex')),'source filter within tenant');
select pg_temp.check_true((select sum(cost_usd)=2 from public.get_cost_series(current_setting('test.a')::uuid,p_source=>'codex')),'cost series within tenant');
select pg_temp.check_true((select count(*)=2 from public.get_token_usage_projects(current_setting('test.a')::uuid,'codex')),'project list within tenant');
select pg_temp.check_true((select count(*)=0 from public.get_cost_table(current_setting('test.a')::uuid,p_projects=>array['unknown'])),'unknown project does not broaden filter');
-- SOURCE_FILTER_ASSERTIONS
select pg_temp.denied($q$select public.manage_tenant(current_setting('test.b')::uuid,'rename',null,'{"name":"hijacked"}')$q$,'PT404');
select pg_temp.denied($q$select public.manage_tenant(current_setting('test.a')::uuid,'members.remove','10000000-0000-4000-8000-000000000001')$q$,'PT409');
select set_config('test.invite',(public.manage_tenant(current_setting('test.a')::uuid,'invitations.create',null,jsonb_build_object('email','invite@example.test','role','viewer','token_hash',repeat('c',64))))->>'id',true);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select pg_temp.denied($q$select public.manage_tenant(current_setting('test.a')::uuid,'keys.create',null,'{}')$q$,'PT403');
select pg_temp.denied($q$select public.manage_tenant(current_setting('test.a')::uuid,'members.update','10000000-0000-4000-8000-000000000003','{"role":"owner"}')$q$,'PT403');
select pg_temp.denied($q$select public.accept_tenant_invitation(repeat('c',64))$q$,'PT409');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
select pg_temp.denied($q$select public.manage_tenant(current_setting('test.a')::uuid,'members.update','10000000-0000-4000-8000-000000000001','{"role":"viewer"}')$q$,'PT403');
select pg_temp.denied($q$select public.manage_tenant(current_setting('test.a')::uuid,'members.update','10000000-0000-4000-8000-000000000004','{"role":"owner"}')$q$,'PT403');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000006',true);
select public.accept_tenant_invitation(repeat('c',64));
select pg_temp.denied($q$select public.accept_tenant_invitation(repeat('c',64))$q$,'PT409');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select public.manage_tenant(current_setting('test.a')::uuid,'members.remove','10000000-0000-4000-8000-000000000006');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000006',true);
select pg_temp.check_true((select count(*)=0 from public.token_usage_logs),'removed member JWT no longer grants access');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
-- A new invitation for an existing member must not silently elevate their role.
select public.manage_tenant(current_setting('test.a')::uuid,'invitations.create',null,jsonb_build_object('email','viewer@example.test','role','admin','token_hash',repeat('d',64)));
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select public.accept_tenant_invitation(repeat('d',64));
select pg_temp.check_true((select role='viewer' from public.tenant_memberships where tenant_id=current_setting('test.a')::uuid and user_id=auth.uid()),'acceptance preserves existing role');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select set_config('test.rotating',(public.manage_tenant(current_setting('test.a')::uuid,'invitations.create',null,jsonb_build_object('email','invite@example.test','role','viewer','token_hash',repeat('e',64))))->>'id',true);
select public.manage_tenant(current_setting('test.a')::uuid,'invitations.resend',current_setting('test.rotating')::uuid,jsonb_build_object('token_hash',repeat('f',64)));
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000006',true);
select pg_temp.denied($q$select public.accept_tenant_invitation(repeat('e',64))$q$,'PT409');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select public.manage_tenant(current_setting('test.a')::uuid,'invitations.revoke',current_setting('test.rotating')::uuid);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000006',true);
select pg_temp.denied($q$select public.accept_tenant_invitation(repeat('f',64))$q$,'PT409');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select set_config('test.expiring',(public.manage_tenant(current_setting('test.a')::uuid,'keys.create',null,jsonb_build_object('label','Expiring','token_hash',repeat('1',64),'prefix','brk_1')))->>'id',true);
reset role;
update private.ingestion_keys set expires_at=now()-interval '1 second' where id=current_setting('test.expiring')::uuid;
set local role service_role;
select pg_temp.denied($q$select public.ingest_telemetry(repeat('1',64),'[]')$q$,'PT401');
select pg_temp.denied($q$select public.ingest_telemetry(repeat('a',64),'[{"source":"codex","project_name":"rollback-fixture","input_tokens":1,"total_cost_usd":0},{"source":"codex","project_name":"bad","input_tokens":-1,"total_cost_usd":0}]')$q$,'22023');
reset role;
select pg_temp.check_true(not exists(select 1 from public.projects where name='rollback-fixture'),'invalid database row rolls back sibling project/usage');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select public.manage_tenant(current_setting('test.a')::uuid,'keys.revoke',current_setting('test.keya')::uuid);
reset role;
select pg_temp.denied($q$delete from auth.users where id='10000000-0000-4000-8000-000000000001'$q$,'PT409');
set local role service_role;
select pg_temp.denied($q$select public.ingest_telemetry(repeat('a',64),'[]')$q$,'PT401');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select public.manage_tenant(current_setting('test.b')::uuid,'deletion-request',null,'{"confirmation":"B"}');
select pg_temp.check_true((select count(*)=0 from public.token_usage_logs),'deleting tenant loses dashboard access');
reset role;
set local role service_role;
select pg_temp.denied($q$select public.ingest_telemetry(repeat('b',64),'[]')$q$,'PT401');
select pg_temp.denied($q$select public.purge_tenant(current_setting('test.b')::uuid)$q$,'PT409');
reset role;
update private.tenant_deletion_jobs set purge_after=now()-interval '1 second' where tenant_id=current_setting('test.b')::uuid;
set local role service_role;
select public.purge_tenant(current_setting('test.b')::uuid);
select public.purge_tenant(current_setting('test.b')::uuid);
reset role;
select pg_temp.check_true(exists(select 1 from auth.users where id='10000000-0000-4000-8000-000000000005'),'purge preserves shared Auth users');
select pg_temp.check_true((select count(*)=4 from public.token_usage_logs where tenant_id=current_setting('test.a')::uuid),'purge preserves other tenant telemetry');
rollback;
