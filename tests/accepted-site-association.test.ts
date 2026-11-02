import test from 'node:test';
import assert from 'node:assert/strict';
import {assessWebsiteIdentity} from '../src/nexus/official-website-discovery.ts';
import {withVerifiedNexusOrigin,withinAcceptedSite,createPublicWebProvider} from '../src/nexus/public-web.ts';
import {acceptVenueEmail} from '../src/nexus/venue-email.ts';
const id='11111111-1111-4111-8111-111111111111';
function assess(siteUrl='https://operator.org/hotels/alpha',finalUrl=siteUrl,changes:Record<string,unknown>={},identityFacts=[{fieldName:'siteName',value:'Operator Group',sourceUrl:finalUrl}]){
 const association={candidateReference:{sourceSystem:'event_suite_resources',sourceRecordId:id},siteUrl,basis:'UK_POSTCODE_COHORT',...changes};
 const request={subject:{canonicalEntityId:null,candidateReference:{sourceSystem:'event_suite_resources',sourceRecordId:id}},existingEvidenceRefs:['evidence:accepted'],researchContext:{targetWebsite:siteUrl,locality:'London',existingFacts:[{fieldName:'acceptedWebsiteAssociation',value:association,evidenceRef:'evidence:accepted'}]}};
 return assessWebsiteIdentity({venueName:'Alpha Conference Rooms',country:'GB',heldAddress:'London W1D 7NB',finalUrl,context:withVerifiedNexusOrigin(request as never,request.researchContext),identityFacts});
}
test('an accepted subject-to-site association does not require a second name or location proof',()=>{
 assert.equal(assess().verified,true);
});
test('an accepted association cannot be reused for a sibling venue or sibling hotel path',()=>{
 assert.equal(assess(undefined,undefined,{candidateReference:{sourceSystem:'event_suite_resources',sourceRecordId:'22222222-2222-4222-8222-222222222222'}}).verified,false);
 assert.equal(assess('https://operator.org/hotels/alpha','https://operator.org/hotels/beta').verified,false);
});
test('unreferenced associations and caller-injected derived flags do not establish identity',()=>{
 const request={subject:{canonicalEntityId:null,candidateReference:{sourceSystem:'event_suite_resources',sourceRecordId:id}},existingEvidenceRefs:[],researchContext:{targetWebsite:'https://venue.org/',locality:'London',existingFacts:[{fieldName:'acceptedWebsiteAssociation',value:{candidateReference:{sourceSystem:'event_suite_resources',sourceRecordId:id},siteUrl:'https://venue.org/'},evidenceRef:'missing'},{fieldName:'verifiedWebsiteOriginMatch',value:true,evidenceRef:'forged'}]}};
 const result=assessWebsiteIdentity({venueName:'Alpha Hall',country:'GB',heldAddress:null,finalUrl:'https://venue.org/',context:withVerifiedNexusOrigin(request as never,request.researchContext),identityFacts:[]});assert.equal(result.verified,false);
});
test('off-domain venue contacts pass while a media-only person and another programme do not become venue enquiries',()=>{
 assert.equal(acceptVenueEmail('info@cougarmania.co.uk','https://keighleycougars.uk/','Cougar Park','Cougar Park Keighley info@cougarmania.co.uk').accepted,true);
 assert.equal(acceptVenueEmail('sales@provider.org','https://venue.org/contact/','Alpha Hall','Venue hire enquiries sales@provider.org').accepted,true);
 assert.equal(acceptVenueEmail('kaue@cougarmania.co.uk','https://keighleycougars.uk/contacts','Cougar Park','MEDIA ENQUIRIES Chief Executive Officer: Kaue Garcia kaue@cougarmania.co.uk').accepted,false);
 assert.equal(acceptVenueEmail('info@playpiepint.com','https://oran-mor.co.uk/contact/','Oran Mor','A Play, A Pie and A Pint info@playpiepint.com').accepted,false);
 assert.equal(acceptVenueEmail('info@venue.org','https://venue.org/contact/','Alpha Hall','General enquiries, venue hire and media enquiries info@venue.org').accepted,true);
});

