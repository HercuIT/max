// Operator-only online rollout. Never executes Supabase migration repair or
// reads application credentials. Use one direct/session-mode database connection.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import pg from 'pg';

const root=new URL('./organizations/',import.meta.url);
export const stageFiles=fs.readdirSync(root).filter(x=>/^00[1-8]_.*\.sql$/.test(x)).sort();
export const readStage=name=>fs.readFileSync(new URL(name,root),'utf8');
const version='20261028210000';

// Concurrent index DDL cannot run inside transaction(), but needs the same
// bounded lock/deadlock recovery. Each retry must inspect/remove invalid builds.
export async function retryLockOperation(work,{sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
 for(let attempt=0;;attempt++){
  try{return await work();}
  catch(error){
   if(!['55P03','40P01'].includes(error.code)||attempt>=7)throw error;
   await sleep(100*(attempt+1));
  }
 }
}

export async function buildConcurrentIndex(db,statement,retryOptions) {
 const name=/^create (?:unique )?index concurrently if not exists (\w+) /.exec(statement)?.[1];
 if(!name)throw new Error('Unrecognized index stage.');
 return retryLockOperation(async()=>{
  const index=(await db.query('select indisvalid from pg_index where indexrelid=to_regclass($1)',['public.'+name])).rows[0];
  if(index&&!index.indisvalid)await db.query('drop index concurrently public.'+name);
  await db.query(statement);
 },retryOptions);
}

export async function verifyLegacyHistory(db) {
 const present=(await db.query("select to_regclass('supabase_migrations.schema_migrations') is not null as present")).rows[0].present;
 if(!present)throw new Error('Migration ledger is missing; inventory deployment state before proceeding.');
 const applied=new Set((await db.query('select version from supabase_migrations.schema_migrations')).rows.map(x=>x.version));
 const earlier=['20261022222115','20261022223638','20261024150026','20261024183711','20261028190000','20261028195000'];
 let completedOnline=false;
 if(applied.has(version)){
  const state=(await db.query("select to_regclass('private.organization_rollout_state') is not null as present")).rows[0].present;
  if(state)completedOnline=!!(await db.query('select phase>=7 as completed from private.organization_rollout_state where singleton')).rows[0]?.completed;
 }
 if(earlier.some(x=>!applied.has(x))||(applied.has(version)&&!completedOnline))throw new Error('Online legacy path requires earlier migrations and either a pending cutover or its verified online progress.');
}

export async function stageOnlineTenancy(db,{through=6,batchSize=5000,statementTimeoutMs=60000,indexStatementTimeoutMs=1800000,onProgress=()=>{}}={}) {
 if(!Number.isInteger(through)||through<1||through>8)throw new Error('Through must be a stage from 1 to 8.');
 if(!Number.isInteger(batchSize)||batchSize<1||batchSize>10000)throw new Error('Batch size must be between 1 and 10000.');
 if(!Number.isInteger(statementTimeoutMs)||statementTimeoutMs<1000||statementTimeoutMs>3600000)throw new Error('Invalid statement timeout.');
 if(!Number.isInteger(indexStatementTimeoutMs)||indexStatementTimeoutMs<1000||indexStatementTimeoutMs>86400000)throw new Error('Index statement timeout must be between 1000 and 86400000 ms.');
 if(stageFiles.length!==8||stageFiles.some((name,i)=>!name.startsWith('00'+(i+1)+'_')))throw new Error('Expected exactly the eight reviewed online stages.');
 const sources=[...stageFiles.map(readStage),readStage('legacy-bridge.sql'),readStage('verify.sql'),readStage('verify-authorization.sql'),fs.readFileSync(new URL(import.meta.url),'utf8')];
 const checksum=createHash('sha256').update(sources.map(sql=>sql.replace(/\r\n/g,'\n')).join('\n')).digest('hex');
 if(!(await db.query("select pg_try_advisory_lock(hashtext('burnrate-staged-tenancy')) as acquired")).rows[0].acquired)throw new Error('Another tenancy rollout is running.');
 async function transaction(work,phase,catalog=false){
  for(let attempt=0;;attempt++){
   await db.query('begin');
   try{
    if(catalog){
     // Legacy inserts lock logs before projects; scoped RPCs lock tenants first.
     // Never wait for a second table while holding the first: NOWAIT breaks the
     // inversion between these two writer generations without deadlocking one.
     await db.query('lock table public.token_usage_logs in access exclusive mode');
     await db.query('lock table public.projects in access exclusive mode nowait');
     if(phase!==1)await db.query('lock table public.tenants,public.tenant_memberships,auth.users in access exclusive mode nowait');
    }
    await work();if(phase!==undefined)await db.query('update private.organization_rollout_state set phase=$1,updated_at=now() where singleton',[phase]);await db.query('commit');return;
   }catch(error){
    await db.query('rollback');
    if(!['55P03','40P01'].includes(error.code)||attempt>=7)throw error;
    await new Promise(resolve=>setTimeout(resolve,100*(attempt+1)));
   }
  }
 }
 try{
  await db.query("set lock_timeout='5s'");
  await db.query("select set_config('statement_timeout',$1,false)",[String(statementTimeoutMs)]);
  const hasState=(await db.query("select to_regclass('private.organization_rollout_state') is not null as present")).rows[0].present;
  if(!hasState){
   const state=(await db.query(`select to_regclass('public.tenants') is not null or to_regclass('private.tenancy_rollout_state') is not null as existing,
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='token_usage_logs' and column_name='source') as source`)).rows[0];
   if(state.existing||!state.source)throw new Error('Refusing upgraded, partially staged, or unrecognized schema; use the deployment-state runbook.');
   await transaction(async()=>{
    await db.query(`create schema if not exists private;
     revoke all on schema private from public,anon,authenticated;
     create table private.organization_rollout_state(singleton boolean primary key default true check(singleton),checksum text not null,
      phase integer not null default 0,baseline_captured boolean not null default false,updated_at timestamptz not null default now());
     revoke all on private.organization_rollout_state from public,anon,authenticated,service_role;`);
    await db.query('insert into private.organization_rollout_state(checksum) values($1)',[checksum]);
   });
  }
  const state=(await db.query('select * from private.organization_rollout_state where singleton')).rows[0];
  if(!state||state.checksum!==checksum)throw new Error('Online rollout checksum changed; reconcile before resuming.');
  let phase=state.phase;
  const progress=n=>onProgress(`Online stage ${n} committed.`);
  if(phase<1&&through>=1){await transaction(()=>db.query(readStage(stageFiles[0])),1,true);phase=1;progress(1);}
  if(phase<2&&through>=2){
   await transaction(()=>db.query(readStage(stageFiles[1])));
   if(!state.baseline_captured)await transaction(async()=>{
    await db.query('set transaction isolation level repeatable read');
    await db.query(`insert into private.organization_baseline_usage select id,to_jsonb(t)-'tenant_id'-'project_id'-'model_provenance' from public.token_usage_logs t;
     insert into private.organization_baseline_projects select id,to_jsonb(p)-'tenant_id' from public.projects p;
     update private.organization_rollout_state set baseline_captured=true where singleton;`);
   });
   while(true){let count=0;await transaction(async()=>{count=(await db.query('select private.backfill_organization_batch($1) as n',[batchSize])).rows[0].n;});if(!count)break;onProgress(`Committed ${count} ownership/provenance assignments.`);}
   await transaction(()=>db.query(readStage('verify.sql')),2);phase=2;progress(2);
  }
  // Add each constraint once, allowing resume after an independently committed
  // validation failed or timed out. Names/table identifiers come only from files.
  async function addConstraints(sql){
   const constraints=[];
   for(const statement of sql.replace(/^--.*$/gm,'').split(';').map(x=>x.trim()).filter(x=>/^alter table/.test(x))){
    const match=/^alter table public\.(\w+) add constraint (\w+)/.exec(statement);
    if(!match)throw new Error('Unrecognized constraint stage.');
    constraints.push({table:match[1],name:match[2]});
    const exists=(await db.query('select exists(select 1 from pg_constraint where conrelid=to_regclass($1) and conname=$2) as present',['public.'+match[1],match[2]])).rows[0].present;
    if(!exists)await db.query(statement);
   }
   return constraints;
  }
  async function validate(constraints){
   for(const {table,name} of constraints){
    const pending=(await db.query('select exists(select 1 from pg_constraint where conrelid=to_regclass($1) and conname=$2 and not convalidated) as pending',['public.'+table,name])).rows[0].pending;
    if(pending)await db.query(`alter table public.${table} validate constraint ${name}`);
   }
  }
  if(phase<3&&through>=3){
   await validate(await addConstraints(readStage(stageFiles[2])));
   await transaction(()=>db.query(`alter table public.projects alter column tenant_id set not null;
    alter table public.token_usage_logs alter column tenant_id set not null,alter column project_id set not null,alter column model_provenance set not null;
    alter table public.projects drop constraint projects_tenant_required;
    alter table public.token_usage_logs drop constraint usage_tenant_required,drop constraint usage_project_required,drop constraint usage_provenance_required;`),3,true);
   phase=3;progress(3);
  }
  if(phase<4&&through>=4){
   await db.query("select set_config('statement_timeout',$1,false)",[String(indexStatementTimeoutMs)]);
   try{
   for(const statement of readStage(stageFiles[3]).split('\n').map(x=>x.trim()).filter(x=>x.startsWith('create '))){
    await buildConcurrentIndex(db,statement);
   }
   }finally{await db.query("select set_config('statement_timeout',$1,false)",[String(statementTimeoutMs)]);}
   await transaction(async()=>{},4);phase=4;progress(4);
  }
  if(phase<5&&through>=5){
   await validate(await addConstraints(readStage(stageFiles[4])));
   await transaction(()=>db.query(readStage('verify.sql')),5);phase=5;progress(5);
  }
  if(phase<6&&through>=6){
   await transaction(async()=>{await db.query(readStage(stageFiles[5]));await db.query(readStage('legacy-bridge.sql'));},6,true);phase=6;progress(6);
  }
  if(phase<7&&through>=7){
   // Fixed-cohort scans run before and after, never under catalog-exclusive locks.
   await db.query(readStage('verify.sql'));
   await transaction(async()=>{await db.query(readStage(stageFiles[6]));await db.query(readStage('verify-authorization.sql'));},7,true);phase=7;progress(7);
  }
  if(phase<8&&through>=8){await transaction(()=>db.query(readStage(stageFiles[7])),8,true);phase=8;progress(8);}
  if(phase>=2)await db.query(readStage('verify.sql'));
  if(phase>=7)await db.query(readStage('verify-authorization.sql'));
  return {phase,checksum};
 }finally{await db.query("select pg_advisory_unlock(hashtext('burnrate-staged-tenancy'))");}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2);
 const through=Number(args.find(x=>x.startsWith('--through='))?.split('=')[1]??6);
 const required=['--confirm-backup-rehearsed','--confirm-durable-delivery'];
 if(through>=7)required.push('--confirm-auth-cutover','--confirm-old-readers-drained');
 if(through>=8)required.push('--confirm-exporters-rotated','--confirm-old-writers-drained');
 if(required.some(x=>!args.includes(x)))throw new Error('Read docs/organizations-online.md and provide the required operational attestations: '+required.join(', '));
 if(!process.env.TENANCY_DATABASE_URL)throw new Error('Set TENANCY_DATABASE_URL securely.');
 const db=new pg.Client({connectionString:process.env.TENANCY_DATABASE_URL});
 try{
  await db.connect();await verifyLegacyHistory(db);
  const {phase}=await stageOnlineTenancy(db,{through,batchSize:Number(args.find(x=>x.startsWith('--batch-size='))?.split('=')[1]??5000),statementTimeoutMs:Number(args.find(x=>x.startsWith('--statement-timeout-ms='))?.split('=')[1]??60000),indexStatementTimeoutMs:Number(args.find(x=>x.startsWith('--index-statement-timeout-ms='))?.split('=')[1]??1800000),onProgress:console.log});
  console.log(`Verified online phase ${phase}. No migration ledger was changed.`);
 }catch(error){console.error('Online rollout stopped; inspect privately and resume after reconciliation. Database code:',/^[A-Z0-9]{5}$/.test(error.code??'')?error.code:'operator-check');process.exitCode=1;}
 finally{await db.end();}
}
