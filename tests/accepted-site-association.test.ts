import test from 'node:test';
import assert from 'node:assert/strict';
import {assessWebsiteIdentity} from '../src/nexus/official-website-discovery.ts';
import {withVerifiedNexusOrigin} from '../src/nexus/public-web.ts';
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
