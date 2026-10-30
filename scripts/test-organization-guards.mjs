import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {setupFixture} from './database-fixture.mjs';
import {stageOnlineTenancy,readStage} from './online-tenancy.mjs';
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
  for(const mutation of [
   'alter function public.get_token_usage_projects(uuid,text) reset search_path',
   'alter function public.get_token_usage_projects(uuid,text) set search_path=public',
   `alter function public.get_token_usage_projects(uuid,text) set schema private;
    create function public.get_token_usage_projects() returns text language sql stable security invoker set search_path='' as $$select 'fixture'::text$$;
    revoke all on function public.get_token_usage_projects() from public,anon,service_role;
    grant execute on function public.get_token_usage_projects() to authenticated;`,
   'grant select on public.project_spend_summary to anon',
   'grant select on public.project_spend_summary to authenticated',
   'grant select(host_name) on public.token_usage_logs to authenticated',
  ]){
   await db.query('begin');await db.query(mutation);await assert.rejects(check());await db.query('rollback');await check();
  }
 }});
 console.log('PASS: inert rollback reference, guarded phase-003 rollback/resume, preserved data, pinned search path and all-role view/attribution checks');
}catch(error){console.error('Organization guard test failed:',error.message);process.exitCode=1;}
finally{await engine.close();}
