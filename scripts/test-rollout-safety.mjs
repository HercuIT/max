import assert from 'node:assert/strict';
import {buildConcurrentIndex,retryLockOperation,stageOnlineTenancy} from './online-tenancy.mjs';
import {backfillModelProvenance} from './backfill-model-provenance.mjs';

// A failed concurrent CREATE may leave an invalid relation. Retrying CREATE
// IF NOT EXISTS alone would silently retain it instead of completing the build.
let invalid=false,creates=0,drops=0,lookups=0;
const indexDb={query:async(sql)=>{
 if(sql.startsWith('select indisvalid')){lookups++;return {rows:invalid?[{indisvalid:false}]:[]};}
 if(sql.startsWith('drop index concurrently')){drops++;invalid=false;return {rows:[]};}
 if(sql.startsWith('create index concurrently')){
  creates++;
  if(creates===1){invalid=true;throw Object.assign(new Error('synthetic index lock conflict'),{code:'55P03'});}
  return {rows:[]};
 }
 throw new Error('Unexpected index query');
}};
await buildConcurrentIndex(indexDb,'create index concurrently if not exists usage_tenant_time on public.token_usage_logs(tenant_id,recorded_at desc);',{sleep:async()=>{}});
assert.equal(creates,2);assert.equal(drops,1);assert.equal(lookups,2);assert.equal(invalid,false);

let attempts=0,delays=[];
await assert.rejects(retryLockOperation(async()=>{attempts++;throw Object.assign(new Error('deadlock'),{code:'40P01'});},{sleep:async ms=>{delays.push(ms);}}),{code:'40P01'});
assert.equal(attempts,8);assert.deepEqual(delays,[100,200,300,400,500,600,700]);
attempts=0;
await assert.rejects(retryLockOperation(async()=>{attempts++;throw Object.assign(new Error('statement timeout requires tuning, not lock retries'),{code:'57014'});},{sleep:async()=>{}}),{code:'57014'});
assert.equal(attempts,1);
await assert.rejects(stageOnlineTenancy({}, {indexStatementTimeoutMs:0}),/Index statement timeout/);

// The configured timeout must apply before the bounded calls, pending scan and
// independently committed validations; callers can tune production-scale scans.
const seen=[];
const modelDb={query:async(sql,args)=>{
 seen.push({sql,args});
 if(sql.includes('pg_try_advisory_lock'))return {rows:[{acquired:true}]};
 if(sql.includes('public.backfill_model_provenance'))return {rows:[{n:0}]};
 if(sql.includes(' as pending'))return {rows:[{pending:false}]};
 if(sql.includes(' as present'))return {rows:[{present:true}]};
 return {rows:[]};
}};
await backfillModelProvenance(modelDb,{statementTimeoutMs:120000});
const timeout=seen.findIndex(x=>x.sql.includes("set_config('statement_timeout'"));
assert.deepEqual(seen[timeout].args,['120000']);
for(const fragment of ['public.backfill_model_provenance',' as pending','validate constraint usage_provenance_required','validate constraint usage_model_provenance_values']){
 assert(seen.findIndex(x=>x.sql.includes(fragment))>timeout,fragment+' must follow configurable timeout');
}
await assert.rejects(backfillModelProvenance({}, {statementTimeoutMs:NaN}),/Statement timeout/);
console.log('PASS: concurrent-index invalid-build recovery, bounded lock/deadlock retries, no timeout retry loop, and configurable provenance validation timeout');
