import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {createOrganisationContactStore} from '../src/ai-sales-team/organisation-contact-store.ts';
import {readNexusOrganisationResearchIdentity} from '../src/nexus/organisation-research-reference.ts';
import {handleOrganisationContactRequest} from '../src/ai-sales-team/organisation-contact-http.ts';
import {ContactResearchError} from '../src/ai-sales-team/organisation-contact-research.ts';

test('account reference update preserves metadata and rejects a concurrent user change',async()=>{
  let current={owner:'human',decision:'retain'};const before=structuredClone(current);
  const client=createClient('https://db.example','offline',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
    const request=new Request(input,init),url=new URL(request.url);assert.equal(request.method,'PATCH');
    const expected=url.searchParams.get('metadata')?.slice(3);assert.equal(expected,JSON.stringify(before));
    const patch=await request.json();assert.equal(patch.metadata.owner,'human');assert.equal(patch.metadata.decision,'retain');
    current={owner:'new-human',decision:'new-decision'};return new Response('[]',{headers:{'content-type':'application/json'}});
  }}});
  const store=createOrganisationContactStore(client,'actor');
  await assert.rejects(()=>store.linkAccount('account',before,{system:'prestige_nexus',entityType:'ORGANISATION',id:'11111111-1111-4111-8111-111111111111',evidenceRefs:['ref'],linkedBy:'actor',linkedAt:'2026-10-21T00:00:00Z'}),/ACCOUNT_REFERENCE_CONFLICT/);
  assert.equal(current.owner,'new-human');
});
test('stale organisation revision cannot overwrite a saved human selection',async()=>{
  const client=createClient('https://db.example','offline',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
    const request=new Request(input,init),url=new URL(request.url);assert.equal(url.searchParams.get('revision'),'eq.3');assert.equal(request.method,'PATCH');
    return new Response('[]',{headers:{'content-type':'application/json'}});
  }}});
  await assert.rejects(()=>createOrganisationContactStore(client,'actor').save({nexusOrganisationId:'org',identity:{} as never,revision:4,shortlist:[],selections:[],replayFingerprint:null,replayObservedAt:null,createdBy:'actor'},3),/RESEARCH_REVISION_CONFLICT/);
});
test('Nexus reference lookup is read-only and keeps operator, physical venues and legal references distinct',async()=>{
  const org='11111111-1111-4111-8111-111111111111';let calls=0;
  const result=await readNexusOrganisationResearchIdentity({query:async(sql:string,values:unknown[])=>{
    assert.match(sql.trim(),/^select/i);assert.deepEqual(values,[org]);calls++;
    if(sql.includes('canonical_organisation'))return {rows:[{id:org,name:'Example Events',legal_name:'Example Events Limited',domain:'operator.example'}]};
    if(sql.includes('canonical_venue'))return {rows:[{id:'venue-id',name:'Example Hall'}]};
    return {rows:[{provider:'companies_house',id:'12345678'}]};
  }},org);
  assert.equal(calls,3);assert.equal(result?.entityType,'ORGANISATION');assert.equal(result?.venues[0].id,'venue-id');assert.equal(result?.legalCompanies[0].id,'12345678');
});
test('disabled or production request returns before auth, persistence and replay',async()=>{
  let authCalls=0;
  for(const options of [{enabled:false,production:false},{enabled:true,production:true}]){
    const response=await handleOrganisationContactRequest(new Request('https://local/api',{method:'POST',body:'{}'}),{...options,authorize:async()=>{authCalls++;throw Error('must not authenticate');}});
    assert.equal(response.status,503);
  }
  assert.equal(authCalls,0);
});
test('HTTP boundary does not leak persistence details or accept an oversized request',async()=>{
  const options={enabled:true,production:false,authorize:async()=>{throw new ContactResearchError('MEMBER_REQUIRED',403);}};
  const response=await handleOrganisationContactRequest(new Request('https://local/api',{method:'POST',body:'{}'}),options);assert.equal(response.status,403);
  const oversized=await handleOrganisationContactRequest(new Request('https://local/api',{method:'POST',body:'x'.repeat(10000)}),{...options,authorize:async()=>({actor:{id:'a',role:'operator' as const},deps:{} as never})});assert.equal(oversized.status,413);
});
