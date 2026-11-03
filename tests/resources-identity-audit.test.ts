import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {assessWebsiteIdentity,executeOfficialWebsiteDiscovery} from '../src/nexus/official-website-discovery.ts';
import {verifyFirstPartyIdentity,withVerifiedNexusOrigin} from '../src/nexus/public-web.ts';
import {acceptVenueEmail} from '../src/nexus/venue-email.ts';
import {handleDirectoryVerificationRequest} from '../src/nexus/source-discovery/continuous-directory-verification.ts';
import {policyHash} from '../src/nexus/source-discovery/continuous-directory-policy.ts';
import {InMemoryNexusResultStore} from '../src/nexus/executor.ts';
import {nexusSignatureFor} from '../src/nexus/transport.ts';
import {validateOfficialWebsiteDiscoveryResult} from '../src/nexus/contracts.ts';

type Fact={fieldName:string;value:unknown;sourceUrl?:string;evidenceRef?:string};
type Case={venue:string;originalUrl:string;request:Parameters<typeof withVerifiedNexusOrigin>[0];facts:Fact[];contacts:Array<{value:string;sourceUrl:string;label:string}>};
const cases:Case[]=JSON.parse(readFileSync(new URL('./fixtures/resources-identity-audit.json',import.meta.url),'utf8'));
const positives=new Set(['Clapham Grand','Amazing Grace London Bridge','The Half Moon']);
function assess(c:Case,facts=c.facts){
 const context=withVerifiedNexusOrigin(c.request,c.request.researchContext!);
 const address=context.existingFacts?.find(f=>f.fieldName==='formattedAddress')?.value;
 return assessWebsiteIdentity({venueName:c.venue,country:'GB',heldAddress:typeof address==='string'?address:null,context,finalUrl:c.originalUrl,identityFacts:facts});
}
for(const c of cases)test(`retained audit property identity: ${c.venue}`,()=>{
 const result=assess(c);
 assert.equal(result.verified,positives.has(c.venue),JSON.stringify(result));
 if(positives.has(c.venue)){
  assert.equal(verifyFirstPartyIdentity(c.venue,c.request.researchContext!,c.facts).verified,true,'provider and directory verifier must agree');
  assert(result.signals.some(s=>s.startsWith('property proof: https://')),'retain the exact proof URL');
  for(const contact of c.contacts)assert.equal(acceptVenueEmail(contact.value,contact.sourceUrl,c.venue,contact.label).accepted,true,contact.value);
 }
});

test('a title cannot borrow a postcode from another property page, even at the same host',()=>{
 const c=cases.find(c=>c.venue==='The Half Moon')!;
 const facts=c.facts.map(f=>f.fieldName==='address'?{...f,sourceUrl:'https://www.halfmoon.co.uk/other-property/'}:f);
 assert.equal(assess(c,facts).verified,false);
});

test('a branch URL and shortened name require a matching postcode on that page',()=>{
 const c=cases.find(c=>c.venue==='Amazing Grace London Bridge')!;
 assert.equal(assess(c,c.facts.filter(f=>f.fieldName!=='address')).verified,false);
 assert.equal(assess(c,c.facts.map(f=>f.fieldName==='address'?{...f,value:'London SE1 1AA'}:f)).verified,false);
 assert.equal(assess(c,c.facts.map(f=>({...f,sourceUrl:f.sourceUrl?.replace('/contact-london-bridge/','/contact/')}))).verified,false);
});

test('a new property proof cannot use a sibling outside an already accepted branch',()=>{
 const site='https://operator.org/hotels/alpha',ref='accepted:alpha';
 const context=withVerifiedNexusOrigin({subject:{canonicalEntityId:'11111111-1111-4111-8111-111111111111'},existingEvidenceRefs:[ref]} as never,{targetWebsite:site,existingFacts:[{fieldName:'formattedAddress',value:'London SW15 1EU',evidenceRef:ref},{fieldName:'acceptedWebsiteAssociation',value:{canonicalEntityId:'11111111-1111-4111-8111-111111111111',siteUrl:site},evidenceRef:ref}]});
 // Without an accepted association, branch proof is not reusable across pages.
 const unaccepted={...context,existingFacts:context.existingFacts?.filter(f=>f.fieldName!=='verifiedWebsiteOriginMatch')};
 assert.equal(verifyFirstPartyIdentity('The Half Moon',unaccepted,[{fieldName:'pageTitle',value:'The Half Moon Putney',sourceUrl:'https://operator.org/hotels/beta'},{fieldName:'address',value:'Putney SW15 1EU',sourceUrl:'https://operator.org/hotels/beta'}]).verified,false);
});

