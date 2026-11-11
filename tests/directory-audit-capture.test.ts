import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {handleDirectoryVerificationRequest} from '../src/nexus/source-discovery/continuous-directory-verification.ts';
import {policyHash} from '../src/nexus/source-discovery/continuous-directory-policy.ts';
import {InMemoryNexusResultStore} from '../src/nexus/executor.ts';
import {nexusSignatureFor} from '../src/nexus/transport.ts';

const now=Date.parse('2026-11-09T10:00:00Z'),id='11111111-1111-4111-8111-111111111111',secret='fixture-only';
const policy={policyId:'audit-test',version:2,enabled:true,actions:['VERIFY_WEBSITE'],validFrom:'2026-11-09T00:00:00Z',validUntil:'2026-11-10T00:00:00Z',countries:['GB'],maxVenuesPerDay:5,maxRequestsPerDay:50,maxRequestsPerVenue:6,maxBatchVenues:1,paidProviderBudgetUsd:0,minHostDelayMs:1000,freshnessHours:720,maxAttempts:3,retryBackoffHours:24,stopAfterConsecutiveFailures:5,publicationAllowed:false,outreachAllowed:false};
const payload={contractVersion:'nexus.research-request.v1',requestId:id,idempotencyKey:id,correlationId:id,originatingProduct:'event_suite_resources',subject:{canonicalEntityId:null,entityType:'UNKNOWN',candidateReference:{sourceSystem:'openstreetmap',sourceRecordId:'node/1'}},researchPurpose:'SOURCE_ENTITY_CLASSIFICATION',requestedFactTypes:['officialWebsite'],providerAllowances:['PUBLIC_WEB'],costCeiling:{currency:'USD',amount:0},freshnessRequirements:{maxAgeHours:720},existingEvidenceRefs:['osm:node/1'],requestedBy:{actorType:'SYSTEM',actorId:'directory'},createdAt:new Date(now).toISOString(),researchContext:{targetName:'Alpha Hall',targetWebsite:'https://alpha.example/',territory:'GB',locality:'Bristol',existingFacts:[{fieldName:'formattedAddress',value:'10 High Street, Bristol, BS1 1AA',evidenceRef:'osm:node/1'}]}};
const context={policyId:policy.policyId,policySha256:policyHash(policy),action:'VERIFY_WEBSITE',canonicalImportAllowed:false,queueId:'a'.repeat(64),identityKey:'openstreetmap:node/1',country:'GB',evidenceRef:'osm:node/1',gaps:['OFFICIAL_WEBSITE'],attempts:0,requestBudget:6};
const config={requestId:id,validFrom:'2026-11-09T09:59:00Z',validUntil:'2026-11-09T10:20:00Z'};
const html='<html><head><title>Alpha Hall Bristol</title><script type="application/ld+json">{"@type":"EventVenue","name":"Alpha Hall","address":{"streetAddress":"10 High Street","addressLocality":"Bristol","postalCode":"BS1 1AA"}}</script></head><body><h1>Alpha Hall Bristol</h1><p>Venue hire and conference facilities.</p>'+('<p>Long introduction.</p>'.repeat(500))+'<footer data-audit="AFTER_EXCERPT"><img src="/original-photo.jpg" data-rights="ask"><form action="/enquire"><input name="message"></form><a href="/contact">Contact</a><span>Late source-only footer.</span></footer></body></html>';
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
function request(cacheOnly=false){const body=JSON.stringify({payload,directoryContext:context}),timestamp=String(now/1000);return new Request('https://aire.example/directory-verify',{method:'POST',headers:{'x-nexus-timestamp':timestamp,'x-nexus-signature':nexusSignatureFor(timestamp,body,secret),...(cacheOnly?{'x-nexus-cache-only':'true'}:{})},body});}
function harness(auditCapture:unknown=config,body=html){
 const store=new InMemoryNexusResultStore(),calls:string[]=[],writes:Record<string,unknown>[]=[];
 const original=store.set.bind(store);store.set=async(key,value)=>{writes.push(value);await original(key,value)};
 const options={policy,approvedPolicyHash:policyHash(policy),secret,store,now:()=>now,auditCapture,resolveHost:async()=>[{address:'1.1.1.1',family:4}],fetchImpl:async(input:RequestInfo|URL)=>{const url=String(input);calls.push(url);return new Response(url.endsWith('/robots.txt')?'User-agent: *\nAllow: /':url.includes('sitemap')?'<urlset></urlset>':body,{headers:{'content-type':url.endsWith('/robots.txt')?'text/plain':url.includes('sitemap')?'application/xml':'text/html','set-cookie':'DO_NOT_RETAIN','authorization':'DO_NOT_RETAIN'}})},ledger:{reserve:async()=>true,complete:async()=>{},isQuarantined:async()=>false}};
 return {store,calls,writes,options};
}

