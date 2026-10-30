// Optional integration check against a NEW disposable PostgreSQL database.
import pg from 'pg';
import assert from 'node:assert/strict';
import {assertFreshDatabase,fixtureAssertions,setupFixture} from './database-fixture.mjs';
import {stageTenancy,cutoverVersion} from './stage-tenancy.mjs';
if(!process.env.TEST_DATABASE_URL)throw new Error('Set TEST_DATABASE_URL to a fresh disposable database.');
const db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await db.connect();
try{
 await assertFreshDatabase(sql=>db.query(sql));
 await setupFixture(sql=>db.query(sql),{applyMigration:async(name,sql)=>{
  if(!name.startsWith(cutoverVersion)){await db.query(sql);return;}
  let interrupted=false;
  await assert.rejects(stageTenancy(db,{batchSize:1,onProgress:message=>{
   if(message.includes('historical usage assignments')){interrupted=true;throw new Error('planned interruption after committed batch');}
  }}),/planned interruption/);
  assert(interrupted);
  assert.equal((await db.query('select count(*)::int as n from public.token_usage_logs where tenant_id is not null and project_id is not null')).rows[0].n,1);
  await stageTenancy(db,{batchSize:1});
  // Privacy must hold at cutover, not only after the appended privacy migration.
  for(const column of ['host_name','user_email']){
   assert.equal((await db.query("select has_column_privilege('authenticated','public.token_usage_logs',$1,'SELECT') as allowed",[column])).rows[0].allowed,false);
  }
  for(const grant of [
   'grant select on public.token_usage_logs to authenticated',
   'grant select(host_name) on public.token_usage_logs to authenticated',
   'grant select(user_email) on public.token_usage_logs to authenticated',
  ]){
   await db.query('begin');
   try{await db.query(grant);await assert.rejects(stageTenancy(db,{batchSize:1}),/Final schema verification failed/);}
   finally{await db.query('rollback');}
   await stageTenancy(db,{batchSize:1});
  }
 }});
 await stageTenancy(db,{batchSize:1}); // A completed rollout is also safely repeatable.
 assert.equal((await db.query('select phase from private.tenancy_rollout_state')).rows[0].phase,5);
 await db.query(fixtureAssertions());
 assert.equal((await db.query("select to_regclass('supabase_migrations.schema_migrations') is null as untouched")).rows[0].untouched,true);
 console.log('PASS: staged expansion, committed bounded backfill restart, concurrent indexes, validated constraints, RLS/RPC equivalence and untouched migration ledger');
}finally{await db.end();}
