import test from 'node:test';
import assert from 'node:assert/strict';
import {handleDirectoryVerificationRequest,validatedVerificationContinuation} from '../src/nexus/source-discovery/continuous-directory-verification.ts';
import fs from 'node:fs';
import {policyHash} from '../src/nexus/source-discovery/continuous-directory-policy.ts';
import {InMemoryNexusResultStore} from '../src/nexus/executor.ts';
import {nexusSignatureFor} from '../src/nexus/transport.ts';
import {validatedVerificationRecovery} from '../src/nexus/source-discovery/continuous-directory-recovery.ts';

const now=Date.parse('2026-10-21T06:15:00Z'),secret='fixture-only';
const id='11111111-1111-4111-8111-111111111111';
const policy={policyId:'verification-test',version:2,enabled:true,actions:['ENRICH_VERIFIED_VENUE','VERIFY_WEBSITE'],validFrom:'2026-10-21T00:00:00Z',validUntil:'2027-01-01T00:00:00Z',countries:['GB','ZA'],maxVenuesPerDay:100,maxRequestsPerDay:1400,maxRequestsPerVenue:14,maxBatchVenues:26,paidProviderBudgetUsd:0,minHostDelayMs:1000,freshnessHours:720,maxAttempts:3,retryBackoffHours:24,stopAfterConsecutiveFailures:5,publicationAllowed:false,outreachAllowed:false};
const payload={contractVersion:'nexus.research-request.v1',requestId:id,idempotencyKey:id,correlationId:id,originatingProduct:'event_suite_resources',subject:{canonicalEntityId:null,entityType:'UNKNOWN',candidateReference:{sourceSystem:'openstreetmap',sourceRecordId:'node/1'}},researchPurpose:'SOURCE_ENTITY_CLASSIFICATION',requestedFactTypes:['officialWebsite','schemaOrgTypes','address','classificationSignals'],providerAllowances:['PUBLIC_WEB'],costCeiling:{currency:'USD',amount:0},freshnessRequirements:{maxAgeHours:720},existingEvidenceRefs:['osm:node/1'],requestedBy:{actorType:'SYSTEM',actorId:'directory'},createdAt:new Date(now).toISOString(),researchContext:{targetName:'Alpha Hall',targetWebsite:'https://alpha.example/',territory:'GB',locality:'Bristol',existingFacts:[{fieldName:'formattedAddress',value:'10 High Street, Bristol, BS1 1AA',evidenceRef:'osm:node/1'}]}};
const context={policyId:policy.policyId,policySha256:policyHash(policy),action:'VERIFY_WEBSITE',canonicalImportAllowed:false,queueId:'a'.repeat(64),identityKey:'openstreetmap:node/1',country:'GB',evidenceRef:'osm:node/1',gaps:['OFFICIAL_WEBSITE','SOURCE_CLASSIFICATION'],attempts:0,requestBudget:6};
function request(input:Record<string,unknown>=payload,change:Record<string,unknown>={},signed=true){const body=JSON.stringify({payload:input,directoryContext:{...context,...change}}),timestamp=String(now/1000);return new Request('https://aire.example/api/integrations/nexus/directory-verify',{method:'POST',headers:{'x-nexus-timestamp':timestamp,'x-nexus-signature':signed?nexusSignatureFor(timestamp,body,secret):'invalid'},body});}
function requestAt(at:number,change:Record<string,unknown>={}){const body=JSON.stringify({payload,directoryContext:{...context,attempts:1,...change}}),timestamp=String(at/1000);return new Request('https://aire.example/api/integrations/nexus/directory-verify',{method:'POST',headers:{'x-nexus-timestamp':timestamp,'x-nexus-signature':nexusSignatureFor(timestamp,body,secret)},body});}
function harness(city='Bristol'){
 let requests=0,reservations=0;const states:string[]=[];const store=new InMemoryNexusResultStore();
 const fetchImpl=async(input:RequestInfo|URL)=>{requests++;const url=new URL(String(input));if(url.pathname==='/robots.txt')return new Response('',{status:404});return new Response(`<html><head><title>Alpha Hall ${city}</title><script type="application/ld+json">{"@type":"EventVenue","name":"Alpha Hall","address":{"streetAddress":"10 High Street","addressLocality":"${city}","postalCode":"${city==='Bristol'?'BS1 1AA':'YO1 1AA'}"}}</script></head><body><h1>Alpha Hall ${city}</h1><p>Venue hire and conference facilities.</p></body></html>`,{headers:{'content-type':'text/html'}})};
 const options={policy,approvedPolicyHash:policyHash(policy),secret,store,now:()=>now,fetchImpl,resolveHost:async()=>[{address:'1.1.1.1',family:4}],ledger:{reserve:async()=>{reservations++;return true},complete:async(r:{state:string})=>{if(!states.includes(r.state))states.push(r.state)},isQuarantined:async()=>states.includes('QUARANTINED')}};
 return {options,counts:()=>({requests,reservations,states})};
}
test('verification requires explicit policy scope, signed authority, neutral subject and zero-paid providers',async()=>{
 const h=harness();
 assert.equal((await handleDirectoryVerificationRequest(request(payload,{},false),h.options)).status,401);
 for(const input of [{...payload,providerAllowances:['GOOGLE_PLACES']},{...payload,subject:{...payload.subject,entityType:'VENUE'}},{...payload,costCeiling:{currency:'USD',amount:1}}])assert.equal((await handleDirectoryVerificationRequest(request(input),h.options)).status,403);
 assert.equal((await handleDirectoryVerificationRequest(request(payload,{policySha256:'f'.repeat(64)}),h.options)).status,403);
 const p={...policy,actions:['ENRICH_VERIFIED_VENUE']};assert.equal((await handleDirectoryVerificationRequest(request(),{...h.options,policy:p,approvedPolicyHash:policyHash(p)})).status,404);
 assert.equal(h.counts().requests,0);assert.equal(h.counts().reservations,0);
});
test('a deferred current-run venue remains CRAWL_INCOMPLETE and never becomes a no-public-email finding',async()=>{
 const h=harness();const p={...policy,quotaMode:'PER_RUN' as const,maxVenuesPerRun:2,maxRequestsPerRun:12,braveMaxRequestsPerRun:0,serperMaxRequestsPerRun:0};
 h.options.ledger.reserve=async()=>false;
 const response=await handleDirectoryVerificationRequest(request(payload,{policySha256:policyHash(p),runId:id}),{...h.options,policy:p,approvedPolicyHash:policyHash(p)});
 const body=await response.json() as any;assert.equal(response.status,409);assert.equal(body.contactOutcome,'CRAWL_INCOMPLETE');assert.equal(body.result,null);assert.equal(h.counts().requests,0);assert.equal(body.receipt.denied,1);
});
test('a cached result repairs a lost completion receipt without recrawling or reserving twice',async()=>{
 const h=harness();let lost=true;const complete=h.options.ledger.complete;h.options.ledger.complete=async r=>{if(lost){lost=false;throw Error('LOST_DATABASE_ACK')}await complete(r)};
 assert.notEqual((await handleDirectoryVerificationRequest(request(),h.options)).status,200);const first=h.counts();
 assert.equal((await handleDirectoryVerificationRequest(request(),h.options)).status,200);assert.equal(h.counts().requests,first.requests);assert.equal(h.counts().reservations,first.reservations);assert.deepEqual(h.counts().states,['COMPLETED']);
});
test('existing crawler verifies a seed, returns neutral research evidence, accounts all HTTP and replays without recrawling',async()=>{
 const h=harness();const response=await handleDirectoryVerificationRequest(request(),h.options);const body=await response.json() as any;
 assert.equal(response.status,200,JSON.stringify(body));assert(body.result.facts.every((f:any)=>f.subjectEntityType==='UNKNOWN'));assert.equal(body.verification.state,'VERIFIED');
 assert(body.result.facts.some((f:any)=>f.fieldName==='officialWebsite'));assert(body.result.facts.some((f:any)=>f.fieldName==='schemaOrgTypes'));
 assert.equal(body.receipt.actualHttpRequestsKnown,h.counts().requests);assert(h.counts().requests>0);assert.equal(h.counts().states[0],'COMPLETED');
 const first=h.counts();const replay=await handleDirectoryVerificationRequest(request(),h.options);assert.equal(replay.status,200);assert.equal((await replay.json() as any).receipt.actualHttpRequestsKnown,0);assert.deepEqual(h.counts(),first);
 const substituted={...payload,researchContext:{...payload.researchContext,locality:'York'}};assert.equal((await handleDirectoryVerificationRequest(request(substituted),h.options)).status,409);
});
test('cached first-party name can reuse an independently verified exact Nexus origin without copying its address into website evidence',async()=>{
 const h=harness();h.options.fetchImpl=async(input:RequestInfo|URL)=>{const u=new URL(String(input));if(u.pathname==='/robots.txt')return new Response('',{status:404});return new Response('<html><head><title>Alpha Hall</title></head><body><h1>Alpha Hall</h1><p>Venue hire and private events.</p></body></html>',{headers:{'content-type':'text/html'}})};
 const evidenceRef='nexus:source_entity_classification:alpha';const facts=[{fieldName:'formattedAddress',value:'10 High Street, Bristol, BS1 1AA',evidenceRef:'listing:alpha:stored_address'},{fieldName:'verifiedWebsiteOrigin',value:'alpha.example',evidenceRef}];
 const input={...payload,existingEvidenceRefs:[...payload.existingEvidenceRefs,evidenceRef],researchContext:{...payload.researchContext,existingFacts:facts}};
 const response=await handleDirectoryVerificationRequest(request(input,{evidenceRef:'osm:node/1'}),h.options);const body=await response.json() as any;
 assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.verification.state,'VERIFIED');
 assert.equal(body.result.facts.some((f:any)=>f.fieldName==='address'),false);
});
test('same name in the wrong town cannot become an official site or a venue; terminal replay stays idempotent',async()=>{
 const h=harness('York');const response=await handleDirectoryVerificationRequest(request(),h.options);const body=await response.json() as any;
 assert.equal(response.status,200);assert.equal(body.verification.state,'UNVERIFIED');assert.equal(body.result.facts.length,0);assert.equal(h.counts().states[0],'QUARANTINED');
 const first=h.counts();assert.equal((await handleDirectoryVerificationRequest(request(),h.options)).status,200);assert.deepEqual(h.counts(),first);
});
test('temporary loss of the identity corroboration page remains retryable rather than a terminal quarantine',async()=>{
 const h=harness();h.options.fetchImpl=async(input:RequestInfo|URL)=>{const u=new URL(String(input));if(u.pathname==='/robots.txt')return new Response('',{status:404});if(u.pathname==='/contact')return new Response('',{status:503});return new Response('<html><head><title>Alpha Hall</title></head><body><h1>Alpha Hall</h1><a href="/contact">Contact</a></body></html>',{headers:{'content-type':'text/html'}})};
 const response=await handleDirectoryVerificationRequest(request(),h.options);const body=await response.json() as any;
 assert.equal(response.status,503,JSON.stringify(body));assert.equal(h.counts().states[0],'RETRYABLE');assert(body.result.researchErrors.some((e:any)=>e.retryable));
});
test('a bounded continuation reuses only the original retryable request and caps its new crawl at three',async()=>{
 const h=harness();let firstCalls=0;h.options.fetchImpl=async(input:RequestInfo|URL)=>{firstCalls++;const u=new URL(String(input));if(u.pathname==='/robots.txt')return new Response('',{status:404});if(u.pathname==='/contact')return new Response('',{status:503});return new Response('<html><head><title>Alpha Hall</title></head><body><h1>Alpha Hall</h1><a href="/contact">Contact</a></body></html>',{headers:{'content-type':'text/html'}})};
 assert.equal((await handleDirectoryVerificationRequest(request(),h.options)).status,503);
 assert.equal(firstCalls,3);
 const later=Date.parse('2026-10-22T06:17:00Z');
 const continuation={...policy,policyId:'verification-continuation-test',version:1,actions:['VERIFY_WEBSITE'],validFrom:'2026-10-22T06:16:00Z',validUntil:'2026-10-22T06:46:00Z',countries:['GB'],maxVenuesPerDay:2,maxRequestsPerDay:6,maxRequestsPerVenue:3,maxBatchVenues:2,minHostDelayMs:2000,maxAttempts:1,continuation:{sourcePolicyId:policy.policyId,sourcePolicySha256:policyHash(policy),originalRequestBudget:6,priorRequestCount:3,additionalRequestBudget:3,entries:[{queueId:context.queueId,requestId:id,identityKey:context.identityKey,host:'alpha.example'},{queueId:'f'.repeat(64),requestId:'22222222-2222-4222-8222-222222222222',identityKey:'event_suite_resources:second',host:'beta.example'}]}};
 let ready=true;
 let secondCalls=0;const goodFetch=async(input:RequestInfo|URL)=>{secondCalls++;const u=new URL(String(input));if(u.pathname==='/robots.txt')return new Response('',{status:404});return new Response('<html><head><title>Alpha Hall Bristol</title><script type="application/ld+json">{"@type":"EventVenue","name":"Alpha Hall","address":{"streetAddress":"10 High Street","addressLocality":"Bristol","postalCode":"BS1 1AA"}}</script></head><body><h1>Alpha Hall Bristol</h1></body></html>',{headers:{'content-type':'text/html'}})};
 const options={...h.options,policy:continuation,approvedPolicyHash:policyHash(continuation),now:()=>later,fetchImpl:goodFetch,continuationReady:async()=>ready};
 ready=false;assert.equal((await handleDirectoryVerificationRequest(requestAt(later),options)).status,409);assert.equal(secondCalls,0);ready=true;
 const response=await handleDirectoryVerificationRequest(requestAt(later),options);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
 const second=h.counts();assert(secondCalls>0&&secondCalls<=3);assert.equal(second.reservations,2);
 assert.equal((await handleDirectoryVerificationRequest(requestAt(later),options)).status,200);assert.deepEqual(h.counts(),second);assert(secondCalls<=3);
 assert.equal((await handleDirectoryVerificationRequest(requestAt(later,{queueId:'another-queue'}),options)).status,403);
 assert.equal((await handleDirectoryVerificationRequest(requestAt(later,{requestBudget:5}),options)).status,403);
 assert.equal((await handleDirectoryVerificationRequest(requestAt(later,{attempts:0}),options)).status,403);
 const other=harness();const notReady={...options,store:other.options.store,continuationReady:async()=>false};
 assert.equal((await handleDirectoryVerificationRequest(requestAt(later),notReady)).status,409);
 assert.equal((await handleDirectoryVerificationRequest(requestAt(later),{...options,policy:{...continuation,maxRequestsPerDay:7},approvedPolicyHash:policyHash({...continuation,maxRequestsPerDay:7})})).status,404);
});
test('an exact signed recovery can run an unreserved old request once without rewriting its identity',async()=>{
 const h=harness(),later=Date.parse('2026-10-30T06:10:00Z');
 const sourcePolicyId='resources-directory-uk-verify-50-20261024';
 const sourcePolicySha256='c49c05bfccd52774aad3e0231b6bc0de766cef51dd1dd175d69aba7fabae1923';
 const candidateId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',identityKey=`event_suite_resources:${candidateId}`;
 const oldPayload={...payload,subject:{...payload.subject,candidateReference:{sourceSystem:'event_suite_resources',sourceRecordId:candidateId}}};
 const recovery={...policy,policyId:'verification-recovery-test',version:1,actions:['VERIFY_WEBSITE','ENRICH_VERIFIED_VENUE'],
  validFrom:'2026-10-30T06:00:00Z',validUntil:'2026-10-30T06:30:00Z',countries:['GB'],maxVenuesPerDay:2,maxRequestsPerDay:12,
  maxRequestsPerVenue:6,maxBatchVenues:1,minHostDelayMs:2000,maxAttempts:1,
  recovery:{originalRequestBudget:6,additionalRequestBudget:3,entries:[{sourcePolicyId,sourcePolicySha256,
   queueId:context.queueId,requestId:id,identityKey,host:'alpha.example',mode:'UNRESERVED' as const,priorRequestCount:0}]}};
 assert.equal(validatedVerificationRecovery(recovery)?.entries.length,1);
 let ready=false;
 const options={...h.options,policy:recovery,approvedPolicyHash:policyHash(recovery),now:()=>later,recoveryReady:async()=>ready};
 const oldRequest=(attempts=0)=>{const body=JSON.stringify({payload:oldPayload,directoryContext:{...context,identityKey,attempts,policyId:sourcePolicyId,policySha256:sourcePolicySha256}}),timestamp=String(later/1000);
  return new Request('https://aire.example/api/integrations/nexus/directory-verify',{method:'POST',headers:{'x-nexus-timestamp':timestamp,'x-nexus-signature':nexusSignatureFor(timestamp,body,secret)},body});};
 assert.equal((await handleDirectoryVerificationRequest(oldRequest(),options)).status,409);
 ready=true;
 const first=await handleDirectoryVerificationRequest(oldRequest(),options);
 assert.equal(first.status,200,JSON.stringify(await first.clone().json()));
 const counts=h.counts();assert(counts.requests>0);
 assert.equal((await handleDirectoryVerificationRequest(oldRequest(),options)).status,200);
 assert.deepEqual(h.counts(),counts);
 assert.equal((await handleDirectoryVerificationRequest(oldRequest(1),options)).status,403);
 assert.throws(()=>validatedVerificationRecovery({...recovery,maxRequestsPerDay:133}),/DIRECTORY_RECOVERY_SCOPE_INVALID/);
});
test('the recorded UK continuation policy is limited to two original requests and a thirty-minute window',()=>{
 const recorded=JSON.parse(fs.readFileSync(new URL('../ops/canaries/uk-resources-website-continuation-2026-10-24/policy.json',import.meta.url),'utf8'));
 assert.equal(policyHash(recorded),'6e46709713bbd8d3e835a8cfa7852a5ca827d7cb2555f3f64b80d636fd1bb46d');
 assert.equal(validatedVerificationContinuation(recorded)?.entries.length,2);
 assert.equal(recorded.continuation.sourcePolicySha256,'6d8346510acdbf4fb6e28fba5264b2270ef8914c8a8d64d57fcb3632717ded26');
});
test('the UK recovery policy binds exactly the eleven pending queue identities',()=>{
 const recorded=JSON.parse(fs.readFileSync(new URL('../ops/canaries/uk-resources-website-recovery-2026-10-30/policy.json',import.meta.url),'utf8'));
 const entries=validatedVerificationRecovery(recorded)?.entries??[];
 assert.equal(entries.length,11);
 assert.equal(entries.filter((entry:{mode:string})=>entry.mode==='UNRESERVED').length,8);
 assert.equal(entries.filter((entry:{mode:string})=>entry.mode==='RETRYABLE').length,3);
 assert.deepEqual([...new Set(entries.map((entry:{sourcePolicyId:string})=>entry.sourcePolicyId))].sort(),
  ['resources-directory-uk-verify-50-20261024','resources-directory-uk-verify-canary-20261022'].sort());
});
test('the ten-venue canary policy is signed to exactly ten existing candidate identities',async()=>{
 const recorded=JSON.parse(fs.readFileSync(new URL('../ops/canaries/uk-resources-ten-existing-venues-2026-10-30/policy.json',import.meta.url),'utf8'));
 assert.equal(recorded.allowedIdentityKeys.length,10);
 assert.equal(new Set(recorded.allowedIdentityKeys).size,10);
 const h=harness(),scoped={...policy,allowedIdentityKeys:recorded.allowedIdentityKeys};
 assert.equal((await handleDirectoryVerificationRequest(request(payload,{policyId:scoped.policyId,policySha256:policyHash(scoped)}),
  {...h.options,policy:scoped,approvedPolicyHash:policyHash(scoped)})).status,403);
 assert.equal(h.counts().requests,0);
});
