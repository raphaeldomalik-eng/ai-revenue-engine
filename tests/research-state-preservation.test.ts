import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {saveResearchedContact,saveResearchedOpportunity} from '../src/ai-sales-team/research-persistence.ts';

// Real PostgREST client against a local response double; no remote database.
function database(table:string,initial:Record<string,unknown>[]){
  const rows=structuredClone(initial);const methods:string[]=[];
  const client=createClient('https://database.example','offline-key',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
    const request=new Request(input,init),url=new URL(request.url);assert.equal(url.pathname,`/rest/v1/${table}`);methods.push(request.method);
    const matches=rows.filter(row=>[...url.searchParams].every(([key,value])=>!value.startsWith('eq.')||String(row[key])===value.slice(3)));
    let result=matches;
    if(request.method==='PATCH'){const value=await request.json();matches.forEach(row=>Object.assign(row,value));}
    if(request.method==='POST'){const value=await request.json();const row={id:'new-record',...value};rows.push(row);result=[row];}
    const singular=request.headers.get('accept')?.includes('vnd.pgrst.object');
    return new Response(JSON.stringify(singular?result[0]:result),{status:200,headers:{'content-type':'application/json'}});
  }}});
  return {client,rows,methods};
}
const person={name:'Alex Example',role:'Event Director',kind:'FACT' as const,sourceUrl:'https://operator.example/team',confidence:'HIGH' as const};
test('repeat research leaves verified contact, ownership, source and metadata unchanged',async()=>{
  const existing={id:'contact-1',account_id:'account-1',full_name:'Alex Example',role_title:'Head of Events',verification_status:'VERIFIED',email:'alex@operator.example',owner_user_id:'human-owner',source:'human_review',metadata:{provenance:{verifiedBy:'operator'},suppressed:true}};
  const db=database('contacts',[existing]);
  await saveResearchedContact(db.client,'account-1',person);
  await saveResearchedContact(db.client,'account-1',{...person,kind:'INFERENCE'});
  assert.deepEqual(db.rows,[existing]);assert.ok(!db.methods.includes('PATCH'));
});
test('refresh preserves converted opportunity, human decisions, ownership and metadata',async()=>{
  const existing={id:'opportunity-1',account_id:'account-1',product_id:'product-1',stage:'converted',owner_user_id:'human-owner',conversion_route:'QUALIFIED_LIVE_DEMO',next_action:'Customer onboarding',metadata:{decision:'accepted',incomingLead:true,custom:{retain:true}}};
  const db=database('product_opportunities',[existing]);
  const id=await saveResearchedOpportunity(db.client,{account_id:'account-1',product_id:'product-1',stage:'identified',next_action:'Research again',metadata:{aiSalesTeam:true}});
  assert.equal(id,'opportunity-1');assert.deepEqual(db.rows,[existing]);assert.ok(!db.methods.includes('PATCH'));
});
test('new research may create an unverified person and initial opportunity',async()=>{
  const contacts=database('contacts',[]);await saveResearchedContact(contacts.client,'account-1',person);
  assert.equal(contacts.rows[0].verification_status,'UNVERIFIED');
  const opportunities=database('product_opportunities',[]);assert.equal(await saveResearchedOpportunity(opportunities.client,{account_id:'account-1',product_id:'product-1',stage:'identified'}),'new-record');
});
