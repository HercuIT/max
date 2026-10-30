// Executes every operator SQL stage verbatim. PGlite covers SQL semantics and
// restartability; --postgres uses a NEW disposable PostgreSQL for real indexes.
import {PGlite} from '@electric-sql/pglite';
import pg from 'pg';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {assertFreshDatabase,setupFixture} from './database-fixture.mjs';
import {stageOnlineTenancy,verifyLegacyHistory} from './online-tenancy.mjs';
const postgres=process.argv.includes('--postgres');
if(postgres&&!process.env.TEST_DATABASE_URL)throw new Error('Set TEST_DATABASE_URL to a NEW disposable PostgreSQL database.');
const engine=postgres?new pg.Client({connectionString:process.env.TEST_DATABASE_URL}):new PGlite();
if(postgres)await engine.connect();
const db=postgres?engine:{query:async(sql,params)=>params?engine.query(sql,params):(await engine.exec(sql)).at(-1)};
try{
 await assertFreshDatabase(sql=>db.query(sql));
 await setupFixture(sql=>db.query(sql),{pglite:!postgres,applyMigration:async(name,sql)=>{
  if(!name.startsWith('20261028210000')){await db.query(sql);return;}
  await assert.rejects(verifyLegacyHistory(db),/ledger is missing/);
  await stageOnlineTenancy(db,{through:1});
  await db.query(`set role service_role`);
  await db.query("insert into public.token_usage_logs(project_name,source,model,input_tokens,total_cost_usd) values('during-expansion','claude','claude-3-5-sonnet',3,0.123456)");
  await db.query('reset role');
  assert.equal((await db.query("select model_provenance from public.token_usage_logs where project_name='during-expansion'")).rows[0].model_provenance,'legacy_hardcoded');
  await assert.rejects(stageOnlineTenancy(db,{through:6,batchSize:1,onProgress:message=>{
   if(message.startsWith('Committed '))throw new Error('planned committed-batch interruption');
  }}),/planned committed-batch/);
  await db.query('set role service_role');
  await db.query("insert into public.token_usage_logs(project_name,source,model,input_tokens) values('during-backfill','codex','gpt-reported',4)");
  await db.query('reset role');
  await stageOnlineTenancy(db,{through:6,batchSize:1});
  assert.equal((await db.query('select sum(input_tokens)::text as n from public.token_usage_logs')).rows[0].n,'16');
  assert.equal((await db.query("select sum(total_cost_usd)::text as n from public.token_usage_logs")).rows[0].n,'0.123456');
  await db.query("insert into auth.users(id,email,email_confirmed_at) values('40000000-0000-4000-8000-000000000001','gate@example.test',now())");
  await assert.rejects(db.query("select public.bootstrap_tenant('Too early','40000000-0000-4000-8000-000000000001')"),/admission gate/);
  await db.query('set role service_role');
  await db.query("select public.register_legacy_ingest(repeat('c',64),now()+interval '1 day')");
  await db.query("select public.ingest_legacy_telemetry(repeat('c',64),'[]')");
  await assert.rejects(db.query("select public.ingest_legacy_telemetry(repeat('f',64),'[]')"),/Unauthorized/);
  await db.query('reset role');
  await stageOnlineTenancy(db,{through:7,batchSize:1});
  assert.equal((await db.query("select to_regprocedure('public.get_token_usage_projects(text)') is null as retired")).rows[0].retired,true);
  assert.equal((await db.query("select has_function_privilege('service_role','private.get_token_usage_projects(text)','execute') as allowed")).rows[0].allowed,false);
  assert.equal((await db.query("select has_table_privilege('service_role','public.project_spend_summary','select') as allowed")).rows[0].allowed,false);
  await db.query('set role service_role');
  await db.query("select public.ingest_legacy_telemetry(repeat('c',64),'[]')");
  await assert.rejects(db.query("insert into public.token_usage_logs(project_name) values('rejected-after-drain')"),/permission denied/);
  await db.query('reset role');
  await stageOnlineTenancy(db,{through:8});
  await db.query('set role service_role');
  await assert.rejects(db.query("select public.ingest_legacy_telemetry(repeat('c',64),'[]')"),/Unauthorized/);
  await assert.rejects(db.query("select public.ingest_telemetry(repeat('c',64),'[]')"),/Unauthorized/);
  await db.query('reset role');
  await stageOnlineTenancy(db,{through:8});
  assert.equal((await db.query("select to_regclass('supabase_migrations.schema_migrations') is null as untouched")).rows[0].untouched,true);
 }});
 await db.query(fs.readFileSync(new URL('../tests/organizations.sql',import.meta.url),'utf8'));
 // Final backfill NOT NULL proof remains effective with normal narrow ingestion.
 assert.equal((await db.query("select is_nullable from information_schema.columns where table_schema='public' and table_name='token_usage_logs' and column_name='model_provenance'")).rows[0].is_nullable,'NO');
 console.log('PASS: online SQL stages, live legacy inserts, interrupted batch restart, fixed-cohort checks, admission gate, bounded bridge/retirement, grants/RLS, model provenance and deletion recovery; '+(postgres?'PostgreSQL':'PGlite (single connection)'));
}catch(error){console.error('Online test failed:',error.message);process.exitCode=1;}
finally{await(postgres?engine.end():engine.close());}