test('exact canary privately retains original bounded bytes beyond the excerpt with no additional requests or shared leakage',async()=>{
 const h=harness(),plain=harness(undefined);plain.options.auditCapture=undefined;
 const response=await handleDirectoryVerificationRequest(request(),h.options),shared=await response.json();
 await handleDirectoryVerificationRequest(request(),plain.options);
 const saved=h.writes.find(row=>row.directoryCrawlReceipt) as any;
 assert(saved?.directoryAudit,'enabled exact canary must retain a private audit reference');
 const audit=await h.store.get(saved.directoryAudit.receiptKey) as any;
 assert(audit?.directoryAuditCorpus,'independent original corpus must survive in the existing private ledger');
 const corpus=audit.directoryAuditCorpus,source=corpus.responses.find((r:any)=>r.url==='https://alpha.example/');
 assert.equal(Buffer.from(source.bodyBase64,'base64').toString(),html);
 assert.equal(source.sha256,sha(html));assert.equal(source.bytes,Buffer.byteLength(html));
 assert.equal(corpus.binding.requestId,id);assert.equal(corpus.binding.requestSha256,saved.directoryRequestSha256);assert.equal(corpus.binding.queueId,context.queueId);assert.equal(corpus.binding.attempt,1);
 assert.equal(audit.storedBytes,Buffer.byteLength(JSON.stringify(audit)));
 assert.equal(audit.dataClassification,'INTERNAL');
 assert.deepEqual(h.calls,plain.calls);assert(h.calls.length<=6);
 assert(!JSON.stringify(audit).includes('DO_NOT_RETAIN'));
 assert(!JSON.stringify(shared).includes('directoryAudit'));assert(!JSON.stringify(shared).includes('bodyBase64'));
 const before=h.calls.length;const replay=await(await handleDirectoryVerificationRequest(request(true),h.options)).json();
 assert.equal(h.calls.length,before);assert(!JSON.stringify(replay).includes('directoryAudit'));assert(!JSON.stringify(replay).includes('bodyBase64'));
});

test('capture is default-off and rejects mismatched, invalid, expired, future and overlong activation windows without changing acquisition',async()=>{
 for(const disabled of [undefined,{}, {...config,requestId:'22222222-2222-4222-8222-222222222222'}, {...config,requestId:'*'}, {...config,validUntil:'invalid'}, {...config,validUntil:'2026-11-09T09:59:59Z'}, {...config,validFrom:'2026-11-09T10:01:00Z'}, {...config,validFrom:'2026-11-09T00:00:00Z'}]){
  const h=harness(disabled);if(disabled===undefined)(h.options as any).auditCapture=undefined;
  const result=await handleDirectoryVerificationRequest(request(),h.options);assert.equal(result.status,200);
  const saved=h.writes.find(row=>row.directoryCrawlReceipt) as any;assert(saved);assert.equal(saved.directoryAudit,undefined);assert(h.calls.length>0);
 }
});

test('unverified source responses remain available privately without approving their extracted facts',async()=>{
 const h=harness(config,html.replaceAll('Bristol','York').replaceAll('BS1 1AA','YO1 1AA'));
 const shared=await(await handleDirectoryVerificationRequest(request(),h.options)).json() as any;
 assert.equal(shared.verification.state,'UNVERIFIED');
 const saved=h.writes.find(row=>row.directoryCrawlReceipt) as any;assert(saved.directoryAudit);
 const audit=await h.store.get(saved.directoryAudit.receiptKey) as any;
 assert(audit.directoryAuditCorpus.responses.some((r:any)=>r.bodyBase64&&Buffer.from(r.bodyBase64,'base64').toString().includes('York')));
 assert(shared.result.evidence.every((e:any)=>!e.payload.firstPassAcquisition));
});


test('audit persistence unavailability is private technical evidence, not a new publication or acquisition failure',async()=>{
 const h=harness();h.store.privateAuditStore.get=async()=>{throw Error('audit read unavailable');};
 const response=await handleDirectoryVerificationRequest(request(),h.options),shared=await response.json() as any;
 assert.equal(response.status,200);assert.equal(shared.verification.state,'VERIFIED');assert(shared.result.evidence.some((e:any)=>e.payload.firstPassAcquisition));
 const saved=h.writes.find(row=>row.directoryCrawlReceipt) as any;assert.equal(saved.directoryAudit.state,'UNAVAILABLE');assert.equal(saved.directoryAudit.reason,'AUDIT_READ_UNCERTAIN');assert(h.calls.length>0);assert(!JSON.stringify(shared).includes('AUDIT_READ_UNCERTAIN'));
});

test('source bytes already read survive a later child terminal-history storage fatal without changing its disposition',async()=>{
 const h=harness(),fetch=h.options.fetchImpl,set=h.store.set.bind(h.store);
 h.options.fetchImpl=async input=>String(input).endsWith('/contact')?(h.calls.push(String(input)),new Response(null,{status:404})):fetch(input);
 h.store.set=async(key,row)=>{if(key.startsWith('terminal-url:'))throw Error('fixture terminal storage unavailable');await set(key,row);};
 const shared=await(await handleDirectoryVerificationRequest(request(),h.options)).json() as any;
 const saved=h.writes.find(row=>row.directoryCrawlReceipt) as any;assert(saved?.directoryAudit);
 const row=await h.store.get(saved.directoryAudit.receiptKey) as any;
 assert(row.directoryAuditCorpus.responses.some((r:any)=>r.url==='https://alpha.example/'&&Buffer.from(r.bodyBase64,'base64').toString()===html));
 assert.equal(saved.directoryCrawlReceipt.disposition.code,'TERMINAL_URL_HISTORY_WRITE_FAILED');assert.equal(shared.result.status,'UNRESOLVED');
 assert.equal(row.directoryAuditCorpus.captureComplete,false);assert(row.directoryAuditCorpus.requestRecordsMissing>0);assert.equal(h.calls.filter(url=>url.endsWith('/contact')).length,1);assert.equal(h.calls.at(-1),'https://alpha.example/contact');
});