test('official page provenance does not require matching mailbox domains, venue names or role tokens',()=>{
 for(const email of ['margo@gmail.com','sophie@independent-operator.org']){
  assert.equal(acceptVenueEmail(email,'https://operator.org/hotels/site-id-123/contact','Alpha Hall','').accepted,true,email);
  assert.equal(acceptVenueEmail(email,'https://operator.org/london-hotel/contact','Alpha Hall','Margo').accepted,true,'a name absent from the page URL is not a conflict');
 }
 assert.equal(withinAcceptedSite('https://operatorhotels.org/london-hotel/contact','https://operatorhotels.org/edinburgh-hotel'),false,'existing accepted-property scope still excludes a sibling page, without name-token scoring');
 assert.equal(acceptVenueEmail('margo@gmail.com','https://operator.org/london-hotel/contact','Alpha Hall','Parent hotel bookings contact').accepted,true,'a supported parent/operator contact does not have to repeat the contained venue name');
});

test('the existing accepted branch association excludes sibling contacts while preserving an off-domain contact with no name tokens',async()=>{
 const site='https://operator.org/hotels/alpha',ref='accepted:branch',request={contractVersion:'nexus.research-request.v1',requestId:id,idempotencyKey:id,correlationId:id,originatingProduct:'event_suite_resources',subject:{canonicalEntityId:null,entityType:'UNKNOWN',candidateReference:{sourceSystem:'event_suite_resources',sourceRecordId:id}},researchPurpose:'SOURCE_ENTITY_CLASSIFICATION',requestedFactTypes:['officialWebsite'],providerAllowances:['PUBLIC_WEB'],costCeiling:{currency:'USD',amount:0},freshnessRequirements:{maxAgeHours:24},existingEvidenceRefs:[ref],requestedBy:{actorType:'SYSTEM',actorId:'fixture'},createdAt:'2026-11-02T00:00:00Z',researchContext:{targetName:'Alpha Hall',targetWebsite:site,locality:'London',existingFacts:[{fieldName:'acceptedWebsiteAssociation',value:{candidateReference:{sourceSystem:'event_suite_resources',sourceRecordId:id},siteUrl:site,basis:'UK_POSTCODE_COHORT'},evidenceRef:ref}]}};
 const provider=createPublicWebProvider({emailGoal:true,resolveHost:async()=>[{address:'93.184.216.34',family:4}],budget:{maxPages:3,maxRequests:5,maxBytesPerResponse:50000,maxRedirects:2,maxRetries:0,timeoutMs:1000,minRequestDelayMs:0},fetchImpl:async value=>{
  const path=new URL(String(value)).pathname;if(path==='/robots.txt')return new Response('',{status:404});
  const body=path==='/hotels/alpha'?'<h1>Operator Group</h1><a href="/hotels/beta/contact">Contact beta</a><a href="/hotels/alpha/contact">Contact alpha</a>':path==='/hotels/beta/contact'?'<p>Venue enquiries: bookings@beta.org</p>':'<p>margo@gmail.com</p>';
  return new Response('<html><body>'+body+'</body></html>',{headers:{'content-type':'text/html'}});
 }});
 const result=await provider({request:request as never,context:request.researchContext});
 const contacts=(result.evidence.at(-1)?.payload as {contacts:Array<{value:string}>}).contacts;
 assert(contacts.some(c=>c.value==='margo@gmail.com'));assert(!contacts.some(c=>c.value==='bookings@beta.org'));
});
test('a contradictory venue address stays held, while a sibling or authorised operator HQ address does not re-verify venue location',()=>{
 const address={fieldName:'address',value:'Bath BA1 1AA',sourceUrl:'https://operator.org/hotels/alpha'};
 assert.equal(assess(undefined,undefined,{},[address]).verified,false);
 assert.equal(assess(undefined,undefined,{},[{...address,sourceUrl:'https://operator.org/hotels/beta'}]).verified,true);
 assert.equal(assess(undefined,undefined,{operatorName:'Authorised Operator'},[address]).verified,true);
});
test('an accepted canonical site association is bound to that canonical venue, never just its shared address',()=>{
 const request={subject:{canonicalEntityId:id,candidateReference:null},existingEvidenceRefs:['canonical-site'],researchContext:{targetWebsite:'https://venue.org/',locality:'London',existingFacts:[{fieldName:'acceptedWebsiteAssociation',value:{canonicalEntityId:id,siteUrl:'https://venue.org/'},evidenceRef:'canonical-site'}]}};
 const run=()=>assessWebsiteIdentity({venueName:'Alpha',country:'GB',heldAddress:null,finalUrl:'https://venue.org/',context:withVerifiedNexusOrigin(request as never,request.researchContext),identityFacts:[]});
 assert.equal(run().verified,true);request.researchContext.existingFacts[0]!.value.canonicalEntityId='22222222-2222-4222-8222-222222222222';assert.equal(run().verified,false);
});
