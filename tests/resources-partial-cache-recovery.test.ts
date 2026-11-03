import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateResearchRequest} from '../src/nexus/contracts.ts';
import {retryableProviderFailure} from '../src/nexus/executor.ts';
import {policyHash} from '../src/nexus/source-discovery/continuous-directory-policy.ts';
import {handleDirectoryVerificationRequest} from '../src/nexus/source-discovery/continuous-directory-verification.ts';
import {nexusSignatureFor} from '../src/nexus/transport.ts';

const fixtures=JSON.parse(readFileSync(new URL('./fixtures/resources-outcome-retained.json',import.meta.url),'utf8'));
const original=fixtures.find((fixture:any)=>fixture.name==='High Lodge, Thetford Forest');
const policy=JSON.parse(readFileSync(new URL('../docs/manifests/resources-sa-uk-per-run-policy-v1.json',import.meta.url),'utf8'));
const now=Date.parse('2026-11-03T14:00:00Z'),secret='partial-cache-fixture';

function harness(change:(cached:any,input:any)=>void=()=>{},signed=true){
 const input=structuredClone(original.request),cached=structuredClone(original.cached),hash=policyHash(policy);
 // Keep the actual historical identity/contact/page evidence unchanged. Bind
 // this fixture to the current test policy through the real validated request.
 input.directoryContext.policySha256=hash;cached.directoryReservation.policySha256=hash;
 const validated=validateResearchRequest(input),context=input.directoryContext;
 cached.directoryRequestSha256=policyHash({subject:validated.subject,purpose:validated.researchPurpose,facts:validated.requestedFactTypes,context:validated.researchContext,evidenceRefs:validated.existingEvidenceRefs,freshness:validated.freshnessRequirements,policy:hash,queue:context.queueId,budget:context.requestBudget,gaps:context.gaps});
 change(cached,input);
 const counts={http:0,dns:0,reservations:0,completions:0,cacheWrites:0};
 const forbid=(key:keyof typeof counts)=>{counts[key]++;throw Error('CACHE_ONLY_SIDE_EFFECT:'+key);};
 const options={policy,approvedPolicyHash:hash,secret,now:()=>now,store:{get:async()=>cached,set:async()=>forbid('cacheWrites')},ledger:{reserve:async()=>forbid('reservations'),complete:async()=>forbid('completions')},fetchImpl:async()=>forbid('http'),resolveHost:async()=>forbid('dns')};
 const body=JSON.stringify({payload:input,directoryContext:input.directoryContext}),timestamp=String(now/1000);
 const request=new Request('https://aire.example/api/integrations/nexus/directory-verify',{method:'POST',headers:{'x-nexus-cache-only':'true','x-nexus-timestamp':timestamp,'x-nexus-signature':signed?nexusSignatureFor(timestamp,body,secret):'invalid'},body});
 return {cached,options,request,counts};
}

test('signed cache-only recovery reuses actual High Lodge PARTIAL evidence despite its historical retryable error',async()=>{
 const h=harness(),before=JSON.stringify(h.cached);
 assert.equal(retryableProviderFailure(h.cached),true);
 const response=await handleDirectoryVerificationRequest(h.request,h.options),body=await response.json() as any;
 assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.result.status,'COMPLETED');assert.equal(body.verification.state,'VERIFIED');
 const site=body.result.evidence.find((e:any)=>e.payload.firstPassAcquisition);
 assert.equal(site.payload.storedVerifierRecovery.version,2);
 assert(site.payload.firstPassAcquisition.publicContacts.some((c:any)=>c.value==='customerrelations@forestryengland.uk'&&!c.reviewRequired));
 assert.equal(body.result.observedAt,h.cached.observedAt);assert.equal(body.receipt.executed,0);assert.equal(body.receipt.actualHttpRequestsKnown,0);
 assert.equal(JSON.stringify(h.cached),before);assert.equal(retryableProviderFailure(h.cached),true,'historical retry guard stays unchanged');
 assert.deepEqual(h.counts,{http:0,dns:0,reservations:0,completions:0,cacheWrites:0});
});

test('partial cache recovery requires exact signature, original request fingerprint and reservation',async()=>{
 for(const variant of ['signature','fingerprint','reservation','subject','lineage']){
  const h=harness((cached,input)=>{
   if(variant==='fingerprint')cached.directoryRequestSha256='f'.repeat(64);
   if(variant==='reservation')cached.directoryReservation.identityKey='event_suite_resources:another';
   if(variant==='subject')input.subject.candidateReference.sourceRecordId='11111111-1111-4111-8111-111111111111';
   if(variant==='lineage')input.directoryContext.sourceLineage=[];
  },variant!=='signature'),before=JSON.stringify(h.cached);
  const response=await handleDirectoryVerificationRequest(h.request,h.options);
  assert.equal(response.status,variant==='signature'?401:['subject','lineage'].includes(variant)?403:409,variant);
  assert.equal(JSON.stringify(h.cached),before);assert.deepEqual(h.counts,{http:0,dns:0,reservations:0,completions:0,cacheWrites:0});
 }
});

test('partial cache with no supported email or broken page-hash binding returns conflict without acquisition',async()=>{
 for(const variant of ['no-supported-email','wrong-page-hash']){
  const h=harness(cached=>{
   if(variant==='no-supported-email')for(const c of cached.directoryCrawlReceipt.contactObservations)c.label='Data protection officer: '+c.value;
   else for(const page of cached.directoryCrawlReceipt.evidenceManifest.pages)page.sourceHash='f'.repeat(64);
  }),before=JSON.stringify(h.cached);
  const response=await handleDirectoryVerificationRequest(h.request,h.options),body=await response.json() as any;
  assert.equal(response.status,409,variant);assert.equal(body.code,'DIRECTORY_CACHED_RESULT_REQUIRED');
  assert.equal(JSON.stringify(h.cached),before);assert.deepEqual(h.counts,{http:0,dns:0,reservations:0,completions:0,cacheWrites:0});
 }
});
