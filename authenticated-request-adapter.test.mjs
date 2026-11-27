// Actual adapter/receipt validator and Python transitions. Host/request, backend
// and transport ports below are labeled doubles, NOT live host acceptance.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import guard from './native-loop-repair/proposed/index.mjs';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {registerAuthenticatedReceiptRpc} from './authenticated-request-adapter.mjs';
const snapshot=()=>JSON.parse(execFileSync('python3',['-B','server/receipt_service_test.py','--emit-contract-fixture'],{encoding:'utf8',timeout:5000}));
function fixture({tool='fixture_workflow_status',dispatch}={}){
 const wire=snapshot(),calls=[];let handler,registration,current=true,response;
 const method=registerAuthenticatedReceiptRpc({pluginConfig:{connections:['F'],...(tool?{receiptStatusTool:tool,receiptStartupTool:'fixture_startup',toolNames:{[tool]:'workflow_status',fixture_startup:'startup'}}:{})},
  registerGatewayMethod(name,fn,opts){handler=fn;registration={name,opts};}},
 {now:()=>2000000,dispatchGatewayMethod:async(...a)=>{
   calls.push(a);if(dispatch)return dispatch(...a);
   if(a[0]==='sessions.resolve')return {ok:true,payload:{ok:true,key:a[1].key,agentId:'fixture-peer'}};
   if(a[1].name==='fixture_startup')return {ok:true,payload:{ok:true,source:'mcp',output:{structuredContent:{state:'READY',connection:'F',kernel:{kernel_state:'active',addressing:'conversation_key'},startup_proof:'v1.2000.'+'c'.repeat(32)+'.'+'a'.repeat(64),startup_proof_expires_in_seconds:3600}}}};
   return {ok:true,payload:{ok:true,source:'mcp',output:{structuredContent:{status:'completed',snapshot:wire}}}};
 }});
 const params={sessionKey:'fixture-existing-session',taskRef:{factory:wire.factory,taskId:wire.taskId,taskRevision:wire.taskRevision}};
 const options={client:{connect:{scopes:['operator.write']}},hasCurrentClientAuthority:()=>current,params,respond(_ok,v){response=v;}};
 return {wire,calls,options,params,registration,method,revoke(){current=false;},async call(patch={}){response=undefined;await handler({...options,...patch});return response;}};
}
test('authenticated RPC uses supported contract/session policy and the existing read-only MCP tool only',async()=>{
 const f=fixture();assert.equal(f.method,true);assert.deepEqual(f.registration,{name:'omatic.connection.workflowStatus',opts:{scope:'operator.write',profileAccess:'required',sessionAccess:{mode:'write'}}});
 const result=await f.call();assert.equal(result.status,'completed');assert.equal(f.calls.length,3);
 assert.deepEqual(f.calls[0][0],'sessions.resolve');assert.deepEqual(f.calls[0][1],{key:'fixture-existing-session'});
 const key='openclaw:'+createHash('sha256').update(JSON.stringify(['fixture-peer','fixture-existing-session'])).digest('hex');
 assert.deepEqual(f.calls[1][1],{name:'fixture_startup',sessionKey:'fixture-existing-session',args:{connection:'F',conversation_key:key},confirm:false});
 const [method,args,opts]=f.calls[2];assert.equal(method,'tools.invoke');
 assert.equal(args.args.conversation_key,key);assert.equal(args.args.startup_proof,'v1.2000.'+'c'.repeat(32)+'.'+'a'.repeat(64));
 assert.equal(args.args.factory,'F');assert.equal(args.args.taskId,f.wire.taskId);assert.equal(args.name,'fixture_workflow_status');
 assert.deepEqual(opts,{timeoutMs:1000,expectFinal:true});assert.ok(!JSON.stringify(result).includes('startup_proof'));

});
test('no configured backend is blocked without dispatch or credential fallback',async()=>{
 const f=fixture({tool:null});assert.equal((await f.call()).reason,'receipt_backend_unconfigured');assert.equal(f.calls.length,0);
});
test('forged identities and request scopes cannot replace code-owned current caller',async()=>{
 for(const patch of [{client:null},{hasCurrentClientAuthority:undefined},{hasCurrentClientAuthority:()=>false},{hasCurrentClientAuthority:()=>Promise.resolve(true)},{signal:{aborted:true}}]){
  const f=fixture();assert.equal((await f.call(patch)).status,'blocked');assert.equal(f.calls.length,0);
 }
});
test('lookup rejects principal/role/proof/tool overrides and foreign factories before dispatch',async()=>{
 for(const change of [p=>p.principalId='invented',p=>p.startup_proof='invented',p=>p.tool='other',p=>p.agentId='other',p=>p.taskRef.factory='foreign',p=>p.taskRef.snapshot={}]){
  const f=fixture();const p=structuredClone(f.params);change(p);assert.notEqual((await f.call({params:p})).status,'completed');assert.equal(f.calls.length,0);
 }
});
test('revocation during dispatch prevents receipt disclosure',async()=>{
 let f;f=fixture({dispatch:async()=>{f.revoke();return {ok:true,payload:{ok:true,source:'mcp',output:{structuredContent:{snapshot:f.wire}}}};}});
 const r=await f.call();assert.equal(r.status,'blocked');assert.ok(!JSON.stringify(r).includes(f.wire.taskId));
});
test('non-MCP, missing and failed backend responses never become receipt authority',async()=>{
 for(const value of [{ok:false},{ok:true,payload:{ok:false}},{ok:true,payload:{ok:true,source:'plugin',output:{structuredContent:{snapshot:{}}}}},{ok:true,payload:{ok:true,source:'mcp',output:{isError:true}}}]){
  const f=fixture({dispatch:async()=>value});assert.equal((await f.call()).status,'blocked');assert.equal(f.calls.length,1);
 }
});
test('SDK failures are finite, sanitized and never trigger startup/retry',async()=>{
 const f=fixture({dispatch:async()=>{throw new Error('private SDK error');}});const r=await f.call();assert.equal(r.status,'blocked');assert.equal(f.calls.length,1);assert.ok(!JSON.stringify(r).includes('private'));
});
test('installed public SDK rejects dispatch outside an authenticated request scope',async()=>{
 const {dispatchGatewayMethod}=await import('/Users/lucid/.openclaw/runtime/2026.11.9-release-0032b1d7ffd0-2026-11-25T00-25-41.000Z/lib/node_modules/openclaw/dist/plugin-sdk/gateway-method-runtime.js');
 const f=fixture({dispatch:dispatchGatewayMethod});const r=await f.call();assert.equal(r.status,'blocked');assert.equal(f.calls.length,1);
});
test('older host without RPC registration does not invent an alternate route',()=>{
 assert.equal(registerAuthenticatedReceiptRpc({pluginConfig:{}}),false);
});

