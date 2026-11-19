import assert from 'node:assert/strict';
import test from 'node:test';
import {InMemoryNexusResultStore} from '../src/nexus/executor.ts';
import {handleNexusExecuteRequest} from '../src/nexus/http.ts';
import {buildNexusEnvelope} from '../src/nexus/transport.ts';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const now=Date.parse('2026-11-19T12:00:00Z'),secret='communion-test-only';
const source='https://www.communionmusic.co.uk/tickets';
function payload(change:Record<string,unknown>={}){
 return {contractVersion:'nexus.source-discovery-request.v1',discoveryRequestId:'11111111-1111-4111-8111-111111111111',idempotencyKey:'22222222-2222-4222-8222-222222222222',correlationId:'33333333-3333-4333-8333-333333333333',originatingProduct:'last_train_home',subjectReference:{canonicalEntityId:null,candidateReference:{sourceSystem:'last_train_home',sourceRecordId:'communion'},entityType:'ORGANISATION'},verifiedSourceUrl:source,requestedExtractors:['EVENTS'],freshnessRequirements:{maxAgeHours:24},crawlBudget:{maxPages:100,maxRequests:150,maxBytesPerResponse:2_000_000,maxRedirects:5,maxRetries:2,timeoutMs:30_000,minRequestDelayMs:50},existingEvidenceRefs:[],requestedBy:{actorType:'PRODUCT',actorId:'last_train_home'},createdAt:new Date(now).toISOString(),...change};
}
function signed(input=payload(),timestamp=String(now/1000),signature?:string|null){
 const envelope=buildNexusEnvelope(input,secret,timestamp),headers=new Headers({'x-nexus-timestamp':timestamp,'content-type':'application/json'});
 if(signature!==null)headers.set('x-nexus-signature',signature??envelope.signature);
 return new Request('https://aire.example/api/integrations/nexus/execute',{method:'POST',headers,body:envelope.body});
}
const html='<html><body><div class="grid_item event" data-artist="test-band" data-date="2026-11-20"><div class="image_holder"><a class="event_link" href="https://communionmusic.seetickets.com/event/band/garage/123"><img src="/image.jpg" alt="Photo: Test Band"></a></div><div class="text_holder"><p class="date">7:00PM Fri, 20 Nov 2026</p><h2>Test Band</h2><p class="location">The Garage, London</p></div></div><a href="/unrelated">Other page</a></body></html>';
function harness(status=200){
 const store=new InMemoryNexusResultStore(),requests:string[]=[],receipts:unknown[]=[];let reservations=0;
 const reserve=store.reserveBatchRequest.bind(store);
 store.reserveBatchRequest=async value=>{reservations++;assert.equal(value.requestBudget,6);return reserve(value)};
 store.completeBatchRequest=async value=>{receipts.push(value)};
 const options={secret,store,now:()=>now,allowResearch:false,allowSourceDiscovery:false,allowScopedSourceDiscovery:true,allowCommunionEvents:true,sourceDiscoveryOptions:{sleep:async()=>{},resolveHost:async()=>[{address:'93.184.216.34',family:4}],fetchImpl:async(input:RequestInfo|URL)=>{const url=String(input);requests.push(url);assert([source,'https://www.communionmusic.co.uk/robots.txt'].includes(url));return url.endsWith('/robots.txt')?new Response('User-agent: *\nAllow: /'):new Response(html,{status,headers:{'content-type':'text/html'}});}}};
 return {options,requests,receipts,reservations:()=>reservations};
}
async function production(run:()=>Promise<void>){const previous=process.env.VERCEL_ENV;process.env.VERCEL_ENV='production';try{await run()}finally{if(previous===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=previous}}

test('the existing signed LTH Communion request works in Production with one bounded durable execution and replay',async()=>production(async()=>{
 const h=harness(),response=await handleNexusExecuteRequest(signed(),h.options),body=await response.json();
 assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.idempotencyKey,payload().idempotencyKey);
 assert.equal(body.contractVersion,'nexus.source-discovery-result.v1');assert.equal(body.eventCandidates.length,1);
 assert.equal(body.publicContacts.length,0);assert.equal(body.identityFacts.length,0);
 assert.deepEqual(h.requests,['https://www.communionmusic.co.uk/robots.txt',source]);
 assert.equal(h.reservations(),1);assert.equal(h.receipts.length,1);
 const replay=await handleNexusExecuteRequest(signed(),h.options);
 assert.equal(replay.status,200);assert.deepEqual(await replay.json(),body);
 assert.equal(h.requests.length,2);assert.equal(h.reservations(),1);
}));

test('Communion exception stays closed without its specific activation',async()=>production(async()=>{
 const h=harness(),response=await handleNexusExecuteRequest(signed(),{...h.options,allowCommunionEvents:false});
 assert.equal(response.status,404);assert.equal(h.requests.length,0);assert.equal(h.reservations(),0);
}));

