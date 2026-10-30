import {JSDOM} from 'jsdom';
import assert from 'node:assert/strict';
import {tokenUsageDashboardHtml} from '../dashboard.ts';
import {UIStrings} from '../ui-strings.ts';
const UI=UIStrings.text;
const tenant='10000000-0000-4000-8000-000000000001';
const project='<img src=x onerror=alert(1)>';
const row={project_name:project,input_tokens:100,output_tokens:20,cache_read_tokens:50,cache_write_tokens:30,total_tokens:200,sessions:3,total_cost_usd:1.25,last_active:null};
async function ready(check){for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Dashboard did not settle');}
function fixture({denyStorage=false,systemLight=false}={}){
 const state={calls:[],charts:[],empty:false,fail:'',changes:[]};
 const dom=new JSDOM(tokenUsageDashboardHtml,{url:'https://app.test/dashboard/token-usage',runScripts:'dangerously',beforeParse(w){
  if(denyStorage)Object.defineProperty(w,'localStorage',{get(){throw new Error('Storage unavailable');}});
  w.matchMedia=query=>({matches:query.includes('prefers-color')&&systemLight,addEventListener:(_event,fn)=>state.changes.push(fn)});
  w.Chart=class{
   constructor(_canvas,config){this.data=config.data;this.options=config.options;this.visibility=[];state.charts.push(this);}
   update(){}destroy(){}setDatasetVisibility(index,visible){this.visibility[index]=visible;}
  };
  w.fetch=async path=>{
   state.calls.push(path);const url=new URL(path,'https://app.test');
   if(path==='/api/session')return response({signedIn:true,csrf:'fixture'});
   if(path==='/api/tenants')return response({tenants:[{id:tenant,name:'Test'}]});
   if(state.fail&&url.pathname.includes(state.fail))return {ok:false,status:503,json:async()=>({error:'Fixture failure'})};
   if(url.pathname.endsWith('/projects'))return response({projects:[project,'second']});
   if(url.pathname.endsWith('/series'))return response({series:state.empty?[]:[{...row,bucket:'2026-10-29T00:00:00Z',cumulative_cost_usd:1.25}]});
   const previous=Date.parse(url.searchParams.get('end'))<Date.now()-6*86400000;
   return response({rows:state.empty?[]:[{...row,total_tokens:previous?100:200}]});
  };
 }});
 return {...state,dom,state,doc:dom.window.document,close:()=>dom.window.close()};
}
function response(body){return {ok:true,status:200,json:async()=>body};}
const f=fixture();const {doc,state,dom}=f;
await ready(()=>doc.getElementById('kpiTokens').textContent==='200');
assert.equal(doc.getElementById('kpiChange').textContent,'+100%');
assert.equal(doc.getElementById('kpiCost').textContent,'$1.25');
assert.equal(doc.getElementById('kpiSessions').textContent,'3');
assert.equal(doc.querySelector('#table tbody img'),null);
assert.equal(doc.querySelector('.project-link').textContent,project);
assert.equal(doc.querySelectorAll('input:not([aria-label]):not([id])').length,0);
const legend=doc.querySelector('#legend button');legend.click();
assert.equal(legend.getAttribute('aria-pressed'),'true'); // Rebuilt control below is the current state.
assert.equal(doc.querySelector('#legend button').getAttribute('aria-pressed'),'false');
doc.getElementById('theme').click();
assert.equal(dom.window.localStorage.getItem('burnrate-theme'),'light');
assert.equal(state.charts.at(-1).visibility[0],false);
assert.deepEqual(Array.from(state.charts.at(-1).data.datasets,d=>d.backgroundColor),['#FF6A1F','#FFB627','#3B82F6','#8B93A1']);
doc.querySelector('th[data-key=project_name] button').click();
assert.equal(doc.querySelector('th[data-key=project_name]').getAttribute('aria-sort'),'descending');
doc.querySelector('th[data-key=project_name] button').click();
assert.equal(doc.querySelector('th[data-key=project_name]').getAttribute('aria-sort'),'ascending');
doc.querySelector('.project-link').click();await ready(()=>!doc.body.classList.contains('loading'));
assert(state.calls.slice(-4).every(path=>new URL(path,'https://app.test').searchParams.get('projects')===project));
const preset=doc.getElementById('preset');preset.value='24';preset.dispatchEvent(new dom.window.Event('change'));
await ready(()=>!doc.body.classList.contains('loading'));
const queries=state.calls.slice(-4).map(path=>new URL(path,'https://app.test'));
assert.equal(Date.parse(queries[1].searchParams.get('end'))-Date.parse(queries[1].searchParams.get('start')),86400000);
assert.equal(Date.parse(queries[3].searchParams.get('end')),Date.parse(queries[1].searchParams.get('start'))-1);
const oldCount=state.calls.length;
doc.getElementById('start').value='2030-01-01T00:00';doc.getElementById('end').value='2029-01-01T00:00';
doc.getElementById('apply').click();
assert.equal(state.calls.length,oldCount);assert.equal(doc.getElementById('status').textContent,UI.invalidDateRange);
preset.value='168';preset.dispatchEvent(new dom.window.Event('change'));await ready(()=>!doc.body.classList.contains('loading'));
state.fail='/cost/table';doc.getElementById('apply').click();await ready(()=>!doc.body.classList.contains('loading'));
assert.equal(doc.getElementById('kpiTokens').textContent,'200');assert.equal(doc.getElementById('kpiCost').textContent,UI.missingValue);
assert.equal(doc.getElementById('retry').hidden,false);assert.equal(doc.body.classList.contains('failed'),false);
state.fail='/token-usage/series';doc.getElementById('retry').click();await ready(()=>doc.body.classList.contains('failed'));
assert(doc.getElementById('status').textContent.includes('Fixture failure'));
state.fail='';state.empty=true;doc.getElementById('retry').click();await ready(()=>!doc.body.classList.contains('loading'));
assert.equal(doc.getElementById('empty').hidden,false);assert(doc.getElementById('exportHint').textContent.includes('OTEL_METRIC_EXPORT_INTERVAL'));
doc.querySelector('[data-tab=cost]').click();await ready(()=>!doc.body.classList.contains('loading'));
assert.equal(preset.value,'all');assert.equal(doc.getElementById('start').value,'');assert.equal(doc.getElementById('kpiChange').textContent,UI.missingValue);
doc.querySelector('[data-tab=tokens]').click();await ready(()=>!doc.body.classList.contains('loading'));
assert.equal(preset.value,'168');
f.close();
const denied=fixture({denyStorage:true,systemLight:true});
await ready(()=>denied.doc.getElementById('kpiTokens').textContent==='200');
assert.equal(denied.doc.documentElement.dataset.theme,'light');
denied.state.changes[0]({matches:false});assert.equal(denied.doc.documentElement.dataset.theme,'dark');
denied.doc.getElementById('theme').click();assert.equal(denied.doc.documentElement.dataset.theme,'light');
denied.state.changes[0]({matches:false});assert.equal(denied.doc.documentElement.dataset.theme,'light');
denied.close();
console.log('PASS: Burnrate themes, series colors, KPI comparison, safe project controls, filters, keyboard sort, empty/error/retry and denied storage');
