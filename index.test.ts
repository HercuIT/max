import { beforeEach, describe, expect, it, vi } from 'vitest';
const { insert, rpc, getUser, refreshSession, signInWithOtp, verifyOtp, signOut, exchangeCodeForSession, createClient } = vi.hoisted(() => {
 const insert=vi.fn(); const rpc=vi.fn(); const getUser=vi.fn(); const refreshSession=vi.fn();
 const signInWithOtp=vi.fn(); const verifyOtp=vi.fn(); const signOut=vi.fn(); const exchangeCodeForSession=vi.fn();
 const createClient=vi.fn(()=>({rpc,auth:{getUser,refreshSession,signInWithOtp,verifyOtp,exchangeCodeForSession,admin:{signOut}}}));
 return {insert,rpc,getUser,refreshSession,signInWithOtp,verifyOtp,signOut,exchangeCodeForSession,createClient};
});
vi.mock('@supabase/supabase-js',()=>({createClient}));
import worker, {parseCodexLogs, type Env} from './index';
import compatibility from './compatibility';
import {faviconAssets} from './assets';
import {digest, randomToken, readJson, databaseError, uuid, ApiError} from './http';
import {dashboardArguments} from './tenancy';
import {sessionFor} from './auth';
const tenant='10000000-0000-4000-8000-000000000001';
const other='10000000-0000-4000-8000-000000000002';
const testEnv:Env={SUPABASE_URL:'https://example.supabase.test',SUPABASE_PUBLISHABLE_KEY:'test-publishable',SUPABASE_SERVICE_ROLE_KEY:'test-service',APP_ORIGIN:'https://x'};
const authCookie='__Host-burnrate-access=valid; __Host-burnrate-csrf=csrf';
beforeEach(()=>{
 vi.clearAllMocks(); vi.unstubAllGlobals();
 exchangeCodeForSession.mockResolvedValue({data:{session:{access_token:'access',refresh_token:'refresh',expires_in:3600}},error:null});
 insert.mockResolvedValue({error:null});
 getUser.mockResolvedValue({data:{user:null},error:null});
 refreshSession.mockResolvedValue({data:{session:null},error:null});
 signInWithOtp.mockResolvedValue({error:null}); verifyOtp.mockResolvedValue({data:{session:{access_token:'access',refresh_token:'refresh',expires_in:3600}},error:null}); signOut.mockResolvedValue({error:null});
 rpc.mockImplementation(async(name:string,args:any)=>{
  if(name==='check_rate_limit')return {data:true,error:null};
  if(name==='ingest_telemetry'||name==='ingest_legacy_telemetry'){if(args.p_rows.length)await insert(args.p_rows);return {data:{count:args.p_rows.length,tenant_id:tenant,key_id:other},error:null};}
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
 it('renders signed-out sign-in without initializing Supabase',async()=>{
  const r=await worker.fetch(new Request('https://x/sign-in'),{...testEnv,SUPABASE_URL:'',SUPABASE_PUBLISHABLE_KEY:''});
  expect(r.status).toBe(200);expect(await r.text()).toContain('<!doctype html>');expect(createClient).not.toHaveBeenCalled();
 });
 it.each(['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY'] as const)('reports missing %s as a configuration failure',async key=>{
  const r=await worker.fetch(new Request('https://x/api/session',{headers:{Cookie:authCookie}}),{...testEnv,[key]:' '});
  expect(r.status).toBe(503);expect(await r.json()).toMatchObject({code:'auth_configuration_error'});expect(createClient).not.toHaveBeenCalled();
 });
 it('sanitizes SDK configuration exceptions',async()=>{
  createClient.mockImplementationOnce(()=>{throw new Error('private-configuration-value');});
  const r=await call('/api/session');expect(r.status).toBe(503);
  const body=await r.text();expect(body).toContain('auth_configuration_error');expect(body).not.toContain('private-configuration-value');
 });
 it.each(['/dashboard/token-usage','/settings'])('redirects signed-out navigation %s',async path=>{const r=await call(path);expect(r.status).toBe(303);expect(r.headers.get('location')).toBe('/sign-in');});
 it('requires a session and removes Basic Auth/global reads',async()=>{
  expect((await call('/api/tenants')).status).toBe(401);
  expect((await call('/api/token-usage/table')).status).toBe(410);
  expect((await call('/api/cost/table')).status).toBe(410);
 });
 it.each(['/sign-in','/invite','/dashboard/token-usage','/settings'])('serves safe HTML for %s',async path=>{
  signedIn();const r=await call(path);expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');expect(await r.text()).toContain('<!doctype html>');
 });
 it.each(['/favicon.ico','/favicon.svg','/apple-touch-icon.png','/favicon-32.png'])('serves original public brand asset %s without authentication',async path=>{
  const r=await call(path);const asset=faviconAssets[path];
  expect(r.status).toBe(200);expect(r.headers.get('content-type')).toBe(asset.contentType);
  expect(r.headers.get('cache-control')).toBe('public, max-age=86400');
  expect(new Uint8Array(await r.arrayBuffer())).toEqual(Uint8Array.from(atob(asset.base64),c=>c.charCodeAt(0)));
  expect(getUser).not.toHaveBeenCalled();
 });
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

describe('organization online compatibility boundary',()=>{
 const request=(path:string,key?:string)=>new Request('https://x'+path,{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{})},body:'{}'});
 it.each(['/v1/metrics','/v1/logs'])('hashes a legacy bearer only in the explicit compatibility build: %s',async path=>{
  const r=await compatibility.fetch(request(path,'old-shared-key'),testEnv);
  expect(r.status).toBe(200);
  expect(rpc).toHaveBeenCalledWith('ingest_legacy_telemetry',{p_token_hash:await digest('old-shared-key'),p_rows:[]});
  expect(await r.text()).not.toContain(tenant);
  expect((await worker.fetch(request(path,'old-shared-key'),testEnv)).status).toBe(401);
 });
 it('uses normal key validation for tenant keys in the compatibility build',async()=>{
  expect((await compatibility.fetch(request('/v1/metrics','brk_'+'a'.repeat(64)),testEnv)).status).toBe(200);
  expect(rpc).toHaveBeenCalledWith('ingest_telemetry',expect.anything());
  expect(rpc).not.toHaveBeenCalledWith('ingest_legacy_telemetry',expect.anything());
 });
 it.each([undefined,'x'.repeat(513)])('rejects missing or unbounded legacy bearers',async key=>{
  expect((await compatibility.fetch(request('/v1/metrics',key),testEnv)).status).toBe(401);
  expect(rpc).not.toHaveBeenCalledWith('ingest_legacy_telemetry',expect.anything());
 });
 it('fails closed when the bridge is unavailable, revoked or expired, even for an empty batch',async()=>{
  rpc.mockImplementation(async(name:string)=>name==='check_rate_limit'?{data:true,error:null}:{data:null,error:{code:'PT401',message:'Unauthorized'}});
  const r=await compatibility.fetch(request('/v1/metrics','old-shared-key'),testEnv);
  expect(r.status).toBe(401);expect(r.headers.get('cache-control')).toBe('no-store');
 });
 it.each(['token-usage/projects','token-usage/table','token-usage/series','cost/table','cost/series'])('uses separate scoped coexistence RPCs for %s',async path=>{
  signedIn();
  const r=await compatibility.fetch(new Request('https://x/api/tenants/'+tenant+'/'+path,{headers:{Cookie:authCookie}}),testEnv);
  expect(r.status).toBe(200);
  expect(rpc).toHaveBeenCalledWith('organization_get_'+path.replaceAll('-','_').replace('/','_'),expect.objectContaining({p_tenant_id:tenant}));
  const denied=await call('/api/tenants/'+other+'/'+path);
  expect(denied.status).toBe(404);
  expect(await denied.text()).not.toContain(other);
 });
 it('does not accept Basic Auth in the compatibility build',async()=>{
  const r=await compatibility.fetch(new Request('https://x/api/tenants',{headers:{Authorization:'Basic dXNlcjpwYXNz'}}),testEnv);
  expect(r.status).toBe(401);
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

describe('review regression checks',()=>{
 it('refreshes a refresh-only session before remote logout',async()=>{
  refreshSession.mockResolvedValue({data:{session:{access_token:'fresh-access',refresh_token:'rotated'}},error:null});
  const r=await call('/auth/sign-out','POST',{}, {Cookie:'__Host-burnrate-refresh=refresh; __Host-burnrate-csrf=csrf'});
  expect(r.status).toBe(200);expect(await r.json()).toMatchObject({success:true,remoteRevoked:true});
  expect(refreshSession).toHaveBeenCalledWith({refresh_token:'refresh'});expect(signOut).toHaveBeenCalledWith('fresh-access','local');
  expect(r.headers.get('set-cookie')).toContain('Max-Age=0');expect(getUser).not.toHaveBeenCalled();
 });
 it('distinguishes local cookie clearing from failed remote revocation',async()=>{
  refreshSession.mockRejectedValue(new Error('offline'));signOut.mockResolvedValue({error:{status:503}});
  const r=await call('/auth/sign-out','POST',{}, {Cookie:authCookie+'; __Host-burnrate-refresh=refresh'});
  expect(await r.json()).toMatchObject({success:true,remoteRevoked:false});expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
 });
 it('does not claim remote revocation when refresh-only recovery fails',async()=>{
  refreshSession.mockResolvedValue({data:{session:null},error:{status:400}});
  const r=await call('/auth/sign-out','POST',{}, {Cookie:'__Host-burnrate-refresh=invalid; __Host-burnrate-csrf=csrf'});
  expect(await r.json()).toMatchObject({success:true,remoteRevoked:false});expect(signOut).not.toHaveBeenCalled();
 });
 it.each([['ingestion-keys', 'POST'],['','PATCH']] as const)('rejects missing required administration fields on %s',async(path,method)=>{
  signedIn();const r=await call(`/api/tenants/${tenant}${path?'/'+path:''}`,method,{});expect(r.status).toBe(400);
  expect(rpc.mock.calls.some((c:any[])=>c[0]==='manage_tenant')).toBe(false);
 });
 it.each(['not a valid URL','http://mail.test/send'])('returns persisted delivery failure for endpoint %s',async endpoint=>{
  signedIn();const request=new Request(`https://x/api/tenants/${tenant}/invitations`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:authCookie,Origin:'https://x','X-CSRF-Token':'csrf'},body:JSON.stringify({email:'invite@example.test',role:'viewer'})});
  const r=await worker.fetch(request,{...testEnv,INVITATION_DELIVERY_URL:endpoint,INVITATION_DELIVERY_TOKEN:'test'});
  expect(r.status).toBe(503);expect(await r.json()).toMatchObject({id:other,code:'invitation_delivery_failed',delivered:false});
 });
 it('reports the actual smaller request-body limit',async()=>{
  const r=await call('/auth/sign-in','POST',{email:'a@example.test',padding:'x'.repeat(8192)});expect(r.status).toBe(413);
  const body:any=await r.json();expect(body.error).toContain('8192');expect(body.error).not.toContain('1 MiB');
 });
 it('adds security and request headers to cacheable favicons',async()=>{
  const r=await call('/favicon.svg');expect(r.headers.get('x-content-type-options')).toBe('nosniff');expect(r.headers.get('referrer-policy')).toBe('no-referrer');expect(r.headers.get('x-request-id')).toBeTruthy();expect(r.headers.get('cache-control')).toBe('public, max-age=86400');
 });
 it('returns Claude partial-success counts and inserts only valid points',async()=>{
  const r=await call('/v1/metrics','POST',{resourceMetrics:[{scopeMetrics:[{metrics:[{name:'claude_code.token.usage',sum:{dataPoints:[{asInt:'NaN',attributes:[{key:'type',value:{stringValue:'input'}}]},{asInt:'7',attributes:[{key:'type',value:{stringValue:'input'}}]}]}}]}]}]}, {Authorization:'Bearer brk_'+'a'.repeat(64)});
  expect(r.status).toBe(200);expect(await r.json()).toMatchObject({count:1,partialSuccess:{rejectedDataPoints:'1'}});expect(insert.mock.calls[0][0]).toHaveLength(1);
 });
});


describe('PKCE email sign-in',()=>{
 it.each([429,400,503])('reports rejected resend %s without replacing the pending link verifier',async status=>{
  signInWithOtp.mockImplementationOnce(async()=>{
   const options=(createClient.mock.calls as unknown as any[][]).find(c=>c[2]?.auth?.flowType==='pkce')?.[2] as any;
   options.auth.storage.setItem('burnrate-auth-flow-ijklmnop-code-verifier',JSON.stringify('replacement-verifier'));
   return {error:{status,message:'private-provider-details'}};
  });
  const r=await call('/auth/sign-in','POST',{email:'a@example.test'},{Cookie:'__Host-burnrate-csrf=csrf; __Host-burnrate-pkce-abcdefgh='+encodeURIComponent(JSON.stringify('existing-verifier'))});
  expect(r.status).toBe(status);
  expect(r.headers.get('set-cookie')??'').not.toContain('__Host-burnrate-pkce');
  const body:any=await r.json();
  expect(body.message).toBeUndefined();expect(body.error).not.toContain('private-provider-details');
  if(status===429)expect(body.code).toBe('auth_email_rate_limited');
 });
 it('explains the application email limit without calling Supabase Auth',async()=>{
  rpc.mockResolvedValueOnce({data:true,error:null}).mockResolvedValueOnce({data:false,error:null});
  const r=await call('/auth/sign-in','POST',{email:'a@example.test'});
  expect(r.status).toBe(429);expect(await r.json()).toMatchObject({code:'auth_email_rate_limited',error:expect.stringContaining('ten minutes')});
  expect(r.headers.get('retry-after')).toBe('600');
  expect(signInWithOtp).not.toHaveBeenCalled();
 });
 it('preserves the latest pending verifier when an expired email returns an error',async()=>{
  const r=await call('/auth/callback?sb_flow_id=abcdefgh&error=access_denied&error_code=otp_expired','GET',undefined,{Cookie:'__Host-burnrate-pkce-abcdefgh=latest-verifier'});
  expect(r.headers.get('location')).toBe('/sign-in?error=invalid_link');
  expect(r.headers.get('set-cookie')??'').not.toContain('__Host-burnrate-pkce=');
 });
 it('preserves pending flows during stale-session cleanup but cancels them on sign-out',async()=>{
  const pending='__Host-burnrate-pkce-abcdefgh='+encodeURIComponent(JSON.stringify('verifier'));
  const stale=await call('/api/session','GET',undefined,{Cookie:authCookie+'; '+pending});
  expect(stale.headers.get('set-cookie')).toContain('__Host-burnrate-access=;');
  expect(stale.headers.get('set-cookie')).not.toContain('__Host-burnrate-pkce');
  const callback=await call('/auth/callback?sb_flow_id=abcdefgh&code=valid','GET',undefined,{Cookie:pending});
  expect(callback.headers.get('location')).toBe('/dashboard/token-usage');
  const logout=await call('/auth/sign-out','POST',{}, {Cookie:authCookie+'; '+pending});
  expect(logout.headers.get('set-cookie')).toContain('__Host-burnrate-pkce-abcdefgh=;');
 });
 it('keeps both SDK flows usable when the older response arrives last',async()=>{
  const actual=await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
  const defaultFactory=createClient.getMockImplementation()!;
  createClient.mockImplementation(((...args:any[])=>args[2]?.auth?.flowType==='pkce'?actual.createClient(args[0],args[1],args[2]):(defaultFactory as any)(...args)) as any);
  const pending:Array<{url:string,body:any,resolve:(response:Response)=>void}>=[];
  const tokens:any[]=[];
  vi.stubGlobal('fetch',vi.fn((url:string,options:any)=>{
   if(String(url).includes('/otp'))return new Promise<Response>(resolve=>pending.push({url:String(url),body:JSON.parse(options.body),resolve}));
   tokens.push(JSON.parse(options.body));
   return Promise.resolve(Response.json({access_token:'access',refresh_token:'refresh',expires_in:3600,token_type:'bearer',user:{id:other}}));
  }));
  try{
   const first=call('/auth/sign-in','POST',{email:'first@example.test'},{Cookie:'__Host-burnrate-csrf=csrf'});
   await vi.waitFor(() => expect(pending.length).toBe(1));
   const second=call('/auth/sign-in','POST',{email:'second@example.test'},{Cookie:'__Host-burnrate-csrf=csrf'});
   await vi.waitFor(() => expect(pending.length).toBe(2));
   pending[1].resolve(Response.json({}));const newer=await second;
   pending[0].resolve(Response.json({}));const older=await first;
   const jar=new Map<string,string>();
   for(const response of [newer,older])for(const cookie of response.headers.getSetCookie()){
    const pair=cookie.split(';')[0];const eq=pair.indexOf('=');jar.set(pair.slice(0,eq),pair.slice(eq+1));
   }
   expect(jar.size).toBe(2);
   for(let i=0;i<2;i++){
    const flowId=new URL(new URL(pending[i].url).searchParams.get('redirect_to')!).searchParams.get('sb_flow_id');
    const verifier=JSON.parse(decodeURIComponent(jar.get('__Host-burnrate-pkce-'+flowId)!));
    const response=await call('/auth/callback?sb_flow_id='+flowId+'&code=code-'+i,'GET',undefined,{Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')});
    expect(response.headers.get('location')).toBe('/dashboard/token-usage');
    expect(tokens[i]).toMatchObject({auth_code:'code-'+i,code_verifier:verifier});
    expect(response.headers.getSetCookie().filter(c=>c.startsWith('__Host-burnrate-pkce-')).every(c=>c.startsWith('__Host-burnrate-pkce-'+flowId+'='))).toBe(true);
   }
  }finally{createClient.mockImplementation(defaultFactory);}
 });

 it('uses the real SDK to generate a PKCE challenge and verifier cookie',async()=>{
  const actual=await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
  createClient.mockImplementationOnce(((...args:any[])=>actual.createClient(args[0],args[1],args[2])) as any);
  const fetcher=vi.fn().mockResolvedValue(new Response('{}',{status:200,headers:{'Content-Type':'application/json'}}));
  vi.stubGlobal('fetch',fetcher);
  const r=await call('/auth/sign-in','POST',{email:'a@example.test'},{Cookie:'__Host-burnrate-csrf=csrf'});
  expect(r.status).toBe(200);
  const cookieHeader=r.headers.get('set-cookie')!;
  expect(cookieHeader).toContain('__Host-burnrate-pkce-');
  expect(cookieHeader).toContain('Max-Age=600');
  expect(cookieHeader).not.toContain('__Host-burnrate-access=');
  const otpCall=fetcher.mock.calls.find(c=>String(c[0]).includes('/otp'))!;
  const body=JSON.parse(otpCall[1].body);
  expect(body.code_challenge_method).toBe('s256');
  expect(body.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(String(otpCall[0])).toContain('redirect_to=');
  const verifierCookie=cookieHeader.split(';')[0];
  const savedVerifier=JSON.parse(decodeURIComponent(verifierCookie.slice(verifierCookie.indexOf('=')+1)));
  // Callback rate limiter still uses the mocked service client; exchange uses the real SDK.
  createClient.mockImplementationOnce(()=>({rpc,auth:{getUser,refreshSession,signInWithOtp,verifyOtp,exchangeCodeForSession,admin:{signOut}}}));
  createClient.mockImplementationOnce(((...args:any[])=>actual.createClient(args[0],args[1],args[2])) as any);
  fetcher.mockResolvedValueOnce(Response.json({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,token_type:'bearer',user:{id:other}}));
  const flowId=new URL(new URL(String(otpCall[0])).searchParams.get('redirect_to')!).searchParams.get('sb_flow_id');
  const callback=await call('/auth/callback?sb_flow_id='+flowId+'&code=single-use','GET',undefined,{Cookie:verifierCookie});
  expect(callback.status).toBe(303);
  expect(callback.headers.get('location')).toBe('/dashboard/token-usage');
  expect(callback.headers.get('set-cookie')).toContain('__Host-burnrate-access=test-access');
  const tokenCall=fetcher.mock.calls.find(c=>String(c[0]).includes('/token'))!;
  expect(JSON.parse(tokenCall[1].body)).toMatchObject({auth_code:'single-use',code_verifier:savedVerifier});
 });
 const cookie='__Host-burnrate-pkce-abcdefgh='+encodeURIComponent(JSON.stringify('verifier'));
 it('requests a fixed callback and persists only the verifier',async()=>{
  const r=await call('/auth/sign-in','POST',{email:'a@example.test'});
  expect(r.status).toBe(200);
  expect(signInWithOtp).toHaveBeenCalledWith({email:'a@example.test',options:{shouldCreateUser:true,emailRedirectTo:'https://x/auth/callback'}});
  const options=(createClient.mock.calls as unknown as any[][]).find(c=>c[2]?.auth?.flowType==='pkce')?.[2] as any;
  expect(options.auth.persistSession).toBe(true);
  const storage=options.auth.storage;
  storage.setItem('burnrate-auth-flow-abcdefgh-code-verifier',JSON.stringify('verifier'));
  storage.setItem('burnrate-auth','private-session');
  expect(storage.getItem('burnrate-auth-flow-abcdefgh-code-verifier')).toBe(JSON.stringify('verifier'));
  storage.removeItem('burnrate-auth-flow-abcdefgh-code-verifier');
  expect(storage.getItem('burnrate-auth-flow-abcdefgh-code-verifier')).toBe(null);
 });
 it('exchanges the code, sets secure sessions and ignores return URLs',async()=>{
  const r=await call('/auth/callback?sb_flow_id=abcdefgh&code=one-time&next=https://evil.test','GET',undefined,{Cookie:cookie});
  expect(r.status).toBe(303);expect(r.headers.get('location')).toBe('/dashboard/token-usage');
  expect(exchangeCodeForSession).toHaveBeenCalledWith('one-time',{flowId:'abcdefgh'});
  expect(r.headers.get('set-cookie')).toContain('__Host-burnrate-access=access');
  expect(r.headers.get('set-cookie')).toContain('HttpOnly; Secure; SameSite=Lax');
  expect(r.headers.get('set-cookie')).toContain('__Host-burnrate-pkce-abcdefgh=;');
  expect(r.headers.get('cache-control')).toBe('no-store');
  expect(await r.text()).not.toContain('refresh');
  const options=(createClient.mock.calls as unknown as any[][]).find(c=>c[2]?.auth?.flowType==='pkce')?.[2] as any;
  expect(options.auth.storage.getItem('burnrate-auth-flow-abcdefgh-code-verifier')).toBe(JSON.stringify('verifier'));
 });
 it.each([['?code=x',''],['',cookie],['?error=access_denied&error_description=private',cookie]])('rejects missing or denied callback state %#',async(query,c)=>{
  const r=await call('/auth/callback'+query,'GET',undefined,{Cookie:c});
  expect(r.headers.get('location')).toBe('/sign-in?error=invalid_link');expect(exchangeCodeForSession).not.toHaveBeenCalled();
 });
 it('rejects expired or mismatched codes without leaking Auth errors',async()=>{
  exchangeCodeForSession.mockResolvedValue({data:{session:null},error:{status:400,message:'private'}});
  const r=await call('/auth/callback?sb_flow_id=abcdefgh&code=used','GET',undefined,{Cookie:cookie});
  expect(r.headers.get('location')).toBe('/sign-in?error=invalid_link');expect((r.headers.get('set-cookie')??'')).not.toContain('__Host-burnrate-access=access');
 });
 it('reports upstream outages safely',async()=>{
  exchangeCodeForSession.mockResolvedValue({data:{session:null},error:{status:503}});
  expect((await call('/auth/callback?sb_flow_id=abcdefgh&code=x','GET',undefined,{Cookie:cookie})).status).toBe(503);
 });
 it('rejects wrong origins and callback methods',async()=>{
  expect((await worker.fetch(new Request('https://evil.test/auth/callback?sb_flow_id=abcdefgh&code=x',{headers:{Cookie:cookie}}),testEnv)).headers.get('location')).toBe('/sign-in?error=invalid_link');
  expect((await call('/auth/callback','POST',{})).status).toBe(405);
  expect(exchangeCodeForSession).not.toHaveBeenCalled();
 });
});
