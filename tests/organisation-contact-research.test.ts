import test from 'node:test';
import assert from 'node:assert/strict';
import {runOrganisationContactResearch,type OrganisationContactStore,type OrganisationResearchIdentity,type OrganisationResearchRecord} from '../src/ai-sales-team/organisation-contact-research.ts';
import {evaluateProspectIntelligence} from '../src/ai-sales-team/prospect-intelligence.ts';

const orgId='11111111-1111-4111-8111-111111111111';
const identity:OrganisationResearchIdentity={nexusOrganisationId:orgId,entityType:'ORGANISATION',name:'Example Events',legalName:'Example Events Limited',domain:'operator.example',evidenceRefs:['nexus:organisation:'+orgId],legalCompanies:[{provider:'companies_house',id:'12345678'}],venues:[{id:'22222222-2222-4222-8222-222222222222',name:'Example Hall',evidenceRef:'nexus:operator:hall'},{id:'33333333-3333-4333-8333-333333333333',name:'Example Theatre',evidenceRef:'nexus:operator:theatre'}]};
const actor={id:'44444444-4444-4444-8444-444444444444',role:'operator' as const};
function fixture(){
  const assessment=evaluateProspectIntelligence({relationship:'PROSPECT',territory:'GB',facts:[{claim:'Example Events organises an upcoming programme of ticketed events.',sourceUrl:'https://operator.example/events',sourceTitle:'Official programme',kind:'FACT',confidence:'HIGH',eventFreshness:'ACTIVE_UPCOMING'}],inferences:[],identityResolved:true,discoveryLane:'VENUE_FIRST'});
  const candidates=new Map(['hall','theatre'].map((id,index)=>[id,{id,status:'QUALIFIED',relationship:'PROSPECT',account_id:'account-1',candidate_name:identity.venues[index].name,organiser_name:identity.name,website:'https://operator.example',origin:'VENUE_FIRST',prospect_intelligence:{...assessment,eventConnection:{state:'CONFIRMED'},accountCreationEligible:true,organisationResolution:{status:'RESOLVED',canonicalOrganisationName:identity.name,officialWebsite:'https://operator.example'}}}]));
  const account={id:'account-1',name:identity.name,website:'https://operator.example',metadata:{owner:'keep',customerDecision:'keep'} as Record<string,unknown>};
  let record:OrganisationResearchRecord|null=null;let replayLoads=0;let writes=0;
  const store:OrganisationContactStore={
    loadCandidate:async id=>({candidate:candidates.get(id)!,account:structuredClone(account)}),
    linkAccount:async(_id,previous,reference)=>{assert.deepEqual(previous,account.metadata);account.metadata={...account.metadata,nexusResearchReference:reference};},
    read:async()=>record?structuredClone(record):null,
    create:async value=>{record??=structuredClone(value);return structuredClone(record);},
    save:async(value,revision)=>{assert.equal(record?.revision,revision);record=structuredClone(value);writes++;return structuredClone(record);},
  };
  const replay={nexusOrganisationId:orgId,domain:'operator.example',observedAt:'2026-10-21T10:00:00Z',people:[
    {id:'buyer-1',name:'Alex Example',title:'Event Director',organization:{name:'Example Events',primary_domain:'operator.example'}},
    {id:'wrong-employer',name:'Jordan Example',title:'Event Director',organization:{name:'Other Company',primary_domain:'unrelated.example'}},
    {id:'irrelevant',name:'Casey Example',title:'Dental Assistant',organization:{name:'Example Events',primary_domain:'operator.example'}},
  ]};
  const deps={store,findOrganisation:async()=>structuredClone(identity),loadReplay:async()=>{replayLoads++;return structuredClone(replay);},now:()=> '2026-10-21T12:00:00Z'};
  return {deps,account,candidates,replay,get record(){return record;},get replayLoads(){return replayLoads;},get writes(){return writes;}};
}
test('verified operator portfolio → existing assessment → Apollo replay → human selection saves intelligence without contact verification',async()=>{
  const f=fixture();
  await runOrganisationContactResearch({action:'link',candidateId:'hall',nexusOrganisationId:orgId},actor,f.deps);
  const searched=await runOrganisationContactResearch({action:'search',candidateId:'hall',provider:'APOLLO_REPLAY'},actor,f.deps);
  assert.equal(searched.record?.shortlist.length,1);assert.equal(searched.record?.shortlist[0].providerPersonId,'buyer-1');assert.ok(searched.commercialAssessment);
  const saved=await runOrganisationContactResearch({action:'select',candidateId:'hall',provider:'APOLLO_REPLAY',personId:'buyer-1',revision:searched.record!.revision},actor,f.deps);
  assert.equal(saved.record?.selections[0].selectedBy,actor.id);assert.equal(saved.record?.selections[0].emailReady,false);assert.equal(saved.record?.selections[0].sourceMode,'REPLAY');
  assert.equal(f.account.metadata.owner,'keep');assert.equal(f.account.metadata.customerDecision,'keep');
  assert.deepEqual(saved.record?.identity.legalCompanies,[{provider:'companies_house',id:'12345678'}]);assert.equal(saved.record?.identity.venues.length,2);
});
test('two venues reuse one organisation shortlist and never perform venue-specific enrichment',async()=>{
  const f=fixture();await runOrganisationContactResearch({action:'link',candidateId:'hall',nexusOrganisationId:orgId},actor,f.deps);
  const first=await runOrganisationContactResearch({action:'search',candidateId:'hall',provider:'APOLLO_REPLAY'},actor,f.deps);
  const second=await runOrganisationContactResearch({action:'search',candidateId:'theatre',provider:'APOLLO_REPLAY'},actor,f.deps);
  assert.equal(second.record?.nexusOrganisationId,first.record?.nexusOrganisationId);assert.deepEqual(second.record?.shortlist,first.record?.shortlist);assert.equal(f.writes,1);
});
test('no implicit provider or live/paid enrichment path exists',async()=>{
  const f=fixture();await runOrganisationContactResearch({action:'link',candidateId:'hall',nexusOrganisationId:orgId},actor,f.deps);
  for(const provider of [undefined,'APOLLO','OPENAI','APOLLO_ENRICH'])await assert.rejects(()=>runOrganisationContactResearch({action:'search',candidateId:'hall',provider},actor,f.deps),/EXPLICIT_REPLAY_PROVIDER_REQUIRED/);
  assert.equal(f.replayLoads,0);assert.equal(f.writes,0);
});
test('selection cannot forge a person or use a stale shortlist revision',async()=>{
  const f=fixture();await runOrganisationContactResearch({action:'link',candidateId:'hall',nexusOrganisationId:orgId},actor,f.deps);
  const searched=await runOrganisationContactResearch({action:'search',candidateId:'hall',provider:'APOLLO_REPLAY'},actor,f.deps);
  await assert.rejects(()=>runOrganisationContactResearch({action:'select',candidateId:'hall',provider:'APOLLO_REPLAY',personId:'wrong-employer',revision:searched.record!.revision},actor,f.deps),/PERSON_NOT_SELECTABLE/);
  await assert.rejects(()=>runOrganisationContactResearch({action:'select',candidateId:'hall',provider:'APOLLO_REPLAY',personId:'buyer-1',revision:0},actor,f.deps),/RESEARCH_REVISION_CONFLICT/);
  assert.equal(f.record?.selections.length,0);
});
test('blocked prospect and viewer cannot link, search or select',async()=>{
  const f=fixture();f.candidates.get('hall')!.status='BLOCKED';
  await assert.rejects(()=>runOrganisationContactResearch({action:'link',candidateId:'hall',nexusOrganisationId:orgId},actor,f.deps),/CONTACT_RESEARCH_NOT_ELIGIBLE/);
  await assert.rejects(()=>runOrganisationContactResearch({action:'link',candidateId:'theatre',nexusOrganisationId:orgId},{...actor,role:'viewer'},f.deps),/OPERATOR_REQUIRED/);
  assert.equal(f.replayLoads,0);assert.equal(f.record,null);
});
test('canonical organisation cannot be linked through domain alone or to an unrelated venue',async()=>{
  const f=fixture();f.deps.findOrganisation=async()=>({...identity,name:'Unrelated Operator',legalName:null});
  await assert.rejects(()=>runOrganisationContactResearch({action:'link',candidateId:'hall',nexusOrganisationId:orgId},actor,f.deps),/ORGANISATION_IDENTITY_CONFLICT/);
  f.deps.findOrganisation=async()=>({...identity,venues:[]});
  await assert.rejects(()=>runOrganisationContactResearch({action:'link',candidateId:'hall',nexusOrganisationId:orgId},actor,f.deps),/VENUE_OPERATOR_RELATIONSHIP_REQUIRED/);
});
test('misbound or expired replay is rejected before adapter execution',async()=>{
  const f=fixture();await runOrganisationContactResearch({action:'link',candidateId:'hall',nexusOrganisationId:orgId},actor,f.deps);
  f.replay.domain='other.example';await assert.rejects(()=>runOrganisationContactResearch({action:'search',candidateId:'hall',provider:'APOLLO_REPLAY'},actor,f.deps),/REPLAY_IDENTITY_MISMATCH/);
  f.replay.domain='operator.example';f.replay.observedAt='2025-01-01T00:00:00Z';await assert.rejects(()=>runOrganisationContactResearch({action:'search',candidateId:'hall',provider:'APOLLO_REPLAY'},actor,f.deps),/REPLAY_EXPIRED/);
});
test('a refreshed role for the same person requires a new human selection bound to that replay',async()=>{
  const f=fixture();await runOrganisationContactResearch({action:'link',candidateId:'hall',nexusOrganisationId:orgId},actor,f.deps);
  const first=await runOrganisationContactResearch({action:'search',candidateId:'hall',provider:'APOLLO_REPLAY'},actor,f.deps);
  await runOrganisationContactResearch({action:'select',candidateId:'hall',provider:'APOLLO_REPLAY',personId:'buyer-1',revision:first.record!.revision},actor,f.deps);
  f.replay.people[0].title='Operations Director';
  const refreshed=await runOrganisationContactResearch({action:'search',candidateId:'hall',provider:'APOLLO_REPLAY'},actor,f.deps);
  assert.notEqual(refreshed.record!.selections[0].replayFingerprint,refreshed.record!.replayFingerprint);
  const selected=await runOrganisationContactResearch({action:'select',candidateId:'hall',provider:'APOLLO_REPLAY',personId:'buyer-1',revision:refreshed.record!.revision},actor,f.deps);
  assert.equal(selected.record!.selections.length,2);assert.equal(selected.record!.selections[1].person.title,'Operations Director');assert.equal(selected.record!.selections[1].replayFingerprint,selected.record!.replayFingerprint);
});
