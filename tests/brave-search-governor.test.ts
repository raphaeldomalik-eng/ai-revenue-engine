import test from 'node:test';import assert from 'node:assert/strict';
import {createBravePublicWebSearchProvider,braveQueryFingerprint} from '../src/nexus/search/brave-public-web-search.ts';
const input={query:'  Bristol   private hire ',country:'GB' as const,maxResults:10};
test('normalized query cache includes geography, category and every provider parameter',()=>{
 assert.equal(braveQueryFingerprint(input),braveQueryFingerprint({...input,query:'bristol private hire'}));
 for(const different of [{...input,country:'ZA' as const},{...input,category:'wedding'},{...input,locality:'Bath'},{...input,maxResults:5}])assert.notEqual(braveQueryFingerprint(input),braveQueryFingerprint(different));
});
test('a cached successful response replays across development request IDs without another provider call',async()=>{
 let calls=0;const rows=new Map();
 const options={apiKey:'fixture',allowanceId:'initial-100',requestKey:'job1',reserve:async(r:{querySha256:string})=>rows.has(r.querySha256)?{state:'CACHED',results:rows.get(r.querySha256)}:{state:'RESERVED'},complete:async(r:{querySha256:string},results:unknown)=>{rows.set(r.querySha256,results)},fetchImpl:async()=>{calls++;return Response.json({web:{results:[]}})}};
 await createBravePublicWebSearchProvider(options).search(input);
 await createBravePublicWebSearchProvider({...options,requestKey:'job2'}).search({...input,query:'bristol private hire'});
 assert.equal(calls,1);
});
test('unknown and failed reservations are never implicitly retried, refunded or refreshed',async()=>{
 let calls=0,reserved=false,failed='';
 const p=createBravePublicWebSearchProvider({apiKey:'fixture',allowanceId:'initial-100',requestKey:'job',reserve:async()=>{if(reserved)return {state:'DENIED'};reserved=true;return {state:'RESERVED'}},fail:async(_r,code)=>{failed=code},fetchImpl:async()=>{calls++;throw Error('network')}});
 await assert.rejects(()=>p.search(input),/BRAVE_PROVIDER_FAILURE/);await assert.rejects(()=>p.search(input),/BUDGET_EXHAUSTED/);
 assert.equal(calls,1);assert.equal(failed,'BRAVE_PROVIDER_FAILURE');
});
