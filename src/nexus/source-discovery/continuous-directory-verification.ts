import {createHash} from 'node:crypto';
import {validateResearchRequest,validateResearchResult} from '../contracts.ts';
import {executeResearchRequest,InMemoryNexusResultStore,retryableProviderFailure,type NexusResultStore,type ProviderResult} from '../executor.ts';
import {createPublicWebProvider,withVerifiedNexusOrigin} from '../public-web.ts';
import {assessWebsiteIdentity,candidateRejection} from '../official-website-discovery.ts';
import {visibleText} from './html.ts';
import {parseNexusEnvelope,verifyNexusSignature,NEXUS_MAX_BODY_BYTES} from '../transport.ts';
import {extractFromFetchedDocuments,type CrawlOutput,type FetchLike,type ResolveHost} from './crawler.ts';
import {policyHash,validateStandingPolicy,standingPolicyAllows,runContinuousDirectoryTick,type StandingPolicy,type ContinuousLedger,type DirectoryWork} from './continuous-directory-policy.ts';

type ContinuationEntry={queueId:string;requestId:string;identityKey:string;host:string};
type Continuation={sourcePolicyId:string;sourcePolicySha256:string;originalRequestBudget:number;priorRequestCount:number;additionalRequestBudget:number;entries:ContinuationEntry[]};
export type VerificationPolicy=StandingPolicy&{continuation?:Continuation};
type Options={policy:VerificationPolicy;approvedPolicyHash:string;secret:string;store:NexusResultStore;ledger:ContinuousLedger;now?:()=>number;fetchImpl?:FetchLike;resolveHost?:ResolveHost;continuationReady?:(entry:ContinuationEntry,now:string)=>Promise<boolean>};
export function validatedVerificationContinuation(policy:VerificationPolicy):Continuation|null{
 const c=policy.continuation;if(!c)return null;
 const window=Date.parse(policy.validUntil)-Date.parse(policy.validFrom);
 if(!c.sourcePolicyId||!/^[a-f0-9]{64}$/.test(c.sourcePolicySha256)||c.originalRequestBudget!==6||c.priorRequestCount!==3||c.additionalRequestBudget!==3
  ||c.entries?.length!==2||new Set(c.entries.map(e=>e.queueId)).size!==2||c.entries.some(e=>!/^[a-f0-9]{64}$/.test(e.queueId)||!e.requestId||!e.identityKey||!e.host)
  ||policy.actions?.length!==1||policy.actions[0]!=='VERIFY_WEBSITE'||policy.countries.length!==1||policy.countries[0]!=='GB'
  ||policy.maxVenuesPerDay!==2||policy.maxRequestsPerDay!==6||policy.maxRequestsPerVenue!==3||policy.maxBatchVenues!==2
  ||policy.minHostDelayMs<2000||policy.maxAttempts!==1||!Number.isFinite(window)||window<=0||window>30*60*1000
  ||policy.paidProviderBudgetUsd!==0||policy.publicationAllowed!==false||policy.outreachAllowed!==false)throw Error('DIRECTORY_CONTINUATION_SCOPE_INVALID');
 return c;
}
const uuid=(seed:string)=>{const h=createHash('sha256').update(seed).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
const cacheReceipt={cacheReused:1,executed:0,actualHttpRequestsKnown:0,knownCostUsd:0};

/** Neutral research only: website authority does not establish canonical identity or venue type. */
export async function handleDirectoryVerificationRequest(request:Request,options:Options):Promise<Response>{
 const nowMs=options.now?.()??Date.now(),now=new Date(nowMs).toISOString();
 try{validateStandingPolicy(options.policy,options.approvedPolicyHash,now)}catch{return Response.json({code:'DIRECTORY_STANDING_POLICY_INACTIVE'},{status:404})}
 let continuation:Continuation|null;
 try{continuation=validatedVerificationContinuation(options.policy)}catch{return Response.json({code:'DIRECTORY_CONTINUATION_SCOPE_INVALID'},{status:404})}
 if(!standingPolicyAllows(options.policy,'VERIFY_WEBSITE'))return Response.json({code:'DIRECTORY_VERIFICATION_INACTIVE'},{status:404});
 const reader=request.body?.getReader();if(!reader)return Response.json({code:'BODY_REQUIRED'},{status:400});
 const chunks:Uint8Array[]=[];let length=0;
 while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>NEXUS_MAX_BODY_BYTES){await reader.cancel();return Response.json({code:'NEXUS_PAYLOAD_TOO_LARGE'},{status:413})}chunks.push(value)}
 const body=Buffer.concat(chunks).toString('utf8');
 if(!options.secret||!verifyNexusSignature(request.headers.get('x-nexus-signature'),request.headers.get('x-nexus-timestamp'),body,options.secret,nowMs))return Response.json({code:'NEXUS_SIGNATURE_INVALID'},{status:401});
 try{
  const raw=parseNexusEnvelope(body);
  if(raw.contractVersion!=='nexus.research-request.v1'||raw.originatingProduct!=='event_suite_resources'||raw.researchPurpose!=='SOURCE_ENTITY_CLASSIFICATION'||(raw.subject as {entityType?:string})?.entityType!=='UNKNOWN'||JSON.stringify(raw.providerAllowances)!=='["PUBLIC_WEB"]'||(raw.costCeiling as {currency?:string;amount?:number})?.currency!=='USD'||(raw.costCeiling as {amount?:number})?.amount!==0)return Response.json({code:'DIRECTORY_VERIFICATION_SCOPE'},{status:403});
  const input=validateResearchRequest(raw),context=JSON.parse(body).directoryContext;
  const research=input.researchContext,seed=research?.targetWebsite;
  const entry=continuation?.entries.find(e=>e.queueId===context?.queueId);
  const policyBound=continuation?Boolean(entry&&context?.policyId===continuation.sourcePolicyId&&context?.policySha256===continuation.sourcePolicySha256
    &&entry.requestId===input.requestId&&entry.identityKey===context.identityKey&&entry.host===new URL(seed??'https://invalid.example').hostname.toLowerCase()
    &&context.requestBudget===continuation.originalRequestBudget&&context.attempts===1)
   :context?.policyId===options.policy.policyId&&context?.policySha256===options.approvedPolicyHash;
  if(!policyBound||context?.action!=='VERIFY_WEBSITE')return Response.json({code:'DIRECTORY_POLICY_BINDING_REQUIRED'},{status:403});
  const identity=input.subject.canonicalEntityId?'canonical:'+input.subject.canonicalEntityId:input.subject.candidateReference?.sourceSystem+':'+input.subject.candidateReference?.sourceRecordId;
  if(context.identityKey!==identity||context.country!==research?.territory||!options.policy.countries.includes(context.country)||!input.existingEvidenceRefs.includes(context.evidenceRef))return Response.json({code:'DIRECTORY_SUBJECT_BINDING_REQUIRED'},{status:403});
  if(context.canonicalImportAllowed!==false||policyHash(context.sourceLineage??[])!==policyHash(research?.existingFacts?.find(f=>f.fieldName==='sourceLineage')?.value??[]))return Response.json({code:'DIRECTORY_LINEAGE_BINDING_REQUIRED'},{status:403});
  if(!seed||!research?.targetName||!research.locality||candidateRejection(seed)||!context.queueId||!Number.isSafeInteger(context.attempts)||context.attempts<0||!Number.isSafeInteger(context.requestBudget)||context.requestBudget<1||context.requestBudget>(continuation?.originalRequestBudget??options.policy.maxRequestsPerVenue)||!Array.isArray(context.gaps)||!context.gaps.length)return Response.json({code:'DIRECTORY_VERIFICATION_CONTEXT_REQUIRED'},{status:400});
  const fingerprint=policyHash({subject:input.subject,purpose:input.researchPurpose,facts:input.requestedFactTypes,context:research,evidenceRefs:input.existingEvidenceRefs,freshness:input.freshnessRequirements,policy:continuation?.sourcePolicySha256??options.approvedPolicyHash,queue:context.queueId,budget:context.requestBudget,gaps:context.gaps});
  const key=uuid('directory-verification-v1:'+input.idempotencyKey),cached=await options.store.get(key);
  if(cached&&cached.directoryRequestSha256!==fingerprint)return Response.json({code:'DIRECTORY_REPLAY_SUBJECT_MISMATCH'},{status:409});
  if(continuation){
   if(!entry||!cached)return Response.json({code:'DIRECTORY_CONTINUATION_ORIGINAL_REQUIRED'},{status:409});
   const prior=cached.directoryReservation as Parameters<ContinuousLedger['complete']>[0]|undefined;
   if(!retryableProviderFailure(cached)){
    if(prior?.policyId!==options.policy.policyId||prior.policySha256!==options.approvedPolicyHash||prior.queueId!==entry.queueId||prior.identityKey!==entry.identityKey)
     return Response.json({code:'DIRECTORY_CONTINUATION_ALREADY_FINAL'},{status:409});
   }else{
    if(cached.directoryRequestCount!==continuation.priorRequestCount||!prior||prior.policyId!==continuation.sourcePolicyId||prior.policySha256!==continuation.sourcePolicySha256||prior.queueId!==entry.queueId||prior.identityKey!==entry.identityKey)
     return Response.json({code:'DIRECTORY_CONTINUATION_ORIGINAL_REQUIRED'},{status:409});
    if(!options.continuationReady||!await options.continuationReady(entry,now))return Response.json({code:'DIRECTORY_CONTINUATION_NOT_READY'},{status:409});
   }
  }
  if(cached&&!retryableProviderFailure(cached)){
   const reservation=cached.directoryReservation as Parameters<ContinuousLedger['complete']>[0]|undefined;
   if(!reservation||reservation.policyId!==options.policy.policyId||reservation.policySha256!==options.approvedPolicyHash||reservation.identityKey!==identity||reservation.queueId!==context.queueId)return Response.json({code:'DIRECTORY_CACHED_RESERVATION_SCOPE'},{status:409});
   await options.ledger.complete({...reservation,state:(cached.directoryVerification as {state:string}).state==='VERIFIED'?'COMPLETED':'QUARANTINED',requestCount:Number(cached.directoryRequestCount),costUsd:0,nextAttemptAt:null,resultRef:input.requestId});
   return Response.json({result:validateResearchResult(cached),verification:cached.directoryVerification,receipt:cacheReceipt});
  }
  const executionBudget=continuation?.additionalRequestBudget??context.requestBudget;
  const item={queueId:context.queueId,identityKey:identity,country:context.country,verifiedSourceUrl:seed,verifiedAt:null,evidenceRef:context.evidenceRef,entityType:'UNKNOWN',gaps:context.gaps,ownership:'INTERNAL',status:'PENDING',attempts:continuation?0:context.attempts,requestBudget:executionBudget,runId:context.runId,action:'VERIFY_WEBSITE'} as DirectoryWork;
  let result:ReturnType<typeof validateResearchResult>|null=null;
  let verification:{state:string;url:string|null;evidenceRef:string|null;signals:string[]}|null=null;
  const receipt=await runContinuousDirectoryTick([item],options.policy,options.approvedPolicyHash,options.ledger,async(_work,reservation)=>{
   const observation:{crawl:CrawlOutput|null}={crawl:null};
   const provider=createPublicWebProvider({fetchImpl:options.fetchImpl,resolveHost:options.resolveHost,now:()=>now,budget:{maxPages:4,maxRequests:executionBudget,maxBytesPerResponse:1_000_000,maxRedirects:2,maxRetries:0,timeoutMs:8000,minRequestDelayMs:options.policy.minHostDelayMs},onCrawl:crawl=>{observation.crawl=crawl}});
   const adapted=async(args:Parameters<typeof provider>[0]):Promise<ProviderResult>=>{
    const value=await provider(args),crawl=observation.crawl;
    if(!crawl)throw Error('VERIFICATION_REQUEST_USAGE_UNKNOWN');
    const facts=extractFromFetchedDocuments(crawl.documents,['IDENTITY']).identityFacts;
    const address=research.existingFacts?.find(f=>f.fieldName==='formattedAddress')?.value;
    const assessment=assessWebsiteIdentity({venueName:research.targetName!,country:context.country,heldAddress:typeof address==='string'?address:null,context:withVerifiedNexusOrigin(input,research),finalUrl:crawl.finalUrl,identityFacts:facts});
    const siteEvidence=value.evidence.find(e=>(e.payload as {kind?:string})?.kind==='FIRST_PARTY_WEBSITE');
    const state=crawl.stats.status==='BLOCKED'?'BLOCKED':assessment.verified?'VERIFIED':'UNVERIFIED';
    verification={state,url:assessment.verified?crawl.finalUrl:null,evidenceRef:siteEvidence?.evidenceRef??null,signals:assessment.signals};
    const retryable=!assessment.verified&&['FAILED','PARTIAL'].includes(crawl.stats.status)&&crawl.stats.failureClass!=='TERMINAL';
    const observedFacts=assessment.verified?value.facts.map(f=>f.fieldName==='officialWebsite'?{...f,confidence:0.95}:f):[];
    if(assessment.verified&&siteEvidence)observedFacts.push({subjectEntityType:'UNKNOWN',canonicalEntityId:input.subject.canonicalEntityId,fieldName:'sourceTextExcerpt',value:crawl.documents.map(d=>visibleText(d.body)).join('\n').slice(0,6000),evidenceRef:siteEvidence.evidenceRef,confidence:1,observedAt:now});
    return {...value,facts:observedFacts,evidence:value.evidence.map(e=>({...e,payload:{...(e.payload as Record<string,unknown>),directoryVerification:{...verification,sourceEvidenceRefs:input.existingEvidenceRefs,canonicalIdentityEstablished:false}}})),unknowns:assessment.verified?value.unknowns:[...value.unknowns,'Website identity is unresolved; no candidate facts were approved.'],...(retryable?{error:{code:'DIRECTORY_VERIFICATION_INCOMPLETE',message:'Incomplete retrieval did not establish website identity; retry is required.',retryable:true}}:value.error?{error:{...value.error,retryable:false}}:{})};
   };
   result=validateResearchResult(await executeResearchRequest(input,research,{publicWeb:adapted,now:()=>now},new InMemoryNexusResultStore()));
   const crawl=observation.crawl as CrawlOutput|null;
   if(!crawl)throw Error('VERIFICATION_REQUEST_USAGE_UNKNOWN');
   await options.store.set(key,{...result,directoryRequestSha256:fingerprint,directoryVerification:verification,directoryReservation:reservation,directoryRequestCount:crawl.stats.requestCount});
   const retryable=retryableProviderFailure(result);
   return {requestCount:crawl.stats.requestCount,costUsd:0,status:retryable?'FAILED':verification?.state==='VERIFIED'?'COMPLETED':'BLOCKED',retryable,resultRef:input.requestId};
  },now);
  return Response.json({result,verification,receipt},{status:receipt.stopped||receipt.actualRequestsUnknown||result&&retryableProviderFailure(result)?503:receipt.denied?409:result?200:202});
 }catch(error){return Response.json({code:error instanceof Error?error.message:'DIRECTORY_VERIFICATION_FAILED'},{status:400})}
}
