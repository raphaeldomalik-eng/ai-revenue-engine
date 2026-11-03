import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {assessWebsiteIdentity} from '../src/nexus/official-website-discovery.ts';
import {verifyFirstPartyIdentity,withVerifiedNexusOrigin} from '../src/nexus/public-web.ts';
import {acceptVenueEmail} from '../src/nexus/venue-email.ts';

const cases=JSON.parse(readFileSync(new URL('./fixtures/resources-batch3-retained-identity.json',import.meta.url),'utf8'));
const positives=new Set(['Clapham Grand','Amazing Grace London Bridge','The Half Moon']);
for(const c of cases)test(`retained identity: ${c.venue}`,()=>{
 const context=withVerifiedNexusOrigin(c.request,c.request.researchContext);
 const address=context.existingFacts?.find((f:any)=>f.fieldName==='formattedAddress')?.value;
 const heldAddress=typeof address==='string'?address:null;
 const result=assessWebsiteIdentity({venueName:c.venue,country:'GB',heldAddress,context,finalUrl:c.originalUrl,identityFacts:c.facts});
 if(positives.has(c.venue)){
  assert.equal(result.verified,true,JSON.stringify(result));
  assert.equal(verifyFirstPartyIdentity(c.venue,context,c.facts).verified,true,'inner provider and outer verification must agree');
  assert.ok(result.signals.some((s:string)=>/corroborat|property/.test(s)),JSON.stringify(result));
  for(const contact of c.contacts)assert.equal(acceptVenueEmail(contact.value,contact.sourceUrl,c.venue,contact.label).accepted,true);
 }else{
  assert.equal(result.verified,false);
  assert.equal(result.reason,['Boom Battle Bar O2',"Mr Fogg's Pawnbrokers"].includes(c.venue)?'ADDRESS_POSTCODE_CONFLICT':['The Live Room','HOTEL DU VIN WIMBLEDON'].includes(c.venue)?'NAME_ALIGNED_WITHOUT_LOCATION_OR_IDENTITY_PROOF':'NO_SAME_ENTITY_IDENTITY_EVIDENCE');
 }
});
test('a page title cannot borrow its postcode from a different property page',()=>{
 const c=cases.find((c:any)=>c.venue==='The Half Moon');
 const context=withVerifiedNexusOrigin(c.request,c.request.researchContext);
 const facts=c.facts.map((f:any)=>f.fieldName==='address'?{...f,sourceUrl:'https://www.halfmoon.co.uk/other-property/'}:f);
 assert.equal(verifyFirstPartyIdentity(c.venue,context,facts).verified,false);
});
test('the matching property path without its corroborating address is not identity proof',()=>{
 const c=cases.find((c:any)=>c.venue==='Amazing Grace London Bridge');
 const context=withVerifiedNexusOrigin(c.request,c.request.researchContext);
 assert.equal(verifyFirstPartyIdentity(c.venue,context,c.facts.filter((f:any)=>f.fieldName!=='address')).verified,false);
});
test('retained Marriott legal and insurance contacts are excluded even on an accepted operator website',()=>{
 const c=cases.find((c:any)=>c.venue==='LONDON MARRIOTT HOTEL');
 for(const contact of c.contacts.filter((c:any)=>/IPLaw|allianz/i.test(c.value))){
  const result=acceptVenueEmail(contact.value,contact.sourceUrl,c.venue,contact.label);
  assert.equal(result.accepted,false,contact.value);
  assert.equal(result.reason,/IPLaw/i.test(contact.value)?'LEGAL_ONLY_CONTACT':'INSURANCE_PROVIDER_CONTACT');
 }
});
