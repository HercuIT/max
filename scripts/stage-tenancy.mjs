// Operator-only staged equivalent of the immutable 20261028210000 cutover.
// Never marks a Supabase migration as applied; see docs/tenancy-operations.md.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import pg from 'pg';

export const cutoverVersion='20261028210000';
const legacyTenant='00000000-0000-4000-8000-000000000001';
export function tenancyPhases() {
 const sql=fs.readFileSync(new URL('../supabase/migrations/'+cutoverVersion+'_multi_tenancy.sql',import.meta.url),'utf8');
 function between(start,end){const a=sql.indexOf(start),b=sql.indexOf(end,a+start.length);if(a<0||b<0)throw new Error('Immutable migration layout changed; review the staged runner.');return sql.slice(a,b);}
 return {
  checksum:createHash('sha256').update(sql).digest('hex'),
  expand:between('create schema if not exists private;','alter table public.projects add column tenant_id')+`
   alter table public.projects add column tenant_id uuid;
   alter table public.projects add constraint projects_tenant_id_fkey foreign key(tenant_id) references public.tenants(id) on delete cascade not valid;
   alter table public.token_usage_logs add column tenant_id uuid, add column project_id uuid;
   alter table public.token_usage_logs add constraint token_usage_logs_tenant_id_fkey foreign key(tenant_id) references public.tenants(id) on delete cascade not valid;
  `+between('create table private.ingestion_keys (','create function private.tenant_role('),
  cutover:`alter table public.projects drop constraint projects_name_key;\ndrop view public.project_spend_summary;\n`+sql.slice(sql.indexOf('create function private.tenant_role(')),
 };
}

