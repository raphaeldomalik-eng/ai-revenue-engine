import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {storedDirectoryVerifierAcquisition} from '../src/nexus/source-discovery/stored-directory-verifier.ts';
import {acceptVenueEmail} from '../src/nexus/venue-email.ts';
const cases=JSON.parse(readFileSync(new URL('./fixtures/resources-outcome-retained.json',import.meta.url),'utf8'));
const positives=new Set(['Millennium Forum','Glynde Place','The Four Horsemen Pub','High Lodge, Thetford Forest','The Bierkeller Showbar','Old George Inn','Three Cups Inn','STACK Newcastle','Shaw Hall Holiday Park','The Gate','The Eagle','Project 83','St Laurence: Stroud Centre For Peace And The Arts','Warehouse 4 (Gloucester Brewery)']);
for(const fixture of cases)test(`immutable retained website evidence: ${fixture.name}`,()=>{
 const before=JSON.stringify(fixture.cached),result=storedDirectoryVerifierAcquisition(fixture.cached,fixture.request) as any;
 const acquisition=result.evidence.find((e:any)=>e.payload?.firstPassAcquisition)?.payload.firstPassAcquisition;
 if(positives.has(fixture.name)){
  assert(acquisition,JSON.stringify(result.directoryVerification));assert.equal(result.requestId,fixture.request.requestId);assert.equal(result.observedAt,fixture.cached.observedAt);
  assert.equal(result.evidence.find((e:any)=>e.payload?.storedVerifierRecovery)?.payload.storedVerifierRecovery.version,2);
  assert(acquisition.publicContacts.some((c:any)=>c.type==='EMAIL'&&c.reviewRequired===false));
  if(fixture.name==='The Eagle')assert.deepEqual(acquisition.publicContacts.filter((c:any)=>c.type==='EMAIL'&&c.reviewRequired===false).map((c:any)=>c.value),['eagle@castlerockbrewery.co.uk']);
 }else assert.equal(acquisition,undefined,'wrong-property or unsupported identity must remain held');
 assert.equal(JSON.stringify(fixture.cached),before,'the original cached result is immutable');
});
test('a general contact is not the privacy contact because a newsletter Privacy Policy link precedes it',()=>{
 const f=cases.find((c:any)=>c.name.startsWith('St Laurence')),c=f.cached.directoryCrawlReceipt.contactObservations.find((c:any)=>c.value==='office@stroudparishchurches.org.uk');
 assert.equal(acceptVenueEmail(c.value,c.sourceUrl,f.name,c.label).accepted,true);
 assert.equal(acceptVenueEmail('dpo@gmail.com',c.sourceUrl,f.name,'Data protection officer: dpo@gmail.com').accepted,false);
 assert.equal(acceptVenueEmail('person@gmail.com',c.sourceUrl,f.name,'Privacy contact: person@gmail.com').accepted,false);
});
test('a finance and personnel department is retained for review rather than relabelled as an enquiry route',()=>{
 const f=cases.find((c:any)=>c.name==='Millennium Forum'),result=storedDirectoryVerifierAcquisition(f.cached,f.request) as any;
 const c=result.evidence.find((e:any)=>e.payload?.firstPassAcquisition).payload.firstPassAcquisition.publicContacts.find((c:any)=>c.value==='elainemcp@millenniumforum.co.uk');
 assert.equal(c.reviewRequired,true);assert.equal(c.reviewReason,'NON_ENQUIRY_DEPARTMENT');
});

test('retained property conflicts return a versioned held assessment without changing the original decision',()=>{
 const f=structuredClone(cases.find((c:any)=>c.name==='Glynde Place'));
 const address=f.request.researchContext.existingFacts.find((x:any)=>x.fieldName==='formattedAddress');address.value='1 Example Road, London, SW1A 1AA';
 const before=JSON.stringify(f.cached),result=storedDirectoryVerifierAcquisition(f.cached,f.request) as any;
 const recovery=result.evidence.find((e:any)=>e.payload?.storedVerifierRecovery)?.payload.storedVerifierRecovery;
 assert(recovery,'the exact held assessment must survive the cached handoff');assert.equal(recovery.state,'HELD');assert.equal(recovery.newVerification.reason,'ADDRESS_POSTCODE_CONFLICT');
 assert.equal(result.directoryVerification.state,f.cached.directoryVerification.state);assert.equal(JSON.stringify(f.cached),before);assert.equal(recovery.websiteRequests,0);assert.equal(recovery.providerRequests,0);
 assert.equal(result.evidence.some((e:any)=>e.payload?.firstPassAcquisition),false);
});