test('missing, invalid and stale signatures cannot reserve, read results or crawl',async()=>production(async()=>{
 for(const request of [signed(payload(),undefined,null),signed(payload(),undefined,'sha256='+'0'.repeat(64)),signed(payload(),String(now/1000-301))]){
  const h=harness();h.options.store.get=async()=>{throw Error('Unauthenticated store access')};
  assert.equal((await handleNexusExecuteRequest(request,h.options)).status,401);
  assert.equal(h.reservations(),0);assert.equal(h.requests.length,0);
 }
}));

const denied:Record<string,unknown>[]=[
 {originatingProduct:'event_suite_resources'},
 {subjectReference:{...payload().subjectReference,entityType:'VENUE'}},
 {subjectReference:{...payload().subjectReference,candidateReference:{sourceSystem:'last_train_home',sourceRecordId:'another-promoter'}}},
 ...['https://www.communionmusic.co.uk/','https://www.communionmusic.co.uk/tickets/','https://www.communionmusic.co.uk/tickets?x=1','https://www.communionmusic.co.uk/tickets#x','https://communionmusic.co.uk/tickets','https://www.communionmusic.co.uk:443/tickets','https://www.other.org/tickets'].map(verifiedSourceUrl=>({verifiedSourceUrl})),
 {requestedExtractors:['EVENTS','PUBLIC_CONTACT']},{requestedExtractors:['EVENTS','EVENTS']},{requestedExtractors:['IDENTITY']},{acquisitionGoal:'VENUE_EMAIL'},
 {providerAllowances:['OPENAI']},{costCeiling:{currency:'USD',amount:1}},
 {crawlBudget:{...payload().crawlBudget,maxRequests:151}},
 {crawlBudget:{...payload().crawlBudget,maxBytesPerResponse:2_000_001}},
];
for(const change of denied)test(`Communion admission rejects changed scope ${JSON.stringify(change)}`,async()=>production(async()=>{
 const h=harness(),response=await handleNexusExecuteRequest(signed(payload(change)),h.options);
 assert([403,404,422].includes(response.status),String(response.status));
 assert.equal(h.requests.length,0);assert.equal(h.reservations(),0);assert.equal(h.receipts.length,0);
}));

test('concurrent deliveries cannot execute the Communion request twice',async()=>production(async()=>{
 const h=harness(),responses=await Promise.all([handleNexusExecuteRequest(signed(),h.options),handleNexusExecuteRequest(signed(),h.options)]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(h.requests.length,2);assert.equal(h.receipts.length,1);
}));

test('an altered signed request under the same key cannot replay or reopen the durable execution',async()=>production(async()=>{
 const h=harness();assert.equal((await handleNexusExecuteRequest(signed(),h.options)).status,200);
 assert.equal((await handleNexusExecuteRequest(signed(payload({crawlBudget:{...payload().crawlBudget,maxRequests:149}})),h.options)).status,409);
 assert.equal(h.requests.length,2);
}));

test('a failed Communion crawl retains its reservation and cannot automatically purchase or recrawl',async()=>production(async()=>{
 const h=harness(500),response=await handleNexusExecuteRequest(signed(),h.options),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.crawl.status,'FAILED');assert(h.requests.length<=6);assert.equal(h.receipts.length,1);
 const requests=h.requests.length;assert.equal((await handleNexusExecuteRequest(signed(),h.options)).status,409);assert.equal(h.requests.length,requests);
}));

test('a denied durable reservation prevents all Communion HTTP',async()=>production(async()=>{
 const h=harness();h.options.store.reserveBatchRequest=async()=>false;
 assert.equal((await handleNexusExecuteRequest(signed(),h.options)).status,409);assert.equal(h.requests.length,0);
}));

test('receipt failure cannot turn an unreceipted execution cache into a successful replay',async()=>production(async()=>{
 const h=harness();h.options.store.completeBatchRequest=async()=>{throw Error('Receipt RPC unavailable')};
 assert.equal((await handleNexusExecuteRequest(signed(),h.options)).status,422);
 assert.equal(h.requests.length,2);
 const replay=await handleNexusExecuteRequest(signed(),h.options);
 assert.equal(replay.status,409);assert.equal(h.requests.length,2);
}));

