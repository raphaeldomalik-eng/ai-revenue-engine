import test from 'node:test';
import assert from 'node:assert/strict';
import {handleDirectoryVerificationRequest} from '../src/nexus/source-discovery/continuous-directory-verification.ts';
import {policyHash} from '../src/nexus/source-discovery/continuous-directory-policy.ts';
import {InMemoryNexusResultStore} from '../src/nexus/executor.ts';
import {nexusSignatureFor} from '../src/nexus/transport.ts';

const now=Date.parse('2026-10-21T06:15:00Z'),secret='fixture-only';
const id='11111111-1111-4111-8111-111111111111';
const policy={policyId:'verification-test',version:2,enabled:true,actions:['ENRICH_VERIFIED_VENUE','VERIFY_WEBSITE'],validFrom:'2026-10-21T00:00:00Z',validUntil:'2027-01-01T00:00:00Z',countries:['GB','ZA'],maxVenuesPerDay:100,maxRequestsPerDay:1400,maxRequestsPerVenue:14,maxBatchVenues:26,paidProviderBudgetUsd:0,minHostDelayMs:1000,freshnessHours:720,maxAttempts:3,retryBackoffHours:24,stopAfterConsecutiveFailures:5,publicationAllowed:false,outreachAllowed:false};
const payload={contractVersion:'nexus.research-request.v1',requestId:id,idempotencyKey:id,correlationId:id,originatingProduct:'event_suite_resources',subject:{canonicalEntityId:null,entityType:'UNKNOWN',candidateReference:{sourceSystem:'openstreetmap',sourceRecordId:'node/1'}},researchPurpose:'SOURCE_ENTITY_CLASSIFICATION',requestedFactTypes:['officialWebsite','schemaOrgTypes','address','classificationSignals'],providerAllowances:['PUBLIC_WEB'],costCeiling:{currency:'USD',amount:0},freshnessRequirements:{maxAgeHours:720},existingEvidenceRefs:['osm:node/1'],requestedBy:{actorType:'SYSTEM',actorId:'directory'},createdAt:new Date(now).toISOString(),researchContext:{targetName:'Alpha Hall',targetWebsite:'https://alpha.example/',territory:'GB',locality:'Bristol',existingFacts:[{fieldName:'formattedAddress',value:'10 High Street, Bristol, BS1 1AA',evidenceRef:'osm:node/1'}]}};
const context={policyId:policy.policyId,policySha256:policyHash(policy),action:'VERIFY_WEBSITE',canonicalImportAllowed:false,queueId:'verification-1',identityKey:'openstreetmap:node/1',country:'GB',evidenceRef:'osm:node/1',gaps:['OFFICIAL_WEBSITE','SOURCE_CLASSIFICATION'],attempts:0,requestBudget:6};
function request(input:Record<string,unknown>=payload,change:Record<string,unknown>={},signed=true){const body=JSON.stringify({payload:input,directoryContext:{...context,...change}}),timestamp=String(now/1000);return new Request('https://aire.example/api/integrations/nexus/directory-verify',{method:'POST',headers:{'x-nexus-timestamp':timestamp,'x-nexus-signature':signed?nexusSignatureFor(timestamp,body,secret):'invalid'},body});}
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
