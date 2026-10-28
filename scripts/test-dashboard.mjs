import {JSDOM} from 'jsdom';
import {UIStrings} from '../ui-strings.ts';
import fs from 'node:fs';
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
for(const role of ['viewer','admin','owner']){
 const dom=new JSDOM(settingsHtml,{url:'https://app.test/settings',runScripts:'dangerously',beforeParse(w){
  w.fetch=async path=>({ok:true,status:200,json:async()=>path==='/api/session'?{signedIn:true,csrf:'c',userId:B}:path==='/api/tenants'?{tenants:[{id:A,name:'A',role}]}:path.endsWith('/members')?{members:[{user_id:A,display_name:'Owner member',role:'owner'},{user_id:B,display_name:'Viewer member',role:'viewer'}]}:path.endsWith('/invitations')?{invitations:[]}:{keys:[]}});
 }});await settle();assert.equal(dom.window.document.getElementById('admin').hidden,role==='viewer');assert.equal(dom.window.document.getElementById('owner').hidden,role!=='owner');
 const memberRows=dom.window.document.querySelectorAll('#members p');
 if(role==='viewer')assert.equal(dom.window.document.querySelectorAll('#members button').length,0);
 if(role==='admin'){
  assert.equal(memberRows[0].querySelectorAll('button,select').length,0);
  assert.deepEqual([...memberRows[1].querySelectorAll('option')].map(o=>o.value),['admin','viewer']);
 }
 if(role==='owner')assert.deepEqual([...memberRows[0].querySelectorAll('option')].map(o=>o.value),['owner','admin','viewer']);
 dom.window.close();
}
// Execute the actual inline script in the real DOM, injecting only the navigation
// boundary that jsdom deliberately does not implement. No application code is rewritten.
function pageFixture(html, pathname, fetcher, {denyStorage=false}={}) {
 const dom=new JSDOM(html,{url:'https://app.test'+pathname,runScripts:'outside-only'});
 const redirects=[];
 dom.window.fetch=fetcher;
 dom.window.Chart=class {destroy(){}};
 if(denyStorage)Object.defineProperty(dom.window,'localStorage',{get(){throw new dom.window.DOMException('Storage unavailable','SecurityError');}});
 const location={origin:dom.window.location.origin,hash:dom.window.location.hash,assign:path=>redirects.push(path),reload:()=>redirects.push('reload')};
 for(const script of dom.window.document.querySelectorAll('script:not([src])'))dom.window.Function('location',script.textContent)(location);
 return {dom,redirects};
}
const response=data=>({ok:true,status:200,json:async()=>data});
// Both settings and dashboard must remain usable without any memberships.
for(const [html,path] of [[settingsHtml,'/settings'],[tokenUsageDashboardHtml,'/dashboard/token-usage']]) {
 const requests=[];
 const {dom}=pageFixture(html,path,async url=>{requests.push(url);return response(url==='/api/session'?{signedIn:true,csrf:'c',userId:B}:{tenants:[]});});
 await settle();assert.equal(dom.window.document.getElementById('status').textContent,UIStrings.text.noOrganizations);
 assert.equal(dom.window.document.getElementById('tenant').options.length,0);
 assert.deepEqual(requests,['/api/session','/api/tenants']);dom.window.close();
}
// Remembered-tenant storage is optional at initialization and when changing tenants.
for(const [html,path] of [[settingsHtml,'/settings'],[tokenUsageDashboardHtml,'/dashboard/token-usage']]) {
 const requests=[];
 const {dom}=pageFixture(html,path,async url=>{requests.push(url);return response(url==='/api/session'?{signedIn:true,csrf:'c',userId:B}:url==='/api/tenants'?{tenants:[{id:A,name:'A',role:'viewer'},{id:B,name:'B',role:'viewer'}]}:url.endsWith('/members')?{members:[]}:url.includes('/projects')?{projects:[]}:{rows:[],series:[]});},{denyStorage:true});
 await settle();const select=dom.window.document.getElementById('tenant');assert([...select.options].some(o=>o.value===A));
 select.value=B;select.dispatchEvent(new dom.window.Event('change'));await settle();
 assert(requests.some(url=>url.includes('/api/tenants/'+B+'/')));assert.equal(dom.window.document.getElementById('status').textContent,'');dom.window.close();
}
// Acceptance submits the captured token once and remembers the successful tenant.
// A storage failure after server acceptance must still navigate, never report failure.
for(const denyStorage of [false,true]) {
 const requests=[];
 const {dom,redirects}=pageFixture(invitationHtml,'/invite#bri_example',async(url,options)=>{requests.push({url,options});return response(url==='/api/session'?{signedIn:true,csrf:'invite-csrf'}:{tenantId:A});},{denyStorage});
 assert.equal(dom.window.location.hash,'');
 await dom.window.document.getElementById('accept').onclick();
 const accepted=requests.find(r=>r.url==='/api/invitations/accept');assert(accepted);
 assert.equal(accepted.options.method,'POST');assert.deepEqual(JSON.parse(accepted.options.body),{token:'bri_example'});
 assert.equal(accepted.options.headers['X-CSRF-Token'],'invite-csrf');
 if(!denyStorage)assert.equal(dom.window.localStorage.getItem('burnrate-tenant'),A);
 assert.deepEqual(redirects,['/dashboard/token-usage']);assert.equal(dom.window.document.getElementById('status').textContent,'');dom.window.close();
}
// Exercise sign-in startup for both an existing session and the email-code flow.
{
 const requests=[];
 const {dom,redirects}=pageFixture(signInHtml,'/sign-in',async url=>{requests.push(url);return response({signedIn:true,csrf:'c'});});
 await settle();assert.deepEqual(requests,['/api/session']);assert.deepEqual(redirects,['/dashboard/token-usage']);dom.window.close();
}
{
 const requests=[];
 const {dom,redirects}=pageFixture(signInHtml,'/sign-in',async(url,options)=>{requests.push({url,options});return response(url==='/api/session'?{signedIn:false,csrf:'signin-csrf'}:url==='/auth/sign-in'?{message:UIStrings.text.codeSent}:{success:true});});
 await settle();assert.equal(requests[0].url,'/api/session');assert.equal(dom.window.document.querySelector('h1').textContent,UIStrings.text.signIn);
 dom.window.document.getElementById('email').value='member@example.test';
 await dom.window.document.getElementById('send').onsubmit(new dom.window.Event('submit',{cancelable:true}));
 assert.equal(dom.window.document.getElementById('status').textContent,UIStrings.text.codeSent);
 dom.window.document.getElementById('code').value='123456';
 await dom.window.document.getElementById('verify').onsubmit(new dom.window.Event('submit',{cancelable:true}));
 const verified=requests.find(r=>r.url==='/auth/verify');assert.equal(verified.options.method,'POST');assert.deepEqual(JSON.parse(verified.options.body),{email:'member@example.test',code:'123456'});
 assert.equal(verified.options.headers['X-CSRF-Token'],'signin-csrf');assert.deepEqual(redirects,['/dashboard/token-usage']);dom.window.close();
}
console.log('PASS: tenant switch clears data and project state, stale responses cannot render, source selections persist, role-based settings and invitation landing script');

