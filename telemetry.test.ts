import { describe, expect, it } from 'vitest';
import {findAttr,parseClaudeMetrics,parseCodexLogs,TelemetryLimitError} from './telemetry';
const attr=(key:string,value:string)=>({key,value:{stringValue:value}});
function metric(name:string,type?:string,attributes:any[]=[],value:any='7',gauge=false):any{return {name,[gauge?'gauge':'sum']:{dataPoints:[{asInt:value,attributes:[...(type?[attr('type',type)]:[]),...attributes]}]}};}
function payload(metrics:any[],attributes:any[]=[]){return {resourceMetrics:[{resource:{attributes},scopeMetrics:[{metrics}]}]};}
describe('Claude normalization remains compatible',()=>{
 it('normalizes four disjoint token types plus cost',()=>{
  const {records}=parseClaudeMetrics(payload(['input','output','cacheRead','cacheCreation'].map(type=>metric('claude_code.token.usage',type,[attr('vcs.repository.name','repo'),attr('session.id','s')])).concat([metric('claude_code.cost.usage',undefined)])));
  expect(records).toHaveLength(5);
  for(const [index,key] of ['input_tokens','output_tokens','cache_read_tokens','cache_write_tokens','total_cost_usd'].entries())expect((records[index] as any)[key]).toBe(7);
  expect(records[0]).toMatchObject({project_name:'repo',source:'claude',session_id:'s',model:'claude-3-5-sonnet'});
 });
 it('handles gauge/double values and resource fallback attribution',()=>{
  const m=metric('claude_code.token.usage','input',[],undefined,true);m.gauge.dataPoints[0].asDouble=3;
  expect(parseClaudeMetrics(payload([m],[attr('project.name','resource'),attr('host.name','host'),attr('user.email','mail')])).records[0]).toMatchObject({project_name:'resource',input_tokens:3,host_name:'host',user_email:'mail'});
 });
 it('prefers point host/email and service fallback',()=>{expect(parseClaudeMetrics(payload([metric('claude_code.cost.usage',undefined,[attr('host.name','point'),attr('user.email','user')])],[attr('service.name','service')])).records[0]).toMatchObject({project_name:'service',host_name:'point',user_email:'user'});});
 it('defaults missing metadata and numeric values',()=>{expect(parseClaudeMetrics({resourceMetrics:[{scopeMetrics:[{metrics:[{name:'claude_code.cost.usage',sum:{dataPoints:[{}]}}]}]}]}).records[0]).toMatchObject({project_name:'default-project',session_id:'active_session',total_cost_usd:0});});
 it('skips unsupported metrics and unknown token types',()=>{expect(parseClaudeMetrics(payload([metric('other','input'),metric('claude_code.token.usage','unknown'),{name:'empty'}]))).toEqual({records:[],rejectedDataPoints:0});});
 it('ignores absent resource/scope/metric lists',()=>{expect(parseClaudeMetrics({})).toEqual({records:[],rejectedDataPoints:0});expect(parseClaudeMetrics({resourceMetrics:[{}, {scopeMetrics:[{}]}]})).toEqual({records:[],rejectedDataPoints:0});});
 it('reads AnyValue strings safely',()=>{expect(findAttr(undefined,'x')).toBeUndefined();expect(findAttr([{key:'x',value:{}}],'x')).toBeUndefined();});
});
describe('Codex defensive normalization',()=>{
 it('skips malformed individual records and preserves valid cost',()=>{
  const result=parseCodexLogs({resourceLogs:[{scopeLogs:[{logRecords:[null,{attributes:{}},{eventName:'codex.turn_cost',attributes:[{key:'usage.estimated_usd',value:{doubleValue:1.2}}]}]}]}]},null);
  expect(result.rejectedLogRecords).toBe(2);expect(result.records[0].total_cost_usd).toBe(1.2);
 });
});

describe('per-record rejection and bounded normalization',()=>{
 it.each([{boolValue:true},{arrayValue:{values:[]}},{kvlistValue:{values:[]}},{bytesValue:'AA=='},{},{stringValue:'1',intValue:'1'}])('rejects unsupported numeric AnyValue %j',value=>{
  const completion={attributes:[attr('event.name','codex.sse_event'),attr('event.kind','response.completed'),{key:'input_token_count',value},attr('output_token_count','2')]};
  const cost={attributes:[attr('event.name','codex.turn_cost'),{key:'usage.estimated_usd',value}]};
  const result=parseCodexLogs({resourceLogs:[{scopeLogs:[{logRecords:[completion,cost]}]}]},null);
  expect(result.records).toEqual([]);expect(result.rejectedLogRecords).toBe(2);
 });
 it('skips invalid Claude tokens/costs while retaining good siblings and fractional costs',()=>{
  const result=parseClaudeMetrics(payload([
   ...[NaN,-1,1.5,'',true,'NaN',Infinity].map(value=>metric('claude_code.token.usage','input',[],value)),
   metric('claude_code.token.usage','input',[],'12'),
   ...[-1,NaN,''].map(value=>metric('claude_code.cost.usage',undefined,[],value)),
   metric('claude_code.cost.usage',undefined,[],1.5),
  ]));
  expect(result.rejectedDataPoints).toBe(10);expect(result.records).toHaveLength(2);
  expect(result.records[0].input_tokens).toBe(12);expect(result.records[1].total_cost_usd).toBe(1.5);
 });
 it('stops Claude normalization at the first over-budget row',()=>{
  const poison={get asInt(){throw new Error('must not normalize the rest');},attributes:[attr('type','input')]};
  const points=[...Array.from({length:3},()=>({asInt:'1',attributes:[attr('type','input')]})),poison];
  expect(()=>parseClaudeMetrics(payload([{name:'claude_code.token.usage',sum:{dataPoints:points}}]),2)).toThrow(TelemetryLimitError);
 });
 it('does not swallow the Codex row-budget failure as a malformed record',()=>{
  const records=[...Array.from({length:3},()=>({attributes:[attr('event.name','codex.turn_cost'),attr('usage.estimated_usd','1')]})),{get attributes(){throw new Error('must not normalize the rest');}}];
  expect(()=>parseCodexLogs({resourceLogs:[{scopeLogs:[{logRecords:records}]}]},null,2)).toThrow(TelemetryLimitError);
 });
});
