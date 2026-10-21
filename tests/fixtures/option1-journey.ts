import {createClient} from '@supabase/supabase-js';
import {isDeepStrictEqual} from 'node:util';
import {createOrganisationContactStore} from '../../src/ai-sales-team/organisation-contact-store.ts';
import {evaluateProspectIntelligence} from '../../src/ai-sales-team/prospect-intelligence.ts';
import type {OrganisationResearchIdentity,OrganisationContactDependencies} from '../../src/ai-sales-team/organisation-contact-research.ts';

/** Synthetic database/provider transport double, not a fixture mode in product code. */
export function option1Journey(){
  const actor={id:'44444444-4444-4444-8444-444444444444',role:'operator' as const};
  const identity:OrganisationResearchIdentity={nexusOrganisationId:'11111111-1111-4111-8111-111111111111',entityType:'ORGANISATION',name:'Example Events',legalName:'Example Events Limited',domain:'operator.example',evidenceRefs:['nexus:verified-organisation'],legalCompanies:[{provider:'companies_house',id:'12345678'}],venues:[{id:'22222222-2222-4222-8222-222222222222',name:'Example Hall',evidenceRef:'nexus:operates:hall'},{id:'33333333-3333-4333-8333-333333333333',name:'Example Theatre',evidenceRef:'nexus:operates:theatre'}]};
  const facts=[{claim:'Example Events organises an upcoming ticketed event programme.',sourceUrl:'https://operator.example/events',sourceTitle:'Official programme',kind:'FACT' as const,confidence:'HIGH' as const,eventFreshness:'ACTIVE_UPCOMING' as const,sourceRoles:['VALIDATION' as const]},{claim:'Event information is fragmented across social channels and a ticket-provider page.',sourceUrl:'https://operator.example/events',sourceTitle:'Programme evidence',kind:'FACT' as const,confidence:'HIGH' as const,eventFreshness:'ACTIVE_UPCOMING' as const,sourceRoles:['COMMERCIAL_EVIDENCE' as const]}];
  const intelligence={...evaluateProspectIntelligence({relationship:'PROSPECT',territory:'GB',facts,inferences:[],identityResolved:true,discoveryLane:'ORGANISATION_FIRST'}),organisationResolution:{status:'RESOLVED',canonicalOrganisationName:'Example Events',officialWebsite:'https://operator.example'}};
  const candidates=identity.venues.map((venue,index)=>({id:index?'theatre':'hall',status:'QUALIFIED',relationship:'PROSPECT',account_id:'account-1',candidate_name:venue.name,organiser_name:identity.name,website:'https://operator.example',origin:'VENUE_FIRST',territory_code:'GB',prospect_intelligence:intelligence,facts,unknowns:[],source_urls:['https://operator.example/events'],created_at:'2026-10-21T10:00:00Z'}));
  const account={id:'account-1',name:identity.name,website:'https://operator.example',metadata:{owner:'retain',humanDecision:'retain'}};
  const contact={id:'contact-1',account_id:'account-1',full_name:'Alex Example',verification_status:'VERIFIED',source:'human',metadata:{provenance:'retain'}};
  const opportunity={id:'opportunity-1',account_id:'account-1',product_id:'product-1',stage:'converted',next_action:'Onboarding',metadata:{humanDecision:'retain'}};
  const tables:Record<string,Record<string,unknown>[]>= {accounts:[structuredClone(account)],ai_prospect_candidates:structuredClone(candidates),contacts:[structuredClone(contact)],product_opportunities:[structuredClone(opportunity)],organisation_contact_intelligence:[]};
  const requests:Array<{table:string;method:string}>=[];
  const client=createClient('https://database.example','offline-key',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
    const request=new Request(input,init),url=new URL(request.url),table=url.pathname.split('/').pop()!;
    requests.push({table,method:request.method});if(!tables[table])throw Error('Unexpected table '+table);
    let matched=tables[table].filter(row=>[...url.searchParams].every(([key,value])=>{
      if(!value.startsWith('eq.'))return true;
      const expected=value.slice(3);return typeof row[key]==='object'?isDeepStrictEqual(row[key],JSON.parse(expected)):String(row[key])===expected;
    }));
    if(request.method==='POST'){
      const body=await request.json(),existing=tables[table].find(row=>body.nexus_organisation_id&&row.nexus_organisation_id===body.nexus_organisation_id);
      if(existing&&request.headers.get('prefer')?.includes('ignore-duplicates'))matched=[existing];
      else {const row={id:'new-record',...body};tables[table].push(row);matched=[row];}
    }else if(request.method==='PATCH'){const body=await request.json();matched.forEach(row=>Object.assign(row,body));}
    else if(request.method!=='GET')throw Error('Unexpected request '+request.method);
    const singular=request.headers.get('accept')?.includes('vnd.pgrst.object');
    return new Response(JSON.stringify(singular?matched[0]:matched),{status:200,headers:{'content-type':'application/json'}});
  }}});
  let replayLoads=0;
  const deps:OrganisationContactDependencies={store:createOrganisationContactStore(client,actor.id),findOrganisation:async()=>structuredClone(identity),now:()=> '2026-10-21T12:00:00Z',loadReplay:async()=>{replayLoads++;return {nexusOrganisationId:identity.nexusOrganisationId,domain:identity.domain,observedAt:'2026-10-21T10:00:00Z',people:[{id:'buyer-1',name:'Alex Example',title:'Event Director',seniority:'director',organization:{name:'Example Events',primary_domain:'operator.example'}},{id:'irrelevant',name:'Casey Example',title:'Dental Assistant',organization:{name:'Example Events',primary_domain:'operator.example'}}]};}};
  return {actor,identity,candidates,account,contact,opportunity,tables,requests,client,deps,get replayLoads(){return replayLoads;}};
}
