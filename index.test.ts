import { beforeEach, describe, expect, it, vi } from 'vitest';
const { insert, rpc, getUser, refreshSession, signInWithOtp, verifyOtp, signOut, createClient } = vi.hoisted(() => {
 const insert=vi.fn(); const rpc=vi.fn(); const getUser=vi.fn(); const refreshSession=vi.fn();
 const signInWithOtp=vi.fn(); const verifyOtp=vi.fn(); const signOut=vi.fn();
 const createClient=vi.fn(()=>({rpc,auth:{getUser,refreshSession,signInWithOtp,verifyOtp,admin:{signOut}}}));
 return {insert,rpc,getUser,refreshSession,signInWithOtp,verifyOtp,signOut,createClient};
});
vi.mock('@supabase/supabase-js',()=>({createClient}));
import worker, {parseCodexLogs, type Env} from './index';
import {digest, randomToken, readJson, databaseError, uuid, ApiError} from './http';
import {dashboardArguments} from './tenancy';
import {sessionFor} from './auth';
const tenant='10000000-0000-4000-8000-000000000001';
const other='10000000-0000-4000-8000-000000000002';
const testEnv:Env={SUPABASE_URL:'https://example.supabase.test',SUPABASE_PUBLISHABLE_KEY:'test-publishable',SUPABASE_SERVICE_ROLE_KEY:'test-service',APP_ORIGIN:'https://x'};
const authCookie='__Host-burnrate-access=valid; __Host-burnrate-csrf=csrf';
beforeEach(()=>{
 vi.clearAllMocks(); vi.unstubAllGlobals();
 insert.mockResolvedValue({error:null});
 getUser.mockResolvedValue({data:{user:null},error:null});
 refreshSession.mockResolvedValue({data:{session:null},error:null});
 signInWithOtp.mockResolvedValue({error:null}); verifyOtp.mockResolvedValue({data:{session:{access_token:'access',refresh_token:'refresh',expires_in:3600}},error:null}); signOut.mockResolvedValue({error:null});
 rpc.mockImplementation(async(name:string,args:any)=>{
  if(name==='check_rate_limit')return {data:true,error:null};
  if(name==='ingest_telemetry'){if(args.p_rows.length)await insert(args.p_rows);return {data:{count:args.p_rows.length,tenant_id:tenant,key_id:other},error:null};}
  if(name==='list_tenants')return {data:[{id:tenant,name:'A',role:'owner'}],error:null};
  if(name==='manage_tenant')return {data:{id:other,email:'invite@example.test'},error:null};
  if(name==='accept_tenant_invitation')return {data:tenant,error:null};
  return {data:[],error:null};
 });
});
function signedIn(){getUser.mockResolvedValue({data:{user:{id:other}},error:null});}
function call(path:string,method='GET',body?:unknown,headers:Record<string,string>={}){
 return worker.fetch(new Request('https://x'+path,{method,headers:{'Content-Type':'application/json',Cookie:authCookie,Origin:'https://x','X-CSRF-Token':'csrf',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),testEnv);
}
describe('Codex OTLP logs and dashboard sources', () => {
    const attrs = (values: Record<string, string | number>) => Object.entries(values).map(([key, value]) => ({
        key, value: typeof value === 'string' ? { stringValue: value } : { intValue: String(value) },
    }));
    const usage = { 'event.name': 'codex.sse_event', 'event.kind': 'response.completed',
        input_token_count: '100', output_token_count: '25', cached_token_count: 40,
        cache_write_token_count: 10, reasoning_token_count: 15, 'conversation.id': 'conversation-1', model: 'gpt-5-codex' };
    async function send(events: Record<string, string | number>[], query = '') {
        return worker.fetch(new Request('https://x/v1/logs' + query, {
            method: 'POST', headers: { Authorization: 'Bearer brk_' + 'a'.repeat(64), 'Content-Type': 'application/json' },
            body: JSON.stringify({ resourceLogs: [{ resource: { attributes: attrs({ 'project.name': 'repo', 'host.name': 'host' }) },
                scopeLogs: [{ logRecords: events.map((event) => ({ attributes: attrs(event) })) }] }] }),
        }), testEnv);
    }
    it('stores disjoint tokens and reported cost without adding reasoning tokens twice', async () => {
        expect((await send([usage, { 'event.name': 'codex.turn_cost', 'usage.estimated_usd': '0.125',
            'conversation.id': 'conversation-1', model: 'gpt-5-codex' }])).status).toBe(200);
        expect(insert.mock.calls[0][0]).toEqual([
            { source: 'codex', project_name: 'repo', session_id: 'conversation-1', model: 'gpt-5-codex',
                input_tokens: 50, output_tokens: 25, cache_read_tokens: 40, cache_write_tokens: 10,
                total_cost_usd: 0, host_name: 'host', user_email: null },
            expect.objectContaining({ source: 'codex', input_tokens: 0, output_tokens: 0, total_cost_usd: 0.125 }),
        ]);
    });
    it('allows an explicit exporter project name', async () => {
        await send([usage], '?project=other-repo');
        expect(insert.mock.calls[0][0][0].project_name).toBe('other-repo');
    });
    it('ignores non-usage, failed, and generic completion events', async () => {
        await send([{ 'event.name': 'codex.user_prompt' }, { 'event.name': 'codex.sse_event', 'event.kind': 'response.completed' },
            { ...usage, 'error.message': 'stream failed' }, { 'event.name': 'codex.turn_cost' }]);
        expect(insert).not.toHaveBeenCalled();
    });
    it.each([-1, 'NaN', '1.5', '9007199254740992', '', '  ', '\t\n'])('counts invalid tokens %s without inserting', async (value) => {
        const response = await send([{ ...usage, input_token_count: value }]);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ partialSuccess: { rejectedLogRecords: '1' } });
        expect(insert).not.toHaveBeenCalled();
    });
    it('rejects cached counts exceeding input and invalid estimated costs', async () => {
        const invalidEvents: Record<string, string | number>[] = [{ ...usage, cached_token_count: 101 },
            { 'event.name': 'codex.turn_cost', 'usage.estimated_usd': '-1' }];
        for (const event of invalidEvents) {
            const response = await send([event]);
            expect(response.status).toBe(200);
            expect(await response.json()).toMatchObject({ partialSuccess: { rejectedLogRecords: '1' } });
        }
        expect(insert).not.toHaveBeenCalled();
    });
    it.each(['', ' ', '\t\n'])('rejects blank cost %j while inserting valid siblings', async (cost) => {
        const response = await send([
            { ...usage, input_token_count: '' },
            usage,
            { 'event.name': 'codex.turn_cost', 'usage.estimated_usd': cost },
            { 'event.name': 'codex.turn_cost', 'usage.estimated_usd': '0.25' },
        ]);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ partialSuccess: { rejectedLogRecords: '2' } });
        expect(insert.mock.calls[0][0]).toEqual([
            expect.objectContaining({ input_tokens: 50, output_tokens: 25 }),
            expect.objectContaining({ total_cost_usd: 0.25 }),
        ]);
    });
    it('reports Codex database failures', async () => {
        rpc.mockImplementation(async(name:string)=>name==='check_rate_limit'?{data:true,error:null}:{data:null,error:{message:'insert failed'}});
        const response = await send([usage]);
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({code:'database_unavailable'});
    });
    it('handles missing token fields and metadata', async () => {
        await send([{ 'event.name': 'codex.sse_event', 'event.kind': 'response.completed', output_token_count: 2 }]);
        expect(insert.mock.calls[0][0][0]).toMatchObject({ input_tokens: 0, output_tokens: 2,
            session_id: 'unknown_session', model: 'unknown_model' });
    });
});
describe('Codex OTLP value and metadata variants', () => {
    it('accepts eventName and double values, falls back to the source project name', () => {
        const records = parseCodexLogs({ resourceLogs: [{ scopeLogs: [{ logRecords: [{
            eventName: 'codex.turn_cost', attributes: [
                { key: 'usage.estimated_usd', value: { doubleValue: 0.5 } },
                { key: 'user.email', value: { stringValue: 'developer@example.test' } },
            ],
        }] }] }] }, null);
        expect(records.records).toEqual([expect.objectContaining({ source: 'codex', project_name: 'codex',
            total_cost_usd: 0.5, host_name: null, user_email: 'developer@example.test' })]);
    });
    it('ignores resource and scope blocks with no logs', () => {
        expect(parseCodexLogs({ resourceLogs: [{}, { scopeLogs: [{}] }] }, null)).toEqual({ records: [], rejectedLogRecords: 0 });
    });
});

