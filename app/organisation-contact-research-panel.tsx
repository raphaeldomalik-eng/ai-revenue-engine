'use client';
import {useEffect,useState} from 'react';
import type {OrganisationResearchRecord,NexusResearchReference} from '../src/ai-sales-team/organisation-contact-research';
type Payload={record:OrganisationResearchRecord|null;reference:NexusResearchReference|null;commercialAssessment?:{recommendedNextAction?:string}};
const explanations:Record<string,string>={PILOT_NOT_ENABLED:'Contact intelligence is held until the supervised pilot is configured.',CONTACT_RESEARCH_REPLAY_UNAVAILABLE_IN_PRODUCTION:'Replay research is held in Production.',APOLLO_REPLAY_NOT_CONFIGURED:'No replay data is available for this organisation.',CONTACT_RESEARCH_PERSISTENCE_NOT_READY:'The contact intelligence workspace is not configured yet.',RESEARCH_REVISION_CONFLICT:'Research changed while you were reviewing it. Reload the shortlist before selecting.',ORGANISATION_IDENTITY_CONFLICT:'That Nexus organisation does not match the resolved operator name and official domain.',VENUE_OPERATOR_RELATIONSHIP_REQUIRED:'Nexus has not confirmed that this organisation operates the venue.',CONTACT_RESEARCH_NOT_ELIGIBLE:'Resolve and qualify this prospect before decision-maker research.'};

export function OrganisationContactResearchPanel({candidateId,canAct}:{candidateId:string;canAct:boolean}){
  const [payload,setPayload]=useState<Payload|null>(null),[organisationId,setOrganisationId]=useState(''),[provider,setProvider]=useState('');
  const [busy,setBusy]=useState(false),[held,setHeld]=useState(false),[message,setMessage]=useState('Loading contact intelligence…');
  const readResponse=async(response:Response)=>{
    const body=await response.json();if(!response.ok){if(response.status===503)setHeld(true);throw Error(explanations[body.code]??body.message??'Contact intelligence could not be loaded.');}
    setPayload(body);setOrganisationId(body.reference?.id??'');setMessage('');return body as Payload;
  };
  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/ai-sales/contact-research?candidateId='+encodeURIComponent(candidateId),{signal:controller.signal}).then(readResponse).catch(error=>{if(error.name!=='AbortError')setMessage(error.message);});
    return ()=>controller.abort();
  },[candidateId]);
  const act=async(action:'link'|'search'|'select',personId?:string)=>{
    setBusy(true);setMessage('');
    try{
      const response=await fetch('/api/ai-sales/contact-research',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,candidateId,nexusOrganisationId:organisationId,provider,personId,revision:payload?.record?.revision})});
      await readResponse(response);if(action==='select')setMessage('Selection saved as replay contact intelligence. Contact details remain unverified.');
    }catch(error){setMessage(error instanceof Error?error.message:'Contact intelligence could not be saved.');}finally{setBusy(false);}
  };
  const record=payload?.record;
  return <section className="drawer-section" aria-label="Organisation decision-maker research">
    <span className="operator-kicker">DECISION-MAKER RESEARCH</span>
    <p>Research the verified organisation once across its venue portfolio. Replay results do not verify a contact route or authorise enrichment or outreach.</p>
    {message?<p role="status">{message}</p>:null}
    {!held&&payload&&!payload.reference&&canAct?<div><label className="inventory-note-label">Existing Nexus organisation ID<input value={organisationId} onChange={event=>setOrganisationId(event.target.value)} placeholder="Organisation reference from Nexus" /></label><button type="button" className="operator-button" disabled={busy||!organisationId.trim()} onClick={()=>void act('link')}>Link verified organisation</button></div>:null}
    {record?<><h3>{record.identity.name}</h3><p>{record.identity.domain}</p>{record.identity.legalName?<p>Legal company: {record.identity.legalName}</p>:null}
      <p>Stored Nexus evidence snapshot. Current identity and operator relationships are checked before further research or selection.</p>
      <ul aria-label="Related operator venues">{record.identity.venues.map(venue=><li key={venue.id}>{venue.name} · recorded operator relationship</li>)}</ul>
      <p>Commercial next action: {payload?.commercialAssessment?.recommendedNextAction??'Review existing commercial evidence.'}</p>
      {canAct&&!held?<><label className="inventory-note-label">Research provider<select value={provider} onChange={event=>setProvider(event.target.value)}><option value="">Choose a provider</option><option value="APOLLO_REPLAY">Apollo — saved replay only</option></select></label><button type="button" className="operator-button" disabled={busy||provider!=='APOLLO_REPLAY'} onClick={()=>void act('search')}>Review organisation shortlist</button></>:null}
      <ul aria-label="Relevant role shortlist">{record.shortlist.map(person=>{
        const selected=record.selections.some(selection=>selection.person.providerPersonId===person.providerPersonId&&selection.replayFingerprint===record.replayFingerprint),selectable=person.status==='ACCEPTED'&&person.employerDomainOutcome==='DOMAIN_CONFIRMED';
        return <li key={person.providerPersonId}><strong>{person.fullName??'Name unavailable'}</strong><p>{person.title} · {person.buyerRoutingClassification?.replaceAll('_',' ')}</p><p>Employer: {person.organisationName} · {person.employerDomainOutcome.replaceAll('_',' ')}</p>{selected?<p>Human selection saved · replay evidence · no verified email</p>:canAct?<button type="button" disabled={busy||held||provider!=='APOLLO_REPLAY'||!selectable} onClick={()=>void act('select',person.providerPersonId??undefined)}>Save selection for {person.fullName??'person'}</button>:null}</li>;
      })}</ul>{record.replayObservedAt?<p>Replay observed: {new Date(record.replayObservedAt).toLocaleString()}</p>:null}
    </>:null}
  </section>;
}
