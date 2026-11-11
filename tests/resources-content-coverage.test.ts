import test from 'node:test';
import assert from 'node:assert/strict';
import {contentCoverage} from '../src/nexus/source-discovery/content-coverage.ts';
import {extractResourcesFromDocuments} from '../src/nexus/source-discovery/extractors/resources.ts';
const document={url:'https://venue.co.uk/hire',body:'<p>A restored hall for private celebrations and public events.</p><p>On-site parking.</p><form action="/send"><input name="email"><textarea name="message"></textarea></form><img src="/hall.jpg" alt="The hall">',sourceHash:'a'.repeat(64),observedAt:'2026-11-09T00:00:00Z',contentType:'text/html',bytes:300};
test('coverage is field-level, evidence-linked and never treats a form as proof no email exists',()=>{
 const extracted={...extractResourcesFromDocuments([document],['IDENTITY','PUBLIC_CONTACT','VENUE_FACTS','IMAGE_CANDIDATES']),eventCandidates:[]};
 const coverage=contentCoverage(extracted,{requestedExtractors:['IDENTITY','PUBLIC_CONTACT','VENUE_FACTS','IMAGE_CANDIDATES'],stopReason:'PAGE_BUDGET'});
 assert.equal(coverage.fields.description.status,'OBSERVED');assert.equal(coverage.fields.parking.status,'OBSERVED');
 assert.equal(coverage.fields.email.status,'BUDGET_LIMITED');assert.equal(coverage.fields.contactForm.status,'OBSERVED');
 assert.equal(coverage.fields.wifi.status,'BUDGET_LIMITED');assert.equal(coverage.fields.events.status,'NOT_REQUESTED');
 assert.equal(coverage.fields.images.status,'REVIEW_REQUIRED');assert(coverage.fields.description.sourceUrls.includes(document.url));assert.equal(coverage.complete,false);
 assert(!JSON.stringify(coverage).includes('NO_EMAIL'));
});
test('not observed means sampled source had no extracted evidence, never confirmed absent',()=>{
 const empty={identityFacts:[],publicContacts:[],venueFacts:[],imageCandidates:[],eventCandidates:[],evidenceRefs:[],warnings:[]};
 const coverage=contentCoverage(empty,{requestedExtractors:['VENUE_FACTS'],stopReason:'NO_GAP_CANDIDATES'});
 assert.equal(coverage.fields.accessibility.status,'NOT_OBSERVED');assert.equal(coverage.fields.email.status,'NOT_REQUESTED');
 assert(coverage.gaps.includes('accessibility'));assert.equal(coverage.complete,false);
});

test('actual heading identity and event review lineage are represented truthfully',()=>{
 const extracted={...extractResourcesFromDocuments([{...document,body:'<h1>Alpha Hall</h1>',url:'https://venue.co.uk/'}],['IDENTITY']),eventCandidates:[{sourcePageUrl:'https://venue.co.uk/calendar.ics',sourceFingerprint:'b'.repeat(64),state:'REVIEW_REQUIRED'}]};
 extracted.evidenceRefs.push('source:'+document.sourceHash+':event:'+'b'.repeat(16));
 const coverage=contentCoverage(extracted,{requestedExtractors:['IDENTITY','EVENTS']});
 assert.equal(coverage.fields.name.status,'OBSERVED');assert.equal(coverage.fields.events.status,'REVIEW_REQUIRED');
 assert.deepEqual(coverage.fields.events.sourceUrls,['https://venue.co.uk/calendar.ics']);assert(coverage.fields.events.evidenceRefs[0]?.endsWith(':event:'+'b'.repeat(16)));
});

test('blocked or never-retrieved pages are not reported as checked absent',()=>{
 const empty={identityFacts:[],publicContacts:[],venueFacts:[],imageCandidates:[],eventCandidates:[],evidenceRefs:[],warnings:[]};
 assert.equal(contentCoverage(empty,{requestedExtractors:['PUBLIC_CONTACT'],retrievalStatus:'BLOCKED',documentCount:0}).fields.email.status,'RETRIEVAL_BLOCKED');
 assert.equal(contentCoverage(empty,{requestedExtractors:['PUBLIC_CONTACT'],retrievalStatus:'FAILED',documentCount:0}).fields.email.status,'NOT_RETRIEVED');
});