test('a property title without held address proof cannot turn a group root into branch authority',()=>{
 const c=cases.find(c=>c.venue==='The Half Moon')!;
 assert.equal(verifyFirstPartyIdentity(c.venue,{locality:'London',existingFacts:[]},c.facts).verified,false);
 assert.equal(verifyFirstPartyIdentity('XY',{existingFacts:[{fieldName:'address',value:'London SW15 1EU'}]},[{fieldName:'pageTitle',value:'Unrelated Hotel',sourceUrl:'https://operator.org/'},{fieldName:'address',value:'London SW15 1EU',sourceUrl:'https://operator.org/'}]).verified,false);
});

test('a property proof cannot borrow a title and address from an unrelated origin',()=>{
 const c=cases.find(c=>c.venue==='The Half Moon')!;
 assert.equal(assess(c,c.facts.map(f=>({...f,sourceUrl:'https://unrelated.org/'}))).verified,false);
});

test('an alias URL may supply only a trailing branch qualifier, never the core name',()=>{
 const c=cases.find(c=>c.venue==='Amazing Grace London Bridge')!;
 const facts=[{fieldName:'pageTitle',value:'London Bridge Bar',sourceUrl:'https://amazinggraceldn.com/amazing-grace/'},{fieldName:'address',value:'9A St Thomas Street, London SE1 9RY',sourceUrl:'https://amazinggraceldn.com/amazing-grace/'}];
 assert.equal(assess(c,facts).verified,false);
});

test('official off-domain enquiries remain valid while recruitment and privacy addresses remain excluded',()=>{
 assert.equal(acceptVenueEmail('halfmoon@youngs.co.uk','https://www.halfmoon.co.uk/','The Half Moon','General enquiries').accepted,true);
 for(const value of ['careers@youngs.co.uk','recruitment@youngs.co.uk','privacy@youngs.co.uk'])assert.equal(acceptVenueEmail(value,'https://www.halfmoon.co.uk/','The Half Moon',value.startsWith('privacy')?'Privacy officer':'Recruitment only').accepted,false);
 // The retained ambiguous Marriott root remains unverified, so none of its
 // unrelated legal, recruitment or insurance observations gain site authority.
 const marriott=cases.find(c=>c.venue==='LONDON MARRIOTT HOTEL')!;
 assert.equal(assess(marriott).verified,false);
});

