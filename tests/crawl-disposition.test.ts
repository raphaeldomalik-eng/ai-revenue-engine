import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {classifyCrawlDisposition} from '../src/nexus/source-discovery/crawl-disposition.ts';
import {crawlVerifiedSource} from '../src/nexus/source-discovery/crawler.ts';
const url='https://venue.example/old';
const sample=(status:number,path=url,extra={}):Parameters<typeof classifyCrawlDisposition>[0]=>({verifiedUrl:url,finalUrl:url,documents:[],stats:{requestCount:2,pageCount:0,warnings:[],status:'FAILED'},observability:{responseManifest:[{url:path,status}],blockedPages:[],redirectChain:[]},...extra});
test('404/410 are page-level terminal recovery leads, never ordinary next-day retry',()=>{
 for(const status of [404,410]){const r=classifyCrawlDisposition(sample(status));assert.equal(r.code,'HTTP_'+status);assert.equal(r.category,'TERMINAL');assert.equal(r.retryable,false);assert.equal(r.businessConclusion,false);}
});
test('a reachable domain plus missing target page is retained separately from domain disappearance',()=>{
 const x=sample(404);x.observability!.responseManifest.unshift({url:'https://venue.example/robots.txt',status:200});
 assert.equal(classifyCrawlDisposition(x).domainReachable,true);
});
test('403 is uncertain access evidence, not a permanent business exclusion; robots remains protected',()=>{
 assert.equal(classifyCrawlDisposition(sample(403)).code,'HTTP_403_ACCESS_UNCERTAIN');
 assert.equal(classifyCrawlDisposition(sample(401)).code,'HTTP_401_AUTH_REQUIRED');
 const x=sample(200);x.observability!.blockedPages=[{url,reason:'ROBOTS_DISALLOW'}];assert.equal(classifyCrawlDisposition(x).code,'ROBOTS_EXCLUDED');
});
test('429 Retry-After is retained as an absolute lower bound even with no in-crawl retries',()=>{
 const x=sample(429);x.stats.diagnostics=[{url,code:'HTTP_429',status:429,observedAt:'2026-11-06T09:00:00Z',retryAfter:'172800',retryNotBefore:'2026-11-08T09:00:00Z'}];
 const r=classifyCrawlDisposition(x);assert.equal(r.retryable,true);assert.equal(r.retryNotBefore,'2026-11-08T09:00:00Z');
});
test('DNS, connection and TLS outcomes use exact diagnostics without inventing NXDOMAIN from ENOTFOUND',()=>{
 for(const [code,wanted,category] of [['DNS_NXDOMAIN','DNS_NXDOMAIN','TERMINAL'],['ENOTFOUND','DNS_NOT_FOUND_UNCONFIRMED','EVIDENCE_HELD'],['EAI_AGAIN','DNS_TEMPORARY','RETRYABLE'],['ETIMEDOUT','CONNECTION_TIMEOUT','RETRYABLE'],['ECONNRESET','CONNECTION_RESET','RETRYABLE'],['CERT_HAS_EXPIRED','TLS_CERTIFICATE_FAILURE','EVIDENCE_HELD']]){
 const x=sample(0);x.observability!.responseManifest=[];x.stats.diagnostics=[{url,code,observedAt:'2026-11-06T09:00:00Z'}];const r=classifyCrawlDisposition(x);assert.equal(r.code,wanted);assert.equal(r.category,category);
 }
});
test('successful retrieval with missing contact evidence is held for evidence, not a technical retry',()=>{
 const x=sample(200);x.stats.status='PARTIAL';x.stats.pageCount=1;x.documents=[{url}];
 assert.equal(classifyCrawlDisposition(x,{identityVerified:true,contactAccepted:false}).code,'NO_USABLE_CONTACT_EVIDENCE');
 assert.equal(classifyCrawlDisposition(x,{identityVerified:true,contactAccepted:false}).retryable,false);
 assert.equal(classifyCrawlDisposition(x,{identityVerified:false}).code,'NO_VENUE_IDENTITY_EVIDENCE');
});
test('5xx is technical retryable; wrong-property and human exclusions stay protected',()=>{
 for(const n of [500,502,503,504])assert.equal(classifyCrawlDisposition(sample(n)).category,'RETRYABLE');
 assert.equal(classifyCrawlDisposition(sample(200),{conflict:'WRONG_PROPERTY'}).code,'WRONG_PROPERTY_CONFLICT');
 assert.equal(classifyCrawlDisposition(sample(200),{humanExcluded:true}).code,'HUMAN_CONFIRMED_EXCLUSION');
});
const budget={maxPages:2,maxRequests:4,maxBytesPerResponse:100000,maxRedirects:2,maxRetries:0,timeoutMs:1000,minRequestDelayMs:0};
test('real crawler: robots403 retains uncertain access status and never fetches the protected page',async()=>{
 const calls:string[]=[];const r=await crawlVerifiedSource({verifiedUrl:url,requestedExtractors:['IDENTITY'],budget,resolveHost:async()=>[{address:'93.184.216.34',family:4}],fetchImpl:async u=>{calls.push(String(u));return new Response('restricted',{status:403});}});
 assert.equal(r.stats.status,'FAILED');assert.equal(r.stats.disposition?.code,'HTTP_403_ACCESS_UNCERTAIN');assert.equal(calls.length,1);assert.equal(r.stats.pageCount,0);
});
test('real crawler: 429 records raw Retry-After and future lower bound without waiting or exceeding budget',async()=>{
 const r=await crawlVerifiedSource({verifiedUrl:url,requestedExtractors:['IDENTITY'],budget,now:()=>new Date('2026-11-06T09:00:00Z'),resolveHost:async()=>[{address:'93.184.216.34',family:4}],fetchImpl:async()=>new Response('',{status:429,headers:{'retry-after':'172800'}})});
 assert.equal(r.stats.disposition?.retryNotBefore,'2026-11-08T09:00:00.000Z');assert.equal(r.stats.diagnostics?.[0]?.retryAfter,'172800');assert.equal(r.stats.requestCount,1);
});
test('real crawler: temporary DNS failure is retryable evidence, not a known blocked website',async()=>{
 const r=await crawlVerifiedSource({verifiedUrl:url,requestedExtractors:['IDENTITY'],budget,resolveHost:async()=>{throw Object.assign(new Error('resolver busy'),{code:'EAI_AGAIN'});},fetchImpl:async()=>{throw Error('must not fetch');}});
 assert.equal(r.stats.disposition?.code,'DNS_TEMPORARY');assert.equal(r.stats.disposition?.retryable,true);assert.equal(r.stats.requestCount,1);assert.equal(r.stats.pageCount,0);
});
test('retained Production receipts distinguish bounded retrieval from a reachable site with insufficient identity evidence',()=>{
 const rows=JSON.parse(fs.readFileSync(new URL('./fixtures/retained-technical-crawl-receipts.json',import.meta.url),'utf8'));
 const before=JSON.stringify(rows);
 const dispositions=rows.map(({crawl:c}:typeof rows[number])=>classifyCrawlDisposition({verifiedUrl:c.finalUrl,finalUrl:c.finalUrl,documents:c.evidenceManifest.pages,stats:c,observability:{responseManifest:c.evidenceManifest.requests,blockedPages:[],redirectChain:[]}},{identityVerified:false}));
 assert.equal(dispositions[0].code,'RETRIEVAL_LIMIT_EVIDENCE_INCOMPLETE');assert.equal(dispositions[1].code,'NO_VENUE_IDENTITY_EVIDENCE');assert(dispositions.every((d:ReturnType<typeof classifyCrawlDisposition>)=>d.retryable===false&&d.businessConclusion===false));assert.equal(JSON.stringify(rows),before);
});

test('absent robots or optional sitemap is never misreported as a missing requested venue page',()=>{
 const c=sample(404,'https://venue.example/robots.txt');c.stats.warnings=['Crawl request budget exhausted'];c.stats.diagnostics=[{url:'https://venue.example/robots.txt',code:'HTTP_404',status:404,observedAt:'2026-11-06T09:00:00Z'}];
 const r=classifyCrawlDisposition(c);assert.equal(r.code,'RETRIEVAL_LIMIT_EVIDENCE_INCOMPLETE');assert.equal(r.httpStatus,null);
});
