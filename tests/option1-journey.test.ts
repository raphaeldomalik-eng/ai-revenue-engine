import test from 'node:test';
import assert from 'node:assert/strict';
import {option1Journey} from './fixtures/option1-journey.ts';
import {handleOrganisationContactRequest} from '../src/ai-sales-team/organisation-contact-http.ts';
import {saveResearchedContact,saveResearchedOpportunity} from '../src/ai-sales-team/research-persistence.ts';

test('non-paying HTTP journey persists through the real Supabase store, reuses portfolio context and preserves commercial state on refresh',async()=>{
  const f=option1Journey(),options={enabled:true,production:false,authorize:async()=>({actor:f.actor,deps:f.deps})};
  const post=async(body:Record<string,unknown>)=>{
    const response=await handleOrganisationContactRequest(new Request('http://localhost/api/ai-sales/contact-research',{method:'POST',body:JSON.stringify(body)}),options);
    const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;
  };
  await post({action:'link',candidateId:'hall',nexusOrganisationId:f.identity.nexusOrganisationId});
  const first=await post({action:'search',candidateId:'hall',provider:'APOLLO_REPLAY'});
  assert.equal(first.record.shortlist.length,1);assert.equal(first.record.shortlist[0].providerPersonId,'buyer-1');
  await post({action:'select',candidateId:'hall',provider:'APOLLO_REPLAY',personId:'buyer-1',revision:first.record.revision});
  const second=await post({action:'search',candidateId:'theatre',provider:'APOLLO_REPLAY'});
  assert.equal(second.record.selections.length,1);assert.equal(f.tables.organisation_contact_intelligence.length,1);
  assert.equal(second.record.identity.venues.length,2);assert.equal(second.commercialAssessment.eventConnection.state,'CONFIRMED');
  const read=await handleOrganisationContactRequest(new Request('http://localhost/api/ai-sales/contact-research?candidateId=hall'),options);
  assert.equal((await read.json()).record.selections[0].sourceMode,'REPLAY');
  for(let repeat=0;repeat<2;repeat++){
    await saveResearchedContact(f.client,'account-1',{name:'Alex Example',role:'New inferred role',kind:'INFERENCE',confidence:'LOW',sourceUrl:null});
    await saveResearchedOpportunity(f.client,{account_id:'account-1',product_id:'product-1',stage:'identified',metadata:{replace:true}});
  }
  assert.deepEqual(f.tables.contacts,[f.contact]);assert.deepEqual(f.tables.product_opportunities,[f.opportunity]);
  assert.equal((f.tables.accounts[0].metadata as Record<string,unknown>).humanDecision,'retain');
  assert.ok(f.requests.every(r=>['accounts','ai_prospect_candidates','contacts','product_opportunities','organisation_contact_intelligence'].includes(r.table)));
  assert.equal(second.record.selections[0].emailReady,false);assert.equal(second.record.selections[0].outreachAuthorised,false);assert.equal(second.record.selections[0].enrichmentAuthorised,false);
});
