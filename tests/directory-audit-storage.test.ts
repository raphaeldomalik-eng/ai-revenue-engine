import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import type {SupabaseClient} from '@supabase/supabase-js';
import {activeDirectoryAuditConfig,directoryAuditConfigFromEnvironment,directoryAuditKey,prepareDirectoryAudit,DIRECTORY_AUDIT_MAX_STORED_BYTES} from '../src/nexus/source-discovery/directory-audit-capture.ts';
import {InMemoryNexusResultStore} from '../src/nexus/executor.ts';
import {SupabaseDirectoryResultStore} from '../src/nexus/source-discovery/continuous-directory-store.ts';
import {crawlVerifiedSource} from '../src/nexus/source-discovery/crawler.ts';
import type {CrawlOutput} from '../src/nexus/source-discovery/types.ts';
import {OriginPoliteness} from '../src/nexus/source-discovery/politeness.ts';
import {planTerminalUrlBackfill} from '../src/nexus/source-discovery/terminal-url-backfill.ts';
import {validateResearchResult} from '../src/nexus/contracts.ts';

const id='11111111-1111-4111-8111-111111111111',now=Date.parse('2026-11-09T10:00:00Z');
const config={requestId:id,validFrom:'2026-11-09T09:59:00Z',validUntil:'2026-11-09T10:20:00Z'};
const binding={requestId:id,requestSha256:'c'.repeat(64),identityKey:'fixture:venue',queueId:'a'.repeat(64),policySha256:'b'.repeat(64),runId:'22222222-2222-4222-8222-222222222222',attempt:1,reservationKey:'first-reservation'};
const empty=(requests=1):CrawlOutput=>({verifiedUrl:'https://venue.example/',finalUrl:'https://venue.example/',documents:[],stats:{requestCount:requests,pageCount:0,bytesRead:0,redirects:0,blockedCount:0,retries:0,warnings:[],status:'PARTIAL'}});
const raw=(text='original',url='https://venue.example/')=>({url,status:200,contentType:'text/html',contentEncoding:null,bytes:Buffer.from(text)});
async function recorder(clock=()=>now){const store=new InMemoryNexusResultStore();return {store,audit:await prepareDirectoryAudit({config,binding,store:store.privateAuditStore,now:clock})};}
const digest=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');

test('byte ceiling and window expiry omit complete bodies explicitly, never silently truncate or exceed stored-byte bound',async()=>{
 let clock=now;const {store,audit}=await recorder(()=>clock);
 for(let i=0;i<10;i++)audit.sink!.response(raw('x'.repeat(1_000_000),'https://venue.example/'+i));
 clock=Date.parse(config.validUntil);audit.sink!.response(raw('AFTER_WINDOW','https://venue.example/late'));
 const ref=await audit.finish(empty(11)),row=await store.get(ref.receiptKey) as any,corpus=row.directoryAuditCorpus;
 assert.equal(ref.state,'STORED');assert.equal(ref.captureComplete,false);assert.equal(row.storedBytes,Buffer.byteLength(JSON.stringify(row)));assert(row.storedBytes<=DIRECTORY_AUDIT_MAX_STORED_BYTES);
 assert(corpus.responses.some((r:any)=>r.bodyState==='AUDIT_BYTE_CEILING'));assert.equal(corpus.responses.at(-1).bodyState,'CAPTURE_WINDOW_EXPIRED');
 for(const r of corpus.responses){if(r.bodyBase64)assert.equal(Buffer.from(r.bodyBase64,'base64').length,r.bytes);else assert.notEqual(r.bodyState,'CAPTURED');}
 assert(!JSON.stringify(row).includes('AFTER_WINDOW'));
});

test('only MIME/charset and recognized encodings survive response metadata; credential-like URL parameters are redacted but hashed',async()=>{
 const {store,audit}=await recorder();const url='https://venue.example/path?token=SECRET&email=PRIVATE&view=hire#fragment';
 audit.sink!.response({...raw('public',url),contentType:'text/html; charset=UTF-8; token=DO_NOT_RETAIN',contentEncoding:'gzip; secret=DO_NOT_RETAIN'});
 const ref=await audit.finish(empty()),row=await store.get(ref.receiptKey) as any,r=row.directoryAuditCorpus.responses[0];
 assert.equal(r.url,'https://venue.example/path?view=hire');assert.equal(r.urlSha256,digest(url));assert.equal(r.urlRedacted,true);
 assert.equal(r.contentType,'text/html; charset=UTF-8');assert.equal(r.contentEncoding,null);assert(!JSON.stringify(row).includes('DO_NOT_RETAIN'));
});

