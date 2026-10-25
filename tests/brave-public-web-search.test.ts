import test from 'node:test';
import assert from 'node:assert/strict';
import {createBravePublicWebSearchProvider} from '../src/nexus/search/brave-public-web-search.ts';

const input={query:'Bristol conference venue hire',country:'GB' as const,maxResults:10};

test('explicit empty Brave response is cached while malformed or mismatched emptiness stays uncertain',async()=>{
 let completed=0,failed=0;
 const options={apiKey:'fixture',requestKey:'empty',allowanceId:'finite',reserve:async()=>true,complete:async(_r:unknown,rows:unknown)=>{assert.deepEqual(rows,[]);completed++;},fail:async()=>{failed++;}};
 const empty={type:'search',query:{original:input.query,more_results_available:false},web:null};
 assert.deepEqual(await createBravePublicWebSearchProvider({...options,fetchImpl:async()=>Response.json(empty)}).search(input),[]);
 assert.equal(completed,1);assert.equal(failed,0);
 for(const payload of [{},{...empty,query:{original:'another venue',more_results_available:false}},{...empty,query:{original:input.query,more_results_available:true}},{...empty,web:{results:'invalid'}}]){
  await assert.rejects(()=>createBravePublicWebSearchProvider({...options,fetchImpl:async()=>Response.json(payload)}).search(input),/BRAVE_RESPONSE_INVALID/);
 }assert.equal(completed,1);assert.equal(failed,4);
});
test('Brave reserves verified free allowance before network access and keeps the key in a header',async()=>{
 const order:string[]=[];
 const p=createBravePublicWebSearchProvider({apiKey:'test-secret',requestKey:'job:1',allowanceId:'test-credits',reserve:async r=>{order.push('reserve');assert.equal(r.allowanceId,'test-credits');return true},fetchImpl:async(url,init)=>{
  order.push('fetch');const u=new URL(String(url));assert.equal(u.hostname,'api.search.brave.com');assert.equal(u.searchParams.get('country'),'gb');assert(!String(url).includes('test-secret'));assert.equal(new Headers(init?.headers).get('X-Subscription-Token'),'test-secret');
  return Response.json({web:{results:[{url:'https://venue.example/',title:'Alpha Hall',description:'Venue hire'},{url:'javascript:alert(1)',title:'Bad'}]}});
 }});
 assert.deepEqual(await p.search(input),[{url:'https://venue.example/',title:'Alpha Hall',snippet:'Venue hire'}]);assert.deepEqual(order,['reserve','fetch']);assert.equal(p.costModel.amountPerCall,0);
});
test('missing configuration or denied/exhausted allowance never calls the provider',async()=>{
 let calls=0;
 for(const key of ['', 'test-secret']){
  const p=createBravePublicWebSearchProvider({apiKey:key,requestKey:'job',allowanceId:'test',reserve:async()=>false,fetchImpl:async()=>{calls++;throw Error('MUST_NOT_FETCH')}});
  await assert.rejects(()=>p.search(input),/BRAVE_CONFIGURATION_REQUIRED|PUBLIC_WEB_SEARCH_BUDGET_EXHAUSTED/);
 }assert.equal(calls,0);
});
test('429, auth failure, malformed and oversized responses are bounded sanitized failures',async()=>{
 for(const response of [new Response('secret echoed',{status:429,headers:{'X-RateLimit-Reset':'1, 3600'}}),new Response('secret echoed',{status:401}),Response.json({wrong:true}),new Response('x'.repeat(131073))]){
  const p=createBravePublicWebSearchProvider({apiKey:'secret',requestKey:'job',allowanceId:'test',reserve:async()=>true,fetchImpl:async()=>response});
  await assert.rejects(()=>p.search(input),e=>e instanceof Error&&!e.message.includes('secret')&&/BRAVE_|PUBLIC_WEB_SEARCH/.test(e.message));
 }
});
