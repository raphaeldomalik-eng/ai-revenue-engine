import assert from 'node:assert/strict';
import test from 'node:test';
import {crawlVerifiedSource, extractFromFetchedDocuments} from '../src/nexus/source-discovery/crawler.ts';
import {venueCrawlProfiles} from '../src/nexus/source-discovery/venue/profiles.ts';

const budget={maxPages:4,maxRequests:6,maxBytesPerResponse:100000,maxRedirects:2,maxRetries:0,timeoutMs:1000,minRequestDelayMs:0};
const fixtures=[
 {name:'Mr Fogg’s Pawnbrokers',host:'www.mr-foggs.com',target:'/mr-foggs-pawnbrokers/',label:'Pawnbrokers',email:'pawnbrokers-events@mr-foggs.com',other:'/venue-hire/mr-foggs-market-tavern-venue-hire/'},
 {name:'Boom Battle Bar O2',host:'boombattlebar.com',target:'/uk/theo2/',label:'The O2',email:'o2@boombattlebar.com',other:'/uk/bath/contact/'},
 {name:'Be At One Monument',host:'www.beatone.co.uk',target:'/bars/monument',label:'Monument',email:'enquiries.beatone.monument@stonegategroup.co.uk',other:'/bars/soho/contact'},
 {name:'BrewDog Waterloo',host:'brewdog.com',target:'/pages/bars/waterloo',label:'Waterloo',email:'waterloobookings@brewdog.com',other:'/pages/bars/camden/contact'},
];
for(const venue of fixtures)for(const venueProfiles of [false,true])test(`${venue.name}: actual property link precedes generic and other-property contact pages (${venueProfiles?'venue':'verification'} profiles)`,async()=>{
 const origin=`https://${venue.host}`,calls:string[]=[];
 const result=await crawlVerifiedSource({verifiedUrl:origin+'/',venueName:venue.name,emailGoal:true,requestedExtractors:['IDENTITY','PUBLIC_CONTACT'],budget,
  ...(venueProfiles?{profiles:venueCrawlProfiles(undefined,{venueName:venue.name,emailGoal:true})}:{}),
  resolveHost:async()=>[{address:'93.184.216.34',family:4}],fetchImpl:async input=>{
   const url=new URL(String(input));calls.push(url.pathname);
   if(url.pathname==='/robots.txt')return new Response('User-agent: *\nAllow: /');
   let body='';
   if(url.pathname==='/')body=`<title>Our venues</title><a href="${venue.other}">Venue hire</a><a href="/contact">Contact</a><a href="${venue.target}">${venue.label}</a><a href="mailto:guestservices@${venue.host.replace(/^www\./,'')}">Enquiries</a>`;
   else if(url.pathname===venue.target)body=`<title>${venue.name}</title><a href="${venue.target}/contact">Contact this venue</a>`;
   else if(url.pathname===venue.target+'/contact')body=`<h1>${venue.name}</h1><a href="mailto:${venue.email}">Event enquiries</a>`;
   else body='<h1>Other property</h1><a href="mailto:other@venue.org">Other property events</a>';
   return new Response(body,{headers:{'content-type':'text/html'}});
  }});
 assert.equal(calls[2],venue.target,JSON.stringify(calls));
 assert(calls.includes(venue.target+'/contact'),JSON.stringify(calls));
 const contacts=extractFromFetchedDocuments(result.documents,['PUBLIC_CONTACT'],venue.name).publicContacts;
 assert(contacts.some(c=>c.value===venue.email&&!c.reviewRequired));
 assert(result.stats.requestCount<=6);
});

test('a real bars directory link is traversed before unrelated contact and blog pages',async()=>{
 const calls:string[]=[];const result=await crawlVerifiedSource({verifiedUrl:'https://brewdog.com/',venueName:'BrewDog Waterloo',emailGoal:true,requestedExtractors:['PUBLIC_CONTACT'],budget,
 resolveHost:async()=>[{address:'93.184.216.34',family:4}],fetchImpl:async input=>{
  const path=new URL(String(input)).pathname;calls.push(path);
  if(path==='/robots.txt')return new Response('User-agent: *\nAllow: /');
  const body=path==='/'?'<a href="/pages/contact-us">Contact</a><a href="/pages/bar-locator-1">Our bars</a>':path==='/pages/bar-locator-1'?'<a href="/pages/bars/camden">Camden</a><a href="/pages/bars/waterloo">Waterloo</a>':path==='/pages/bars/waterloo'?'<a href="mailto:waterloobookings@brewdog.com">Waterloo bookings</a>':'<p>No property contact here</p>';
  return new Response(body,{headers:{'content-type':'text/html'}});
 }});
 assert.deepEqual(calls.slice(0,4),['/robots.txt','/','/pages/bar-locator-1','/pages/bars/waterloo']);
 assert(extractFromFetchedDocuments(result.documents,['PUBLIC_CONTACT']).publicContacts.some(c=>c.value==='waterloobookings@brewdog.com'));
});

test('hotel city-directory and exact property meeting form are traversed without inventing an email or form usability',async()=>{
 const calls:string[]=[],target='/london/leonardo-royal-hotel-london-city';
 const result=await crawlVerifiedSource({verifiedUrl:'https://www.leonardohotels.co.uk/',venueName:'Leonardo Royal London City',emailGoal:true,requestedExtractors:['IDENTITY','PUBLIC_CONTACT'],budget,
 resolveHost:async()=>[{address:'93.184.216.34',family:4}],fetchImpl:async input=>{
  const p=new URL(String(input)).pathname;calls.push(p);if(p==='/robots.txt')return new Response('User-agent: *\nAllow: /');
  const body=p==='/'?'<a href="/contact">Contact</a><a href="/blog/visit-esslingen-in-one-day">Visit Esslingen</a><a href="/london">Explore London</a>':p==='/london'?`<a href="/london/royal-tower-bridge">Tower Bridge</a><a href="${target}">Leonardo Royal London City</a>`:p===target?`<a href="${target}/meeting">Meetings</a>`:'<h1>Meetings at Leonardo Royal London City</h1><form action="/enquire"><input name="email" type="email"><input name="event_type"><button>Submit enquiry</button></form>';
  return new Response(body,{headers:{'content-type':'text/html'}});
 }});
 assert(calls.includes(target+'/meeting'),JSON.stringify(calls));assert(!calls.includes('/blog/visit-esslingen-in-one-day'));assert(result.stats.requestCount<=6);
 const contacts=extractFromFetchedDocuments(result.documents,['PUBLIC_CONTACT']).publicContacts;assert(contacts.some(c=>c.type==='CONTACT_FORM'));assert(!contacts.some(c=>c.type==='EMAIL'));
});
