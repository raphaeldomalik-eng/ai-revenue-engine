import test from 'node:test';
import assert from 'node:assert/strict';
import {crawlVerifiedSource,extractFromFetchedDocuments,type CrawlInput} from '../src/nexus/source-discovery/crawler.ts';
import {createPublicWebProvider,withinAcceptedSite} from '../src/nexus/public-web.ts';
import {acceptVenueEmail} from '../src/nexus/venue-email.ts';
import {OriginPoliteness} from '../src/nexus/source-discovery/politeness.ts';

// Minimal regression documents from the owner's 30 October first-party observations.
// They reproduce retrieval boundaries, not full copies of the live websites.
const budget={maxPages:4,maxRequests:8,maxBytesPerResponse:50000,maxRedirects:2,maxRetries:0,timeoutMs:1000,minRequestDelayMs:0};
const resolveHost=async()=>[{address:'93.184.216.34',family:4}];
const html=(body:string)=>new Response('<html><body>'+body+'</body></html>',{headers:{'content-type':'text/html'}});
function input(verifiedUrl:string,fetchImpl:CrawlInput['fetchImpl']):CrawlInput{return{verifiedUrl,budget,requestedExtractors:['PUBLIC_CONTACT'],emailGoal:true,venueName:'Camp and Furnace',resolveHost,fetchImpl,politeness:new OriginPoliteness(),sleep:async()=>{}};}

test('Camp and Furnace: oversized entry falls back to an independently eligible sitemap hire page within the same budget',async()=>{
 const calls:string[]=[];const result=await crawlVerifiedSource(input('https://campandfurnace.com/',async value=>{
  const u=new URL(String(value));calls.push(u.pathname);
  if(u.pathname==='/robots.txt')return new Response('User-agent: *\nAllow: /\nSitemap: https://campandfurnace.com/sitemap.xml');
  if(u.pathname==='/')return new Response('oversized',{headers:{'content-type':'text/html','content-length':'9999999'}});
  if(u.pathname==='/sitemap.xml')return new Response('<urlset><url><loc>https://campandfurnace.com/event-space-hire-liverpool/</loc></url></urlset>',{headers:{'content-type':'application/xml'}});
  if(u.pathname==='/event-space-hire-liverpool/')return html('<h1>Camp and Furnace venue hire Liverpool</h1><p>Venue hire enquiries: greta@campandfurnace.com</p>');
  return new Response('',{status:404});
 }));
 assert.ok(calls.includes('/event-space-hire-liverpool/'),JSON.stringify(result.stats));
 const contacts=extractFromFetchedDocuments(result.documents,['PUBLIC_CONTACT'],'Camp and Furnace').publicContacts;
 assert.ok(contacts.some(c=>c.value==='greta@campandfurnace.com'&&c.sourceUrl.endsWith('/event-space-hire-liverpool/')&&!c.reviewRequired));
 assert.ok(result.stats.requestCount<=budget.maxRequests);assert.ok(result.stats.warnings.some(w=>/size limit/.test(w)));
});

test('Night Owl: independently evidenced apex permits subdomain redirect but no ambient registrable-domain grant',async()=>{
 const run=async(evidenced:boolean)=>{const args=input('https://birmingham.thenightowl.club/',async value=>{
  const u=new URL(String(value));if(u.pathname==='/robots.txt')return new Response('',{status:404});
  if(u.hostname==='birmingham.thenightowl.club')return new Response(null,{status:301,headers:{location:'https://thenightowl.club/venue-hire/'}});
  return html('<h1>The Night Owl Birmingham</h1><a href="mailto:clare@thenightowl.club">Private venue hire</a>');
 });args.venueName='The Night Owl';return crawlVerifiedSource({...args,...(evidenced?{seedUrls:['https://thenightowl.club/venue-hire/']}: {})});};
 const refused=await run(false);assert.equal(refused.stats.status,'BLOCKED');
 const allowed=await run(true);assert.ok(allowed.documents.length);assert.equal(allowed.stats.redirects,1);
 assert.ok(extractFromFetchedDocuments(allowed.documents,['PUBLIC_CONTACT'],'The Night Owl').publicContacts.some(c=>c.value==='clare@thenightowl.club'&&!c.reviewRequired));
});

