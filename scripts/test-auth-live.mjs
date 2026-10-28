// Test-only: a local Supabase Auth container, no real email delivery or customer accounts.
import {createClient} from '@supabase/supabase-js';
import {createHmac,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const origin=process.env.TEST_AUTH_URL||'http://127.0.0.1:55433';
if(!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw new Error('Live Auth test requires a disposable loopback Auth service.');
const secret=process.env.TEST_AUTH_JWT_SECRET;if(!secret)throw new Error('Set the disposable Auth container JWT secret in TEST_AUTH_JWT_SECRET.');
function jwt(role){const head=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');const body=Buffer.from(JSON.stringify({role,aud:'authenticated',iss:'supabase',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return head+'.'+body+'.'+createHmac('sha256',secret).update(head+'.'+body).digest('base64url');}
const transport=(input,init)=>fetch(String(input).replace(origin+'/auth/v1',origin),init);
const options={global:{fetch:transport},auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(origin,jwt('service_role'),options),user=createClient(origin,jwt('anon'),options);
let id;
try{
 const email='test-'+randomUUID()+'@example.test';
 const generated=await admin.auth.admin.generateLink({type:'signup',email,password:randomUUID()+'Aa1!'});
 assert.equal(generated.error,null);id=generated.data.user.id;
 const verified=await user.auth.verifyOtp({email,token:generated.data.properties.email_otp,type:'email'});
 assert.equal(verified.error,null);assert(verified.data.session);assert.equal(verified.data.user.email,email);
 const current=await user.auth.getUser(verified.data.session.access_token);assert.equal(current.error,null);assert.equal(current.data.user.id,id);
 const refreshed=await user.auth.refreshSession({refresh_token:verified.data.session.refresh_token});assert.equal(refreshed.error,null);assert(refreshed.data.session);
 const invalid=await user.auth.getUser('not-a-valid-jwt');assert(invalid.error);
 // Despite its SDK namespace, signOut(jwt) calls the user-authenticated /logout endpoint.
 // Preserve this public-client test: /logout must revoke the supplied user's session.
 const logout=await user.auth.admin.signOut(refreshed.data.session.access_token,'local');assert.equal(logout.error,null);
 const after=await user.auth.refreshSession({refresh_token:refreshed.data.session.refresh_token});assert(after.error);assert(after.error.status>=400&&after.error.status<500,'Refresh must be rejected by Auth, not fail from a transport/server error.');
}finally{if(id){const cleanup=await admin.auth.admin.deleteUser(id);assert.equal(cleanup.error,null,'Synthetic Auth user cleanup failed.');}}
console.log('PASS: official Supabase Auth email OTP verification, validated identity, refresh, invalid JWT rejection, and refresh revocation on local sign-out');
