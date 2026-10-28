import {JSDOM} from 'jsdom';
import assert from 'node:assert/strict';
import {tokenUsageDashboardHtml} from '../dashboard.ts';
import {signInHtml,settingsHtml,invitationHtml} from '../pages.ts';
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002';
const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
const calls=[];let pendingA;let delayA=false;
const dashboard=new JSDOM(tokenUsageDashboardHtml,{url:'https://app.test/dashboard/token-usage',runScripts:'dangerously',beforeParse(w){
 w.localStorage.setItem('burnrate-tenant',A);w.Chart=class{constructor(_canvas,config){this.config=config;}destroy(){}};
 w.fetch=async(path)=>{
  calls.push(path);const url=new URL(path,'https://app.test');
  if(path==='/api/session')return {ok:true,status:200,json:async()=>({signedIn:true,csrf:'csrf'})};
  if(path==='/api/tenants')return {ok:true,status:200,json:async()=>({tenants:[{id:A,name:'A'},{id:B,name:'B'}]})};
  const isA=url.pathname.includes(A);const source=url.searchParams.get('source');
  let data=url.pathname.endsWith('/projects')?{projects:source==='codex'?['beta']:['alpha','beta']}:
   url.pathname.endsWith('/series')?{series:[]}:{rows:[{project_name:isA?'A-private':'B-private',total_tokens:1,input_tokens:1,output_tokens:0,cache_read_tokens:0,cache_write_tokens:0,total_cost_usd:1,cost_per_1k_tokens:1,sessions:1,last_active:null}]};
  if(delayA&&isA&&url.pathname.endsWith('/table'))await new Promise(resolve=>{pendingA=resolve;});
  return {ok:true,status:200,json:async()=>data};
 }
}});
await settle();const doc=dashboard.window.document;
assert(doc.querySelector('#table tbody').textContent.includes('A-private'));
const projects=doc.getElementById('projects');projects.options[0].selected=true;projects.dispatchEvent(new dashboard.window.Event('change'));
const source=doc.getElementById('source');source.value='codex';source.dispatchEvent(new dashboard.window.Event('change'));await settle();
assert(calls.slice(-3).filter(x=>!x.includes('/projects')).every(x=>new URL(x,'https://app.test').searchParams.get('projects')==='alpha'));
assert([...projects.options].some(o=>o.value==='alpha'&&o.selected));
delayA=true;doc.getElementById('apply').click();await settle();assert(pendingA);
const tenants=doc.getElementById('tenant');tenants.value=B;tenants.dispatchEvent(new dashboard.window.Event('change'));
assert.equal(doc.querySelector('#table tbody').textContent,'');assert.equal(projects.options.length,0);
await settle();assert(doc.querySelector('#table tbody').textContent.includes('B-private'));
pendingA();await settle();assert(!doc.querySelector('#table tbody').textContent.includes('A-private'));
assert(!calls.slice(-3).filter(x=>!x.includes('/projects')).some(x=>new URL(x,'https://app.test').searchParams.has('projects')));
assert.equal(source.value,'codex');
doc.querySelector('[data-tab="cost"]').click();await settle();assert.equal(source.value,'');
source.value='claude';source.dispatchEvent(new dashboard.window.Event('change'));await settle();
doc.querySelector('[data-tab="tokens"]').click();await settle();assert.equal(source.value,'codex');
assert(!Object.keys(dashboard.window.localStorage).some(k=>k.includes('token')));
dashboard.window.close();
// Verify the real settings script enforces viewer UI and handles an organization with no memberships.
for(const role of ['viewer','owner']){
 const dom=new JSDOM(settingsHtml,{url:'https://app.test/settings',runScripts:'dangerously',beforeParse(w){
  w.fetch=async path=>({ok:true,status:200,json:async()=>path==='/api/session'?{signedIn:true,csrf:'c',userId:B}:path==='/api/tenants'?{tenants:[{id:A,name:'A',role}]}:path.endsWith('/members')?{members:[]}:path.endsWith('/invitations')?{invitations:[]}:{keys:[]}});
 }});await settle();assert.equal(dom.window.document.getElementById('admin').hidden,role==='viewer');assert.equal(dom.window.document.getElementById('owner').hidden,role!=='owner');dom.window.close();
}
const invite=new JSDOM(invitationHtml,{url:'https://app.test/invite#bri_example',runScripts:'dangerously'});
assert.equal(invite.window.location.hash,'');invite.window.close();
const signin=new JSDOM(signInHtml,{url:'https://app.test/sign-in',runScripts:'dangerously',beforeParse(w){w.fetch=async()=>({ok:true,json:async()=>({signedIn:false,csrf:'c'})});}});
await settle();assert(signin.window.document.querySelector('input[autocomplete="one-time-code"]'));signin.window.close();
console.log('PASS: tenant switch clears data and project state, stale responses cannot render, source selections persist, role-based settings and invitation landing script');
