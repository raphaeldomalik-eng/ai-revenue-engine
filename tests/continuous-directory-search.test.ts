import {DirectorySearchAllocationDeniedError} from '../src/nexus/search/brave-public-web-search.ts';
import test from 'node:test';import assert from 'node:assert/strict';
import {handleDirectorySearchRequest} from '../src/nexus/search/continuous-directory-search.ts';
import {policyHash} from '../src/nexus/source-discovery/continuous-directory-policy.ts';
import {nexusSignatureFor} from '../src/nexus/transport.ts';
const now=Date.parse('2026-10-21T12:00:00Z'),id='11111111-1111-4111-8111-111111111111',secret='fixture';
const policy={policyId:'directory',version:3,enabled:true,actions:['DISCOVER_WEBSITE','VERIFY_WEBSITE','ENRICH_VERIFIED_VENUE'],validFrom:'2026-10-21T00:00:00Z',validUntil:'2026-11-01T00:00:00Z',countries:['GB','ZA'],maxVenuesPerDay:100,maxRequestsPerDay:1400,maxRequestsPerVenue:14,maxBatchVenues:10,paidProviderBudgetUsd:0,minHostDelayMs:1500,freshnessHours:720,maxAttempts:3,retryBackoffHours:24,stopAfterConsecutiveFailures:5,publicationAllowed:false,outreachAllowed:false};
const scope={mode:'NAME',query:'"Alpha Hall" "Bristol" "United Kingdom" official website',category:'events_venue'};
const input={contractVersion:'nexus.research-request.v1',requestId:id,idempotencyKey:id,correlationId:id,originatingProduct:'event_suite_resources',subject:{entityType:'UNKNOWN',canonicalEntityId:null,candidateReference:{sourceSystem:'test',sourceRecordId:'1'}},researchPurpose:'SOURCE_ENTITY_CLASSIFICATION',requestedFactTypes:['sourceCandidates'],providerAllowances:['PUBLIC_WEB'],costCeiling:{currency:'USD',amount:0},freshnessRequirements:{maxAgeHours:720},existingEvidenceRefs:['stock:1'],requestedBy:{actorType:'SYSTEM',actorId:'directory'},createdAt:new Date(now).toISOString(),researchContext:{targetName:'Alpha Hall',locality:'Bristol',territory:'GB',existingFacts:[{fieldName:'directorySearch',value:scope,evidenceRef:'stock:1'},{fieldName:'sourceLineage',value:[],evidenceRef:'stock:1'}]}};
const context={policyId:policy.policyId,policySha256:policyHash(policy),action:'DISCOVER_WEBSITE',queueId:'search:1',identityKey:'test:1',country:'GB',evidenceRef:'stock:1',sourceLineage:[],canonicalImportAllowed:false};
function request(payload:unknown=input,ctx:unknown=context,signed=true){const body=JSON.stringify({payload,directoryContext:ctx}),timestamp=String(now/1000);return new Request('https://aire.example/api/integrations/nexus/directory-search',{method:'POST',body,headers:{'x-nexus-timestamp':timestamp,'x-nexus-signature':signed?nexusSignatureFor(timestamp,body,secret):'wrong'}})}
test('signed standing search yields observations only and preserves an eligible homepage despite event result order',async()=>{
 let calls=0;const response=await handleDirectorySearchRequest(request(),{policy,approvedPolicyHash:policyHash(policy),secret,now:()=>now,searchProvider:{id:'brave-web-search',costModel:{kind:'ZERO_INCREMENTAL',currency:'USD',amountPerCall:0},search:async()=>{calls++;return [{url:'https://alphahall.example/events/show',title:'Alpha Hall Bristol'},{url:'https://alphahall.example/',title:'Alpha Hall Bristol'}]}}});
 assert.equal(response.status,200);const data=await response.json();assert.equal(calls,1);assert.deepEqual(data.result.facts,[]);assert.equal(data.result.evidence[0].payload.directorySearch.candidates[0].websiteSeed,'https://alphahall.example/');assert.equal(data.result.evidence[0].payload.directorySearch.candidates[0].identityEstablished,false);assert.equal(data.receipt.websiteRequests,0);
});
test('signature, policy, cost and scope errors reject before search; missing allowance/provider is isolated',async()=>{
 let calls=0;const options={policy,approvedPolicyHash:policyHash(policy),secret,now:()=>now,searchProvider:{id:'fixture',costModel:{kind:'ZERO_INCREMENTAL' as const,currency:'USD',amountPerCall:0},search:async()=>{calls++;return []}}};
 assert.equal((await handleDirectorySearchRequest(request(input,context,false),options)).status,401);
 assert.equal((await handleDirectorySearchRequest(request({...input,costCeiling:{currency:'USD',amount:1}}),options)).status,403);
 assert.equal((await handleDirectorySearchRequest(request(input,{...context,identityKey:'wrong'}),options)).status,403);
 assert.equal((await handleDirectorySearchRequest(request(),{...options,searchProvider:null})).status,503);assert.equal(calls,0);
});
test('geographic discovery keeps proposed names evidence-bound and excludes platforms, events and generic community-centre coverage',async()=>{
 const coverage={...input,researchContext:{...input.researchContext,targetName:'conference venues',existingFacts:[{fieldName:'directorySearch',value:{mode:'COVERAGE',query:'Bristol conference venue hire',category:'conference'},evidenceRef:'stock:1'},{fieldName:'sourceLineage',value:[],evidenceRef:'stock:1'}]}};
 const response=await handleDirectorySearchRequest(request(coverage),{policy,approvedPolicyHash:policyHash(policy),secret,now:()=>now,searchProvider:{id:'fixture',costModel:{kind:'ZERO_INCREMENTAL',currency:'USD',amountPerCall:0},search:async()=>[{url:'https://alphahall.example/',title:'Alpha Hall | Conference venue Bristol'},{url:'https://eventbrite.com/e/show',title:'Show'}]}});
 assert.equal(response.status,200);const result=await response.json();assert.equal(result.result.evidence[0].payload.directorySearch.candidates[0].proposedName,'Alpha Hall');
});

