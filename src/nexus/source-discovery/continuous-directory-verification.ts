import {storedDirectoryVerifierAcquisition} from './stored-directory-verifier.ts';
import {createHash} from 'node:crypto';
import {validateResearchRequest,validateResearchResult} from '../contracts.ts';
import {executeResearchRequest,InMemoryNexusResultStore,retryableProviderFailure,type NexusResultStore,type ProviderResult} from '../executor.ts';
import {createPublicWebProvider,withVerifiedNexusOrigin} from '../public-web.ts';
import {assessWebsiteIdentity,candidateRejection} from '../official-website-discovery.ts';
import {visibleText} from './html.ts';
import {acceptVenueEmail} from '../venue-email.ts';
import {parseNexusEnvelope,verifyNexusSignature,NEXUS_MAX_BODY_BYTES} from '../transport.ts';
import {extractFromFetchedDocuments,type CrawlOutput,type FetchLike,type ResolveHost} from './crawler.ts';
import {policyHash,validateStandingPolicy,standingPolicyAllows,runContinuousDirectoryTick,type ContinuousLedger,type DirectoryWork} from './continuous-directory-policy.ts';
import {validatedVerificationRecovery,type RecoveryPolicy,type RecoveryEntry} from './continuous-directory-recovery.ts';

type ContinuationEntry={queueId:string;requestId:string;identityKey:string;host:string};
type Continuation={sourcePolicyId:string;sourcePolicySha256:string;originalRequestBudget:number;priorRequestCount:number;additionalRequestBudget:number;entries:ContinuationEntry[]};
export type VerificationPolicy=RecoveryPolicy&{continuation?:Continuation};
type Options={policy:VerificationPolicy;approvedPolicyHash:string;secret:string;store:NexusResultStore;ledger:ContinuousLedger;now?:()=>number;fetchImpl?:FetchLike;resolveHost?:ResolveHost;continuationReady?:(entry:ContinuationEntry,now:string)=>Promise<boolean>;recoveryReady?:(entry:RecoveryEntry,now:string)=>Promise<boolean>};
export function validatedVerificationContinuation(policy:VerificationPolicy):Continuation|null{
 const c=policy.continuation;if(!c)return null;
 const window=Date.parse(policy.validUntil??'')-Date.parse(policy.validFrom);
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
 let recovery:ReturnType<typeof validatedVerificationRecovery>;
 try{recovery=validatedVerificationRecovery(options.policy)}catch{return Response.json({code:'DIRECTORY_RECOVERY_SCOPE_INVALID'},{status:404})}
 if(continuation&&recovery)return Response.json({code:'DIRECTORY_RECOVERY_SCOPE_INVALID'},{status:404});
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
  const recoveryEntry=recovery?.entries.find(e=>e.queueId===context?.queueId);
  const policyBound=continuation?Boolean(entry&&context?.policyId===continuation.sourcePolicyId&&context?.policySha256===continuation.sourcePolicySha256
    &&entry.requestId===input.requestId&&entry.identityKey===context.identityKey&&entry.host===new URL(seed??'https://invalid.example').hostname.toLowerCase()
    &&context.requestBudget===continuation.originalRequestBudget&&context.attempts===1)
   :recovery?Boolean(recoveryEntry&&context?.policyId===recoveryEntry.sourcePolicyId&&context?.policySha256===recoveryEntry.sourcePolicySha256
    &&recoveryEntry.requestId===input.requestId&&recoveryEntry.identityKey===context.identityKey
    &&recoveryEntry.host===new URL(seed??'https://invalid.example').hostname.toLowerCase()
    &&context.requestBudget===recovery.originalRequestBudget&&context.attempts===0)
   :context?.policyId===options.policy.policyId&&context?.policySha256===options.approvedPolicyHash;
  if(!policyBound||context?.action!=='VERIFY_WEBSITE')return Response.json({code:'DIRECTORY_POLICY_BINDING_REQUIRED'},{status:403});
  const identity=input.subject.canonicalEntityId?'canonical:'+input.subject.canonicalEntityId:input.subject.candidateReference?.sourceSystem+':'+input.subject.candidateReference?.sourceRecordId;
  if(context.identityKey!==identity||context.country!==research?.territory||!options.policy.countries.includes(context.country)||!input.existingEvidenceRefs.includes(context.evidenceRef))return Response.json({code:'DIRECTORY_SUBJECT_BINDING_REQUIRED'},{status:403});
  if(options.policy.allowedIdentityKeys&&!options.policy.allowedIdentityKeys.includes(identity))return Response.json({code:'DIRECTORY_COHORT_BINDING_REQUIRED'},{status:403});
  if(context.canonicalImportAllowed!==false||policyHash(context.sourceLineage??[])!==policyHash(research?.existingFacts?.find(f=>f.fieldName==='sourceLineage')?.value??[]))return Response.json({code:'DIRECTORY_LINEAGE_BINDING_REQUIRED'},{status:403});
  if(!seed||!research?.targetName||!research.locality||candidateRejection(seed)||!context.queueId||!Number.isSafeInteger(context.attempts)||context.attempts<0||!Number.isSafeInteger(context.requestBudget)||context.requestBudget<1||context.requestBudget>(continuation?.originalRequestBudget??recovery?.originalRequestBudget??options.policy.maxRequestsPerVenue)||!Array.isArray(context.gaps)||!context.gaps.length)return Response.json({code:'DIRECTORY_VERIFICATION_CONTEXT_REQUIRED'},{status:400});
  const fingerprint=policyHash({subject:input.subject,purpose:input.researchPurpose,facts:input.requestedFactTypes,context:research,evidenceRefs:input.existingEvidenceRefs,freshness:input.freshnessRequirements,policy:continuation?.sourcePolicySha256??recoveryEntry?.sourcePolicySha256??options.approvedPolicyHash,queue:context.queueId,budget:context.requestBudget,gaps:context.gaps});
  const key=uuid('directory-verification-v1:'+input.idempotencyKey),cached=await options.store.get(key);
  if(request.headers.get('x-nexus-cache-only')==='true'&&(!cached||retryableProviderFailure(cached)))return Response.json({code:'DIRECTORY_CACHED_RESULT_REQUIRED'},{status:409});
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
  if(recoveryEntry){
   if(recoveryEntry.mode==='UNRESERVED'){
    if(cached&&retryableProviderFailure(cached))return Response.json({code:'DIRECTORY_RECOVERY_ORIGINAL_UNEXPECTED'},{status:409});
    if(!cached&&(!options.recoveryReady||!await options.recoveryReady(recoveryEntry,now)))return Response.json({code:'DIRECTORY_RECOVERY_NOT_READY'},{status:409});
   }else if(!cached)return Response.json({code:'DIRECTORY_RECOVERY_ORIGINAL_REQUIRED'},{status:409});
   else if(retryableProviderFailure(cached)){
    const prior=cached.directoryReservation as Parameters<ContinuousLedger['complete']>[0]|undefined;
    if(cached.directoryRequestCount!==recoveryEntry.priorRequestCount||!prior||prior.policyId!==recoveryEntry.sourcePolicyId
      ||prior.policySha256!==recoveryEntry.sourcePolicySha256||prior.queueId!==recoveryEntry.queueId||prior.identityKey!==recoveryEntry.identityKey
      ||!options.recoveryReady||!await options.recoveryReady(recoveryEntry,now))return Response.json({code:'DIRECTORY_RECOVERY_ORIGINAL_REQUIRED'},{status:409});
   }
  }
  if(cached&&!retryableProviderFailure(cached)){
   const reservation=cached.directoryReservation as Parameters<ContinuousLedger['complete']>[0]|undefined;
   if(!reservation||reservation.policyId!==options.policy.policyId||reservation.policySha256!==options.approvedPolicyHash||reservation.identityKey!==identity||reservation.queueId!==context.queueId)return Response.json({code:'DIRECTORY_CACHED_RESERVATION_SCOPE'},{status:409});
   if(request.headers.get('x-nexus-cache-only')!=='true')await options.ledger.complete({...reservation,state:(cached.directoryVerification as {state:string}).state==='VERIFIED'?'COMPLETED':'QUARANTINED',requestCount:Number(cached.directoryRequestCount),costUsd:0,nextAttemptAt:null,resultRef:input.requestId});
   return Response.json({result:validateResearchResult(storedDirectoryVerifierAcquisition(cached,input)),verification:cached.directoryVerification,receipt:cacheReceipt});
  }
  const executionBudget=continuation?.additionalRequestBudget??(recoveryEntry?.mode==='RETRYABLE'?recovery?.additionalRequestBudget:undefined)??context.requestBudget;
  const item={queueId:context.queueId,identityKey:identity,country:context.country,verifiedSourceUrl:seed,verifiedAt:null,evidenceRef:context.evidenceRef,entityType:'UNKNOWN',gaps:context.gaps,ownership:'INTERNAL',status:'PENDING',attempts:continuation||recoveryEntry?0:context.attempts,requestBudget:executionBudget,runId:context.runId,action:'VERIFY_WEBSITE'} as DirectoryWork;
  let result:ReturnType<typeof validateResearchResult>|null=null;
  let verification:{state:string;url:string|null;evidenceRef:string|null;signals:string[];reason:string}|null=null;
  let crawlReceipt:Record<string,unknown>|null=null;
  const receipt=await runContinuousDirectoryTick([item],options.policy,options.approvedPolicyHash,options.ledger,async(_work,reservation)=>{
   const observation:{crawl:CrawlOutput|null}={crawl:null};
   const provider=createPublicWebProvider({emailGoal:options.policy.quotaMode==='PER_RUN',fetchImpl:options.fetchImpl,resolveHost:options.resolveHost,now:()=>now,budget:{maxPages:4,maxRequests:executionBudget,maxBytesPerResponse:1_000_000,maxRedirects:2,maxRetries:0,timeoutMs:8000,minRequestDelayMs:options.policy.minHostDelayMs},onCrawl:crawl=>{observation.crawl=crawl}});
   const adapted=async(args:Parameters<typeof provider>[0]):Promise<ProviderResult>=>{
    const value=await provider(args),crawl=observation.crawl;
    if(!crawl)throw Error('VERIFICATION_REQUEST_USAGE_UNKNOWN');
    const facts=extractFromFetchedDocuments(crawl.documents,['IDENTITY']).identityFacts;
    const address=research.existingFacts?.find(f=>f.fieldName==='formattedAddress')?.value;
    const assessment=assessWebsiteIdentity({venueName:research.targetName!,country:context.country,heldAddress:typeof address==='string'?address:null,context:withVerifiedNexusOrigin(input,research),finalUrl:crawl.finalUrl,identityFacts:facts});
    const siteEvidence=value.evidence.find(e=>(e.payload as {kind?:string})?.kind==='FIRST_PARTY_WEBSITE');
    const state=crawl.stats.status==='BLOCKED'?'BLOCKED':assessment.verified?'VERIFIED':'UNVERIFIED';
    verification={state,url:assessment.verified?crawl.finalUrl:null,evidenceRef:siteEvidence?.evidenceRef??null,signals:assessment.signals,reason:assessment.reason};
    // Review telemetry from this exact existing crawl, never another fetch or
    // additional contact acceptance policy. Rejected observations stay evidence.
    const observed=extractFromFetchedDocuments(crawl.documents,['PUBLIC_CONTACT']).publicContacts;
    const accepted=(siteEvidence?.payload as {contacts?:Array<{type:string;value:string;sourceUrl:string}>})?.contacts??[];
    crawlReceipt={...crawl.stats,finalUrl:crawl.finalUrl,evidenceManifest:crawl.evidenceManifest,
      contactObservations:observed.slice(0,100).map(c=>{const verdict=c.type==='EMAIL'?acceptVenueEmail(c.value,c.sourceUrl,research.targetName!,c.label??''):null;
       const supported=assessment.verified&&accepted.some(a=>a.type===c.type&&a.value.toLowerCase()===c.value.toLowerCase()&&a.sourceUrl===c.sourceUrl);
       return {...c,accepted:supported,rejectionReason:supported?null:verdict&&!verdict.accepted?verdict.reason:!assessment.verified?'WEBSITE_IDENTITY_UNRESOLVED':'NOT_ACCEPTED_BY_EXISTING_SOURCE_SCOPE',...(c.type==='CONTACT_FORM'?{usability:'OBSERVED_NOT_USABILITY_CONFIRMED'}:{})};}),
      contactObservationsOmitted:Math.max(0,observed.length-100)};
    const retryable=!assessment.verified&&['FAILED','PARTIAL'].includes(crawl.stats.status)&&crawl.stats.failureClass!=='TERMINAL';
    const observedFacts=assessment.verified?value.facts.map(f=>f.fieldName==='officialWebsite'?{...f,confidence:0.95}:f):[];
    if(assessment.verified&&siteEvidence)observedFacts.push({subjectEntityType:'UNKNOWN',canonicalEntityId:input.subject.canonicalEntityId,fieldName:'sourceTextExcerpt',value:crawl.documents.map(d=>visibleText(d.body)).join('\n').slice(0,6000),evidenceRef:siteEvidence.evidenceRef,confidence:1,observedAt:now});
    // Preserve structured observations from THIS crawl for Nexus's existing
    // classified acquisition consumer. Verification does not grant publication
    // or canonical authority, and an unverified site exports no such handoff.
    const extracted=assessment.verified?extractFromFetchedDocuments(crawl.documents,['IDENTITY','PUBLIC_CONTACT','VENUE_FACTS'],research.targetName!):null;
    const acquisition=extracted&&siteEvidence&&['COMPLETED','PARTIAL'].includes(crawl.stats.status)?{
      version:1,requestId:input.requestId,
      source:{verifiedUrl:seed,finalUrl:crawl.finalUrl,observedAt:now,sourceHash:createHash('sha256').update(crawl.documents.map(d=>`${d.url}:${d.sourceHash}`).join('\n')).digest('hex')},
      crawl:{...crawl.stats,retryable:false,evidenceManifest:crawl.evidenceManifest?{...crawl.evidenceManifest,pages:crawl.evidenceManifest.pages.map(p=>({...p,evidenceRefs:[...new Set([...extracted.identityFacts,...extracted.publicContacts,...extracted.venueFacts].filter(f=>f.sourceUrl===p.url).map(f=>f.evidenceRef))]}))}:null},
      identityFacts:extracted.identityFacts.slice(0,100).map(f=>({...f,subjectEntityType:'UNKNOWN',canonicalEntityId:input.subject.canonicalEntityId,confidence:0.8,observedAt:now})),
      publicContacts:extracted.publicContacts.slice(0,100).map(c=>{const verdict=c.type==='EMAIL'?acceptVenueEmail(c.value,c.sourceUrl,research.targetName!,c.label??''):null;return {...c,observedAt:now,reviewRequired:c.reviewRequired||!accepted.some(a=>a.type===c.type&&a.value.toLowerCase()===c.value.toLowerCase()&&a.sourceUrl===c.sourceUrl),...(verdict&&!verdict.accepted?{reviewReason:verdict.reason}:{})};}),
      venueFacts:extracted.venueFacts.slice(0,100).map(f=>({...f,observedAt:now})),evidenceRefs:extracted.evidenceRefs.slice(0,1000),
    }:null;
    const executionEvidence={evidenceRef:`research:${input.requestId}:public_web:directory-execution`,externalRecordId:`directory-execution:${input.requestId}`,provider:'PUBLIC_WEB' as const,sourceUrl:seed,observedAt:now,dataClassification:'PUBLIC' as const,licenceType:'PUBLIC_SOURCE',
      payload:{kind:'DIRECTORY_WEBSITE_EXECUTION',version:1,requestId:input.requestId,identityKey:context.identityKey,originalUrl:seed,verification,crawl:crawlReceipt}};
    return {...value,facts:observedFacts,evidence:[...value.evidence.map(e=>({...e,payload:{...(e.payload as Record<string,unknown>),...(e===siteEvidence&&acquisition?{firstPassAcquisition:acquisition}:{}),directoryVerification:{...verification,sourceEvidenceRefs:input.existingEvidenceRefs,canonicalIdentityEstablished:false}}})),executionEvidence],unknowns:assessment.verified?value.unknowns:[...value.unknowns,'Website identity is unresolved; no candidate facts were approved.'],...(retryable?{error:{code:'DIRECTORY_VERIFICATION_INCOMPLETE',message:('Incomplete retrieval did not establish website identity; retry is required. '+(value.error?.message??crawl.stats.warnings.join(' '))).slice(0,2000),retryable:true}}:value.error?{error:{...value.error,retryable:false}}:{})};
   };
   result=validateResearchResult(await executeResearchRequest(input,research,{publicWeb:adapted,now:()=>now},new InMemoryNexusResultStore()));
   const crawl=observation.crawl as CrawlOutput|null;
   if(!crawl)throw Error('VERIFICATION_REQUEST_USAGE_UNKNOWN');
   await options.store.set(key,{...result,directoryRequestSha256:fingerprint,directoryVerification:verification,directoryReservation:reservation,directoryRequestCount:crawl.stats.requestCount,directoryCrawlReceipt:crawlReceipt});
   const retryable=retryableProviderFailure(result);
   return {requestCount:crawl.stats.requestCount,costUsd:0,status:retryable?'FAILED':verification?.state==='VERIFIED'?'COMPLETED':'BLOCKED',retryable,resultRef:input.requestId};
  },now);
  const returned=result as ReturnType<typeof validateResearchResult>|null;
  const contactOutcome=returned?.evidence.find(e=>(e.payload as Record<string,unknown>)?.kind==='FIRST_PARTY_WEBSITE')?.payload as Record<string,unknown>|undefined;
  return Response.json({result,verification,receipt,contactOutcome:contactOutcome?.contactOutcome??'CRAWL_INCOMPLETE'},{headers:receipt.nextAttemptAt?{'Retry-After':String(Math.max(1,Math.ceil((Date.parse(receipt.nextAttemptAt)-nowMs)/1000)))}:undefined,status:receipt.stopped||receipt.actualRequestsUnknown||result&&retryableProviderFailure(result)?503:receipt.denied?409:result?200:202});
 }catch(error){return Response.json({code:error instanceof Error?error.message:'DIRECTORY_VERIFICATION_FAILED'},{status:400})}
}