test('immutable original receipt is reused across later attempts without opening another capture',async()=>{
 const {store,audit}=await recorder();audit.sink!.response(raw());const first=await audit.finish(empty()),original=JSON.stringify(await store.get(first.receiptKey));
 const next=await prepareDirectoryAudit({config,binding:{...binding,attempt:2,runId:null,reservationKey:'second-reservation'},store:store.privateAuditStore,now:()=>now});
 assert.equal(next.sink,undefined);const ref=await next.finish(empty(8));assert.equal(ref.state,'REUSED');assert.equal(ref.auditSha256,first.auditSha256);assert.equal(JSON.stringify(await store.get(ref.receiptKey)),original);
});

test('collision, write uncertainty and readback uncertainty cannot claim a new saved corpus',async()=>{
 const good=await recorder();good.audit.sink!.response(raw());const saved=await good.audit.finish(empty()),receipt=await good.store.get(saved.receiptKey);
 let reads=0,writes=0;
 for(const mode of ['read-error','collision','write-error','readback-error','lost-write','duplicate'] as const){
  reads=0;writes=0;let current:Record<string,unknown>|null=null;
  const store={get:async()=>{reads++;if(mode==='read-error'||mode==='readback-error'&&reads>1)throw Error('storage unavailable');if(mode==='collision')return {...receipt,requestId:id};return current;},set:async(_key:string,value:Record<string,unknown>)=>{writes++;if(mode==='write-error')throw Error('write uncertain');if(mode==='duplicate')current=receipt;else if(mode!=='lost-write')current=value;}};
  const audit=await prepareDirectoryAudit({config,binding,store,now:()=>now});audit.sink?.response(raw('different'));
  const result=await audit.finish(empty());assert.equal(result.state,mode==='duplicate'?'REUSED':'UNAVAILABLE',mode);assert(writes<=1);
  if(mode==='duplicate')assert.equal(result.auditSha256,saved.auditSha256);
  else assert.equal(result.auditSha256,undefined);
 }
});

test('a write whose acknowledgement failed is accepted only when readback verifies the exact immutable receipt',async()=>{
 let current:Record<string,unknown>|null=null,writes=0;
 const audit=await prepareDirectoryAudit({config,binding,store:{get:async()=>current,set:async(_key,row)=>{writes++;current=row;throw Error('acknowledgement lost');}},now:()=>now});
 audit.sink!.response(raw());const ref=await audit.finish(empty());assert.equal(ref.state,'STORED');assert.equal(writes,1);assert(ref.auditSha256);
});

