// Operator-assisted export, never an HTTP endpoint. All rows share one MVCC
// snapshot; role is rechecked freshly before publishing the restricted file.
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function exportOrganization(db,{tenantId,userId,outputPath,batchSize=500}={}) {
 if(!uuid.test(tenantId??'')||!uuid.test(userId??'')||!outputPath||!Number.isInteger(batchSize)||batchSize<1||batchSize>10000)throw new Error('Supply organization, verified owner/admin UUID, output path and a valid batch size.');
 const partial=outputPath+'.'+randomUUID()+'.partial';
 let file,inTransaction=false;
 const authorized=async()=>!!(await db.query(`select 1 from public.tenants t join public.tenant_memberships m on m.tenant_id=t.id
  join auth.users u on u.id=m.user_id where t.id=$1 and m.user_id=$2 and t.status='active'
  and m.role in ('owner','admin') and u.email_confirmed_at is not null`,[tenantId,userId])).rows.length;
 try{
  file=await fs.open(partial,'wx',0o600);
  const write=row=>file.write(JSON.stringify(row)+'\n');
  await db.query('begin isolation level repeatable read');inTransaction=true;
  await db.query("set local statement_timeout='60s'; set local lock_timeout='5s'");
  if(!await authorized())throw new Error('Organization export requires its current verified owner or admin.');
  const tenant=(await db.query('select id,name,status,created_at from public.tenants where id=$1',[tenantId])).rows[0];
  await write({type:'manifest',schemaVersion:1,exportedAt:new Date().toISOString(),organization:tenant});
  const projects=(await db.query('select id,name,created_at from public.projects where tenant_id=$1 order by id',[tenantId])).rows;
  for(const project of projects)await write({type:'project',...project});
  // Parameters are bound in the DECLARE statement; FETCH count is a validated integer.
  await db.query(`declare organization_export no scroll cursor for
   select (to_jsonb(t)-'model') || jsonb_build_object('model',a.effective_model,'raw_model',a.raw_model,'model_provenance',a.model_provenance,
    'input_tokens',t.input_tokens::text,'output_tokens',t.output_tokens::text,'cache_read_tokens',t.cache_read_tokens::text,
    'cache_write_tokens',t.cache_write_tokens::text,'total_cost_usd',t.total_cost_usd::text) as usage
   from public.token_usage_logs t join public.token_usage_model_attribution a on a.id=t.id and a.tenant_id=t.tenant_id
   where t.tenant_id=$1 order by t.id`,[tenantId]);
  while(true){const batch=(await db.query(`fetch ${batchSize} from organization_export`)).rows;if(!batch.length)break;for(const row of batch)await write({type:'usage',...row.usage});}
  const totals=(await db.query(`select count(*)::text as rows,
   coalesce(sum(input_tokens),0)::text as input_tokens,coalesce(sum(output_tokens),0)::text as output_tokens,
   coalesce(sum(cache_read_tokens),0)::text as cache_read_tokens,coalesce(sum(cache_write_tokens),0)::text as cache_write_tokens,
   coalesce(sum(total_cost_usd),0)::text as total_cost_usd from public.token_usage_logs where tenant_id=$1`,[tenantId])).rows[0];
  await write({type:'totals',...totals});
  await db.query("insert into private.tenant_audit_events(tenant_id,actor_id,action) values($1,$2,'export.prepared')",[tenantId,userId]);
  await db.query('commit');inTransaction=false;
  await file.sync();await file.close();file=null;
  if(!await authorized())throw new Error('Export authorization changed; file was not published.');
  // Link is exclusive, unlike rename which can overwrite a prior export.
  await fs.link(partial,outputPath);
  return {outputPath,rows:totals.rows};
 }finally{
  if(inTransaction)await db.query('rollback');
  if(file)await file.close();
  await fs.unlink(partial).catch(error=>{if(error.code!=='ENOENT')throw error;});
  // Delivery remains operator-assisted; a prepared/published artifact is not
  // evidence it was emailed or downloaded. No customer data is printed.
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=Object.fromEntries(process.argv.slice(2).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
 if(!process.env.TENANCY_DATABASE_URL)throw new Error('Set TENANCY_DATABASE_URL securely.');
 const db=new pg.Client({connectionString:process.env.TENANCY_DATABASE_URL});
 try{await db.connect();await exportOrganization(db,{tenantId:args['--organization'],userId:args['--requester'],outputPath:args['--output']});console.log('Organization export prepared. Verify recipient access and deliver securely.');}
 catch{console.error('Organization export failed; no data or credentials printed.');process.exitCode=1;}
 finally{await db.end();}
}
