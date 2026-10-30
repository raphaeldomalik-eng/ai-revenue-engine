import {createHash} from 'node:crypto';
import {handleNexusExecuteRequest,type NexusHttpOptions} from '../http.ts';
import {buildNexusEnvelope,parseNexusEnvelope,verifyNexusSignature,NEXUS_MAX_BODY_BYTES} from '../transport.ts';
import {validateSourceDiscoveryRequest,validateSourceDiscoveryResult} from '../contracts.ts';
import {sourceDiscoveryRequestSha256,type SourceDiscoveryBatchScope} from './batch-scope.ts';
import {sourceDiscoveryExecutionKey,sourceDiscoveryReplayable} from '../executor.ts';
import {runContinuousDirectoryTick,validateStandingPolicy,standingPolicyAllows,type ContinuousLedger,type DirectoryWork} from './continuous-directory-policy.ts';
import {validatedVerificationRecovery,type RecoveryPolicy} from './continuous-directory-recovery.ts';
const uuid=(s:string)=>{const h=createHash('sha256').update(s).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
export type ContinuousHttpOptions={policy:RecoveryPolicy;approvedPolicyHash:string;ledger:ContinuousLedger;executor:NexusHttpOptions;now?:()=>number};
/** Signed existing source-discovery envelope plus signed internal queue context; execution reuses the existing handler. */
export async function handleContinuousDirectoryRequest(request:Request,options:ContinuousHttpOptions):Promise<Response>{
 const nowMs=options.now?.()??Date.now(),now=new Date(nowMs).toISOString();
 try{validateStandingPolicy(options.policy,options.approvedPolicyHash,now)}catch{return Response.json({code:'DIRECTORY_STANDING_POLICY_INACTIVE'},{status:404})}
 let recovery:ReturnType<typeof validatedVerificationRecovery>;
 try{recovery=validatedVerificationRecovery(options.policy)}catch{return Response.json({code:'DIRECTORY_RECOVERY_SCOPE_INVALID'},{status:404})}
 if(!standingPolicyAllows(options.policy,'ENRICH_VERIFIED_VENUE'))return Response.json({code:'DIRECTORY_ACTION_INACTIVE'},{status:404});
 const reader=request.body?.getReader();let body='';let length=0;
 if(!reader)return Response.json({code:'BODY_REQUIRED'},{status:400});
 const chunks:Uint8Array[]=[];while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>NEXUS_MAX_BODY_BYTES){await reader.cancel();return Response.json({code:'NEXUS_PAYLOAD_TOO_LARGE'},{status:413})}chunks.push(value)}body=Buffer.concat(chunks).toString('utf8');
 const secret=options.executor.secret;
 if(!secret||!verifyNexusSignature(request.headers.get('x-nexus-signature'),request.headers.get('x-nexus-timestamp'),body,secret,nowMs))return Response.json({code:'NEXUS_SIGNATURE_INVALID'},{status:401});
 try{
  const payload=parseNexusEnvelope(body),input=validateSourceDiscoveryRequest(payload);
  if(input.originatingProduct!=='event_suite_resources'||input.subjectReference.entityType!=='VENUE'||input.acquisitionGoal!=='VENUE_EMAIL'||input.crawlBudget.minRequestDelayMs<options.policy.minHostDelayMs)return Response.json({code:'DIRECTORY_REQUEST_SCOPE'},{status:403});
  const context=JSON.parse(body).directoryContext as (Partial<DirectoryWork>&{policyId?:string;policySha256?:string;action?:string})|undefined;
  if((context?.action??'ENRICH_VERIFIED_VENUE')!=='ENRICH_VERIFIED_VENUE')return Response.json({code:'DIRECTORY_POLICY_BINDING_REQUIRED'},{status:403});
  if(!context?.queueId||!context.identityKey||!context.country||!context.verifiedAt||!context.evidenceRef||!Array.isArray(context.gaps)||!Number.isSafeInteger(context.attempts)||context.attempts!<0)return Response.json({code:'DIRECTORY_QUEUE_CONTEXT_REQUIRED'},{status:400});
  if(!input.existingEvidenceRefs.includes(context.evidenceRef))return Response.json({code:'DIRECTORY_EVIDENCE_BINDING_REQUIRED'},{status:403});
  const subject=input.subjectReference;
  const expectedIdentity=subject.canonicalEntityId?'canonical:'+subject.canonicalEntityId:subject.candidateReference?subject.candidateReference.sourceSystem+':'+subject.candidateReference.sourceRecordId:null;
  if(context.identityKey!==expectedIdentity||!options.policy.countries.includes(context.country))return Response.json({code:'DIRECTORY_SUBJECT_BINDING_REQUIRED'},{status:403});
  if(options.policy.allowedIdentityKeys&&!options.policy.allowedIdentityKeys.includes(context.identityKey))return Response.json({code:'DIRECTORY_COHORT_BINDING_REQUIRED'},{status:403});
  if(recovery){
   const parentRequestId=(context as typeof context&{parentVerificationRequestId?:string}).parentVerificationRequestId;
   const entry=recovery.entries.find(value=>value.requestId===parentRequestId);
   if(!entry||context?.policyId!==entry.sourcePolicyId||context?.policySha256!==entry.sourcePolicySha256
    ||context.identityKey!==entry.identityKey||context.country!=='GB'||context.attempts!==0
    ||new URL(input.verifiedSourceUrl).hostname.toLowerCase()!==entry.host
    ||input.crawlBudget.maxRequests>recovery.originalRequestBudget||input.crawlBudget.maxRequests<1
    ||context.requestBudget!==input.crawlBudget.maxRequests
    ||(context as typeof context&{canonicalImportAllowed?:boolean}).canonicalImportAllowed!==false)
    return Response.json({code:'DIRECTORY_RECOVERY_PARENT_BINDING_REQUIRED'},{status:403});
   const parent=await options.executor.store.get(uuid('directory-verification-v1:'+entry.requestId));
   const verification=parent?.directoryVerification as {state?:string;url?:string;evidenceRef?:string}|undefined;
   const reservation=parent?.directoryReservation as {policyId?:string;policySha256?:string;queueId?:string;identityKey?:string}|undefined;
   if(verification?.state!=='VERIFIED'||verification.url!==input.verifiedSourceUrl||verification.evidenceRef!==context.evidenceRef
    ||reservation?.policyId!==options.policy.policyId||reservation.policySha256!==options.approvedPolicyHash
    ||reservation.queueId!==entry.queueId||reservation.identityKey!==entry.identityKey)
    return Response.json({code:'DIRECTORY_RECOVERY_PARENT_NOT_VERIFIED'},{status:409});
  }else if(context.policyId!==options.policy.policyId||context.policySha256!==options.approvedPolicyHash)
   return Response.json({code:'DIRECTORY_POLICY_BINDING_REQUIRED'},{status:403});
  const item:DirectoryWork={...context,queueId:context.queueId,identityKey:context.identityKey,country:context.country,verifiedAt:context.verifiedAt,evidenceRef:context.evidenceRef,gaps:context.gaps,attempts:context.attempts!,verifiedSourceUrl:input.verifiedSourceUrl,entityType:'VENUE',ownership:context.ownership||'INTERNAL',status:context.status||'PENDING',requestBudget:input.crawlBudget.maxRequests,runId:context.runId};
  const cacheKey=sourceDiscoveryExecutionKey(input.idempotencyKey,undefined,input.acquisitionGoal);
  const cached=await options.executor.store.get(cacheKey);
  if(sourceDiscoveryReplayable(cached)){
   const result=validateSourceDiscoveryResult(cached);
   if(result.source.verifiedUrl!==input.verifiedSourceUrl||JSON.stringify(result.subjectReference)!==JSON.stringify(input.subjectReference))return Response.json({code:'DIRECTORY_REPLAY_SUBJECT_MISMATCH'},{status:409});
   if(['BLOCKED','FAILED'].includes(result.crawl.status)){
    const quarantined=()=>options.ledger.isQuarantined?.(options.policy.policyId,item.identityKey)??Promise.resolve(false);
    if(await quarantined())return Response.json({result,receipt:{cacheReused:1,executed:0,quarantined:1,actualHttpRequestsKnown:0,knownCostUsd:0}});
    const receipt=await runContinuousDirectoryTick([item],options.policy,options.approvedPolicyHash,options.ledger,async()=>({requestCount:0,costUsd:0,status:result.crawl.status,retryable:false}),now);
    return Response.json({result,receipt:{...receipt,cacheReused:1}},{status:receipt.denied&&!await quarantined()?409:200});
   }
   return Response.json({result,receipt:{cacheReused:1,executed:0,actualHttpRequestsKnown:0,knownCostUsd:0}});
  }
  let output:Record<string,unknown>|null=null;
  const receipt=await runContinuousDirectoryTick([item],options.policy,options.approvedPolicyHash,options.ledger,async(_work,reservation)=>{
   const scopeId=uuid(reservation.reservationKey),listingId=uuid(item.identityKey),manifestSha256=createHash('sha256').update(JSON.stringify({policySha256:options.approvedPolicyHash,reservation,input})).digest('hex');
   const scoped={...input,batchExecution:{scopeId,listingId,manifestSha256}};
   const scope:SourceDiscoveryBatchScope={scopeId,manifestSha256,validFrom:now,validUntil:new Date(Math.min(Date.parse(options.policy.validUntil),nowMs+6*3600000)).toISOString(),maxVenues:1,maxRequestsPerVenue:input.crawlBudget.maxRequests,maxTotalRequests:input.crawlBudget.maxRequests,paidProviderBudgetUsd:0,records:[{listingId,host:reservation.host,idempotencyKey:input.idempotencyKey,requestSha256:sourceDiscoveryRequestSha256(scoped)}]};
   const envelope=buildNexusEnvelope(scoped,secret,String(Math.floor(nowMs/1000)));
   const response=await handleNexusExecuteRequest(new Request(request.url,{method:'POST',headers:{'content-type':'application/json','x-nexus-timestamp':envelope.timestamp,'x-nexus-signature':envelope.signature},body:envelope.body}),{...options.executor,now:()=>nowMs,allowResearch:false,allowSourceDiscovery:process.env.VERCEL_ENV!=='production',allowContentInterpretation:false,allowScopedSourceDiscovery:true,sourceDiscoveryBatchScope:scope});
   if(!response.ok)throw Error(`EXISTING_EXECUTOR_${response.status}`);
   const result=validateSourceDiscoveryResult(await response.json());output=result as unknown as Record<string,unknown>;return {requestCount:result.crawl.requestCount,costUsd:0,status:result.crawl.status,retryable:result.crawl.retryable,resultRef:input.discoveryRequestId};
  },now);
  const crawl=(output as {crawl?:{status?:string;retryable?:boolean}}|null)?.crawl;
  return Response.json({result:output,receipt},{status:receipt.stopped||receipt.actualRequestsUnknown||crawl?.retryable||crawl?.status==='FAILED'&&crawl?.retryable!==false?503:receipt.executed?200:receipt.denied?409:202});
 }catch(error){return Response.json({code:error instanceof Error?error.message:'DIRECTORY_REQUEST_FAILED'},{status:400})}
}