test('real private ledger writer preserves corpus across SQL result replacement and process restart without ordinary request collision',async()=>{
 const db=new PGlite();try{
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(readFileSync(new URL('../supabase/migrations/20260921100000_nexus_executor_results.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20261029042500_resources_directory_store_result_v2_and_run_queue_isolation.sql',import.meta.url),'utf8').split('create or replace function public.reserve_nexus_directory_run_work')[0]!);
  const client={from:(table:string)=>{assert.equal(table,'nexus_executor_results');return {select:()=>({eq:(_column:string,key:string)=>({maybeSingle:async()=>({data:(await db.query('select result_payload from public.nexus_executor_results where idempotency_key=$1',[key])).rows[0]??null,error:null})})}),upsert:async(row:any,options:any)=>{assert.deepEqual(options,{onConflict:'idempotency_key',ignoreDuplicates:true});await db.query('insert into public.nexus_executor_results(idempotency_key,contract_version,request_id,result_payload) values($1,$2,$3,$4) on conflict(idempotency_key) do nothing',[row.idempotency_key,row.contract_version,row.request_id,row.result_payload]);return {error:null};}}},rpc:async(name:string,args:any)=>{assert.equal(name,'store_nexus_directory_result');return {data:(await db.query<{value:unknown}>('select public.store_nexus_directory_result($1,$2) value',[args.p_key,args.p_result])).rows[0]!.value,error:null};}} as unknown as SupabaseClient;
  const store=new SupabaseDirectoryResultStore(client),audit=await prepareDirectoryAudit({config,binding,store:store.privateAuditStore,now:()=>now});audit.sink!.response(raw());const ref=await audit.finish(empty()),original=JSON.stringify(await store.get(ref.receiptKey));
  const result={contractVersion:'nexus.research-result.v1',requestId:id,directoryRequestSha256:'fixture',status:'UNRESOLVED',researchErrors:[{retryable:true}]};await store.set(id,result);await store.set(id,{...result,status:'COMPLETED',researchErrors:[]});
  const restarted=new SupabaseDirectoryResultStore(client);assert.equal(JSON.stringify(await restarted.get(ref.receiptKey)),original);
  const replay=await prepareDirectoryAudit({config,binding,store:restarted.privateAuditStore,now:()=>now});assert.equal(replay.sink,undefined);
  const rows=(await db.query<{request_id:string}>('select request_id from public.nexus_executor_results')).rows;assert.equal(rows.length,2);assert(rows.some(r=>r.request_id===id));assert(rows.some(r=>r.request_id==='directory-audit-receipt:'+id));
  const row=await restarted.get(ref.receiptKey);assert.equal(planTerminalUrlBackfill([row]).candidateObservations,0);assert.throws(()=>validateResearchResult(row),/INVALID_CONTRACT_VERSION/);
 }finally{await db.close();}
});

async function capturedCrawl(routes:Record<string,()=>Response|Promise<Response>>,budgetOverrides:Record<string,number>={}){
 const {store,audit}=await recorder(),calls:string[]=[];
 const crawl=await crawlVerifiedSource({verifiedUrl:'https://venue.example/',requestedExtractors:['IDENTITY','PUBLIC_CONTACT','VENUE_FACTS','IMAGE_CANDIDATES','EVENTS'],budget:{maxPages:4,maxRequests:8,maxBytesPerResponse:1_000_000,maxRedirects:2,maxRetries:0,timeoutMs:100,minRequestDelayMs:0,...budgetOverrides},auditCapture:audit.sink,fetchImpl:async input=>{const url=String(input);calls.push(url);return routes[url]?.()??new Response(null,{status:404});},resolveHost:async()=>[{address:'1.1.1.1',family:4}],politeness:new OriginPoliteness({sleep:async()=>{}}),sleep:async()=>{},now:()=>new Date(now)});
 const ref=await audit.finish(crawl);return {calls,crawl,ref,row:await store.get(ref.receiptKey) as any};
}
const robots=()=>new Response('User-agent: *\nAllow: /\nSitemap: https://venue.example/sitemap.xml',{headers:{'content-type':'text/plain'}});

test('same crawl captures original robots, sitemap, PDF bytes and derived PDF text without parsing away missing content',async()=>{
 const pdf=Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj\n4 0 obj << /Length 60 >> stream\nBT (Venue capacity 250) Tj ET\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF');
 const r=await capturedCrawl({'https://venue.example/robots.txt':robots,'https://venue.example/':()=>new Response('<h1>Venue</h1><a href="/venue-hire.pdf">Venue hire technical brochure</a>',{headers:{'content-type':'text/html'}}),'https://venue.example/venue-hire.pdf':()=>new Response(pdf,{headers:{'content-type':'application/pdf'}}),'https://venue.example/sitemap.xml':()=>new Response('<urlset><url><loc>https://venue.example/contact</loc></url></urlset>',{headers:{'content-type':'application/xml'}})});
 const corpus=r.row.directoryAuditCorpus;assert(corpus.responses.some((v:any)=>v.url.endsWith('/robots.txt')&&v.bodyBase64));assert(corpus.responses.some((v:any)=>v.url.endsWith('/sitemap.xml')&&v.bodyBase64));
 const p=corpus.responses.find((v:any)=>v.url.endsWith('.pdf'));assert(p,JSON.stringify(r.calls));assert.deepEqual(Buffer.from(p.bodyBase64,'base64'),pdf);assert.equal(p.sha256,digest(pdf));assert(corpus.derived.some((v:any)=>v.kind==='PDF_TEXT'));
 assert.equal(corpus.responses.length,r.calls.length);
});

