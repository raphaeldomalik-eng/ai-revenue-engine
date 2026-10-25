import test from 'node:test';
import assert from 'node:assert/strict';
import {createGovernedSerperSearch,preferGovernedSearch} from '../src/nexus/search/governed-directory-search.ts';
import {createBravePublicWebSearchProvider,DirectorySearchAllocationDeniedError} from '../src/nexus/search/brave-public-web-search.ts';
const input={query:'Alpha Hall Bristol official website',country:'GB' as const,maxResults:5};

test('Serper reserves durable credit before fetch and reuses shared cached evidence',async()=>{
 const order:string[]=[];let saved:unknown;const rows=new Map();
 const options={apiKey:'fixture',allowanceId:'serper-100',requestKey:'venue-1',
 reserve:async(r:{querySha256:string;parameters:Record<string,string|number>})=>{order.push('reserve');assert.equal(r.parameters.provider,'serper-google-search');return rows.has(r.querySha256)?{state:'CACHED',results:rows.get(r.querySha256),observedAt:new Date().toISOString()}:{state:'RESERVED',reservedMicroUsd:1000};},
 complete:async(r:{querySha256:string},results:unknown)=>{order.push('complete');saved=results;rows.set(r.querySha256,results);},
 fail:async()=>{},fetchImpl:async()=>{order.push('fetch');return Response.json({organic:[{link:'https://alphahall.example/',title:'Alpha Hall'}]});}};
 const provider=createGovernedSerperSearch(options);const result=await provider.search(input);
 assert.deepEqual(order,['reserve','fetch','complete']);assert.deepEqual(saved,result);
 await createGovernedSerperSearch({...options,requestKey:'venue-2'}).search(input);
 assert.deepEqual(order,['reserve','fetch','complete','reserve']);assert.equal(provider.usage?.requests,1);
});

test('denied or uncertain Serper reservations cannot spend or retry',async()=>{
 let calls=0,failed=0,reserved=false;
 const provider=createGovernedSerperSearch({apiKey:'fixture',allowanceId:'serper-100',requestKey:'venue-1',reserve:async()=>{if(reserved)return {state:'DENIED'};reserved=true;return {state:'RESERVED'};},complete:async()=>{},fail:async()=>{failed++;},fetchImpl:async()=>{calls++;throw Error('network');}});
 await assert.rejects(()=>provider.search(input));await assert.rejects(()=>provider.search(input),/BUDGET_EXHAUSTED/);
 assert.equal(calls,1);assert.equal(failed,1);
});

test('Brave is preferred and Serper is used only for a denied allocation or empty result',async()=>{
 const calls:string[]=[];const p=(id:string,result:any)=>({id,costModel:{kind:'ZERO_INCREMENTAL' as const,currency:'USD',amountPerCall:0},async search(){calls.push(id);if(result instanceof Error)throw result;return result;}});
 const result=[{url:'https://alpha.example/'}];
 assert.deepEqual(await preferGovernedSearch(p('brave-web-search',result),p('serper-google-search',[]))!.search(input),result);
 assert.deepEqual(calls,['brave-web-search']);calls.length=0;
 await preferGovernedSearch(p('brave-web-search',new DirectorySearchAllocationDeniedError('ALLOCATION_EXHAUSTED')),p('serper-google-search',result))!.search(input);
 assert.deepEqual(calls,['brave-web-search','serper-google-search']);calls.length=0;
 await assert.rejects(()=>preferGovernedSearch(p('brave-web-search',Error('unknown outcome')),p('serper-google-search',result))!.search(input));
 assert.deepEqual(calls,['brave-web-search']);
});

test('an in-flight or unknown Brave receipt cannot cause a Serper purchase on redelivery',async()=>{
 let calls=0;
 const brave=createBravePublicWebSearchProvider({apiKey:'fixture',allowanceId:'brave',requestKey:'redelivery',reserve:async()=>({state:'DENIED',reason:'IN_FLIGHT_OR_UNKNOWN'}),fetchImpl:async()=>{throw Error('MUST_NOT_FETCH');}});
 const serper={id:'serper-google-search',costModel:{kind:'ZERO_INCREMENTAL' as const,currency:'USD',amountPerCall:0},search:async()=>{calls++;return [];}};
 await assert.rejects(()=>preferGovernedSearch(brave,serper)!.search(input));assert.equal(calls,0);
});

test('Brave per-run cap uses independently reserved Serper credit without a Brave fetch',async()=>{
 let braveFetches=0,serperReservations=0,serperFetches=0;
 const brave=createBravePublicWebSearchProvider({apiKey:'fixture',allowanceId:'brave',requestKey:'run-capped',reserve:async()=>({state:'DENIED',reason:'RUN_PROVIDER_BUDGET'}),fetchImpl:async()=>{braveFetches++;throw Error('MUST_NOT_FETCH');}});
 const serper=createGovernedSerperSearch({apiKey:'fixture',allowanceId:'serper',requestKey:'run-capped',reserve:async()=>{serperReservations++;return {state:'RESERVED'};},complete:async()=>{},fail:async()=>{},fetchImpl:async()=>{serperFetches++;return Response.json({organic:[{link:'https://alpha.example/',title:'Alpha Hall'}]});}});
 const result=await preferGovernedSearch(brave,serper)!.search(input);
 assert.equal(result.length,1);assert.equal(braveFetches,0);assert.equal(serperReservations,1);assert.equal(serperFetches,1);
});