test('a live NAME response observed after request start remains usable without another search',async()=>{
 const response=await handleDirectorySearchRequest(request(),{policy,approvedPolicyHash:policyHash(policy),secret,now:()=>now,searchProvider:{id:'brave-web-search',usage:{requests:1,cacheReused:0,reservedCreditMicroUsd:5000,observedAt:new Date(now+50).toISOString()},costModel:{kind:'ZERO_INCREMENTAL',currency:'USD',amountPerCall:0},search:async()=>[{url:'https://alphahall.example/',title:'Alpha Hall Bristol'}]}});
 assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
});


test('daily provider guard defers without consuming a website or provider request',async()=>{
 const response=await handleDirectorySearchRequest(request(),{policy,approvedPolicyHash:policyHash(policy),secret,now:()=>now,searchProvider:{id:'governed-search',costModel:{kind:'ZERO_INCREMENTAL',currency:'USD',amountPerCall:0},search:async()=>{throw new DirectorySearchAllocationDeniedError('PROVIDER_DAILY_BUDGET')}}});
 assert.equal(response.status,409);assert.equal(response.headers.get('retry-after'),'43200');
 const data=await response.json();assert.equal(data.result,null);assert.equal(data.receipt.denied,1);assert.equal(data.receipt.actualHttpRequestsKnown,0);assert.deepEqual(data.receipt.denialReasons,['PROVIDER_DAILY_BUDGET']);
});

test('allocation exhaustion defers using the existing retry backoff while real provider failures remain failures',async()=>{
 const options={policy,approvedPolicyHash:policyHash(policy),secret,now:()=>now,searchProvider:{id:'governed-search',costModel:{kind:'ZERO_INCREMENTAL' as const,currency:'USD',amountPerCall:0},search:async()=>{throw new DirectorySearchAllocationDeniedError('ALLOCATION_EXHAUSTED')}}};
 const denied=await handleDirectorySearchRequest(request(),options);assert.equal(denied.status,409);assert.equal(denied.headers.get('retry-after'),'86400');
 const failure=await handleDirectorySearchRequest(request(),{...options,searchProvider:{...options.searchProvider,search:async()=>{throw Error('SERPER_PROVIDER_FAILURE')}}});assert.equal(failure.status,503);assert.equal(failure.headers.get('retry-after'),null);
});
