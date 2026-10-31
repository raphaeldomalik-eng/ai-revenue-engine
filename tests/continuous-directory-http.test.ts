import test from 'node:test';import assert from 'node:assert/strict';
import {handleContinuousDirectoryRequest} from '../src/nexus/source-discovery/continuous-directory-http.ts';
import {policyHash} from '../src/nexus/source-discovery/continuous-directory-policy.ts';
import {InMemoryNexusResultStore,sourceDiscoveryExecutionKey} from '../src/nexus/executor.ts';
import {nexusSignatureFor} from '../src/nexus/transport.ts';
const now=Date.parse('2026-10-21T12:00:00Z'),secret='isolated-test-secret';
const canonical='11111111-1111-4111-8111-111111111111';
const policy={policyId:'test',version:1,enabled:true,validFrom:'2026-10-21T00:00:00Z',validUntil:'2026-11-21T00:00:00Z',countries:['GB','ZA'],maxVenuesPerDay:1000,maxRequestsPerDay:14000,maxRequestsPerVenue:14,maxBatchVenues:26,paidProviderBudgetUsd:0,minHostDelayMs:1500,freshnessHours:720,maxAttempts:3,retryBackoffHours:24,stopAfterConsecutiveFailures:5,publicationAllowed:false,outreachAllowed:false};
const payload={contractVersion:'nexus.source-discovery-request.v1',discoveryRequestId:'22222222-2222-4222-8222-222222222222',idempotencyKey:'33333333-3333-4333-8333-333333333333',correlationId:'44444444-4444-4444-8444-444444444444',originatingProduct:'event_suite_resources',subjectReference:{canonicalEntityId:canonical,entityType:'VENUE',candidateReference:null},verifiedSourceUrl:'https://venue.example/',acquisitionGoal:'VENUE_EMAIL',venueName:'Test Venue',requestedExtractors:['IDENTITY','PUBLIC_CONTACT','VENUE_FACTS'],freshnessRequirements:{maxAgeHours:720},crawlBudget:{maxRequests:14,maxPages:8,maxBytesPerResponse:1500000,maxRedirects:4,maxRetries:1,timeoutMs:15000,minRequestDelayMs:1500},existingEvidenceRefs:['e:1'],requestedBy:{actorType:'SYSTEM',actorId:'isolated-proof'},createdAt:'2026-10-21T12:00:00Z'};
const context={policyId:policy.policyId,policySha256:policyHash(policy),queueId:'test',identityKey:'canonical:'+canonical,country:'GB',verifiedAt:'2026-10-20T00:00:00Z',evidenceRef:'e:1',gaps:['PUBLIC_CONTACT'],attempts:0};
function request(change:Record<string,unknown>={},signed=true){const body=JSON.stringify({payload,directoryContext:{...context,...change}}),timestamp=String(now/1000);return new Request('https://aire.example/api/integrations/nexus/directory-execute',{method:'POST',headers:{'x-nexus-timestamp':timestamp,'x-nexus-signature':signed?nexusSignatureFor(timestamp,body,secret):'bad'},body});}
test('standing route preserves signed authority and rejects subject-context substitution',async()=>{
 let reservations=0;const opts={policy,approvedPolicyHash:policyHash(policy),now:()=>now,ledger:{reserve:async()=>{reservations++;return true},complete:async()=>{}},executor:{secret,store:new InMemoryNexusResultStore()}};
 assert.equal((await handleContinuousDirectoryRequest(request({},false),opts)).status,401);
 assert.equal((await handleContinuousDirectoryRequest(request({identityKey:'canonical:other'}),opts)).status,403);assert.equal(reservations,0);
 const scoped={...policy,allowedIdentityKeys:['event_suite_resources:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']};
 assert.equal((await handleContinuousDirectoryRequest(request({policyId:scoped.policyId,policySha256:policyHash(scoped)}),
  {...opts,policy:scoped,approvedPolicyHash:policyHash(scoped)})).status,403);
});
test('standing route reuses the exact existing production executor and honours durable denial',async()=>{
 const old=process.env.VERCEL_ENV;process.env.VERCEL_ENV='production';let executed=0,completed=0;
 try{
  const executor={secret,store:new InMemoryNexusResultStore(),executeSourceDiscovery:async()=>{executed++;return {contractVersion:'nexus.source-discovery-result.v1',discoveryRequestId:payload.discoveryRequestId,idempotencyKey:payload.idempotencyKey,subjectReference:payload.subjectReference,source:{verifiedUrl:payload.verifiedSourceUrl,finalUrl:payload.verifiedSourceUrl,observedAt:new Date(now).toISOString(),sourceHash:'abc'},crawl:{status:'COMPLETED',warnings:[],requestCount:2,pageCount:1,bytesRead:10,redirects:0,blockedCount:0,retryable:false},identityFacts:[],publicContacts:[],venueFacts:[],imageCandidates:[],eventCandidates:[],evidenceRefs:[]}}};
  const opts={policy,approvedPolicyHash:policyHash(policy),now:()=>now,ledger:{reserve:async()=>true,complete:async()=>{completed++}},executor};
  const denied=await handleContinuousDirectoryRequest(request(),{...opts,ledger:{reserve:async()=>false,complete:async()=>{}}});assert.equal(denied.status,409);assert.equal(executed,0);
  const response=await handleContinuousDirectoryRequest(request(),opts);const result=await response.json() as any;assert.equal(response.status,200,JSON.stringify(result));assert.equal(executed,1);assert.equal(completed,1);assert.equal(result.receipt.actualHttpRequestsKnown,2);
  assert.equal((await handleContinuousDirectoryRequest(request({policyId:'revoked',policySha256:'f'.repeat(64)}),opts)).status,403);
  const failed=await handleContinuousDirectoryRequest(request(),{...opts,executor:{...executor,store:new InMemoryNexusResultStore(),executeSourceDiscovery:async()=>{const value=await executor.executeSourceDiscovery();return {...value,crawl:{...value.crawl,status:'FAILED',retryable:true}}}}});
  assert.equal(failed.status,503);
  const cachedStore=new InMemoryNexusResultStore();const base=await executor.executeSourceDiscovery();await cachedStore.set(sourceDiscoveryExecutionKey(payload.idempotencyKey,undefined,payload.acquisitionGoal),{...base,crawl:{...base.crawl,status:'BLOCKED',retryable:false}});
  let cachedState='',cachedReservations=0;const cachedOptions={...opts,ledger:{isQuarantined:async()=>cachedState==='QUARANTINED',reserve:async()=>{cachedReservations++;return cachedReservations===1},complete:async (r:{state:string})=>{cachedState=r.state}},executor:{...executor,store:cachedStore,executeSourceDiscovery:async()=>{throw Error('CACHE_MUST_NOT_CRAWL')}}};
  const cached=await handleContinuousDirectoryRequest(request(),cachedOptions);
  assert.equal(cached.status,200);assert.equal(cachedState,'QUARANTINED');assert.equal((await cached.json() as any).receipt.actualHttpRequestsKnown,0);
  assert.equal((await handleContinuousDirectoryRequest(request(),cachedOptions)).status,200);assert.equal(cachedReservations,1);
 }finally{if(old===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=old;}
});
test('recovery enriches only a child bound to its verified parent result',async()=>{
 const sourcePolicyId='resources-directory-uk-verify-50-20261024';
 const sourcePolicySha256='c49c05bfccd52774aad3e0231b6bc0de766cef51dd1dd175d69aba7fabae1923';
 const candidateId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',identityKey=`event_suite_resources:${candidateId}`;
 const parentId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',queueId='a'.repeat(64);
 const recovery={...policy,policyId:'recovery-test',validUntil:'2026-10-22T00:00:00Z',countries:['GB'],actions:['VERIFY_WEBSITE','ENRICH_VERIFIED_VENUE'],
  maxVenuesPerDay:2,maxRequestsPerDay:12,maxRequestsPerVenue:6,maxBatchVenues:1,minHostDelayMs:2000,maxAttempts:1,
  recovery:{originalRequestBudget:6,additionalRequestBudget:3,entries:[{sourcePolicyId,sourcePolicySha256,
   queueId,requestId:parentId,identityKey,host:'venue.example',mode:'UNRESERVED' as const,priorRequestCount:0}]}};
 const hash=policyHash(recovery),store=new InMemoryNexusResultStore(),child={...payload,
  subjectReference:{canonicalEntityId:null,entityType:'VENUE',candidateReference:{sourceSystem:'event_suite_resources',sourceRecordId:candidateId}},
  crawlBudget:{...payload.crawlBudget,maxRequests:6,minRequestDelayMs:2000}};
 const childContext={...context,policyId:sourcePolicyId,policySha256:sourcePolicySha256,queueId:'child-queue',requestBudget:6,canonicalImportAllowed:false,
  identityKey,attempts:0,parentVerificationRequestId:parentId};
 const signed=(change:Record<string,unknown>={})=>{const body=JSON.stringify({payload:child,directoryContext:{...childContext,...change}}),timestamp=String(now/1000);
  return new Request('https://aire.example/api/integrations/nexus/directory-execute',{method:'POST',headers:{'x-nexus-timestamp':timestamp,'x-nexus-signature':nexusSignatureFor(timestamp,body,secret)},body});};
 let calls=0;
 const result={contractVersion:'nexus.source-discovery-result.v1',discoveryRequestId:child.discoveryRequestId,idempotencyKey:child.idempotencyKey,
  subjectReference:child.subjectReference,source:{verifiedUrl:child.verifiedSourceUrl,finalUrl:child.verifiedSourceUrl,observedAt:new Date(now).toISOString(),sourceHash:'abc'},
  crawl:{status:'COMPLETED',warnings:[],requestCount:2,pageCount:1,bytesRead:10,redirects:0,blockedCount:0,retryable:false},
  identityFacts:[],publicContacts:[],venueFacts:[],imageCandidates:[],eventCandidates:[],evidenceRefs:[]};
 const options={policy:recovery,approvedPolicyHash:hash,now:()=>now,ledger:{reserve:async()=>true,complete:async()=>{}},
  executor:{secret,store,executeSourceDiscovery:async()=>{calls++;return result}}};
 assert.equal((await handleContinuousDirectoryRequest(signed(),options)).status,409);
 const {createHash}=await import('node:crypto');const digest=createHash('sha256').update('directory-verification-v1:'+parentId).digest('hex');
 const parentKey=`${digest.slice(0,8)}-${digest.slice(8,12)}-5${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`;
 await store.set(parentKey,{directoryVerification:{state:'VERIFIED',url:child.verifiedSourceUrl,evidenceRef:'e:1'},
  directoryReservation:{policyId:recovery.policyId,policySha256:hash,queueId,identityKey}});
 assert.equal((await handleContinuousDirectoryRequest(signed({identityKey:'event_suite_resources:other'}),options)).status,403);
 assert.equal((await handleContinuousDirectoryRequest(signed({parentVerificationRequestId:'other'}),options)).status,403);
 const response=await handleContinuousDirectoryRequest(signed(),options);
 assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.equal(calls,1);
});

test('durable crawler backoff is exposed to Nexus through Retry-After',async()=>{
 const next=new Date(now+48*3600000).toISOString();
 const response=await handleContinuousDirectoryRequest(request(),{policy,approvedPolicyHash:policyHash(policy),now:()=>now,ledger:{reserve:async()=>false,nextEligibleAt:async()=>next,complete:async()=>{throw Error('NO_EXECUTION')}},executor:{secret,store:new InMemoryNexusResultStore()}});
 assert.equal(response.status,409);assert.equal(response.headers.get('retry-after'),'172800');
});