export async function stageTenancy(db,{batchSize=5000,statementTimeoutMs=60000,onProgress=()=>{}}={}) {
 if(!Number.isInteger(batchSize)||batchSize<1||batchSize>10000)throw new Error('Batch size must be between 1 and 10000.');
 if(!Number.isInteger(statementTimeoutMs)||statementTimeoutMs<1000||statementTimeoutMs>3600000)throw new Error('Statement timeout must be between 1000 and 3600000 ms.');
 const phases=tenancyPhases();
 if(!(await db.query("select pg_try_advisory_lock(hashtext('burnrate-staged-tenancy')) as acquired")).rows[0].acquired)throw new Error('Another staged tenancy rollout is running.');
 try {
  await db.query("set lock_timeout='5s'");
  await db.query("select set_config('statement_timeout',$1,false)",[String(statementTimeoutMs)]);
  const hasState=(await db.query("select to_regclass('private.tenancy_rollout_state') is not null as present")).rows[0].present;
  if(!hasState) {
   const already=(await db.query("select to_regclass('public.tenants') is not null as present")).rows[0].present;
   if(already)throw new Error('Tenant schema already exists without staged progress. Do not replay or repair this migration blindly.');
   const ready=await db.query("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='token_usage_logs' and column_name='source') as ready");
   if(!ready.rows[0].ready)throw new Error('Apply the migrations before 20261028210000 first; source-aware legacy schema is required.');
   await db.query(`create schema if not exists private;
    create table private.tenancy_rollout_state(version text primary key,checksum text not null,phase integer not null,updated_at timestamptz not null default now());
    revoke all on private.tenancy_rollout_state from public,anon,authenticated,service_role;`);
   await db.query('insert into private.tenancy_rollout_state(version,checksum,phase) values($1,$2,0)',[cutoverVersion,phases.checksum]);
  }
  const state=(await db.query('select * from private.tenancy_rollout_state where version=$1',[cutoverVersion])).rows[0];
  if(!state||state.checksum!==phases.checksum)throw new Error('Staged migration checksum mismatch; stop and reconcile the immutable migration before continuing.');
  let phase=state.phase;
  async function transaction(work,nextPhase){await db.query('begin');try{await work();if(nextPhase!==undefined)await db.query('update private.tenancy_rollout_state set phase=$1,updated_at=now() where version=$2',[nextPhase,cutoverVersion]);await db.query('commit');}catch(error){await db.query('rollback');throw error;}}
  if(phase<1){await transaction(()=>db.query(phases.expand),1);phase=1;onProgress('Nullable schema expansion committed.');}
  if(phase<4){
   while(true){let n=0;await transaction(async()=>{const rows=(await db.query('select id from public.projects where tenant_id is null order by id limit $1 for update',[batchSize])).rows;n=rows.length;if(n)await db.query('update public.projects set tenant_id=$1 where id=any($2::uuid[])',[legacyTenant,rows.map(x=>x.id)]);});if(!n)break;onProgress(`Committed ${n} historical project assignments.`);}
   while(true){let n=0;await transaction(async()=>{
    const rows=(await db.query('select id from public.token_usage_logs where tenant_id is null or project_id is null order by id limit $1 for update',[batchSize])).rows;n=rows.length;if(!n)return;
    const ids=rows.map(x=>x.id);
    await db.query(`insert into public.projects(tenant_id,name) select distinct $1::uuid,t.project_name from public.token_usage_logs t where t.id=any($2::uuid[]) on conflict(name) do nothing`,[legacyTenant,ids]);
    const updated=await db.query(`update public.token_usage_logs t set tenant_id=$1,project_id=p.id from public.projects p where t.id=any($2::uuid[]) and p.tenant_id=$1 and p.name=t.project_name`,[legacyTenant,ids]);
    if(updated.rowCount!==n)throw new Error('A historical project could not be resolved in the legacy tenant.');
   });if(!n)break;onProgress(`Committed ${n} historical usage assignments.`);}
   await transaction(async()=>{
    const bad=(await db.query(`select exists(select 1 from public.projects where tenant_id is distinct from $1::uuid) or exists(select 1 from public.token_usage_logs t left join public.projects p on p.id=t.project_id and p.tenant_id=t.tenant_id where t.tenant_id is distinct from $1::uuid or p.id is null) as bad`,[legacyTenant])).rows[0].bad;
    if(bad)throw new Error('Historical ownership/link verification failed. Keep writers paused and reconcile before cutover.');
   },Math.max(phase,2));phase=Math.max(phase,2);
  }
  const indexes=[
   ['projects_tenant_name_key_stage','public.projects','tenant_id,name',true],
   ['projects_tenant_id_key_stage','public.projects','tenant_id,id',true],
   ['usage_tenant_time','public.token_usage_logs','tenant_id,recorded_at desc',false],
   ['usage_tenant_source_time','public.token_usage_logs','tenant_id,source,recorded_at desc',false],
   ['usage_tenant_project_time','public.token_usage_logs','tenant_id,project_id,recorded_at desc',false],
  ];
  if(phase<3){
   for(const [name,table,columns,unique] of indexes){
    const existing=(await db.query('select i.indisvalid from pg_index i where i.indexrelid=to_regclass($1)',['public.'+name])).rows[0];
    if(existing&&!existing.indisvalid)await db.query('drop index concurrently public.'+name);
    if(!existing||!existing.indisvalid)await db.query(`create ${unique?'unique ':''}index concurrently ${name} on ${table}(${columns})`);
    onProgress(`Concurrent index ${name} is valid.`);
   }
   await transaction(async()=>{},3);phase=3;
  }
  if(phase<4){
   // Attach prebuilt unique indexes and add NOT VALID checks/FKs with brief catalog locks.
   await transaction(async()=>{
    const names=new Set((await db.query("select conname from pg_constraint where conrelid in ('public.projects'::regclass,'public.token_usage_logs'::regclass)")).rows.map(x=>x.conname));
    const definitions={
     projects_tenant_name_key:'alter table public.projects add constraint projects_tenant_name_key unique using index projects_tenant_name_key_stage',
     projects_tenant_id_key:'alter table public.projects add constraint projects_tenant_id_key unique using index projects_tenant_id_key_stage',
     projects_tenant_required:'alter table public.projects add constraint projects_tenant_required check(tenant_id is not null) not valid',
     usage_tenant_required:'alter table public.token_usage_logs add constraint usage_tenant_required check(tenant_id is not null) not valid',
     usage_project_required:'alter table public.token_usage_logs add constraint usage_project_required check(project_id is not null) not valid',
     usage_tenant_project_fk:'alter table public.token_usage_logs add constraint usage_tenant_project_fk foreign key(tenant_id,project_id) references public.projects(tenant_id,id) on delete cascade not valid',
    };
    for(const [name,definition] of Object.entries(definitions))if(!names.has(name))await db.query(definition);
   });
   for(const [table,name] of [['projects','projects_tenant_id_fkey'],['projects','projects_tenant_required'],['token_usage_logs','token_usage_logs_tenant_id_fkey'],['token_usage_logs','usage_tenant_required'],['token_usage_logs','usage_project_required'],['token_usage_logs','usage_tenant_project_fk']]){
    await db.query(`alter table public.${table} validate constraint ${name}`);
    onProgress(`Validated ${name} in its own transaction.`);
   }
   await transaction(()=>db.query(`alter table public.projects alter column tenant_id set not null;
    alter table public.token_usage_logs alter column tenant_id set not null,alter column project_id set not null;
    alter table public.projects drop constraint projects_tenant_required;
    alter table public.token_usage_logs drop constraint usage_tenant_required,drop constraint usage_project_required;`),4);phase=4;
  }
  if(phase<5){await transaction(()=>db.query(phases.cutover),5);onProgress('RLS, grants and required-tenant RPC cutover committed.');}
  const final=(await db.query(`select
   (select count(*)=3 from information_schema.columns where table_schema='public' and ((table_name='projects' and column_name='tenant_id') or (table_name='token_usage_logs' and column_name in ('tenant_id','project_id'))) and is_nullable='NO')
   and (select count(*)=3 and bool_and(convalidated) from pg_constraint where conname in ('projects_tenant_id_fkey','token_usage_logs_tenant_id_fkey','usage_tenant_project_fk'))
   and not has_table_privilege('anon','public.token_usage_logs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
   and has_column_privilege('authenticated','public.token_usage_logs','tenant_id','SELECT')
   and not has_table_privilege('authenticated','public.token_usage_logs','INSERT,UPDATE,DELETE,TRUNCATE')
   and (select count(*)=5 and bool_and(indisvalid) from pg_index where indexrelid in (to_regclass('public.projects_tenant_name_key'),to_regclass('public.projects_tenant_id_key'),to_regclass('public.usage_tenant_time'),to_regclass('public.usage_tenant_source_time'),to_regclass('public.usage_tenant_project_time')))
   and (select count(*)=5 and bool_and(p.proargtypes[0]='uuid'::regtype and not has_function_privilege('anon',p.oid,'EXECUTE') and has_function_privilege('authenticated',p.oid,'EXECUTE')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('get_token_usage_projects','get_token_usage_series','get_token_usage_table','get_cost_table','get_cost_series'))
   and (select count(*)=4 and bool_and(relrowsecurity) from pg_class where oid in ('public.tenants'::regclass,'public.tenant_memberships'::regclass,'public.projects'::regclass,'public.token_usage_logs'::regclass)) as ready`)).rows[0].ready;
  if(!final)throw new Error('Final schema verification failed; do not repair the migration ledger.');
  onProgress('Equivalent staged schema verified. Compare historical totals/backups, then explicitly repair migration 20261028210000 as applied. No ledger was changed.');
 }finally{await db.query("select pg_advisory_unlock(hashtext('burnrate-staged-tenancy'))");}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(!process.argv.includes('--confirm-maintenance'))throw new Error('Pause all legacy writers and read the cutover runbook, then pass --confirm-maintenance.');
 if(!process.env.TENANCY_DATABASE_URL)throw new Error('Set TENANCY_DATABASE_URL securely to the operator migration database connection.');
 const db=new pg.Client({connectionString:process.env.TENANCY_DATABASE_URL});await db.connect();
 try{await stageTenancy(db,{batchSize:Number(process.argv.find(x=>x.startsWith('--batch-size='))?.split('=')[1]??5000),statementTimeoutMs:Number(process.argv.find(x=>x.startsWith('--statement-timeout-ms='))?.split('=')[1]??60000),onProgress:message=>console.log(message)});}finally{await db.end();}
}
