import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {setupFixture} from './database-fixture.mjs';
import {stageOnlineTenancy,readStage} from './online-tenancy.mjs';
import {stageTenancy} from './stage-tenancy.mjs';
const engine=new PGlite();
const db={query:async(sql,params)=>params?engine.query(sql,params):(await engine.exec(sql)).at(-1)};
const rollback=readStage('rollback-003.sql');
try{
 let staged=false;
 await setupFixture(sql=>db.query(sql),{pglite:true,applyMigration:async(name,sql)=>{
  if(staged)return;
  if(!name.startsWith('20261028210000')){await db.query(sql);return;}
  staged=true;
  await stageOnlineTenancy(db,{through:3});
  const flags=async()=>(await db.query(`select is_nullable from information_schema.columns where table_schema='public'
   and ((table_name='projects' and column_name='tenant_id') or (table_name='token_usage_logs' and column_name in('tenant_id','project_id','model_provenance'))) order by table_name,column_name`)).rows.map(x=>x.is_nullable);
  const before=(await db.query('select to_jsonb(t) as row from public.token_usage_logs t order by id')).rows;
  assert.deepEqual(await flags(),['NO','NO','NO','NO']);
  await db.query(readStage('rollback.sql')); // Harmless even with continue-on-error clients.
  assert.deepEqual(await flags(),['NO','NO','NO','NO']);
  await db.query(rollback);
  assert.deepEqual(await flags(),['YES','YES','YES','YES']);
  assert.equal((await db.query('select phase from private.organization_rollout_state')).rows[0].phase,2);
  assert.equal((await db.query("select count(*)::int as n from pg_constraint where conname in ('projects_tenant_required','usage_tenant_required','usage_project_required','usage_provenance_required')")).rows[0].n,0);
  assert.deepEqual((await db.query('select to_jsonb(t) as row from public.token_usage_logs t order by id')).rows,before);
  await assert.rejects(db.query(rollback),/requires completed phase 3/);await db.query('rollback');
  assert.deepEqual(await flags(),['YES','YES','YES','YES']);
  await stageOnlineTenancy(db,{through:7});
  assert.deepEqual(await flags(),['NO','NO','NO','NO']);
  const check=()=>db.query(readStage('verify-authorization.sql'));
  const signatureError=/Canonical dashboard signatures or grants are unsafe/;
  const accessError=/RLS, legacy view or direct-write grants are unsafe/;
  const attributionError=/Raw telemetry attribution is exposed/;
  for(const [mutation,expected] of [
   ['alter function public.get_token_usage_projects(uuid,text) reset search_path',signatureError],
   ['alter function public.get_token_usage_projects(uuid,text) set search_path=public',signatureError],
   [`alter function public.get_token_usage_projects(uuid,text) set schema private;
    create function public.get_token_usage_projects() returns text language sql stable security invoker set search_path='' as $$select 'fixture'::text$$;
    revoke all on function public.get_token_usage_projects() from public,anon,service_role;
    grant execute on function public.get_token_usage_projects() to authenticated;`,signatureError],
   [`alter function public.get_token_usage_projects(uuid,text) set schema private;
    create function public.get_token_usage_projects(uuid,integer) returns text language sql stable security invoker set search_path='' as $$select 'fixture'::text$$;
    revoke all on function public.get_token_usage_projects(uuid,integer) from public,anon,service_role;
    grant execute on function public.get_token_usage_projects(uuid,integer) to authenticated;`,signatureError],
   ['grant execute on function public.get_cost_table(uuid,text[],timestamptz,timestamptz,text) to service_role',signatureError],
   ['grant select on public.project_spend_summary to anon',accessError],
   ['grant select on public.project_spend_summary to authenticated',accessError],
   ['grant select on public.project_spend_summary to service_role',accessError],
   ['grant insert on public.token_usage_logs to authenticated',accessError],
   ['grant insert on public.token_usage_logs to service_role',accessError],
   ...['authenticated','anon'].flatMap(role=>['host_name','user_email'].map(column=>[
    `grant select(${column}) on public.token_usage_logs to ${role}`,attributionError])),
  ]){
   await db.query('begin');await db.query(mutation);await assert.rejects(check(),expected);await db.query('rollback');await check();
  }
 }});
 const maintenance=new PGlite();
 const maintenanceDb={query:async(sql,params)=>params?maintenance.query(sql,params):(await maintenance.exec(sql)).at(-1)};
 try{
  await setupFixture(sql=>maintenanceDb.query(sql),{pglite:true,applyMigration:async(name,sql)=>{
   if(!name.startsWith('20261028210000'))return maintenanceDb.query(sql);
   await stageTenancy(maintenanceDb);
   // Verify privacy before the later provenance/privacy migrations execute.
   for(const column of ['host_name','user_email']){
    assert.equal((await maintenanceDb.query("select has_column_privilege('authenticated','public.token_usage_logs',$1,'SELECT') as allowed",[column])).rows[0].allowed,false);
   }
   for(const grant of [
    'grant select on public.token_usage_logs to authenticated',
    'grant select(host_name) on public.token_usage_logs to authenticated',
    'grant select(user_email) on public.token_usage_logs to authenticated',
   ]){
    await maintenanceDb.query('begin');
    try{await maintenanceDb.query(grant);await assert.rejects(stageTenancy(maintenanceDb),/Final schema verification failed/);}
    finally{await maintenanceDb.query('rollback');}
    await stageTenancy(maintenanceDb);
   }
  }});
  await stageTenancy(maintenanceDb); // Column-limited safe grants are sufficient.
  await maintenanceDb.query('begin');
  await maintenanceDb.query('revoke select(input_tokens) on public.token_usage_logs from authenticated');
  await assert.rejects(stageTenancy(maintenanceDb),/Final schema verification failed/);
  await maintenanceDb.query('rollback');await stageTenancy(maintenanceDb);
 }finally{await maintenance.close();}
 console.log('PASS: guarded rollback/resume, exact RPC signatures/search paths, all-role view/attribution and write grants, and complete staged-dashboard read privileges');
}catch(error){console.error('Organization guard test failed:',error.message);process.exitCode=1;}
finally{await engine.close();}
