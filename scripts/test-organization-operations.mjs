import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {setupFixture} from './database-fixture.mjs';
import {backfillModelProvenance} from './backfill-model-provenance.mjs';
import {exportOrganization} from './export-organization.mjs';
const engine=new PGlite();
const db={query:async(sql,params)=>params?engine.query(sql,params):(await engine.exec(sql)).at(-1)};
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'burnrate-export-test-'));
const owner='50000000-0000-4000-8000-000000000001',other='50000000-0000-4000-8000-000000000002',viewer='50000000-0000-4000-8000-000000000003';
try{
 await setupFixture(sql=>db.query(sql),{pglite:true});
 await assert.rejects(backfillModelProvenance(db,{batchSize:1,onProgress:()=>{throw new Error('planned interruption');}}),/planned interruption/);
 await backfillModelProvenance(db,{batchSize:1});await backfillModelProvenance(db,{batchSize:1});
 assert.equal((await db.query("select is_nullable from information_schema.columns where table_name='token_usage_logs' and column_name='model_provenance'")).rows[0].is_nullable,'NO');
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now()),($5,$6,now())',[owner,'owner@example.test',other,'other@example.test',viewer,'viewer@example.test']);
 const a=(await db.query("select public.bootstrap_tenant('Export A',$1,true) as id",[owner])).rows[0].id;
 const b=(await db.query("select public.bootstrap_tenant('Export B',$1) as id",[other])).rows[0].id;
 await db.query("insert into public.tenant_memberships(tenant_id,user_id,role) values($1,$2,'viewer')",[a,viewer]);
 for(const tenant of [a,b]){
  const pid=(await db.query("insert into public.projects(tenant_id,name) values($1,'api') returning id",[tenant])).rows[0].id;
  await db.query(`insert into public.token_usage_logs(tenant_id,project_id,project_name,source,model,input_tokens,total_cost_usd,host_name)
   values($1,$2,'api','claude','claude-3-5-sonnet',9007199254740993,123.123456,$3)`,[tenant,pid,tenant===a?'A-host':'B-private-host']);
 }
 const outputPath=path.join(directory,'a.jsonl');
 const result=await exportOrganization(db,{tenantId:a,userId:owner,outputPath,batchSize:1});
 assert.equal(result.rows,'2');
 const content=await fs.readFile(outputPath,'utf8');
 const rows=content.trim().split('\n').map(JSON.parse);
 const usage=rows.find(x=>x.type==='usage'&&x.project_name==='api');
 assert.equal(usage.model,'unknown');assert.equal(usage.raw_model,'claude-3-5-sonnet');assert.equal(usage.model_provenance,'legacy_hardcoded');
 assert.equal(usage.input_tokens,'9007199254740993');assert.equal(usage.total_cost_usd,'123.123456');
 assert.equal(rows.at(-1).input_tokens,'9007199254741002');assert.equal(rows.at(-1).total_cost_usd,'123.123456');
 assert(!content.includes('B-private-host'));assert(!content.includes('token_hash'));
 await assert.rejects(exportOrganization(db,{tenantId:b,userId:owner,outputPath:path.join(directory,'b.jsonl')}),/current verified owner or admin/);
 await assert.rejects(exportOrganization(db,{tenantId:a,userId:viewer,outputPath:path.join(directory,'viewer.jsonl')}),/current verified owner or admin/);
 await assert.rejects(exportOrganization(db,{tenantId:a,userId:owner,outputPath}),/exist/i);
 assert.equal(await fs.readFile(outputPath,'utf8'),content);
 let authorizationChecks=0;
 const revoked={query:async(sql,params)=>{
  if(sql.startsWith('select 1 from public.tenants')&&++authorizationChecks===2)await db.query("update public.tenant_memberships set role='viewer' where tenant_id=$1 and user_id=$2",[a,owner]);
  return db.query(sql,params);
 }};
 await assert.rejects(exportOrganization(revoked,{tenantId:a,userId:owner,outputPath:path.join(directory,'revoked.jsonl')}),/authorization changed/);
 assert.deepEqual(await fs.readdir(directory),['a.jsonl']);
 console.log('PASS: bounded provenance restart/finalization and full tenant export isolation, exact numeric values, effective model, no overwrite and fresh role check');
}catch(error){console.error('Organization operations test failed:',error.message);process.exitCode=1;}
finally{
 await engine.close();
 for(const name of await fs.readdir(directory))await fs.unlink(path.join(directory,name));
 await fs.rmdir(directory);
}
