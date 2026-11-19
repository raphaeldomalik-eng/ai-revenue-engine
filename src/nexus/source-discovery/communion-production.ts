import {createHash} from 'node:crypto';
import {CONTRACTS,validateSourceDiscoveryResult,type SourceDiscoveryRequest} from '../contracts.ts';
import {executeSourceDiscoveryRequest,sourceDiscoveryExecutionKey,sourceDiscoveryReplayable,type NexusResultStore,type SourceDiscoveryExecutorOptions} from '../executor.ts';
import {sourceDiscoveryRequestSha256} from './batch-scope.ts';

export const COMMUNION_TICKETS_SOURCE='https://www.communionmusic.co.uk/tickets';

/** Called only after transport authentication and the normal contract validator.
 * Inspect the original URL/array too: normalisation must not widen this grant. */
export function communionProductionRequest(raw:Record<string,unknown>,request:SourceDiscoveryRequest):boolean{
 const subject=request.subjectReference,candidate=subject.candidateReference,b=request.crawlBudget;
 return raw.verifiedSourceUrl===COMMUNION_TICKETS_SOURCE
  &&raw.originatingProduct==='last_train_home'&&subject.entityType==='ORGANISATION'
  &&subject.canonicalEntityId===null&&candidate?.sourceSystem==='last_train_home'&&candidate.sourceRecordId==='communion'
  &&Array.isArray(raw.requestedExtractors)&&raw.requestedExtractors.length===1&&raw.requestedExtractors[0]==='EVENTS'
  &&request.acquisitionGoal===null&&request.venueName===null&&!request.batchExecution
  &&request.requestedBy.actorType==='PRODUCT'&&request.requestedBy.actorId==='last_train_home'
  &&!('providerAllowances' in raw)&&!('costCeiling' in raw)
  &&b.maxPages<=100&&b.maxRequests<=150&&b.maxBytesPerResponse<=2_000_000
  &&b.maxRedirects<=5&&b.maxRetries<=2&&b.timeoutMs<=30_000&&b.minRequestDelayMs>=50;
}

/** Reuse deployed one-use reservations and the existing crawler/result store.
 * No new ledger, provider capability, queue or venue-email scope is introduced. */
export async function executeCommunionProduction(input:SourceDiscoveryRequest,store:NexusResultStore,options:SourceDiscoveryExecutorOptions={},now=Date.now()){
 if(!store.reserveBatchRequest||!store.completeBatchRequest)throw Error('COMMUNION_DURABLE_STORE_REQUIRED');
 const fingerprint=sourceDiscoveryRequestSha256(input as Record<string,unknown>);
 const scopeId=sourceDiscoveryExecutionKey(input.idempotencyKey,'communion-production-reservation-v1');
 const internalKey=sourceDiscoveryExecutionKey(input.idempotencyKey+':'+fingerprint,'communion-production-execution-v1');
 const cacheKey=sourceDiscoveryExecutionKey(internalKey);
 const receiptedKey=sourceDiscoveryExecutionKey(internalKey,'communion-production-receipted-v1');
 // LTH's deployed consumer still validates v1. Keep the stored v2 evidence and
 // project only this response through the already supported v1 contract.
 const response=(value:Record<string,unknown>)=>validateSourceDiscoveryResult({...value,contractVersion:CONTRACTS.SOURCE_DISCOVERY_RESULT_V1,idempotencyKey:input.idempotencyKey});
 const receipted=await store.get(receiptedKey);
 if(sourceDiscoveryReplayable(receipted))return response(receipted!);
 // The executor writes before its receipt. An uncertain completion must never
 // become success on retry, and must not initiate another website execution.
 if(await store.get(cacheKey))throw Error('COMMUNION_RESERVATION_DENIED');
 const budget={...input.crawlBudget,maxPages:1,maxRequests:Math.min(6,input.crawlBudget.maxRequests)};
 const binding={scopeId,manifestSha256:createHash('sha256').update('communion-production-v1:'+fingerprint).digest('hex'),requestSha256:fingerprint,
  listingId:sourceDiscoveryExecutionKey('communion','communion-production-subject-v1'),host:'www.communionmusic.co.uk',idempotencyKey:input.idempotencyKey};
 const reserved=await store.reserveBatchRequest({...binding,requestBudget:budget.maxRequests,
  validFrom:new Date(now-300_000).toISOString(),validUntil:new Date(now+86_400_000).toISOString(),maxVenues:1,maxRequestsPerVenue:6,maxTotalRequests:6});
 if(!reserved)throw Error('COMMUNION_RESERVATION_DENIED');
 let observed:import('./types.ts').CrawlObservability|null=null;
 let completionAttempted=false;
 try{
  const result=validateSourceDiscoveryResult(await executeSourceDiscoveryRequest({...input,idempotencyKey:internalKey,crawlBudget:budget},{...options,
   // The shared EVENTS parser observes external ticket links; it never follows them.
   allowedHosts:['www.communionmusic.co.uk'],renderAdapter:undefined,renderPolicy:undefined,
   onCrawlObservability:async value=>{observed=value;await options.onCrawlObservability?.(value)}},store));
  completionAttempted=true;
  await store.completeBatchRequest({...binding,status:result.crawl.status==='FAILED'?'FAILED':'COMPLETED',requestCount:result.crawl.requestCount,bytesRead:result.crawl.bytesRead??0,providerCostUsd:0,resultStatus:result.crawl.status});
  await store.set(receiptedKey,result);
  return response(result);
 }catch(error){
  // Unknown/in-flight usage stays consumed. Recording failure never grants replay.
  if(observed&&!completionAttempted){const receipt=observed as import('./types.ts').CrawlObservability;
   await store.completeBatchRequest({...binding,status:'FAILED',requestCount:receipt.requests,bytesRead:receipt.bytes,providerCostUsd:0,resultStatus:receipt.finalStatus??'FAILED'});
  }
  throw error;
 }
}
