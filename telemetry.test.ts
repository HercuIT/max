import { describe, expect, it } from 'vitest';
import {findAttr,parseClaudeMetrics,parseCodexLogs} from './telemetry';
const attr=(key:string,value:string)=>({key,value:{stringValue:value}});
function metric(name:string,type?:string,attributes:any[]=[],value:any='7',gauge=false):any{return {name,[gauge?'gauge':'sum']:{dataPoints:[{asInt:value,attributes:[...(type?[attr('type',type)]:[]),...attributes]}]}};}
function payload(metrics:any[],attributes:any[]=[]){return {resourceMetrics:[{resource:{attributes},scopeMetrics:[{metrics}]}]};}
describe('Claude normalization remains compatible',()=>{
 it('normalizes four disjoint token types plus cost',()=>{
  const records=parseClaudeMetrics(payload(['input','output','cacheRead','cacheCreation'].map(type=>metric('claude_code.token.usage',type,[attr('vcs.repository.name','repo'),attr('session.id','s')])).concat([metric('claude_code.cost.usage',undefined)])));
  expect(records).toHaveLength(5);
  for(const [index,key] of ['input_tokens','output_tokens','cache_read_tokens','cache_write_tokens','total_cost_usd'].entries())expect((records[index] as any)[key]).toBe(7);
  expect(records[0]).toMatchObject({project_name:'repo',source:'claude',session_id:'s',model:'claude-3-5-sonnet'});
 });
 it('handles gauge/double values and resource fallback attribution',()=>{
  const m=metric('claude_code.token.usage','input',[],undefined,true);m.gauge.dataPoints[0].asDouble=3;
  expect(parseClaudeMetrics(payload([m],[attr('project.name','resource'),attr('host.name','host'),attr('user.email','mail')]))[0]).toMatchObject({project_name:'resource',input_tokens:3,host_name:'host',user_email:'mail'});
 });
 it('prefers point host/email and service fallback',()=>{expect(parseClaudeMetrics(payload([metric('claude_code.cost.usage',undefined,[attr('host.name','point'),attr('user.email','user')])],[attr('service.name','service')]))[0]).toMatchObject({project_name:'service',host_name:'point',user_email:'user'});});
 it('defaults missing metadata and numeric values',()=>{expect(parseClaudeMetrics({resourceMetrics:[{scopeMetrics:[{metrics:[{name:'claude_code.cost.usage',sum:{dataPoints:[{}]}}]}]}]})[0]).toMatchObject({project_name:'default-project',session_id:'active_session',total_cost_usd:0});});
 it('skips unsupported metrics and unknown token types',()=>{expect(parseClaudeMetrics(payload([metric('other','input'),metric('claude_code.token.usage','unknown'),{name:'empty'}]))).toEqual([]);});
 it('ignores absent resource/scope/metric lists',()=>{expect(parseClaudeMetrics({})).toEqual([]);expect(parseClaudeMetrics({resourceMetrics:[{}, {scopeMetrics:[{}]}]})).toEqual([]);});
 it('reads AnyValue strings safely',()=>{expect(findAttr(undefined,'x')).toBeUndefined();expect(findAttr([{key:'x',value:{}}],'x')).toBeUndefined();});
});
describe('Codex defensive normalization',()=>{
 it('skips malformed individual records and preserves valid cost',()=>{
  const result=parseCodexLogs({resourceLogs:[{scopeLogs:[{logRecords:[null,{attributes:{}},{eventName:'codex.turn_cost',attributes:[{key:'usage.estimated_usd',value:{doubleValue:1.2}}]}]}]}]},null);
  expect(result.rejectedLogRecords).toBe(2);expect(result.records[0].total_cost_usd).toBe(1.2);
 });
});