// The browser receives exactly the same copy and formatter, including quotes/newlines/HTML-like text.
const dangerousCopy = '</script><script>window.injected=true</script> "quoted" \n<key>';
const stringsDom = new JSDOM('<script>' + UIStrings.browserScript({ copy: dangerousCopy, template: UIStrings.text.keyInstructions }) + 'window.catalogCopy=UI.copy; window.formatted=uiText(UI.template,{origin:"https://app.test"});</script>', { runScripts: 'dangerously' });
assert.equal(stringsDom.window.catalogCopy, dangerousCopy);
assert.equal(stringsDom.window.injected, undefined);
assert.equal(stringsDom.window.formatted, UIStrings.format(UIStrings.text.keyInstructions, { origin: 'https://app.test' }));
stringsDom.window.close();
// Guard dynamic UI references, which aren't checked by TypeScript inside HTML template strings.
for (const filename of ['dashboard.ts', 'pages.ts']) {
 const source = fs.readFileSync(new URL('../' + filename, import.meta.url), 'utf8');
 for (const [, key] of source.matchAll(/\bUI\.(\w+)/g)) assert(Object.hasOwn(UIStrings.text, key), filename + ': unknown UI string ' + key);
}
console.log('PASS: shared browser copy, interpolation parity, script-safe serialization and valid catalog references');
