import { createHash } from "node:crypto";
export const CONTRACT = "omatic.workflow-receipt/2";
export const PROVENANCE = ["hostId", "sessionId", "sessionIncarnation", "runId", "correlationId"];
export const EVIDENCE_FIELDS = ["operationId", "receiptId", "principalId", "executorRole", "taskRevision",
  "artifactId", "artifactVersion", "artifactSha256", "readbackVersion", "readbackSha256", "execution", "approvalRef", "assignmentId", "acceptedInputId",
  "returnReceiptId", "parentRunId", "parentCorrelationId", "parentSessionIncarnation", ...PROVENANCE];
export const ACCEPTANCE_FIELDS=["receiptId","principalId","executorRole","taskRevision","stateVersion","decision","evidenceDigest","approvalRef",...PROVENANCE];
export const COMPLETION_FIELDS=["receiptId","principalId","executorRole","stateVersion","acceptanceDigest","approvalRef",...PROVENANCE];
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v) => typeof v === "string" && v.length > 0 && Array.from(v).length <= 256 && v.isWellFormed();
const revision = (v) => Number.isSafeInteger(v) && v > 0;
const sha = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const outcome = (status, reason, extra = {}) => ({ status, reason, automaticRetry: false, ...extra });
// Unicode-scalar order agrees with Python; no locale/UTF-16 sorting ambiguity.
const compare = (a,b) => {const x=Array.from(a),y=Array.from(b);for(let i=0;i<Math.min(x.length,y.length);i++){const d=x[i].codePointAt(0)-y[i].codePointAt(0);if(d)return d;}return x.length-y.length;};
export function evidenceDigest(record) {
  const requirements=record.requirements.map(r=>[r.operationId,r.ownerRole]).sort((a,b)=>compare(a[0],b[0]));
  const evidence=record.evidence.map(e=>EVIDENCE_FIELDS.map(k=>e[k])).sort((a,b)=>compare(a[0],b[0]));
  return createHash("sha256").update(JSON.stringify(["omatic.workflow-evidence/2",record.factory,record.principalId,record.taskId,
    record.taskRevision,record.policyRevision,record.initialApprovalRef,record.coordinatorRole,PROVENANCE.map(k=>record.origin[k]),requirements,evidence])).digest("hex");
}
export const acceptanceDigest=s=>createHash("sha256").update(JSON.stringify(["omatic.workflow-acceptance/2",s.factory,s.principalId,s.taskId,s.taskRevision,s.policyRevision,ACCEPTANCE_FIELDS.map(k=>s.acceptance[k])])).digest("hex");
export const completionDigest=s=>createHash("sha256").update(JSON.stringify(["omatic.workflow-completion/2",s.factory,s.principalId,s.taskId,s.taskRevision,s.policyRevision,COMPLETION_FIELDS.map(k=>s.completion[k])])).digest("hex");
// Consistency validation only. Authenticity/current grants/provenance must come
// from the code-owned readVerifiedSnapshot adapter, never model-authored JSON.
export function evaluateVerifiedSnapshot(s, expected, now=Date.now()) {
  if(!object(s)||s.contract!==CONTRACT)return outcome("blocked","unsupported_receipt_contract");
  if(s.factory!==expected.factory||s.taskId!==expected.taskId)return outcome("refused","receipt_scope_mismatch");
  if(!revision(s.taskRevision)||s.taskRevision!==expected.taskRevision)return outcome("blocked","stale_task_revision");
  if(!revision(s.version)||!revision(s.policyRevision))return outcome("blocked","invalid_state_or_policy_revision");
  if(!Number.isSafeInteger(s.observedAt)||!Number.isSafeInteger(s.expiresAt)||s.observedAt>now||s.expiresAt<=now
    ||s.expiresAt<=s.observedAt||s.expiresAt-s.observedAt>60000)return outcome("blocked","receipt_snapshot_not_current");
  if(s.grantState!=="current")return outcome("refused","current_backend_grants_required");
  if(s.taskState==="cancelled")return outcome("refused","task_cancelled");
  if(s.taskState==="failed")return outcome("blocked","task_failed");
  if(!["active","completed"].includes(s.taskState))return outcome("blocked","unknown_task_state");
  if(!text(s.principalId))return outcome("blocked","authenticated_principal_required");
  if(!text(s.initialApprovalRef))return outcome("blocked","operation_approval_reference_required");
  if(s.executorBinding!=="verified-host-execution")return outcome("blocked","executor_unverified");
  if(!text(s.coordinatorRole))return outcome("blocked","coordinator_binding_required");
  if(!object(s.origin)||PROVENANCE.some(k=>!text(s.origin[k])))return outcome("blocked","executor_unverified");
  if(!Array.isArray(s.requirements)||!s.requirements.length||s.requirements.length>64||!Array.isArray(s.evidence)||s.evidence.length>64)
    return outcome("blocked","invalid_operation_requirements");
  const requirements=new Map(),receipts=new Set(),seen=new Set();
  for(const r of s.requirements){if(!object(r)||Object.keys(r).length!==2||!text(r.operationId)||!text(r.ownerRole)||requirements.has(r.operationId))
    return outcome("blocked","ambiguous_operation_owner_binding");requirements.set(r.operationId,r.ownerRole);}
  for(const e of s.evidence){
    if(!object(e)||!text(e.operationId)||!text(e.receiptId)||seen.has(e.operationId)||receipts.has(e.receiptId)||!requirements.has(e.operationId))
      return outcome("blocked","ambiguous_evidence_receipt");
    seen.add(e.operationId);receipts.add(e.receiptId);
    if(e.principalId!==s.principalId||e.executorRole!==requirements.get(e.operationId))return outcome("refused","wrong_operation_executor");
    if(e.taskRevision!==s.taskRevision)return outcome("blocked","stale_artifact_revision");
    if(e.execution!=="succeeded")return outcome("pending","operation_not_succeeded");
    if(EVIDENCE_FIELDS.some(k=>!["taskRevision","artifactVersion","readbackVersion"].includes(k)&&!text(e[k])))return outcome("blocked","executor_unverified");
    if(!revision(e.artifactVersion)||e.readbackVersion!==e.artifactVersion)return outcome("blocked","artifact_version_mismatch");
    if(e.parentRunId!==s.origin.runId||e.parentCorrelationId!==s.origin.correlationId||e.parentSessionIncarnation!==s.origin.sessionIncarnation)return outcome("blocked","receipt_parent_correlation_mismatch");
    if(!sha(e.artifactSha256)||e.artifactSha256!==e.readbackSha256)return outcome("blocked","artifact_readback_mismatch");
  }
  if(seen.size!==requirements.size)return outcome("pending","required_operation_evidence_missing");
  const a=s.acceptance;
  if(!object(a))return outcome("pending","coordinator_review_required");
  if(a.principalId!==s.principalId||a.executorRole!==s.coordinatorRole)return outcome("refused","wrong_accepting_executor");
  if(PROVENANCE.some(k=>!text(a[k])))return outcome("blocked","executor_unverified");
  if(a.taskRevision!==s.taskRevision||a.evidenceDigest!==evidenceDigest(s))return outcome("blocked","stale_coordinator_acceptance");
  if(!revision(a.stateVersion)||a.stateVersion>s.version||!text(a.approvalRef))return outcome("blocked","invalid_acceptance_fields");
  if(!text(a.receiptId))return outcome("blocked","acceptance_receipt_required");
  if(Object.keys(a).some(k=>![...ACCEPTANCE_FIELDS,"acceptanceDigest"].includes(k))||a.acceptanceDigest!==acceptanceDigest(s))return outcome("blocked","acceptance_digest_mismatch");
  if(receipts.has(a.receiptId))return outcome("blocked","receipt_type_replay");
  if(a.decision==="rejected")return outcome("refused","coordinator_rejected");
  if(a.decision!=="accepted")return outcome("pending","coordinator_review_required");
  if(s.taskState!=="completed"||!text(s.completionReceiptId))return outcome("pending","server_completion_commit_required");
  if(s.completionReceiptId===a.receiptId||receipts.has(s.completionReceiptId))return outcome("blocked","receipt_type_replay");
  const c=s.completion;
  if(!object(c)||COMPLETION_FIELDS.some(k=>k!=="stateVersion"&&!text(c[k]))||!revision(c.stateVersion)||c.stateVersion>s.version||c.stateVersion<a.stateVersion)
    return outcome("blocked","invalid_completion_fields");
  if(c.receiptId!==s.completionReceiptId||c.principalId!==s.principalId||c.executorRole!==s.coordinatorRole||c.acceptanceDigest!==a.acceptanceDigest
    ||Object.keys(c).some(k=>![...COMPLETION_FIELDS,"completionDigest"].includes(k))||c.completionDigest!==completionDigest(s))return outcome("blocked","completion_digest_mismatch");
  const delivery=object(s.delivery)&&["delivered","not_delivered","ambiguous","unverified"].includes(s.delivery.status)
    &&(s.delivery.status!=="delivered"||text(s.delivery.receiptId))?s.delivery.status:"unverified";
  return outcome("completed","verified_task_completion",{taskRevision:s.taskRevision,completionReceiptId:s.completionReceiptId,
    evidenceDigest:a.evidenceDigest,delivery:{status:delivery}});
}
export function createReceiptVerifier({readVerifiedSnapshot,assertCurrent,now=Date.now,timeoutMs=1000}={}){
  if(typeof assertCurrent!=="function")throw new Error("Code-owned current-invocation guard required");
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new Error("Bounded receipt-read deadline required");
  const checkCurrent=()=>{const result=assertCurrent();if(result!==undefined){if(result&&typeof result.then==="function")Promise.resolve(result).catch(()=>{});throw new Error("Current-invocation guard must synchronously return void or throw");}};
  return async function verify(expected){
    checkCurrent();
    if(!object(expected)||!text(expected.factory)||!text(expected.taskId)||!revision(expected.taskRevision)
      ||Object.keys(expected).some(k=>!["factory","taskId","taskRevision"].includes(k)))return outcome("refused","lookup_reference_only");
    if(typeof readVerifiedSnapshot!=="function")return outcome("blocked","authenticated_receipt_reader_unavailable");
    const controller=new AbortController(),deadline=Symbol("deadline");let timer;
    try{const snapshot=await Promise.race([Promise.resolve().then(()=>readVerifiedSnapshot(Object.freeze({...expected}),{signal:controller.signal})),
      new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(deadline);},timeoutMs);})]);
      checkCurrent();if(snapshot===deadline)return outcome("pending","receipt_read_deadline",{remoteOutcome:"unknown"});
      return evaluateVerifiedSnapshot(snapshot,expected,now());
    }catch{checkCurrent();return outcome("blocked","authenticated_receipt_read_failed");}finally{clearTimeout(timer);}
  };
}
