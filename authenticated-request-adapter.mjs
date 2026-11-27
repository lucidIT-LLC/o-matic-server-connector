import {createHash} from 'node:crypto';
import { createReceiptVerifier } from './receipt-contract.mjs';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=v=>typeof v==='string'&&v.length>0&&v.length<=256&&v.isWellFormed();
const blocked=reason=>({status:'blocked',reason,automaticRetry:false});
function assertRequest(options){
  const current=typeof options.hasCurrentClientAuthority==='function'?options.hasCurrentClientAuthority():false;
  if(current&&typeof current.then==='function')Promise.resolve(current).catch(()=>{});
  if(!object(options.client)||current!==true||options.signal?.aborted)
    throw new Error('authenticated_request_scope_unavailable');
}
function packet(output){
  if(output?.isError)throw new Error('receipt_backend_refused');
  if(object(output?.structuredContent))return output.structuredContent;
  if(!Array.isArray(output?.content)||output.content.length!==1||output.content[0]?.type!=='text')
    throw new Error('receipt_backend_invalid_response');
  const value=output.content[0].text;
  if(typeof value!=='string'||value.length>262144)throw new Error('receipt_backend_invalid_response');
  return JSON.parse(value);
}
async function publicDispatch(method,params,options){
  // Public external-plugin contract, NOT runtime.gateway.request (which is
  // reserved for bundled/trusted-official plugins). Loader retains the exact
  // authenticated RPC client; the SDK disables synthetic clients.
  const {dispatchGatewayMethod}=await import('openclaw/plugin-sdk/gateway-method-runtime');
  return dispatchGatewayMethod(method,params,options);
}
export function registerAuthenticatedReceiptRpc(api,{dispatchGatewayMethod=publicDispatch,now=Date.now}={}){
  if(typeof api.registerGatewayMethod!=='function')return false;
  const config=api.pluginConfig??{},connections=new Set(config.connections??[]);
  const tool=config.receiptStatusTool,startupTool=config.receiptStartupTool;
  const validTool=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,256}$/.test(value);
  const configured=validTool(tool)&&validTool(startupTool)
    && config.toolNames?.[tool]==='workflow_status' && config.toolNames?.[startupTool]==='startup';
  api.registerGatewayMethod('omatic.connection.workflowStatus',async options=>{
    const respond=result=>options.respond(true,result);
    try{
      assertRequest(options);
      const p=options.params;
      if(!object(p)||Object.keys(p).some(k=>!['sessionKey','taskRef'].includes(k))
          ||!text(p.sessionKey)||!object(p.taskRef)||Object.keys(p.taskRef).length!==3
          ||!text(p.taskRef.factory)||!text(p.taskRef.taskId)
          ||!Number.isSafeInteger(p.taskRef.taskRevision)||p.taskRef.taskRevision<1)
        return respond({status:'refused',reason:'lookup_reference_only',automaticRetry:false});
      if(!connections.has(p.taskRef.factory))
        return respond({status:'refused',reason:'unconfigured_factory_reference',automaticRetry:false});
      if(!configured)return respond(blocked('receipt_backend_unconfigured'));
      const sessionKey=p.sessionKey,taskRef=Object.freeze({...p.taskRef});
      const verify=createReceiptVerifier({now,assertCurrent:()=>assertRequest(options),
        readVerifiedSnapshot:async expected=>{
          assertRequest(options);
          // Routing facts, NOT executor/custody evidence: the actual Gateway
          // resolves the admitted existing session; no model agent/key override.
          const resolved=await dispatchGatewayMethod('sessions.resolve',{key:sessionKey},
            {timeoutMs:1000,expectFinal:true});
          assertRequest(options);
          const facts=resolved?.payload;
          if(resolved?.ok!==true||facts?.ok!==true||facts.key!==sessionKey||!text(facts.agentId))
            throw new Error('authenticated_session_routing_unavailable');
          // Same deterministic key protocol as the native guard; never a new
          // conversation key. Authority remains the authenticated Server caller.
          const conversationKey='openclaw:'+createHash('sha256')
            .update(JSON.stringify([facts.agentId,facts.key])).digest('hex');
          const started=await dispatchGatewayMethod('tools.invoke',{
            name:startupTool,sessionKey,
            args:{connection:expected.factory,conversation_key:conversationKey},confirm:false,
          },{timeoutMs:1000,expectFinal:true});
          assertRequest(options);
          if(started?.ok!==true||started.payload?.ok!==true||started.payload.source!=='mcp')
            throw new Error('receipt_startup_unavailable');
          const startup=packet(started.payload.output);
          const proof=startup?.startup_proof,ttl=startup?.startup_proof_expires_in_seconds;
          if(startup?.state!=='READY'||startup.connection!==expected.factory
              ||startup.kernel?.kernel_state!=='active'||startup.kernel?.addressing!=='conversation_key'
              ||typeof proof!=='string'||!/^v1\.\d{1,12}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(proof)
              ||!Number.isInteger(ttl)||ttl<1||ttl>3600)
            throw new Error('receipt_ready_startup_required');
          // Only this authenticated startup's proof enters the status tool
          // arguments. It is never accepted from UI/model, stored or returned.
          const result=await dispatchGatewayMethod('tools.invoke',{
            name:tool,sessionKey,
            args:{factory:expected.factory,taskId:expected.taskId,
              conversation_key:conversationKey,startup_proof:proof},confirm:false,
          },{timeoutMs:1000,expectFinal:true});
          assertRequest(options);
          if(result?.ok!==true||result.payload?.ok!==true||result.payload.source!=='mcp')
            throw new Error('receipt_backend_unavailable');
          const wire=packet(result.payload.output);
          if(!object(wire)||!object(wire.snapshot))throw new Error('receipt_backend_unavailable');
          return wire.snapshot;
        }});
      const result=await verify(taskRef);
      assertRequest(options);return respond(result);
    }catch{
      // No raw SDK/backend exceptions, credentials, provenance claims or
      // receipt snapshots are disclosed on missing/revoked request authority.
      return respond(blocked('authenticated_receipt_request_failed'));
    }
  },{scope:'operator.write',profileAccess:'required',sessionAccess:{mode:'write'}});
  return true;
}
