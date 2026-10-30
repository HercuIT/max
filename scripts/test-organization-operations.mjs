import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {parse} from '@babel/parser';
import {transform} from 'esbuild';
import {setupFixture} from './database-fixture.mjs';
import {backfillModelProvenance} from './backfill-model-provenance.mjs';
import {exportOrganization,exportFailureMessage} from './export-organization.mjs';
import {registerLegacyIngest,registrationFailureMessage} from './register-legacy-ingest.mjs';
const engine=new PGlite();
const db={query:async(sql,params)=>params?engine.query(sql,params):(await engine.exec(sql)).at(-1)};
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'burnrate-export-test-'));
const owner='50000000-0000-4000-8000-000000000001',other='50000000-0000-4000-8000-000000000002',viewer='50000000-0000-4000-8000-000000000003';
try{
 // Execute the actual exported Worker digest body, not a second copy of its
 // algorithm. AST extraction avoids loading Worker-only imports or Node's
 // unsupported strip-only TypeScript parameter properties elsewhere in http.ts.
 const source=await fs.readFile(new URL('../http.ts',import.meta.url),'utf8');
 const syntax=parse(source,{sourceType:'module',plugins:['typescript']});
 const digestFunctions=syntax.program.body.filter(statement=>statement.type==='ExportNamedDeclaration'&&statement.declaration?.type==='FunctionDeclaration'&&statement.declaration.id?.name==='digest');
 assert.equal(digestFunctions.length,1,'expected exactly one exported Worker digest function');
 const compiled=(await transform(source.slice(digestFunctions[0].start,digestFunctions[0].end),{loader:'ts',format:'esm',target:'es2022'})).code;
 const {digest:workerDigest}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
 assert.equal(await workerDigest('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad','Worker digest must remain SHA-256');
 const registrationQueries=[];
 const registrationDb={query:async(...args)=>{registrationQueries.push(args);return {rows:[]};}};
 const syntheticToken='existing-🔑-test-token';
 await registerLegacyIngest(registrationDb,{token:syntheticToken,expiresAt:'2026-11-01T12:00:00-06:00'});
 assert.equal(registrationQueries[0][0],'select public.register_legacy_ingest($1,$2::timestamptz)');
 assert.deepEqual(registrationQueries[0][1],[await workerDigest(syntheticToken),'2026-11-01T12:00:00-06:00']);
 assert.match(registrationQueries[0][1][0],/^[0-9a-f]{64}$/);
 const databaseExpiryQueries=[];
 const databaseExpiryDb={query:async(sql,params)=>{
  assert.equal(sql,'select public.register_legacy_ingest($1,$2::timestamptz)');
  databaseExpiryQueries.push(params[1]);
  // Exercise the same typed PostgreSQL cast as the registration call without
  // registering a real bridge or mocking PostgreSQL's calendar validation.
  return db.query('select $1::timestamptz as expires_at',[params[1]]);
 }};
 await registerLegacyIngest(databaseExpiryDb,{token:syntheticToken,expiresAt:'2026-11-01T12:00:00-06:00'});
 for(const expiresAt of ['2026-02-31T12:00:00Z','2026-02-29T12:00:00-06:00']){
  assert(Number.isFinite(Date.parse(expiresAt)),'regression fixture must be a date JavaScript silently rolls forward');
  await assert.rejects(registerLegacyIngest(databaseExpiryDb,{token:syntheticToken,expiresAt}),{code:'22008'});
  assert.equal(databaseExpiryQueries.at(-1),expiresAt,'PostgreSQL must receive the original invalid calendar date');
 }
 for(const token of [undefined,null,123,'','has space','has\nnewline','x'.repeat(513)]){
  const before=registrationQueries.length;
  await assert.rejects(registerLegacyIngest(registrationDb,{token,expiresAt:'2026-11-01T18:00:00Z'}),{code:'INVALID_LEGACY_REGISTRATION'});
  assert.equal(registrationQueries.length,before,'invalid tokens must be rejected before querying');
 }
 for(const expiresAt of [undefined,null,'','not-a-date','2026-11-01T18:00:00','2026-99-01T18:00:00Z']){
  const before=registrationQueries.length;
  await assert.rejects(registerLegacyIngest(registrationDb,{token:syntheticToken,expiresAt}),{code:'INVALID_LEGACY_REGISTRATION'});
  assert.equal(registrationQueries.length,before,'invalid or zone-less expiry must be rejected before querying');
 }
 for(const message of [exportFailureMessage({code:'42501',message:'private-secret'}),registrationFailureMessage({code:'PT409',message:'private-secret'})]){
  assert.match(message,/SQLSTATE/);assert(!message.includes('private-secret'));
 }
 for(const code of ['EPERM','EROFS','EBUSY','EXDEV']){
  for(const syscall of [undefined,'open','link']){
   const diagnostic=exportFailureMessage({code,syscall,path:'private-path',message:'private-secret'});
   assert.match(diagnostic,/filesystem error/);assert(diagnostic.includes(code));
   assert(!diagnostic.includes('SQLSTATE'));assert(!diagnostic.includes('private-path'));assert(!diagnostic.includes('private-secret'));
  }
 }
 assert(!exportFailureMessage({code:'42501',syscall:'open',message:'private-secret'}).includes('SQLSTATE'),'a system syscall must not be classified as a database error');
 assert(!registrationFailureMessage({code:'EPERM',syscall:'connect',message:'private-secret'}).includes('SQLSTATE'));
 for(const format of [exportFailureMessage,registrationFailureMessage]){
  assert.match(format({code:'ECONNREFUSED',message:'private-secret'}),/ECONNREFUSED/);
  assert(!format(new Error('private-secret')).includes('private-secret'));
 }
 await assert.rejects(registerLegacyIngest(registrationDb,{token:'synthetic-private-token',expiresAt:'invalid'}),error=>{
  assert.match(registrationFailureMessage(error),/INVALID_LEGACY_REGISTRATION.*ISO expiry/);
  assert(!registrationFailureMessage(error).includes('synthetic-private-token'));return true;
 });
 await assert.rejects(exportOrganization(db),error=>{
  assert.match(exportFailureMessage(error),/INVALID_EXPORT_REQUEST.*Supply organization/);return true;
 });
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
 assert.equal((await db.query("select count(*)::int as n from private.tenant_audit_events where tenant_id=$1 and actor_id=$2 and action='export.prepared'",[a,owner])).rows[0].n,1);
 const content=await fs.readFile(outputPath,'utf8');
 const rows=content.trim().split('\n').map(JSON.parse);
 const usage=rows.find(x=>x.type==='usage'&&x.project_name==='api');
 assert.equal(usage.model,'unknown');assert.equal(usage.raw_model,'claude-3-5-sonnet');assert.equal(usage.model_provenance,'legacy_hardcoded');
 assert.equal(usage.input_tokens,'9007199254740993');assert.equal(usage.total_cost_usd,'123.123456');
 assert.equal(rows.at(-1).input_tokens,'9007199254741002');assert.equal(rows.at(-1).total_cost_usd,'123.123456');
 assert(!content.includes('B-private-host'));assert(!content.includes('token_hash'));
 await assert.rejects(exportOrganization(db,{tenantId:b,userId:owner,outputPath:path.join(directory,'b.jsonl')}),/current verified owner or admin/);
 await assert.rejects(exportOrganization(db,{tenantId:a,userId:viewer,outputPath:path.join(directory,'viewer.jsonl')}),/current verified owner or admin/);
 await db.query("update public.tenants set status='deleting' where id=$1",[b]);
 await assert.rejects(exportOrganization(db,{tenantId:b,userId:other,outputPath:path.join(directory,'deleting.jsonl')}),{code:'EXPORT_NOT_AUTHORIZED'});
 await db.query("update public.tenants set status='active' where id=$1",[b]);
 await db.query('update auth.users set email_confirmed_at=null where id=$1',[owner]);
 await assert.rejects(exportOrganization(db,{tenantId:a,userId:owner,outputPath:path.join(directory,'unverified.jsonl')}),{code:'EXPORT_NOT_AUTHORIZED'});
 await db.query('update auth.users set email_confirmed_at=now() where id=$1',[owner]);
 assert.equal((await db.query("select count(*)::int as n from private.tenant_audit_events where tenant_id=$1 and action='export.prepared'",[b])).rows[0].n,0,'rejected exports must not record preparation');
 const empty=(await db.query("select public.bootstrap_tenant('Empty export',$1) as id",[owner])).rows[0].id;
 const emptyPath=path.join(directory,'empty.jsonl');
 assert.equal((await exportOrganization(db,{tenantId:empty,userId:owner,outputPath:emptyPath,batchSize:1})).rows,'0');
 const emptyRows=(await fs.readFile(emptyPath,'utf8')).trim().split('\n').map(JSON.parse);
 assert.deepEqual(emptyRows.map(row=>row.type),['manifest','totals']);
 assert.equal(emptyRows[1].input_tokens,'0');assert.equal(emptyRows[1].total_cost_usd,'0');
 assert.equal((await db.query("select count(*)::int as n from private.tenant_audit_events where tenant_id=$1 and actor_id=$2 and action='export.prepared'",[empty,owner])).rows[0].n,1);
 await assert.rejects(exportOrganization(db,{tenantId:a,userId:owner,outputPath}),{code:'EEXIST'});
 assert.match(exportFailureMessage({code:'EEXIST',message:'private-output-path'}),/choose a new private output path/);
 assert.equal(await fs.readFile(outputPath,'utf8'),content);
 let authorizationChecks=0;
 const revoked={query:async(sql,params)=>{
  if(sql.startsWith('select 1 from public.tenants')&&++authorizationChecks===2)await db.query("update public.tenant_memberships set role='viewer' where tenant_id=$1 and user_id=$2",[a,owner]);
  return db.query(sql,params);
 }};
 await assert.rejects(exportOrganization(revoked,{tenantId:a,userId:owner,outputPath:path.join(directory,'revoked.jsonl')}),/authorization changed/);
 assert.deepEqual((await fs.readdir(directory)).sort(),['a.jsonl','empty.jsonl']);
 console.log('PASS: registration Worker-hash parity, explicit-zone expiry preservation/PostgreSQL calendar rejection, safe filesystem/database diagnostics, bounded provenance restart/finalization and full tenant export isolation, exact numeric values, effective model, empty batches/audit, authorization predicates, no overwrite and fresh role check');
}catch(error){console.error('Organization operations test failed:',error.message);process.exitCode=1;}
finally{
 await engine.close();
 for(const name of await fs.readdir(directory))await fs.unlink(path.join(directory,name));
 await fs.rmdir(directory);
}
