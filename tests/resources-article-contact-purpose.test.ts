import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {storedDirectoryVerifierAcquisition} from '../src/nexus/source-discovery/stored-directory-verifier.ts';

const fixtures=JSON.parse(readFileSync(new URL('./fixtures/resources-outcome-retained.json',import.meta.url),'utf8'));
const fixture=fixtures.find((item:any)=>item.name.startsWith('St Laurence'));
const judy='judyburkitthoward@gmail.com',sue='suepowell709@hotmail.com';
function recovered(cached:any){
 const result=storedDirectoryVerifierAcquisition(cached,fixture.request) as any;
 return result.evidence.find((e:any)=>e.payload.firstPassAcquisition).payload.firstPassAcquisition.publicContacts;
}

test('actual bare Article contact remains held while contextual programme and general office enquiries recover',()=>{
 const cached=structuredClone(fixture.cached),before=JSON.stringify(cached);
 const observed=cached.directoryCrawlReceipt.contactObservations.find((c:any)=>c.value===judy);
 const facts=cached.evidence.find((e:any)=>e.payload.kind==='FIRST_PARTY_WEBSITE').payload.identityFacts;
 assert(facts.some((f:any)=>f.sourceUrl===observed.sourceUrl&&f.fieldName==='schemaOrgTypes'&&f.value.includes('Article')),'the retained same page really is an Article');
 assert.equal(observed.label,judy);assert.equal(observed.purpose,'GENERAL');
 const contacts=recovered(cached),held=contacts.find((c:any)=>c.value===judy);
 assert.equal(held.reviewRequired,true);assert.equal(held.reviewReason,'ARTICLE_CONTACT_ENQUIRY_PURPOSE_UNCONFIRMED');
 assert.equal(contacts.find((c:any)=>c.value===sue).reviewRequired,false);
 assert.equal(contacts.find((c:any)=>c.value==='office@stroudparishchurches.org.uk').reviewRequired,false);
 assert.equal(JSON.stringify(cached),before,'original observations remain immutable');
});

test('a child Article contact with its own explicit enquiry context remains usable regardless of email provider',()=>{
 const cached=structuredClone(fixture.cached),c=cached.directoryCrawlReceipt.contactObservations.find((c:any)=>c.value===judy);
 c.label='For enquiries about attending this programme please email '+judy;
 assert.equal(recovered(cached).find((item:any)=>item.value===judy).reviewRequired,false);
});

test('bare official property-root contacts stay usable even when the root has Article schema',()=>{
 const cached=structuredClone(fixture.cached),c=cached.directoryCrawlReceipt.contactObservations.find((c:any)=>c.value===judy),root=fixture.request.researchContext.targetWebsite;
 const page=cached.directoryCrawlReceipt.evidenceManifest.pages.find((p:any)=>p.url===root);
 assert(page);
 c.sourceUrl=root;c.evidenceRef='source:'+page.sourceHash+':contact:root-enquiry';
 cached.evidence.find((e:any)=>e.payload.kind==='FIRST_PARTY_WEBSITE').payload.identityFacts.push({fieldName:'schemaOrgTypes',value:['Article'],sourceUrl:root,evidenceRef:'source:'+page.sourceHash+':identity:root-article'});
 assert.equal(recovered(cached).find((item:any)=>item.value===judy).reviewRequired,false);
});

test('Article classification on a different document cannot hold a bare contact on a non-Article page',()=>{
 const cached=structuredClone(fixture.cached),site=cached.evidence.find((e:any)=>e.payload.kind==='FIRST_PARTY_WEBSITE');
 site.payload.identityFacts=site.payload.identityFacts.map((f:any)=>f.fieldName==='schemaOrgTypes'?{...f,value:f.value.filter((type:string)=>type!=='Article'&&type!=='NewsArticle')}:f);
 const root=fixture.request.researchContext.targetWebsite,page=cached.directoryCrawlReceipt.evidenceManifest.pages.find((p:any)=>p.url===root);
 site.payload.identityFacts.push({fieldName:'schemaOrgTypes',value:['NewsArticle'],sourceUrl:root,evidenceRef:'source:'+page.sourceHash+':identity:other-article'});
 assert.equal(recovered(cached).find((item:any)=>item.value===judy).reviewRequired,false);
});