test('terminal and oversize/transport outcomes are explicit gaps without reading404/410 bodies or issuing another fetch',async()=>{
 let bodyReads=0;
 const r=await capturedCrawl({'https://venue.example/robots.txt':robots,'https://venue.example/':()=>{const response=new Response('NEVER_READ',{status:404});response.arrayBuffer=async()=>{bodyReads++;throw Error('terminal body read');};return response;}});
 assert.equal(bodyReads,0);assert.equal(r.calls.filter(v=>v==='https://venue.example/').length,1);assert.equal(r.ref.captureComplete,false);assert(r.row.directoryAuditCorpus.responses.some((v:any)=>v.status===404&&v.bodyState==='TERMINAL_BODY_NOT_READ'&&!v.bodyBase64));
 for(const error of ['oversize','transport']){
  const result=await capturedCrawl({'https://venue.example/robots.txt':robots,'https://venue.example/':()=>{if(error==='transport')throw Error('ECONNRESET');return new Response('not read',{headers:{'content-type':'text/html','content-length':'1000001'}});}});
  assert.equal(result.ref.captureComplete,false);assert(result.row.directoryAuditCorpus.gaps.some((v:any)=>v.reason===(error==='oversize'?'RESPONSE_SIZE_LIMIT':'RESPONSE_UNAVAILABLE')));assert.equal(result.calls.filter(v=>v==='https://venue.example/').length,1);
 }
});

test('server configuration is finite and exact and the real route passes only server environment configuration',()=>{
 const env={NEXUS_DIRECTORY_AUDIT_REQUEST_ID:id,NEXUS_DIRECTORY_AUDIT_VALID_FROM:config.validFrom,NEXUS_DIRECTORY_AUDIT_VALID_UNTIL:config.validUntil};
 assert.deepEqual(activeDirectoryAuditConfig(directoryAuditConfigFromEnvironment(env),id,now),config);assert.equal(activeDirectoryAuditConfig(directoryAuditConfigFromEnvironment({}),id,now),null);
 const route=new URL('../app/api/integrations/nexus/directory-verify/route.ts',import.meta.url).href,verifier=new URL('../src/nexus/source-discovery/continuous-directory-verification.ts',import.meta.url).href,policyModule=new URL('../src/nexus/source-discovery/continuous-directory-policy.ts',import.meta.url).href;
 const script=`import assert from 'node:assert/strict';import {mock} from 'node:test';import {policyHash} from ${JSON.stringify(policyModule)};
 const policy={policyId:'fixture',enabled:true};process.env.NEXUS_DIRECTORY_STANDING_POLICY_ID='fixture';process.env.NEXUS_DIRECTORY_STANDING_POLICY_SHA256=policyHash(policy);process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.supabase.co';process.env.SUPABASE_SECRET_KEY='fixture';process.env.NEXUS_HMAC_SECRET='fixture';
 globalThis.fetch=async input=>{assert(String(input).startsWith('https://fixture.supabase.co/rest/v1/nexus_directory_standing_policy'));return Response.json({policy,policy_sha256:policyHash(policy),enabled:true});};
 mock.module(${JSON.stringify(verifier)},{namedExports:{validatedVerificationContinuation:()=>null,handleDirectoryVerificationRequest:async(_request,options)=>{assert.deepEqual(options.auditCapture,${JSON.stringify(config)});assert(options.store.privateAuditStore);return Response.json({ok:true});}}});
 const {POST}=await import(${JSON.stringify(route)});assert.equal((await POST(new Request('https://fixture.example',{method:'POST',body:JSON.stringify({auditCapture:{requestId:'injected'}})}))).status,200);`;
 execFileSync(process.execPath,['--experimental-transform-types','--experimental-test-module-mocks','--input-type=module','-e',script],{stdio:'pipe',env:{...process.env,...env}});
});

