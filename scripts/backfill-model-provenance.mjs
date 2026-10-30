import {pathToFileURL} from 'node:url';
import pg from 'pg';

export async function backfillModelProvenance(db,{batchSize=5000,onProgress=()=>{}}={}) {
 if(!Number.isInteger(batchSize)||batchSize<1||batchSize>10000)throw new Error('Invalid batch size.');
 if(!(await db.query("select pg_try_advisory_lock(hashtext('burnrate-model-provenance')) as acquired")).rows[0].acquired)throw new Error('Another provenance backfill is running.');
 try{
  await db.query("set lock_timeout='5s'; set statement_timeout='60s'");
  while(true){const n=(await db.query('select public.backfill_model_provenance($1) as n',[batchSize])).rows[0].n;if(!n)break;onProgress(`Committed ${n} provenance assignments.`);}
  const pending=(await db.query('select exists(select 1 from public.token_usage_logs where model_provenance is null) as pending')).rows[0].pending;
  if(pending)throw new Error('Some rows are locked or unclassified; retry finalization later.');
  const present=(await db.query("select exists(select 1 from pg_constraint where conrelid='public.token_usage_logs'::regclass and conname='usage_provenance_required') as present")).rows[0].present;
  if(!present)await db.query('alter table public.token_usage_logs add constraint usage_provenance_required check(model_provenance is not null) not valid');
  const values=(await db.query("select exists(select 1 from pg_constraint where conrelid='public.token_usage_logs'::regclass and conname='usage_model_provenance_values') as present")).rows[0].present;
  if(!values)await db.query("alter table public.token_usage_logs add constraint usage_model_provenance_values check(model_provenance in ('legacy_hardcoded','reported','unknown')) not valid");
  await db.query('alter table public.token_usage_logs validate constraint usage_provenance_required');
  await db.query('alter table public.token_usage_logs validate constraint usage_model_provenance_values');
  await db.query('alter table public.token_usage_logs alter column model_provenance set not null');
 }finally{await db.query("select pg_advisory_unlock(hashtext('burnrate-model-provenance'))");}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(!process.argv.includes('--confirm-backup-rehearsed')||!process.env.TENANCY_DATABASE_URL)throw new Error('Read the runbook; set TENANCY_DATABASE_URL securely and attest --confirm-backup-rehearsed.');
 const db=new pg.Client({connectionString:process.env.TENANCY_DATABASE_URL});
 try{await db.connect();await backfillModelProvenance(db,{onProgress:console.log});console.log('Model provenance backfill and constraints verified.');}
 catch{console.error('Provenance backfill stopped; inspect privately and resume.');process.exitCode=1;}
 finally{await db.end();}
}
