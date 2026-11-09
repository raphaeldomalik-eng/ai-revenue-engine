import {candidateRejection} from '../src/nexus/venue-email.ts';
import {venueCrawlProfiles} from '../src/nexus/source-discovery/venue/profiles.ts';
import test from 'node:test';import assert from 'node:assert/strict';
import {extractResourcesFromDocuments} from '../src/nexus/source-discovery/extractors/resources.ts';
const document=(body:string)=>({url:'https://venue.co.uk/private-hire',body,sourceHash:'a'.repeat(64),observedAt:'2026-11-09T00:00:00Z',contentType:'text/html',bytes:body.length});
test('rich source body is retained beside thin meta, excluding navigation and forms',()=>{
 const out=extractResourcesFromDocuments([document('<meta name="description" content="Burgers, pizzas, craft beers and more!"><nav><p>Home About Private Hire</p></nav><main><p>The Kitchen Tap offers a tap room, food and live entertainment in Witham.</p><p>Our private hire area can accommodate up to 110 guests.</p></main><form><p>Subscribe to our newsletter.</p></form>')],['IDENTITY']);
 assert(out.identityFacts.some(f=>f.fieldName==='siteDescription'&&String(f.value).includes('live entertainment')));
 assert(!out.identityFacts.some(f=>f.fieldName==='siteDescription'&&/Home About|Subscribe/.test(String(f.value))));
});
test('contact link alone is not an observed form; actual enquiry form and footer email coexist',()=>{
 const out=extractResourcesFromDocuments([document('<a href="/contact">Contact us</a><footer>Email: venue@venue.co.uk</footer>')],['PUBLIC_CONTACT']);
 assert(out.publicContacts.some(c=>c.type==='EMAIL'));assert(!out.publicContacts.some(c=>c.type==='CONTACT_FORM'));
 const form=extractResourcesFromDocuments([document('<form id="enquiry" action="/send"><input name="email"><textarea name="message"></textarea></form><footer>Email: venue@venue.co.uk</footer>')],['PUBLIC_CONTACT']);
 assert(form.publicContacts.some(c=>c.type==='EMAIL'));assert(form.publicContacts.some(c=>c.type==='CONTACT_FORM'&&!c.reviewRequired));
});
test('opening hours and generic hire headings do not become named spaces; explicit capacity survives',()=>{
 const out=extractResourcesFromDocuments([document('<h2>The Tap Room Opening Hours</h2><p>Monday to Friday.</p><h2>Private Hire</h2><p>Our venue accommodates up to 110 guests.</p>')],['VENUE_FACTS']);
 assert(!out.venueFacts.some(f=>f.fieldName==='spaces'&&/Opening Hours|^Private$/.test(String(f.value))));
 assert(out.venueFacts.some(f=>f.fieldName==='capacity'&&(f.value as any).count===110));
});


test('negated practical facts retain the negation and cannot become positive approved amenities',()=>{
 const out=extractResourcesFromDocuments([document('<p>No wheelchair access is available.</p><p>External catering is not permitted.</p><p>There is no on-site parking.</p>')],['VENUE_FACTS']);
 for(const field of ['accessibility','catering','parking']){const f=out.venueFacts.find(f=>f.fieldName===field);assert(f,field);assert.equal(f.reviewRequired,true,field);assert.match(String(f.value),/no|not/i);}
});

test('observed TortoisePath directory is never an official venue website candidate',()=>assert.equal(candidateRejection('https://uk.tortoisepath.com/place/the-bootlegger-brighton/'),'DIRECTORY'));
test('complete venue content keeps individual facility gaps open after two amenities',()=>{
 const profile=venueCrawlProfiles(undefined,{emailGoal:true,venueName:'Alpha Hall',completeContent:true} as any).find(p=>p.extractor==='VENUE_FACTS')!;
 const state:any={};profile.observe(document('<p>On-site parking. Licensed bar.</p>'),{resources:()=>extractResourcesFromDocuments([document('<p>On-site parking. Licensed bar.</p>')],['VENUE_FACTS']),eventCount:()=>0},state,[]);
 assert(profile.dimensions.includes('VENUE_FACTS:wifi'));assert(!profile.satisfied(state).includes('VENUE_FACTS:wifi'));
 assert(profile.linkDimensions('https://venue.co.uk/facilities','Facilities').includes('VENUE_FACTS:wifi'));
});

test('retained source descriptions do not truncate away a late qualification',()=>{
 const text='Alpha Hall has a long history. '+ 'The building retains its historic character. '.repeat(50)+'There is no wheelchair access.';
 const out=extractResourcesFromDocuments([document('<p>'+text+'</p>')],['IDENTITY']);
 assert(out.identityFacts.some(f=>f.fieldName==='siteDescription'&&f.value===text));
});

