import test from 'node:test';
import assert from 'node:assert/strict';
import {executeSourceDiscoveryRequest,InMemoryNexusResultStore} from '../src/nexus/executor.ts';
import {CONTRACTS,validateSourceDiscoveryResult} from '../src/nexus/contracts.ts';
import {acceptVenueEmail} from '../src/nexus/venue-email.ts';

test('current concrete directory contact exclusion survives the existing result contract',async()=>{
 const run=async(verifiedSourceUrl:string,email:string)=>await executeSourceDiscoveryRequest({contractVersion:CONTRACTS.SOURCE_DISCOVERY_REQUEST,discoveryRequestId:'44444444-4444-4444-8444-444444444444',idempotencyKey:'22222222-2222-4222-8222-222222222222',correlationId:'33333333-3333-4333-8333-333333333333',originatingProduct:'event_suite_resources',subjectReference:{canonicalEntityId:null,candidateReference:{sourceSystem:'event_suite_resources',sourceRecordId:'Cape Town Conferences'},entityType:'VENUE'},verifiedSourceUrl,venueName:'Cape Town Conferences',acquisitionGoal:'VENUE_EMAIL',requestedExtractors:['IDENTITY','PUBLIC_CONTACT'],freshnessRequirements:{maxAgeHours:24},crawlBudget:{maxPages:1,maxRequests:4,maxBytesPerResponse:100000,maxRedirects:2,maxRetries:0,timeoutMs:1000,minRequestDelayMs:0},existingEvidenceRefs:[],requestedBy:{actorType:'PRODUCT',actorId:'resources'},createdAt:'2026-11-02T00:00:00Z'},
 {resolveHost:async()=>[{address:'93.184.216.34',family:4}],fetchImpl:async input=>String(input).endsWith('/robots.txt')?new Response('User-agent: *\nAllow: /'):new Response(`<title>Conference Venues SA</title><a href="mailto:${email}">Event enquiries</a>`,{headers:{'content-type':'text/html'}})},new InMemoryNexusResultStore()) as ReturnType<typeof validateSourceDiscoveryResult>;
 const result=await run('https://www.conference-venues.co.za/','info@conference-venues.co.za');
 assert.equal(result.crawl.status,'BLOCKED');
 assert.equal(result.crawl.requestCount,0);
 assert.equal(validateSourceDiscoveryResult(result).publicContacts.length,0);
 assert(result.crawl.warnings.some(w=>w.startsWith('SOURCE_NOT_OFFICIAL:')));
 assert.equal(result.guideEmailReady,false);
 const official=await run('https://official-venue.example/','person@ticketmaster.com');
 assert.equal(official.publicContacts.find(c=>c.type==='EMAIL')?.reviewReason,undefined,'mailbox domain alone cannot become a concrete current attribution exclusion');
});

test('privacy as a venue amenity is not a privacy-officer contact, including off-domain enquiries',()=>{
 assert.equal(acceptVenueEmail('margo@gmail.com','https://estate.example/weddings','Estate','Privacy on a secluded estate. For general enquiries email margo@gmail.com').accepted,true);
 for(const context of ['Privacy officer: privacy@estate.example','Privacy contact: margo@gmail.com','Privacy: margo@gmail.com','Data protection enquiries: margo@gmail.com'])assert.equal(acceptVenueEmail('margo@gmail.com','https://estate.example/contact','Estate',context).accepted,false,context);
});