describe('tenant HTTP boundary',()=>{
 it.each(['/dashboard/token-usage','/settings'])('redirects signed-out navigation %s',async path=>{const r=await call(path);expect(r.status).toBe(303);expect(r.headers.get('location')).toBe('/sign-in');});
 it('requires a session and removes Basic Auth/global reads',async()=>{
  expect((await call('/api/tenants')).status).toBe(401);
  expect((await call('/api/token-usage/table')).status).toBe(410);
  expect((await call('/api/cost/table')).status).toBe(410);
 });
 it.each(['/sign-in','/invite','/dashboard/token-usage','/settings'])('serves safe HTML for %s',async path=>{
  signedIn();const r=await call(path);expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');expect(await r.text()).toContain('<!doctype html>');
 });
 it.each(['/favicon.svg','/favicon-32.png'])('serves public asset %s',async path=>{expect((await call(path)).status).toBe(200);expect(getUser).not.toHaveBeenCalled();});
 it('returns 404 for unknown page',async()=>{expect((await call('/missing')).status).toBe(404);});
 it('loads memberships and safe member display data',async()=>{signedIn();expect((await call('/api/tenants')).status).toBe(200);expect((await call(`/api/tenants/${tenant}/members`)).status).toBe(200);});
 for(const path of ['token-usage/projects','token-usage/table','token-usage/series','cost/table','cost/series']){
  it('uses the user JWT and required tenant for '+path,async()=>{
   signedIn();const r=await call(`/api/tenants/${tenant}/${path}?source=codex&projects=repo`);expect(r.status).toBe(200);
   expect(rpc).toHaveBeenCalledWith('get_'+path.replaceAll('-','_').replace('/','_'),expect.objectContaining({p_tenant_id:tenant,p_source:'codex'}));
   expect(createClient).toHaveBeenCalledWith(testEnv.SUPABASE_URL,'test-publishable',expect.objectContaining({global:{headers:{Authorization:'Bearer valid'}}}));
   expect(createClient.mock.calls.some((c:any[])=>c[1]==='test-service')).toBe(false);
  });
 }
 it('returns generic inaccessible organization errors',async()=>{signedIn();const r=await call(`/api/tenants/${other}/cost/table`);expect(r.status).toBe(404);expect(rpc).not.toHaveBeenCalledWith('get_cost_table',expect.anything());});
 it.each(['source=bad','bucket=month','start=garbage','start=2026-02-30T00:00:00Z','start=2026-13-01T00:00:00Z','start=2026-10-29T00:00:00Z&end=2026-10-28T00:00:00Z'])('validates query %s',async query=>{signedIn();expect((await call(`/api/tenants/${tenant}/cost/table?${query}`)).status).toBe(400);});
 it('validates organization and target UUIDs',async()=>{signedIn();expect((await call('/api/tenants/bad/members')).status).toBe(400);expect((await call(`/api/tenants/${tenant}/members/bad`,'DELETE')).status).toBe(400);});
 it('returns stable errors for unsupported operations',async()=>{signedIn();expect((await call(`/api/tenants/${tenant}/unknown`)).status).toBe(404);});
 it('blocks cross-origin and missing-CSRF mutations',async()=>{signedIn();expect((await call(`/api/tenants/${tenant}`,'PATCH',{name:'B'},{Origin:'https://evil.test'})).status).toBe(403);expect((await call(`/api/tenants/${tenant}`,'PATCH',{name:'B'},{'X-CSRF-Token':''})).status).toBe(403);});
 it.each([['','PATCH',{name:'New'}],['deletion-request','POST',{confirmation:'A'}],['members/'+other,'PATCH',{role:'viewer'}],['members/'+other,'DELETE',undefined],['ingestion-keys/'+other,'DELETE',undefined],['invitations/'+other,'DELETE',undefined],['invitations','GET',undefined],['ingestion-keys','GET',undefined]] as const)('routes admin %s %s',async(path,method,body)=>{signedIn();expect((await call(`/api/tenants/${tenant}${path?'/'+path:''}`,method,body)).status).toBe(200);});
 it('generates key entropy server-side and returns the raw key only at creation',async()=>{
  signedIn();const r=await call(`/api/tenants/${tenant}/ingestion-keys`,'POST',{label:'Laptop',token_hash:'evil',prefix:'evil'});expect(r.status).toBe(201);const data:any=await r.json();expect(data.token).toMatch(/^brk_[0-9a-f]{64}$/);
  const args=rpc.mock.calls.find((c:any[])=>c[0]==='manage_tenant')![1];expect(args.p_values.token_hash).toBe(await digest(data.token));expect(args.p_values.token_hash).not.toBe('evil');expect(r.headers.get('cache-control')).toBe('no-store');
 });
 it('reports persisted invitation delivery failures',async()=>{signedIn();const r=await call(`/api/tenants/${tenant}/invitations`,'POST',{email:'invite@example.test',role:'viewer'});expect(r.status).toBe(503);expect(await r.json()).toMatchObject({id:other,delivered:false,code:'invitation_delivery_failed'});});
 it('sends invitation through configured authenticated HTTPS integration',async()=>{
  signedIn();const fetcher=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',fetcher);
  const env={...testEnv,INVITATION_DELIVERY_URL:'https://mail.test/send',INVITATION_DELIVERY_TOKEN:'delivery-test'};
  const req=new Request(`https://x/api/tenants/${tenant}/invitations/${other}/resend`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:authCookie,Origin:'https://x','X-CSRF-Token':'csrf'},body:'{}'});
  expect((await worker.fetch(req,env)).status).toBe(201);expect(String(fetcher.mock.calls[0][0])).toBe('https://mail.test/send');expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer delivery-test');expect(fetcher.mock.calls[0][1].redirect).toBe('error');
 });
 it('accepts a hashed invitation token and validates shape',async()=>{signedIn();expect((await call('/api/invitations/accept','POST',{token:'bri_'+'c'.repeat(64)})).status).toBe(200);expect((await call('/api/invitations/accept','POST',{token:'bad'})).status).toBe(400);});
 it('does not expose unexpected exception details',async()=>{getUser.mockRejectedValue(new Error('private-credential'));const r=await call('/api/tenants');expect(r.status).toBe(500);expect(await r.text()).not.toContain('private-credential');});
});