test('Canteen: linked contact mailto is visited before irrelevant pages and preserves the exact page',async()=>{
 const result=await crawlVerifiedSource({...input('https://canteenbristol.co.uk/',async value=>{
  const u=new URL(String(value));if(u.pathname==='/robots.txt')return new Response('',{status:404});
  if(u.pathname==='/contact-the-canteen-bristol/')return html('<h1>The Canteen Bristol</h1><a href="mailto:hello@canteenbristol.co.uk">General venue enquiries</a>');
  return html('<h1>The Canteen Bristol</h1><a href="/events/">Events</a><a href="/weddings/">Weddings</a><a href="/contact-the-canteen-bristol/">Contact</a>');
 }),venueName:'The Canteen',budget:{...budget,maxPages:2,maxRequests:3}});
 assert.ok(extractFromFetchedDocuments(result.documents,['PUBLIC_CONTACT'],'The Canteen').publicContacts.some(c=>c.value==='hello@canteenbristol.co.uk'&&c.sourceUrl.endsWith('/contact-the-canteen-bristol/')));
});

test('verification provider enables email traversal and records confirmed forms distinctly from links',async()=>{
 const provider=createPublicWebProvider({emailGoal:true,resolveHost,budget:{...budget,maxPages:3,maxRequests:5},fetchImpl:async value=>{
  const u=new URL(String(value));if(u.pathname==='/robots.txt')return new Response('',{status:404});
  if(u.pathname==='/venue-hire/')return html('<h1>Fixture Hall Bristol</h1><p>Hire enquiries hello@fixture.org</p>');
  return html('<h1>Fixture Hall Bristol</h1><p>10 High Street, Bristol BS1 1AA</p><a href="tel:+441171234567">Bookings</a><a href="/venue-hire/">Private hire</a><form id="contact" action="/send"><input name="email"><textarea name="message"></textarea></form>');
 }});
 const request={contractVersion:'nexus.research-request.v1',requestId:'11111111-1111-4111-8111-111111111111',idempotencyKey:'11111111-1111-4111-8111-111111111111',correlationId:'11111111-1111-4111-8111-111111111111',originatingProduct:'event_suite_resources',subject:{canonicalEntityId:null,entityType:'UNKNOWN',candidateReference:{sourceSystem:'event_suite_resources',sourceRecordId:'fixture'}},researchPurpose:'SOURCE_ENTITY_CLASSIFICATION',requestedFactTypes:['officialWebsite'],providerAllowances:['PUBLIC_WEB'],costCeiling:{currency:'USD',amount:0},freshnessRequirements:{maxAgeHours:24},existingEvidenceRefs:[],requestedBy:{actorType:'SYSTEM',actorId:'fixture'},createdAt:'2026-10-30T23:00:00Z',researchContext:{targetName:'Fixture Hall',targetWebsite:'https://fixture.org/',locality:'Bristol'}};
 const result=await provider({request:request as never,context:request.researchContext});
 const p=result.evidence[0]?.payload as {contacts:Array<{type:string;value:string;reviewRequired?:boolean;confidence?:number}>;contactOutcome:string};
 assert.equal(p.contactOutcome,'EMAIL_FOUND');assert.ok(p.contacts.some(c=>c.type==='EMAIL'&&c.value==='hello@fixture.org'));
 assert.ok(p.contacts.some(c=>c.type==='CONTACT_FORM'&&c.reviewRequired===false&&c.confidence===.8));
});

test('press, recruitment and sibling-property contacts are observations, not supported venue enquiry contacts',()=>{
 for(const email of ['press@venue.org','recruitment@venue.org'])assert.equal(acceptVenueEmail(email,'https://venue.org/contact','Fixture Hall','Contact our team').accepted,false,email);
 assert.equal(withinAcceptedSite('https://operatorhotels.org/london-hotel/contact','https://operatorhotels.org/edinburgh-hotel'),false);
 assert.equal(acceptVenueEmail('hello@operatorhotels.org','https://operatorhotels.org/edinburgh-hotel/contact','Edinburgh Hotel','Edinburgh hotel enquiries').accepted,true);
});

