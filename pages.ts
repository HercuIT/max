import { UIStrings } from './ui-strings.ts';

const style = `body{font:16px system-ui;max-width:960px;margin:3rem auto;padding:1rem;background:#171b24;color:#f3f1ee}a{color:#ffb627}input,select,button{font:inherit;padding:.6rem;margin:.3rem;border-radius:5px}label{display:block}section{border:1px solid #555;padding:1rem;margin:1rem 0}table{width:100%;text-align:left}td,th{padding:.5rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}#status{color:#ffb627}[hidden]{display:none!important}`;
function page(title: string, body: string, script: string) {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title} — ${UIStrings.text.appName}</title><style>${style}</style></head><body><h1>${title}</h1>${body}<p id="status" role="status"></p><script>${UIStrings.browserScript()}
${script}</script></body></html>`;
}
const api = `
let csrf = '';
const statusEl = document.getElementById('status');
async function request(path, method = 'GET', body) {
 const res = await fetch(path, {method, headers: {'Content-Type':'application/json','X-CSRF-Token':csrf}, ...(body === undefined ? {} : {body:JSON.stringify(body)})});
 const data = await res.json();
 if (!res.ok) throw new Error(data.error || uiText(UI.requestFailed, { status: res.status }));
 return data;
}
async function initializeSession() { const session = await request('/api/session'); csrf=session.csrf; return session; }
function report(error) { statusEl.textContent = error.message; }
function rememberTenant(id) { try { localStorage.setItem('burnrate-tenant',id); } catch { /* Optional preference. */ } }
function rememberedTenant() { try { return localStorage.getItem('burnrate-tenant'); } catch { return null; } }
`;
export const signInHtml = page(UIStrings.text.signIn, `
<p>${UIStrings.text.signInInstructions}</p>
<form id="send"><label>${UIStrings.text.email} <input id="email" type="email" autocomplete="email" required></label><button>${UIStrings.text.sendCode}</button></form>
<form id="verify"><label>${UIStrings.text.emailCode} <input id="code" inputmode="numeric" autocomplete="one-time-code" required pattern="[0-9]{6,8}"></label><button>${UIStrings.text.signIn}</button></form>`, api + `
initializeSession().then(s=>{if(s.signedIn) location.assign('/dashboard/token-usage');}).catch(report);
document.getElementById('send').onsubmit=async e=>{e.preventDefault();try{statusEl.textContent=(await request('/auth/sign-in','POST',{email:document.getElementById('email').value})).message;}catch(error){report(error);}};
document.getElementById('verify').onsubmit=async e=>{e.preventDefault();try{await request('/auth/verify','POST',{email:document.getElementById('email').value,code:document.getElementById('code').value});location.assign('/dashboard/token-usage');}catch(error){report(error);}};
`);
export const invitationHtml = page(UIStrings.text.acceptOrganizationInvitation, `
<p>${UIStrings.text.invitationBeforeSignIn} <a href="/sign-in" target="_blank" rel="noopener">${UIStrings.text.signInAnotherTab}</a>${UIStrings.text.invitationAfterSignIn}</p><button id="accept">${UIStrings.text.acceptInvitation}</button><a href="/dashboard/token-usage">${UIStrings.text.dashboard}</a>`, api + `
const invitation = location.hash.slice(1); history.replaceState(null,'','/invite');
document.getElementById('accept').onclick=async()=>{try{const s=await initializeSession();if(!s.signedIn)throw new Error(UI.invitationSignInRequired);const result=await request('/api/invitations/accept','POST',{token:invitation});rememberTenant(result.tenantId);location.assign('/dashboard/token-usage');}catch(error){report(error);}};
`);
export const settingsHtml = page(UIStrings.text.organizationSettings, `
<nav><a href="/dashboard/token-usage">${UIStrings.text.dashboard}</a> <button id="signout">${UIStrings.text.signOut}</button></nav>
<label>${UIStrings.text.organization} <select id="tenant"></select></label><p id="role"></p>
<section><h2>${UIStrings.text.members}</h2><p>${UIStrings.text.exporterKeysRemain}</p><div id="members"></div><button id="leave">${UIStrings.text.leaveOrganization}</button></section>
<div id="admin" hidden>
<section><h2>${UIStrings.text.ingestionKeys}</h2><p>${UIStrings.text.keyRotationInstructions}</p>
<form id="newkey"><label>${UIStrings.text.label} <input name="label" required maxlength="120"></label><label>${UIStrings.text.optionalExpiry} <input name="expires_at" type="datetime-local"></label><button>${UIStrings.text.createKey}</button></form>
<div id="secret" hidden><p>${UIStrings.text.copyKeyNotice}</p><pre id="rawkey"></pre><button id="copykey">${UIStrings.text.copyKey}</button><pre id="instructions"></pre></div><div id="keys"></div></section>
<section><h2>${UIStrings.text.invitations}</h2><form id="invite"><input name="email" type="email" placeholder="${UIStrings.text.email}" required><select name="role"><option value="viewer">${UIStrings.text.viewer}</option><option value="admin">${UIStrings.text.admin}</option></select><button>${UIStrings.text.invite}</button></form><div id="invites"></div></section>
<section><h2>${UIStrings.text.organizationName}</h2><form id="rename"><input name="name" required maxlength="120"><button>${UIStrings.text.rename}</button></form></section>
<section id="owner" hidden><h2>${UIStrings.text.deleteOrganization}</h2><p>${UIStrings.text.deletionNotice}</p><form id="delete"><label>${UIStrings.text.typeOrganizationName} <input name="confirmation" required></label><button>${UIStrings.text.requestDeletion}</button></form></section>
</div>`, api + `
const tenant = document.getElementById('tenant'); let tenants=[]; let current=null; let version=0;
const base=()=>'/api/tenants/'+encodeURIComponent(tenant.value);
function metadata(label,value) {return ' · '+label+' '+value;}
function node(tag,text) {const n=document.createElement(tag);n.textContent=text;return n;}
function button(parent,text,action) {const b=node('button',text);b.type='button';b.onclick=()=>action().catch(report);parent.appendChild(b);}
async function mutate(path,method,body) {statusEl.textContent='';try{await request(base()+path,method,body);}finally{await load();}}
async function load(){
 const v=++version; current=tenants.find(t=>t.id===tenant.value); statusEl.textContent='';
 for(const id of ['members','keys','invites','rawkey','instructions'])document.getElementById(id).textContent='';document.getElementById('secret').hidden=true;
 document.getElementById('admin').hidden=!current||current.role==='viewer';document.getElementById('owner').hidden=current?.role!=='owner';
 if(!current){statusEl.textContent=UI.noOrganizations;return;} document.getElementById('role').textContent=uiText(UI.yourRole, { role: UI[current.role] });
 document.querySelector('#rename input').value=current.name;
 const endpoint=base();
 try{
 const members=await request(endpoint+'/members');if(v!==version)return;
 for(const m of members.members){const row=node('p',m.display_name+' ('+UI[m.role]+') ');
 if(current.role==='owner'||(current.role==='admin'&&m.role!=='owner')){
 const roles=document.createElement('select');for(const role of (current.role==='owner'?['owner','admin','viewer']:['admin','viewer'])){const o=node('option',UI[role]);o.value=role;o.selected=m.role===role;roles.appendChild(o);}row.appendChild(roles);
 button(row,UI.changeRole,()=>mutate('/members/'+m.user_id,'PATCH',{role:roles.value}));
 button(row,UI.remove,async()=>{if(confirm(uiText(UI.confirmationWithNotice, { question: UI.removeMember, notice: UI.exporterKeysRemain })))await mutate('/members/'+m.user_id,'DELETE');});}
 document.getElementById('members').appendChild(row);}
 if(current.role==='viewer')return;
 const [keys,invites]=await Promise.all([request(endpoint+'/ingestion-keys'),request(endpoint+'/invitations')]);if(v!==version)return;
 for(const key of keys.keys){const row=node('p',key.label+' · '+key.prefix+'…'+metadata(UI.created,key.created_at)+metadata(UI.creator,key.created_by)+metadata(UI.expires,key.expires_at||UI.never)+metadata(UI.lastUsed,key.last_used_at||UI.never)+(key.revoked_at?metadata(UI.revoked,key.revoked_at):''));if(!key.revoked_at)button(row,UI.revoke,()=>mutate('/ingestion-keys/'+key.id,'DELETE'));document.getElementById('keys').appendChild(row);}
 for(const i of invites.invitations){const row=node('p',i.email+' ('+UI[i.role]+')'+metadata(UI.expires,i.expires_at));button(row,UI.resend,()=>mutate('/invitations/'+i.id+'/resend','POST',{}));button(row,UI.revoke,()=>mutate('/invitations/'+i.id,'DELETE'));document.getElementById('invites').appendChild(row);}
 }catch(error){if(v===version)report(error);}
}
tenant.onchange=()=>{rememberTenant(tenant.value);load();};
document.getElementById('signout').onclick=async()=>{try{await request('/auth/sign-out','POST',{});try{localStorage.removeItem('burnrate-tenant');}catch{}location.assign('/sign-in');}catch(error){report(error);}};
document.getElementById('leave').onclick=()=>{if(confirm(uiText(UI.confirmationWithNotice, { question: UI.leaveOrganizationConfirmation, notice: UI.exporterKeysRemain })))mutate('/members/'+userId,'DELETE').then(()=>location.reload()).catch(report);};
let userId;
initializeSession().then(async s=>{if(!s.signedIn){location.assign('/sign-in');return;}userId=s.userId;tenants=(await request('/api/tenants')).tenants;for(const t of tenants){const o=node('option',t.name);o.value=t.id;tenant.appendChild(o);}const remembered=rememberedTenant();if(tenants.some(t=>t.id===remembered))tenant.value=remembered;if(!tenants.length)statusEl.textContent=UI.noOrganizations;await load();}).catch(report);
document.getElementById('newkey').onsubmit=async e=>{e.preventDefault();try{const originTenant=tenant.value;const f=new FormData(e.target);const result=await request(base()+'/ingestion-keys','POST',{label:f.get('label'),...(f.get('expires_at')?{expires_at:new Date(f.get('expires_at')).toISOString()}:{})});if(tenant.value!==originTenant)return;await load();if(tenant.value!==originTenant)return;document.getElementById('secret').hidden=false;document.getElementById('rawkey').textContent=result.token;document.getElementById('instructions').textContent=uiText(UI.keyInstructions, { origin: location.origin });}catch(error){report(error);}};
document.getElementById('copykey').onclick=()=>navigator.clipboard.writeText(document.getElementById('rawkey').textContent).catch(report);
for(const [id,path,method] of [['invite','/invitations','POST'],['rename','','PATCH'],['delete','/deletion-request','POST']])document.getElementById(id).onsubmit=async e=>{e.preventDefault();try{await mutate(path,method,Object.fromEntries(new FormData(e.target)));if(id!=='invite')location.reload();}catch(error){report(error);}};
`);