test('actual execute route admits only signed Communion when its separate switch is active',()=>{
 const route=new URL('../app/api/integrations/nexus/execute/route.ts',import.meta.url).href;
 const script=`import assert from 'node:assert/strict';
 import {createHmac} from 'node:crypto';
 import https from 'node:https';import http from 'node:http';import dns from 'node:dns/promises';
 import {syncBuiltinESMExports} from 'node:module';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
 const input=${JSON.stringify(payload())};input.createdAt=new Date().toISOString();
 const results=new Map(),calls=[];
 dns.lookup=async()=>[{address:'93.184.216.34',family:4}];syncBuiltinESMExports();
 http.request=()=>{throw Error('HTTP prohibited')};
 https.request=(options,onResponse)=>{
  assert.equal(options.hostname,'www.communionmusic.co.uk');assert(['/robots.txt','/tickets'].includes(options.path));
  const url='https://'+options.hostname+options.path;calls.push(url);
  const request=new EventEmitter();request.setTimeout=()=>request;request.destroy=()=>{};
  request.end=()=>queueMicrotask(()=>{const response=new PassThrough();response.statusCode=200;response.headers={'content-type':options.path==='/robots.txt'?'text/plain':'text/html'};onResponse(response);response.end(options.path==='/robots.txt'?'User-agent: *\\nAllow: /':${JSON.stringify(html)});});return request;
 };
 globalThis.fetch=async(value,init)=>{
  const url=String(value);calls.push(url);
  if(url.startsWith('https://store.fixture/')){
   const u=new URL(url);
   if(u.pathname.endsWith('/rpc/reserve_nexus_source_discovery_batch_request'))return Response.json({state:'RESERVED'});
   if(u.pathname.endsWith('/rpc/complete_nexus_source_discovery_batch_request'))return Response.json({state:'RECORDED'});
   if(init?.method==='POST'){const row=JSON.parse(init.body);results.set(row.idempotency_key,row.result_payload);return new Response(null,{status:201});}
   const key=u.searchParams.get('idempotency_key')?.replace(/^eq\\./,'');return Response.json(results.has(key)?[{result_payload:results.get(key)}]:[]);
  }
  throw Error('Unexpected network target');
 };
 const {POST}=await import(${JSON.stringify(route)});
 const request=(data,signed=true)=>{const body=JSON.stringify({payload:data}),t=String(Math.floor(Date.now()/1000));return new Request('https://aire.fixture/api/integrations/nexus/execute',{method:'POST',body,headers:{'x-nexus-timestamp':t,...(signed?{'x-nexus-signature':'sha256='+createHmac('sha256','fixture-secret').update(t+'.'+body).digest('hex')}:{})}})};
 assert.equal((await POST(request(input,false))).status,401);assert.equal(calls.length,0);
 assert.equal((await POST(request({...input,verifiedSourceUrl:'https://other.example/'}))).status,404);assert.equal(calls.length,0);
 const response=await POST(request(input));assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
 const result=await response.json();assert.equal(result.contractVersion,'nexus.source-discovery-result.v1');assert.equal(result.eventCandidates.length,1);
 const before=calls.length;assert.equal((await POST(request(input))).status,200);assert.equal(calls.length,before+1);
 assert.equal(calls.filter(url=>url===${JSON.stringify(source)}).length,1);`;
 execFileSync(process.execPath,['--experimental-transform-types','--input-type=module','-e',script],{stdio:'pipe',env:{...process.env,VERCEL_ENV:'production',NEXUS_COMMUNION_EVENTS_ENABLED:'true',NEXUS_EXECUTOR_ENABLED:'true',NEXUS_SOURCE_DISCOVERY_ENABLED:'true',NEXUS_CONTENT_INTERPRETATION_ENABLED:'false',NEXUS_SOURCE_DISCOVERY_BATCH_SCOPE:'',NEXT_PUBLIC_SUPABASE_URL:'https://store.fixture',SUPABASE_SECRET_KEY:'fixture-service-key',NEXUS_HMAC_SECRET:'fixture-secret'}});
});

test('deployed reservation SQL bounds concurrent Communion execution and retains zero-cost receipts',async()=>production(async()=>{
 const db=new PGlite();
 try{
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(readFileSync(new URL('../supabase/migrations/20261021110000_nexus_source_discovery_batch_scopes.sql',import.meta.url),'utf8'));
  const h=harness();h.options.now=()=>Date.now();
  h.options.store.reserveBatchRequest=async r=>{
   const result=await db.query<{result:{state:string}}>('select public.reserve_nexus_source_discovery_batch_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) result',[r.scopeId,r.manifestSha256,r.validFrom,r.validUntil,r.maxVenues,r.maxRequestsPerVenue,r.maxTotalRequests,r.listingId,r.host,r.idempotencyKey,r.requestSha256,r.requestBudget]);
   return result.rows[0].result.state==='RESERVED';
  };
  h.options.store.completeBatchRequest=async r=>{
   const result=await db.query<{result:{state:string}}>('select public.complete_nexus_source_discovery_batch_request($1,$2,$3,$4,$5,$6,$7) result',[r.scopeId,r.listingId,r.idempotencyKey,r.status,r.requestCount,r.bytesRead,r.resultStatus]);
   assert.equal(result.rows[0].result.state,'RECORDED');
  };
  const request=()=>signed(payload(),String(Math.floor(Date.now()/1000)));
  const responses=await Promise.all([handleNexusExecuteRequest(request(),h.options),handleNexusExecuteRequest(request(),h.options)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(h.requests.length,2);
  const rows=(await db.query('select reserved_requests,request_count,provider_cost_usd::text,status from public.nexus_source_discovery_batch_receipts')).rows;
  assert.deepEqual(rows,[{reserved_requests:6,request_count:2,provider_cost_usd:'0.0000',status:'COMPLETED'}]);
  const permissions=(await db.query("select has_function_privilege('anon','public.reserve_nexus_source_discovery_batch_request(uuid,text,timestamptz,timestamptz,integer,integer,integer,uuid,text,uuid,text,integer)','execute') anon_can_reserve")).rows;
  assert.deepEqual(permissions,[{anon_can_reserve:false}]);
 }finally{await db.close()}
}));