describe('Supabase Auth cookie lifecycle',()=>{
 it('issues HttpOnly secure CSRF cookies without exposing tokens',async()=>{const r=await call('/api/session','GET',undefined,{Cookie:''});expect(r.status).toBe(200);expect(r.headers.get('set-cookie')).toContain('HttpOnly; Secure; SameSite=Lax');expect(await r.json()).toMatchObject({signedIn:false,csrf:expect.stringMatching(/^csrf_/)});});
 it('refreshes an expired session, validates Auth user and preserves new cookies',async()=>{
  getUser.mockResolvedValueOnce({data:{user:null},error:null}).mockResolvedValueOnce({data:{user:{id:other}},error:null});
  refreshSession.mockResolvedValue({data:{session:{access_token:'new-access',refresh_token:'new-refresh',expires_in:3600}},error:null});
  const r=await call('/api/session','GET',undefined,{Cookie:authCookie+'; __Host-burnrate-refresh=refresh'});expect(await r.json()).toMatchObject({signedIn:true});expect(r.headers.get('set-cookie')).toContain('new-access');
 });
 it('clears invalid sessions',async()=>{const r=await call('/api/session');expect(r.headers.get('set-cookie')).toContain('Max-Age=0');});
 it('fails safely during Auth outage',async()=>{getUser.mockResolvedValue({data:{user:null},error:{status:503}});expect((await call('/api/session')).status).toBe(503);});
 it('handles refresh outage',async()=>{refreshSession.mockResolvedValue({data:{session:null},error:{status:503}});expect((await call('/api/session','GET',undefined,{Cookie:'__Host-burnrate-refresh=refresh'})).status).toBe(503);});
 it('sends generic OTP response and verifies emailed code',async()=>{expect((await call('/auth/sign-in','POST',{email:'a@example.test'})).status).toBe(200);const r=await call('/auth/verify','POST',{email:'a@example.test',code:'123456'});expect(r.status).toBe(200);expect(r.headers.get('set-cookie')).toContain('__Host-burnrate-access=access');expect(await r.text()).not.toContain('refresh');});
 it.each([['/auth/sign-in',{email:'bad'},400],['/auth/verify',{email:'a@example.test',code:'x'},400]])('validates %s',async(path,body,status)=>{expect((await call(path as string,'POST',body)).status).toBe(status);});
 it('rejects expired OTP and reports sign-in outages',async()=>{verifyOtp.mockResolvedValue({data:{session:null},error:{message:'expired'}});expect((await call('/auth/verify','POST',{email:'a@example.test',code:'123456'})).status).toBe(401);signInWithOtp.mockResolvedValue({error:{status:503}});expect((await call('/auth/sign-in','POST',{email:'a@example.test'})).status).toBe(503);});
 it('signs out and clears local cookies',async()=>{const r=await call('/auth/sign-out','POST',{});expect(r.status).toBe(200);expect(r.headers.get('set-cookie')).toContain('Max-Age=0');expect(signOut).toHaveBeenCalledWith('valid','local');});
 it('requires POST for Auth mutations',async()=>{expect((await call('/auth/verify')).status).toBe(405);});
});