test('confirmed forms, phone-only and exhausted contact searches remain distinct; a Contact link alone is not a form',async()=>{
 for(const [markup,expected] of [
  ['<form id="contact"><input name="email"><textarea name="message"></textarea></form>','FORM_ONLY'],
  ['<a href="tel:+441171234567">Venue enquiries</a>','PHONE_ONLY'],
  ['<p>Visit us at 10 High Street, Bristol BS1 1AA.</p>','NO_PUBLIC_CONTACT_FOUND'],
 ] as const){
  const provider=createPublicWebProvider({emailGoal:true,resolveHost,budget,fetchImpl:async value=>new URL(String(value)).pathname==='/'?html('<h1>Fixture Hall Bristol</h1>'+markup):new Response('',{status:404})});
  const request={contractVersion:'nexus.research-request.v1',requestId:'11111111-1111-4111-8111-111111111111',idempotencyKey:'11111111-1111-4111-8111-111111111111',correlationId:'11111111-1111-4111-8111-111111111111',originatingProduct:'event_suite_resources',subject:{canonicalEntityId:null,entityType:'UNKNOWN',candidateReference:{sourceSystem:'event_suite_resources',sourceRecordId:'fixture'}},researchPurpose:'SOURCE_ENTITY_CLASSIFICATION',requestedFactTypes:['officialWebsite'],providerAllowances:['PUBLIC_WEB'],costCeiling:{currency:'USD',amount:0},freshnessRequirements:{maxAgeHours:24},existingEvidenceRefs:[],requestedBy:{actorType:'SYSTEM',actorId:'fixture'},createdAt:'2026-10-30T23:00:00Z',researchContext:{targetName:'Fixture Hall',targetWebsite:'https://fixture.org/',locality:'Bristol'}};
  const result=await provider({request:request as never,context:request.researchContext});
  assert.equal((result.evidence[0]?.payload as {contactOutcome:string}).contactOutcome,expected);
 }
});

test('positive host evidence cannot admit cross-site, shared-platform sibling, private DNS, or exceed a host allowlist',async()=>{
 for(const [origin,seed] of [['https://venue.org/','https://unrelated.org/contact'],['https://one.vercel.app/','https://two.vercel.app/contact']] as const){
  const calls:string[]=[];const result=await crawlVerifiedSource({...input(origin,async value=>{calls.push(String(value));return String(value).endsWith('/robots.txt')?new Response('',{status:404}):new Response(null,{status:301,headers:{location:seed}});}),seedUrls:[seed]});
  assert.equal(result.stats.status,'BLOCKED');assert.ok(!calls.includes(seed));
 }
 const result=await crawlVerifiedSource({...input('https://birmingham.thenightowl.club/',async value=>String(value).endsWith('/robots.txt')?new Response('',{status:404}):new Response(null,{status:301,headers:{location:'https://thenightowl.club/venue-hire/'}})),seedUrls:['https://thenightowl.club/venue-hire/'],resolveHost:async host=>[{address:host==='thenightowl.club'?'127.0.0.1':'93.184.216.34',family:4}]});
 assert.equal(result.documents.length,0);assert.equal(result.stats.status,'BLOCKED');
});

test('a rendered shell cannot spend beyond the total request budget',async()=>{
 let renders=0;const result=await crawlVerifiedSource({...input('https://venue.org/',async value=>String(value).endsWith('/robots.txt')?new Response('',{status:404}):html('<div id="__next"></div><script src="/app.js"></script>')),budget:{...budget,maxRequests:2},renderAdapter:{name:'fixture',render:async()=>{renders++;return{finalUrl:'https://venue.org/',html:'<p>Venue hire: hire@venue.org</p>'};}}});
 assert.equal(renders,0);assert.ok(result.stats.requestCount<=2);assert.ok(result.observability?.renderNeededButUnavailable.length);
});