test('same-response hydration is retained separately from original HTML while render and image downloads remain off',async()=>{
 const data={props:{pageProps:{name:'Alpha Hall',description:'Venue hire. '.repeat(60),email:'events@venue.example'}}};
 const shell='<html><head><title>Alpha Hall</title></head><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">'+JSON.stringify(data)+'</script></body></html>';
 const r=await capturedCrawl({'https://venue.example/robots.txt':robots,'https://venue.example/':()=>new Response(shell,{headers:{'content-type':'text/html'}})});
 const original=r.row.directoryAuditCorpus.responses.find((v:any)=>v.url==='https://venue.example/');assert.equal(Buffer.from(original.bodyBase64,'base64').toString(),shell);
 const hydration=r.row.directoryAuditCorpus.derived.find((v:any)=>v.kind==='HYDRATION_MARKUP');assert(hydration);assert(Buffer.from(hydration.bodyBase64,'base64').toString().includes('Alpha Hall'));assert.equal(r.crawl.observability?.renderedPages,0);
});

test('403 and503 response bodies survive privately as error evidence with unchanged refusal behavior',async()=>{
 for(const status of [403,503]){
  const r=await capturedCrawl({'https://venue.example/robots.txt':robots,'https://venue.example/':()=>new Response('ERROR_RESPONSE_'+status,{status,headers:{'content-type':'text/html'}})});
  const response=r.row.directoryAuditCorpus.responses.find((v:any)=>v.status===status);assert(response);assert.equal(Buffer.from(response.bodyBase64,'base64').toString(),'ERROR_RESPONSE_'+status);assert.equal(r.crawl.documents.length,0);assert.notEqual(r.crawl.stats.status,'COMPLETED');
 }
});

test('JSONB key ordering does not invalidate verified persisted audit integrity',async()=>{
 const reorder=(value:any):any=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,v])=>[key,reorder(v)])):value;
 let persisted:Record<string,unknown>|null=null;
 const audit=await prepareDirectoryAudit({config,binding,store:{get:async()=>persisted,set:async(_key,value)=>{persisted=reorder(value);}},now:()=>now});audit.sink!.response(raw());
 const ref=await audit.finish(empty());assert.equal(ref.state,'STORED');assert(ref.auditSha256);
});

test('same request UUID with changed semantic fingerprint cannot reuse an orphaned original corpus',async()=>{
 const {store,audit}=await recorder();audit.sink!.response(raw());const first=await audit.finish(empty()),original=JSON.stringify(await store.get(first.receiptKey));
 const changed=await prepareDirectoryAudit({config,binding:{...binding,requestSha256:'e'.repeat(64)},store:store.privateAuditStore,now:()=>now});
 assert.equal(changed.sink,undefined);const result=await changed.finish(empty());assert.equal(result.state,'UNAVAILABLE');assert.equal(result.reason,'AUDIT_RECEIPT_COLLISION_OR_INVALID');assert.equal(JSON.stringify(await store.get(first.receiptKey)),original);
});

test('credential-like query aliases are redacted without losing the exact original URL hash',async()=>{
 const {store,audit}=await recorder();const url='https://venue.example/?api_key=FIRST&access_key=SECOND&credential=THIRD&apikey=FOURTH&accesskey=FIFTH&view=hire';
 audit.sink!.response(raw('public',url));const ref=await audit.finish(empty()),row=await store.get(ref.receiptKey) as any,r=row.directoryAuditCorpus.responses[0];
 assert.equal(r.url,'https://venue.example/?view=hire');assert.equal(r.urlSha256,digest(url));assert.equal(r.urlRedacted,true);assert(!JSON.stringify(row).includes('FIRST'));assert(!JSON.stringify(row).includes('SECOND'));assert(!JSON.stringify(row).includes('THIRD'));
});

test('quoted and unquoted supported charset metadata both survive without retaining arbitrary header parameters',async()=>{
 for(const contentType of ['text/html; charset="windows-1252"; token=DO_NOT_RETAIN','text/html; charset=windows-1252; token=DO_NOT_RETAIN']){
  const {store,audit}=await recorder();audit.sink!.response({...raw(),contentType});const ref=await audit.finish(empty()),row=await store.get(ref.receiptKey) as any;
  assert.equal(row.directoryAuditCorpus.responses[0].contentType,'text/html; charset=windows-1252');assert(!JSON.stringify(row).includes('DO_NOT_RETAIN'));
 }
});