describe('bounded, tenant-key ingestion',()=>{
 const bearer={Authorization:'Bearer brk_'+'a'.repeat(64)};
 it('authenticates empty metrics through a narrow service RPC',async()=>{const r=await call('/v1/metrics','POST',{},bearer);expect(r.status).toBe(200);expect(rpc).toHaveBeenCalledWith('ingest_telemetry',{p_token_hash:await digest('brk_'+'a'.repeat(64)),p_rows:[]});});
 it('rejects global/unknown keys and read methods',async()=>{expect((await call('/v1/metrics','POST',{}, {Authorization:'Bearer old-shared-key'})).status).toBe(401);expect((await call('/v1/logs')).status).toBe(405);});
 it('propagates revoked key rejection without leaking details',async()=>{rpc.mockImplementation(async(name:string)=>name==='check_rate_limit'?{data:true,error:null}:{data:null,error:{code:'PT401',message:'Unauthorized'}});expect((await call('/v1/metrics','POST',{},bearer)).status).toBe(401);});
 it('enforces distributed limits',async()=>{rpc.mockResolvedValue({data:false,error:null});expect((await call('/v1/metrics','POST',{},bearer)).status).toBe(429);});
 it('reports limiter database outages',async()=>{rpc.mockResolvedValue({data:null,error:{message:'private'}});expect((await call('/v1/metrics','POST',{},bearer)).status).toBe(503);});
 it('bounds streaming request body and validates JSON/content type',async()=>{
  expect((await call('/v1/metrics','POST',{huge:'a'.repeat(1048576)},bearer)).status).toBe(413);
  expect((await call('/v1/metrics','POST',{}, {...bearer,'Content-Type':'text/plain'})).status).toBe(415);
  const r=await worker.fetch(new Request('https://x/v1/metrics',{method:'POST',headers:{...bearer,'Content-Type':'application/json'},body:'invalid'}),testEnv);expect(r.status).toBe(400);
 });
 it('rejects more than 5000 normalized rows',async()=>{
  const records=Array.from({length:5001},()=>({asInt:'1',attributes:[{key:'type',value:{stringValue:'input'}}]}));
  expect((await call('/v1/metrics','POST',{resourceMetrics:[{scopeMetrics:[{metrics:[{name:'claude_code.token.usage',sum:{dataPoints:records}}]}]}]},bearer)).status).toBe(413);
 });
});

