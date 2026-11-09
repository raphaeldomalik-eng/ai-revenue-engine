import fs from 'node:fs';
import {createPublicWebProvider} from '../src/nexus/public-web.ts';
import {resultStoreTerminalUrlHistory} from '../src/nexus/source-discovery/terminal-url-history.ts';
import {validateResearchRequest} from '../src/nexus/contracts.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {executeSourceDiscoveryRequest,InMemoryNexusResultStore} from '../src/nexus/executor.ts';
import {CONTRACTS,validateSourceDiscoveryResult} from '../src/nexus/contracts.ts';
import {crawlVerifiedSource} from '../src/nexus/source-discovery/crawler.ts';
import {venueCrawlProfiles,VENUE_EXTRACTORS} from '../src/nexus/source-discovery/venue/profiles.ts';
const budget={maxPages:4,maxRequests:8,maxBytesPerResponse:100000,maxRedirects:2,maxRetries:0,timeoutMs:1000,minRequestDelayMs:0};
const request={contractVersion:CONTRACTS.SOURCE_DISCOVERY_REQUEST,discoveryRequestId:'44444444-4444-4444-8444-444444444444',idempotencyKey:'22222222-2222-4222-8222-222222222222',correlationId:'33333333-3333-4333-8333-333333333333',originatingProduct:'event_suite_resources',subjectReference:{canonicalEntityId:null,candidateReference:{sourceSystem:'event_suite_resources',sourceRecordId:'Bootlegger Brighton'},entityType:'VENUE'},verifiedSourceUrl:'https://uk.tortoisepath.com/place/the-bootlegger-brighton/',venueName:'Bootlegger Brighton',acquisitionGoal:'VENUE_FACTS',requestedExtractors:['IDENTITY','PUBLIC_CONTACT','VENUE_FACTS','IMAGE_CANDIDATES'],freshnessRequirements:{maxAgeHours:24},crawlBudget:budget,existingEvidenceRefs:[],requestedBy:{actorType:'PRODUCT',actorId:'resources'},createdAt:'2026-11-09T00:00:00Z'};
test('known third-party Resources source is refused before DNS/HTTP and contributes no target facts',async()=>{
 let calls=0;
 const result=validateSourceDiscoveryResult(await executeSourceDiscoveryRequest(request,{resolveHost:async()=>{calls++;return[{address:'93.184.216.34',family:4}]},fetchImpl:async()=>{calls++;return new Response('<title>Bootlegger Brighton</title><p>A fine venue.</p>',{headers:{'content-type':'text/html'}})}},new InMemoryNexusResultStore()));
 assert.equal(calls,0);assert.equal(result.crawl.status,'BLOCKED');assert.equal(result.crawl.retryable,false);assert.equal(result.identityFacts.length,0);assert(result.crawl.warnings.some(w=>w.includes('SOURCE_NOT_OFFICIAL')));
});
test('four-page venue budget chooses contact, hire and gallery ahead of news',async()=>{
 const paths:string[]=[];
 const html=(path:string)=>path==='/'?'<html><head><title>Alpha Hall</title></head><body><a href="/news/old-opening">Old news</a><a href="/news/local-area">Local area</a><a href="/contact">Contact</a><a href="/hire">Private hire</a><a href="/gallery">Gallery</a></body></html>':path==='/contact'?'<a href="mailto:bookings@alphahall.co.uk">Venue bookings</a>':path==='/hire'?'<p>Alpha Hall is a restored riverside hall offering flexible spaces for private events.</p><p>Seated capacity 110, licensed bar and on-site parking.</p>':'<img src="/room.jpg" alt="Alpha Hall main room">';
 const crawl=await crawlVerifiedSource({verifiedUrl:'https://alphahall.co.uk/',requestedExtractors:[...VENUE_EXTRACTORS],profiles:venueCrawlProfiles(undefined,{emailGoal:true,venueName:'Alpha Hall',completeContent:true}),emailGoal:true,venueName:'Alpha Hall',budget,resolveHost:async()=>[{address:'93.184.216.34',family:4}],fetchImpl:async input=>{const p=new URL(String(input)).pathname;paths.push(p);return new Response(p==='/robots.txt'?'User-agent: *\nAllow: /':html(p),{headers:{'content-type':p==='/robots.txt'?'text/plain':'text/html'}})}});
 assert.deepEqual(crawl.documents.map(d=>new URL(d.url).pathname).sort(),['/','/contact','/gallery','/hire']);assert(!paths.some(p=>p.startsWith('/news/')));assert(crawl.stats.requestCount<=budget.maxRequests);
});

test('production public-web route wires durable history and provider restart does not repeat 404',async()=>{
 const route=fs.readFileSync(new URL('../app/api/integrations/nexus/execute/route.ts',import.meta.url),'utf8');
 assert.match(route,/createPublicWebProvider\(\{[^}]*terminalUrlHistory:store\.terminalUrlHistory/);
 const store=new InMemoryNexusResultStore();let calls=0;
 const research=validateResearchRequest({contractVersion:CONTRACTS.RESEARCH_REQUEST,requestId:'11111111-1111-4111-8111-111111111111',idempotencyKey:'22222222-2222-4222-8222-222222222222',correlationId:'33333333-3333-4333-8333-333333333333',originatingProduct:'event_suite_resources',subject:{entityType:'VENUE',canonicalEntityId:null,candidateReference:{sourceSystem:'event_suite_resources',sourceRecordId:'Alpha Hall'}},researchPurpose:'PUBLIC_CONTACT',requestedFactTypes:['publicEmail'],providerAllowances:['PUBLIC_WEB'],costCeiling:{currency:'USD',amount:0},freshnessRequirements:{maxAgeHours:24},existingEvidenceRefs:[],requestedBy:{actorType:'SYSTEM',actorId:'fixture'},createdAt:'2026-11-09T00:00:00Z'});
 const options={terminalUrlHistory:resultStoreTerminalUrlHistory(store),budget,resolveHost:async()=>[{address:'93.184.216.34',family:4}],fetchImpl:async()=>{calls++;return new Response('',{status:404})}};
 await createPublicWebProvider(options)({request:research,context:{targetName:'Alpha Hall',targetWebsite:'https://alphahall.co.uk/'}});
 const first=calls;assert(first>0);
 await createPublicWebProvider({...options,terminalUrlHistory:resultStoreTerminalUrlHistory(store)})({request:research,context:{targetName:'Alpha Hall',targetWebsite:'https://alphahall.co.uk/'}});
 assert.equal(calls,first);
});
