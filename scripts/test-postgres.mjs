// Optional live PostgreSQL test. Refuses initialized databases; never points this at production.
import pg from 'pg';
import { assertFreshDatabase, fixtureAssertions, setupFixture } from './database-fixture.mjs';
import assert from 'node:assert/strict';
const url=process.env.TEST_DATABASE_URL;
if(!url)throw new Error('Set TEST_DATABASE_URL to a new disposable PostgreSQL database.');
const db=new pg.Client({connectionString:url});await db.connect();
const clients = [db];
try {
await assertFreshDatabase(sql => db.query(sql));
await setupFixture(sql => db.query(sql));
await db.query(fixtureAssertions());
await db.query(`insert into auth.users values ('20000000-0000-4000-8000-000000000001','one@example.test',now(),'{}'),('20000000-0000-4000-8000-000000000002','two@example.test',now(),'{}');`);
const one='20000000-0000-4000-8000-000000000001',two='20000000-0000-4000-8000-000000000002';
const tenant=(await db.query("select public.bootstrap_tenant('Concurrent',$1)",[one])).rows[0].bootstrap_tenant;
await db.query("insert into public.tenant_memberships(tenant_id,user_id,role) values($1,$2,'owner')",[tenant,two]);
const c1=new pg.Client({connectionString:url}),c2=new pg.Client({connectionString:url});clients.push(c1,c2);await c1.connect();await c2.connect();
async function begin(c,user,role='authenticated'){await c.query('begin');await c.query('set local statement_timeout=5000');await c.query('set local role '+role);if(user)await c.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);}
async function waitForLock(client){
 const pid=(await client.query('select pg_backend_pid()')).rows[0].pg_backend_pid;
 return async()=>{for(let i=0;i<100;i++){const r=await db.query('select wait_event_type from pg_stat_activity where pid=$1',[pid]);if(r.rows[0]?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,10));}throw new Error('Expected the concurrent transaction to wait on its tenant lock.');};
}
const wait2=await waitForLock(c2);
await begin(c1,one);await c1.query("select public.manage_tenant($1,'members.remove',$2)",[tenant,one]);
await begin(c2,two);const competing=c2.query("select public.manage_tenant($1,'members.remove',$2)",[tenant,two]).then(()=>null,e=>e.code);
await wait2();await c1.query('commit');assert.equal(await competing,'PT409');await c2.query('rollback');
assert.equal((await db.query("select count(*)::int as n from public.tenant_memberships where tenant_id=$1 and role='owner'",[tenant])).rows[0].n,1);
// A waiting management request must observe committed membership removal.
await db.query("insert into public.tenant_memberships(tenant_id,user_id,role) values($1,$2,'admin')",[tenant,one]);
await begin(c1,two);await c1.query("select public.manage_tenant($1,'members.remove',$2)",[tenant,one]);
await begin(c2,one);const removedAdmin=c2.query("select public.manage_tenant($1,'rename',null,'{\"name\":\"should-not-change\"}')",[tenant]).then(()=>null,e=>e.code);
await wait2();await c1.query('commit');assert.equal(await removedAdmin,'PT404');await c2.query('rollback');
await begin(c1,two);const key=(await c1.query("select public.manage_tenant($1,'keys.create',null,jsonb_build_object('label','Concurrency','token_hash',repeat('d',64),'prefix','brk_d')) as result",[tenant])).rows[0].result.id;await c1.query('commit');
await begin(c1,two);await c1.query("select public.manage_tenant($1,'keys.revoke',$2)",[tenant,key]);
await begin(c2,null,'service_role');const ingest=c2.query("select public.ingest_telemetry(repeat('d',64),'[]')").then(()=>null,e=>e.code);
await wait2();await c1.query('commit');assert.equal(await ingest,'PT401');await c2.query('rollback');
// Shared query plans on a representative 10k-row tenant fixture; capture actual timing, not a readiness assertion.
await db.query("insert into public.projects(tenant_id,name) values($1,'load')",[tenant]);
await db.query(`insert into public.token_usage_logs(tenant_id,project_id,project_name,source,session_id,input_tokens)
 select $1,p.id,p.name,case when n%2=0 then 'claude' else 'codex' end,n::text,1 from generate_series(1,10000) n cross join public.projects p where p.tenant_id=$1 and p.name='load'`,[tenant]);
await db.query('analyze public.token_usage_logs');
const plan=await db.query('explain (analyze,buffers,format json) select * from public.token_usage_logs where tenant_id=$1 and source=$2 and recorded_at>=now()-interval \'7 days\'',[tenant,'codex']);
console.log('PASS: PostgreSQL full isolation suite, concurrent last-owner removal, revoked-key transaction ordering; 10k-row filtered query execution ms:',plan.rows[0]['QUERY PLAN'][0]['Execution Time']);
} finally {
    await Promise.all(clients.map(client => client.end()));
}