describe('validation helpers',()=>{
 it.each(['22023','23514','22P02','22007','22008','22003'])('maps field SQLSTATE %s',code=>expect(()=>databaseError({code})).toThrow(ApiError));
 it.each(['PT401','PT403','PT404','PT409','PT413','23505','unknown'])('maps SQLSTATE %s safely',code=>expect(()=>databaseError({code})).toThrow(ApiError));
 it('generates random opaque tokens and validates UUID',()=>{expect(randomToken('brk_')).not.toBe(randomToken('brk_'));expect(uuid(tenant)).toBe(tenant);});
 it('rejects no body or nonobject JSON',async()=>{await expect(readJson(new Request('https://x',{headers:{'Content-Type':'application/json'}}))).rejects.toThrow(ApiError);await expect(readJson(new Request('https://x',{method:'POST',headers:{'Content-Type':'application/json'},body:'[]'}))).rejects.toThrow(ApiError);});
 it('preserves valid query dates and project filters',()=>{expect(dashboardArguments(new URL('https://x?projects=a,%20b,,&start=2026-01-01T00:00:00Z&end=2026-02-01T00:00:00Z&bucket=week'),tenant)).toMatchObject({p_projects:['a','b'],p_bucket:'week',p_start:'2026-01-01T00:00:00Z'});});
});


