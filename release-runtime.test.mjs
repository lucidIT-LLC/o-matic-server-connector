import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import entry from "./dist-runtime/index.js";

function fixture() {
  const hooks = new Map(); let descriptor;
  const ctx = { agentId: "probot", sessionKey: "agent:probot:main", sessionId: "fixture-incarnation", assertInvocationCurrent() {} };
  const key = `openclaw:${createHash("sha256").update(JSON.stringify([ctx.agentId, ctx.sessionKey])).digest("hex")}`;
  entry.register({ on(name,fn){const handlers=hooks.get(name)??[];handlers.push(fn);hooks.set(name,handlers);},
    registerTool(value){descriptor=value;}, pluginConfig:{connections:["F"],toolNames:{s:"startup",q:"search"}} });
  const call = (name,event,context=ctx) => { for(const fn of hooks.get(name)??[]){const result=fn(event,context);if(result?.block)return result;} };
  const proof="v1.2000."+"c".repeat(32)+"."+"a".repeat(64);
  const event=(id="startup")=>({toolName:"s",toolCallId:id,params:{connection:"F",conversation_key:key}});
  const wire=(patch={})=>({state:"READY",connection:"F",kernel:{kernel_state:"active",addressing:"conversation_key"},startup_proof:proof,startup_proof_expires_in_seconds:3600,session_tool_surface:{state:"UNVERIFIED",this_session_listed_by_this_process:false},...patch});
  const ready=(patch={})=>{const ev=event();call("before_tool_call",ev);call("after_tool_call",{...ev,result:{structuredContent:wire(patch)}});};
  const status=async(context=ctx,args={})=>JSON.parse((await descriptor.create(context).execute("status",args)).content[0].text);
  return {hooks,ctx,key,call,event,wire,ready,status,proof,descriptor};
}
test("shipped compiled entry exposes exact display name, public v2 status and legacy guards",()=>{
  const f=fixture();assert.equal(entry.name,"o-MATIC Server Connection");assert.equal(f.descriptor.contextVersion,2);
  assert.equal(f.descriptor.create(f.ctx).name,"omatic_connection_status");assert.ok(!f.hooks.has("before_agent_finalize"));
});
test("unbound workflow remains blocked even after READY and verified discovery",async()=>{
  const f=fixture();f.ready({session_tool_surface:{state:"CURRENT",this_session_listed_by_this_process:true}});
  const result=await f.status();assert.equal(result.factories[0].readiness,"READY");assert.equal(result.factories[0].toolSurface,"CURRENT");
  assert.equal(result.workflow.status,"blocked");assert.equal(result.workflow.automaticRetry,false);
  assert.equal(result.agentDispatch,"not_provided");assert.ok(!JSON.stringify(result).includes(f.proof));
});
test("catalog warning survives successful known reads and cannot force an automatic reply loop",async()=>{
  const f=fixture();f.ready();assert.equal(f.call("before_tool_call",{toolName:"q",params:{connection:"F",conversation_key:f.key,startup_proof:f.proof}}),undefined);
  const result=await f.status();assert.equal(result.factories[0].toolSurface,"UNVERIFIED");assert.equal(result.discovery.automaticRetry,false);
});
test("a newer failed startup cannot be overwritten by an older successful observation",async()=>{
  const f=fixture();const old=f.event("old"),current=f.event("new");f.call("before_tool_call",old);f.call("before_tool_call",current);
  f.call("after_tool_call",{...current,result:{structuredContent:{state:"BLOCKED"}}});
  f.call("after_tool_call",{...old,result:{structuredContent:f.wire()}});
  assert.equal((await f.status()).factories[0].readiness,"UNVERIFIED");
});
test("shared credential claims, task labels and fabricated completion cannot be status input",async()=>{
  const f=fixture();await assert.rejects(f.status(f.ctx,{actorId:"probot",completed:true}),/No actor/);
  await assert.rejects(f.status({...f.ctx,assertInvocationCurrent(){throw new Error("revoked");}}),/revoked/);
  assert.equal(f.descriptor.create({...f.ctx,assertInvocationCurrent:undefined}),null);
});
test("status observations are isolated from another host session incarnation",async()=>{
  const f=fixture();f.ready();assert.equal((await f.status({...f.ctx,sessionId:"other"})).factories[0].readiness,"UNVERIFIED");
});