test('canonical session resolution failures block before MCP startup',async()=>{
 for(const payload of [{ok:false},{ok:true,key:'another',agentId:'fixture-peer'},{ok:true,key:'fixture-existing-session'}]){
  const f=fixture({dispatch:async()=>({ok:true,payload})});assert.equal((await f.call()).status,'blocked');assert.equal(f.calls.length,1);
 }
});
test('nonready or cross-factory startup never dispatches receipt read',async()=>{
 for(const startup of [{state:'BLOCKED'}, {state:'READY',connection:'foreign'}, {state:'READY',connection:'F',kernel:{kernel_state:'active',addressing:'conversation_key'},startup_proof:'forged'}]){
  const f=fixture({dispatch:async(method,args)=>method==='sessions.resolve'?{ok:true,payload:{ok:true,key:args.key,agentId:'fixture-peer'}}:{ok:true,payload:{ok:true,source:'mcp',output:{structuredContent:startup}}}});
  assert.equal((await f.call()).status,'blocked');assert.equal(f.calls.length,2);
 }
});
test('RPC proof arguments pass native scoped-read guard without any rewriting',async()=>{
 const f=fixture();await f.call();const hooks=new Map();
 guard.register({on:(name,fn)=>hooks.set(name,fn),pluginConfig:{connections:['F'],toolNames:{fixture_startup:'startup',fixture_workflow_status:'workflow_status'}}});
 const ctx={agentId:'fixture-peer',sessionKey:f.params.sessionKey,runId:'fixture-run'};
 const start={toolName:'fixture_startup',toolCallId:'fixture-start',params:f.calls[1][1].args};
 assert.equal(hooks.get('before_tool_call')(start,ctx),undefined);
 hooks.get('after_tool_call')({...start,result:{structuredContent:{state:'READY',connection:'F',kernel:{kernel_state:'active',addressing:'conversation_key'},startup_proof:f.calls[2][1].args.startup_proof,startup_proof_expires_in_seconds:3600}}},ctx);
 const read={toolName:'fixture_workflow_status',params:f.calls[2][1].args};
 const original=JSON.stringify(read.params);assert.equal(hooks.get('before_tool_call')(read,ctx),undefined);assert.equal(JSON.stringify(read.params),original);
 assert.equal(hooks.get('before_tool_call')({...read,params:{...read.params,startup_proof:undefined}},ctx).block,true);
 assert.equal(hooks.get('before_tool_call')({...read,params:{...read.params,factory:'foreign'}},ctx).block,true);
 assert.equal(hooks.get('before_tool_call')({toolName:'mcp__o_MATIC_Server__workflow_begin',params:read.params},ctx).block,true);
});