describe('additional auth and payload regressions',()=>{
 it('reports Auth transport errors without clearing valid refresh cookies',async()=>{getUser.mockResolvedValue({data:{user:null},error:{status:0}});const r=await call('/api/session');expect(r.status).toBe(503);expect(r.headers.get('set-cookie')).toBeNull();});
 it('reports OTP verification outages',async()=>{verifyOtp.mockResolvedValue({data:{session:null},error:{status:503}});expect((await call('/auth/verify','POST',{email:'a@example.test',code:'123456'})).status).toBe(503);});
 it('rejects malformed OTLP array shapes',async()=>{expect((await call('/v1/metrics','POST',{resourceMetrics:{}},{Authorization:'Bearer brk_'+'a'.repeat(64)})).status).toBe(400);});
 it('validates administrative value types',async()=>{signedIn();expect((await call(`/api/tenants/${tenant}`,'PATCH',{name:{bad:true}})).status).toBe(400);expect((await call(`/api/tenants/${tenant}/ingestion-keys`,'POST',{label:'label',expires_at:'bad-date'})).status).toBe(400);});
});


describe('local logout during upstream failure',()=>{
 it('clears cookies even when Auth cannot validate or revoke the session',async()=>{getUser.mockRejectedValue(new Error('offline'));signOut.mockRejectedValue(new Error('offline'));const r=await call('/auth/sign-out','POST',{});expect(r.status).toBe(200);expect(r.headers.get('set-cookie')).toContain('Max-Age=0');expect(getUser).not.toHaveBeenCalled();});
 it('clears cookies when remote logout returns an Auth error',async()=>{signOut.mockResolvedValue({error:{status:503}});expect((await call('/auth/sign-out','POST',{})).status).toBe(200);});
});