test('body descriptions exclude interface prompts and sibling venue promotion',()=>{
 const out=extractResourcesFromDocuments([document('<title>Alpha Hall</title><h1>Alpha Hall</h1><meta name="description" content="Alpha Hall is a restored riverside venue."><p>Please select your preferred date.</p><p>Our sister venue Beta Hall offers 300 seats and a licensed bar.</p><p>Beta Hall is a historic hall with 300 seats.</p><p>Alpha Hall is a restored riverside venue with original brickwork.</p>')],['IDENTITY'],'Alpha Hall');
 const descriptions=out.identityFacts.filter(f=>f.fieldName==='siteDescription').map(f=>String(f.value));
 assert(!descriptions.some(v=>/select|Beta Hall/.test(v)),JSON.stringify(descriptions));
 assert(descriptions.some(v=>v.includes('original brickwork')));
});

test('contracted negatives cannot turn into positive accessibility or parking',()=>{
 for(const text of ["We don't provide wheelchair access.","There isn't any on-site parking."]){
  const out=extractResourcesFromDocuments([document('<p>'+text+'</p>')],['VENUE_FACTS']);
  assert(out.venueFacts.length);assert(out.venueFacts.every(f=>f.reviewRequired&&String(f.value).includes(text.slice(0,-1))));
 }
});
test('every governed practical extraction family is actively represented',()=>{
 const examples={accessibility:'Wheelchair access',parking:'On-site parking',publicTransport:'Train station',catering:'In-house catering',bar:'Licensed bar',kitchen:'Commercial kitchen',avProduction:'AV equipment',sound:'Sound system',lighting:'Stage lighting',staging:'Built-in stage',loadingAccess:'Loading bay',wifi:'Wi-Fi',power:'Three-phase power',outdoorSpace:'Garden',accommodation:'On-site accommodation',cloakroom:'Cloakroom',hireSuitability:'Available for weddings'};
 for(const [field,text] of Object.entries(examples)){
  const out=extractResourcesFromDocuments([document('<p>'+text+' available.</p>')],['VENUE_FACTS']);
  assert(out.venueFacts.some(f=>f.fieldName===field),field);
 }
});

test('complete-content technical PDFs still serve missing individual facility needs',()=>{
 const profile=venueCrawlProfiles(undefined,{completeContent:true}).find(p=>p.extractor==='VENUE_FACTS')!;
 assert(profile.pdfDimensions('https://venue.co.uk/technical-accessibility-pack.pdf','Technical and accessibility pack')?.includes('VENUE_FACTS:wifi'));
 assert.equal(profile.pdfDimensions('https://venue.co.uk/menu.pdf','Menu'),null);
});

test('oversized source paragraph is withheld with an observable omission warning',()=>{
 const out=extractResourcesFromDocuments([document('<p>Alpha Hall is a historic venue. '+'The hall has original brickwork. '.repeat(400)+'</p>')],['IDENTITY']);
 assert(!out.identityFacts.some(f=>f.fieldName==='siteDescription'));assert(out.warnings.some(w=>w.includes('exceeded the bounded text payload')));
});

test('description scope follows named local sections and tolerates article/name and character wording',()=>{
 const bad=extractResourcesFromDocuments([document('<title>Alpha Hall</title><h1>Alpha Hall</h1><p>Beta Hall, our riverside venue, offers a licensed bar and private hire.</p><section><h2>Beta Hall</h2><p>A riverside venue offering flexible rooms and private hire.</p></section>')],['IDENTITY'],'Alpha Hall');
 assert(!bad.identityFacts.some(f=>f.fieldName==='siteDescription'));
 for(const [name,title,body] of [['Alpha Hall','Alpha Hall','Built in 1875, it retains original oak beams and overlooks the River Avon.'],['The Kitchen Tap','Private Hire | Kitchen Tap','Our tap room offers food and live entertainment in Witham.']]){
 const out=extractResourcesFromDocuments([document('<title>'+title+'</title><h1>'+title+'</h1><p>'+body+'</p>')],['IDENTITY'],name);
 assert(out.identityFacts.some(f=>f.fieldName==='siteDescription'&&f.value===body),body);
 }
});

test('generic venue section labels do not imply a different named property',()=>{
 for(const heading of ['Venue Hire','About the Venue','Our Venue History']){
  const out=extractResourcesFromDocuments([document('<title>Venue Hire | Alpha Hall</title><h1>'+heading+'</h1><p>Alpha Hall is a restored riverside venue with original oak beams.</p>')],['IDENTITY'],'Alpha Hall');
  assert(out.identityFacts.some(f=>f.fieldName==='siteDescription'),heading);
 }
});

test('privacy policy, terms and partner pages never become non-review venue phone or form contacts',()=>{
 for(const path of ['/privacy-policy','/terms-and-conditions','/our-partners']){
  const out=extractResourcesFromDocuments([{...document('<h1>Data protection requests</h1><a href="tel:+442012345678">Privacy phone</a><form action="/contact"><input name="email"><textarea name="message"></textarea></form>'),url:'https://venue.co.uk'+path}],['PUBLIC_CONTACT']);
  assert(!out.publicContacts.some(c=>c.type==='PHONE'||c.type==='CONTACT_FORM'),path);
 }
});