// Reconstruct minimal HTML from retained facts, not a live recrawl or a claim
// that these are the original page bytes. Run the real extractor and signed
// directory handler with the original subject, source lineage and HTTP ceiling.
const escape=(value:unknown)=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
for(const c of cases.filter(c=>positives.has(c.venue)))test(`signed first-pass identity and contact handoff: ${c.venue}`,async()=>{
 const now=Date.parse('2026-11-03T00:00:00Z'),secret='identity-regression-only';
 const policy={policyId:'identity-regression',version:2,enabled:true,quotaMode:'PER_RUN' as const,actions:['VERIFY_WEBSITE'],validFrom:'2026-01-01T00:00:00Z',validUntil:'2027-01-01T00:00:00Z',countries:['GB'],maxVenuesPerRun:3,maxRequestsPerRun:18,maxRequestsPerVenue:6,maxBatchVenues:3,paidProviderBudgetUsd:0,minHostDelayMs:1000,freshnessHours:720,maxAttempts:3,retryBackoffHours:24,stopAfterConsecutiveFailures:5,publicationAllowed:false,outreachAllowed:false};
 const original=c.request as typeof c.request&{directoryContext:Record<string,unknown>};
 const directoryContext:Record<string,unknown>={...original.directoryContext,policyId:policy.policyId,policySha256:policyHash(policy),runId:'11111111-1111-4111-8111-111111111111'};
 const pages=new Map<string,string>();
 const urls=[...new Set(c.facts.map(f=>f.sourceUrl).filter((url):url is string=>Boolean(url)))];
 for(const url of urls){
  const facts=c.facts.filter(f=>f.sourceUrl===url),value=(field:string)=>facts.find(f=>f.fieldName===field)?.value;
  const schema={"@type":"Organization",name:value('siteName'),address:value('address')};
  const contacts=c.contacts.filter(contact=>contact.sourceUrl===url).map(contact=>`<p>General enquiries <a href="mailto:${escape(contact.value)}">${escape(contact.value)}</a></p>`).join('');
  const links=urls.filter(other=>other!==url).map(other=>`<a href="${escape(other)}">Venue contact and private hire</a>`).join('');
  pages.set(url,`<html><head><title>${escape(value('pageTitle'))}</title><script type="application/ld+json">${JSON.stringify(schema)}</script></head><body>${value('explicitVenueName')?`<h1>${escape(value('explicitVenueName'))}</h1>`:''}${contacts}${links}</body></html>`);
 }
 let requests=0,reservations=0;
 const options={policy,approvedPolicyHash:policyHash(policy),secret,store:new InMemoryNexusResultStore(),now:()=>now,resolveHost:async()=>[{address:'93.184.216.34',family:4}],ledger:{reserve:async()=>{reservations++;return true},complete:async()=>{}},fetchImpl:async(input:RequestInfo|URL)=>{
  requests++;const url=String(input);
  if(new URL(url).pathname==='/robots.txt')return new Response('',{status:404});
  if(c.venue==='The Half Moon'&&new URL(url).hostname==='halfmoon.co.uk')return new Response(null,{status:301,headers:{location:'https://www.halfmoon.co.uk/'}});
  return new Response(pages.get(url)??'',{status:pages.has(url)?200:404,headers:{'content-type':'text/html'}});
 }};
 const request=()=>{const body=JSON.stringify({payload:c.request,directoryContext}),timestamp=String(now/1000);return new Request('https://aire.example/api/integrations/nexus/directory-verify',{method:'POST',headers:{'x-nexus-timestamp':timestamp,'x-nexus-signature':nexusSignatureFor(timestamp,body,secret)},body});};
 const response=await handleDirectoryVerificationRequest(request(),options),body=await response.json();
 assert.equal(response.status,200,JSON.stringify(body));
 assert.equal(body.verification.state,'VERIFIED',JSON.stringify(body));
 const payload=body.result.evidence.find((e:{payload:{firstPassAcquisition?:unknown}})=>e.payload.firstPassAcquisition)?.payload;
 assert(payload?.firstPassAcquisition,'the same verified crawl must reach the existing handoff');
 assert.equal(payload.directoryVerification.canonicalIdentityEstablished,false);
 for(const contact of c.contacts)assert(payload.firstPassAcquisition.publicContacts.some((found:{value:string;reviewRequired:boolean})=>found.value===contact.value&&!found.reviewRequired),contact.value);
 assert(body.result.facts.every((f:{subjectEntityType:string})=>f.subjectEntityType==='UNKNOWN'));
 assert(requests<=Number(directoryContext.requestBudget),'keep the original signed HTTP ceiling');
 assert.equal(reservations,1);
 const before=requests,replay=await handleDirectoryVerificationRequest(request(),options),replayed=await replay.json();
 assert.equal(replay.status,200);assert.equal(replayed.receipt.actualHttpRequestsKnown,0);
 assert.equal(requests,before);assert.equal(reservations,1);
 const heldAddress=c.request.researchContext!.existingFacts!.find(f=>f.fieldName==='formattedAddress')!.value;
 const discovered=validateOfficialWebsiteDiscoveryResult(await executeOfficialWebsiteDiscovery({...c.request,contractVersion:'aire.official-website-discovery-request.v1',subject:{...c.request.subject,entityType:'VENUE'},identity:{venueName:c.venue,locality:'London',country:'GB',formattedAddress:heldAddress},heldEvidence:{resources:{website:c.originalUrl,evidenceRef:'retained:audit-source'}},providerAllowances:['PUBLIC_WEB']},{fetchImpl:options.fetchImpl,resolveHost:options.resolveHost,now:()=>new Date(now).toISOString()}));
 assert.equal(discovered.guideEmailReady,true,JSON.stringify(discovered));
 assert(discovered.officialWebsite?.verificationSignals.some(signal=>signal.startsWith('property proof:')));
 for(const contact of c.contacts)assert(discovered.publicContacts.some(found=>found.value===contact.value));
});
