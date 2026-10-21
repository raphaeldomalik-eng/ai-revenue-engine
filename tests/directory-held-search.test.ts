import test from 'node:test';
import assert from 'node:assert/strict';
import {consumeDirectorySearchEvidence} from '../src/nexus/search/directory-held-search.ts';
import {InMemoryNexusResultStore} from '../src/nexus/executor.ts';
const now='2026-10-21T11:00:00Z',id='11111111-1111-4111-8111-111111111111';
const request=()=>({contractVersion:'aire.official-website-discovery-request.v1',requestId:id,idempotencyKey:id,correlationId:id,originatingProduct:'event_suite_resources',subject:{entityType:'UNKNOWN',canonicalEntityId:null,candidateReference:{sourceSystem:'test',sourceRecordId:'1'}},identity:{venueName:'Alpha Hall',locality:'Bristol',country:'GB'},providerAllowances:['PUBLIC_WEB_SEARCH'],costCeiling:{currency:'USD',amount:0},requestedBy:{actorType:'SYSTEM',actorId:'directory'},createdAt:now});
const receipt=()=>({query:'"Alpha Hall" "Bristol" "United Kingdom" official website',country:'GB',observedAt:now,evidenceRef:'native-search:1',mechanism:'native_web_search',paidProviderCostUsd:0,results:[{url:'https://alphahall.example/hire',title:'Alpha Hall Bristol'},{url:'https://facebook.com/alpha',title:'Alpha Hall'}]});
test('held search uses existing discovery contract without crawling; exact replay reuses the checkpoint',async()=>{
 const store=new InMemoryNexusResultStore();const input=request(),evidence=[receipt()];
 const first=await consumeDirectorySearchEvidence(input,evidence,{store,now});
 assert.equal(first.result.officialWebsite,null);assert.equal(first.result.crawl.requestCount,0);assert.equal(first.result.googlePlacesCalls,0);
 assert.equal(first.sourceObservedAt,evidence[0].observedAt);
 assert.equal(first.candidates.length,1);assert.equal(first.candidates[0].websiteAuthority,'UNVERIFIED_SEARCH_RESULT');assert.deepEqual(first.candidates[0].evidenceRefs,['native-search:1']);
 assert.equal(first.cacheReused,false);assert.equal((await consumeDirectorySearchEvidence(input,evidence,{store,now})).cacheReused,true);
 assert.equal((await consumeDirectorySearchEvidence({...input,createdAt:'2026-10-21T10:59:00Z'},evidence,{store,now})).cacheReused,true);
 await assert.rejects(()=>consumeDirectorySearchEvidence({...input,subject:{...input.subject,candidateReference:{sourceSystem:'test',sourceRecordId:'2'}}},evidence,{store,now}),/REPLAY_SCOPE/);
});
test('missing, stale, differently scoped and paid evidence cannot masquerade as completed zero-paid search',async()=>{
 for(const evidence of [[],[{...receipt(),country:'ZA'}],[{...receipt(),observedAt:'2020-01-01T00:00:00Z'}],[{...receipt(),paidProviderCostUsd:1}]])await assert.rejects(()=>consumeDirectorySearchEvidence(request(),evidence,{now}),/EVIDENCE/);
 await assert.rejects(()=>consumeDirectorySearchEvidence({...request(),providerAllowances:['PUBLIC_WEB_SEARCH','PUBLIC_WEB']},[receipt()],{now}),/SEARCH_ONLY/);
});
test('a lone unrelated search link is retained as an observation but never prepared as a venue seed',async()=>{
 const r=await consumeDirectorySearchEvidence(request(),[{...receipt(),results:[{url:'https://classified.example/forsale/bristol',title:'Classified advertisements in Bristol'}]}],{now});
 assert.equal(r.result.candidates.length,1);assert.equal(r.candidates.length,0);
});
test('event listings and wiki directory pages remain source observations even with an aligned title',async()=>{
 for(const url of ['https://listing.example/event/alpha-hall','https://wiki.example/wiki/Alpha_Hall']){
  const r=await consumeDirectorySearchEvidence(request(),[{...receipt(),results:[{url,title:'Alpha Hall Bristol'}]}],{now});
  assert.equal(r.candidates.length,0);
 }
});
test('a second eligible site at rank nine prevents a false unique-seed decision',async()=>{
 const results=Array.from({length:10},(_,i)=>({url:`https://unrelated${i}.example/`,title:'Unrelated business'}));
 results[0]={url:'https://alphahall.example/',title:'Alpha Hall Bristol'};results[8]={url:'https://otheralphahall.example/',title:'Alpha Hall Bristol'};
 const r=await consumeDirectorySearchEvidence(request(),[{...receipt(),results}],{now});assert.equal(r.candidates.length,2);
});
