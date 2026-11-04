import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {storedDirectoryVerifierAcquisition} from '../src/nexus/source-discovery/stored-directory-verifier.ts';
import {acceptVenueEmail} from '../src/nexus/venue-email.ts';

const cases=JSON.parse(readFileSync(new URL('./fixtures/resources-retained-identity-review.json',import.meta.url),'utf8'));
const accepted=new Set(['Simmons | Soho','Amazing Grace London Bridge','Clapham Grand','53 Degrees','The Half Moon','HOTEL DU VIN WIMBLEDON']);
for(const fixture of cases)test(`original retained source review: ${fixture.name}`,()=>{
 const before=JSON.stringify(fixture.cached),result=storedDirectoryVerifierAcquisition(fixture.cached,fixture.request) as any;
 const payload=result.evidence.find((e:any)=>e.payload?.storedVerifierRecovery)?.payload;
 assert(payload, 'every eligible retained assessment must retain its precise disposition');
 const recovery=payload.storedVerifierRecovery;
 assert.equal(recovery.originalRequestId,fixture.request.requestId);
 assert.equal(recovery.originalObservedAt,fixture.cached.observedAt);
 assert.equal(recovery.websiteRequests,0);assert.equal(recovery.providerRequests,0);
 assert.equal(JSON.stringify(fixture.cached),before);
 if(accepted.has(fixture.name)){
  assert.equal(result.directoryVerification.state,'VERIFIED');
  assert(payload.firstPassAcquisition.publicContacts.some((c:any)=>c.type==='EMAIL'&&!c.reviewRequired));
  if(fixture.name==='HOTEL DU VIN WIMBLEDON')assert(recovery.newVerification.signals.includes('property proof: https://www.hotelduvin.com/locations/wimbledon/'));
  if(fixture.name==='53 Degrees'){
   const account=recovery.contactDecisions.find((c:any)=>c.value==='accounts@53degreesglobal.com');
   assert.equal(account.accepted,false);assert.equal(account.rejectionReason,'NON_ENQUIRY_DEPARTMENT');
  }
 }else{
  assert.equal(recovery.state,'HELD');assert.match(recovery.newVerification.reason,/^[A-Z][A-Z0-9_]+$/);
  assert.equal(payload.firstPassAcquisition,undefined);
  assert.equal(result.directoryVerification.state,fixture.cached.directoryVerification.state);
 }
});

test('an uncorroborated hotel-group root cannot inherit the property proof from an omitted page',()=>{
 const f=structuredClone(cases.find((c:any)=>c.name==='HOTEL DU VIN WIMBLEDON'));
 const keep=(c:any)=>new URL(c.sourceUrl??c.url).pathname==='/';
 f.cached.directoryCrawlReceipt.evidenceManifest.pages=f.cached.directoryCrawlReceipt.evidenceManifest.pages.filter(keep);
 const result=storedDirectoryVerifierAcquisition(f.cached,f.request) as any;
 assert.equal(result.directoryVerification.state,'UNVERIFIED');
 assert.equal(result.evidence.some((e:any)=>e.payload?.firstPassAcquisition),false);
});

test('a mailbox role or off-domain address alone is not a department exclusion',()=>{
 assert.equal(acceptVenueEmail('accounts@independent-mail.co.uk','https://venue.example/contact','A Venue','General enquiries: accounts@independent-mail.co.uk').accepted,true);
});
