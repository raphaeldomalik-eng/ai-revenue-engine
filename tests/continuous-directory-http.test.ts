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
