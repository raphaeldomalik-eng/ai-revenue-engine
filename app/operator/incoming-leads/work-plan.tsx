"use client";
import { useState } from 'react';

type Data = { lead: Record<string, any>; members: Record<string, any>[]; opportunity?: Record<string, any> | null; opportunityCandidates?: Record<string, any>[] };
const nextStages: Record<string,string[]> = { identified:['qualified','nurture','disqualified'],qualified:['contacted','demo_scheduled','nurture','lost','disqualified'],contacted:['demo_scheduled','proposal','nurture','lost','disqualified'],demo_scheduled:['proposal','nurture','lost','disqualified'],proposal:['converted','lost','nurture'],nurture:['qualified','lost','disqualified'] };
function localDate(value?:string) { if(!value) return ''; const d=new Date(value); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); }
export function LeadWorkPlan({data,readOnly,onUpdated}:{data:Data;readOnly:boolean;onUpdated:()=>Promise<void>}) {
  const {lead,members,opportunity}=data;
  const [owner,setOwner]=useState(lead.owner_id??''); const [action,setAction]=useState(lead.next_action??'');
  const [due,setDue]=useState(localDate(lead.follow_up_at)); const [reason,setReason]=useState('');
  const [holdReason,setHoldReason]=useState(lead.hold_reason??''); const [condition,setCondition]=useState(lead.hold_review_condition??'');
  const [reviewAt,setReviewAt]=useState(localDate(lead.hold_review_at)); const [stage,setStage]=useState(nextStages[opportunity?.stage??'']?.[0]??'qualified');
  const [selected,setSelected]=useState(''); const [busy,setBusy]=useState(false); const [message,setMessage]=useState('');
  const [contactAt,setContactAt]=useState(''); const [channel,setChannel]=useState('PHONE');
  const [contactReference,setContactReference]=useState(''); const [contactSummary,setContactSummary]=useState('');
  const save=async(name:string,value:Record<string,unknown>)=>{
    setBusy(true);setMessage('');
    try {
      const response=await fetch('/api/incoming-leads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({leadId:lead.id,action:name,value})});
      const result=await response.json(); if(!response.ok) throw Error(result.message??'Could not save');
      setMessage('Saved. Decision and previous values retained in audit history.');
      window.dispatchEvent(new Event('incoming-lead-updated')); await onUpdated();
    }catch(error){setMessage(error instanceof Error?error.message:'Could not save');}finally{setBusy(false);}
  };
  const customer=lead.lead_classification==='EXISTING_CUSTOMER'||lead.stage==='TRIAL_ACTIVE';
  return <section className="lead-work-plan"><h3>{customer?'Customer / trial service follow-up':'Ownership and next action'}</h3>
    {!lead.owner_id?<p className="incoming-read-only">Unassigned review queue — an eligible owner must accept this work.</p>:null}
    <fieldset disabled={readOnly||busy}><label>Work owner<select value={owner} onChange={e=>setOwner(e.target.value)}><option value="">Unassigned</option>{members.filter(m=>m.active&&['operator','admin'].includes(m.member_role.toLowerCase())).map(m=><option key={m.user_id} value={m.user_id}>{m.display_name??`${m.user_id.slice(0,8)} · ${m.member_role}`}</option>)}</select></label>
    <label>Recorded next action<input value={action} maxLength={500} onChange={e=>setAction(e.target.value)} /></label>
    <label>Follow-up due<input type="datetime-local" value={due} onChange={e=>setDue(e.target.value)} /></label>
    <button className="operator-button" disabled={!owner||!action.trim()||!due} onClick={()=>void save('SET_WORK_PLAN',{ownerId:owner,nextAction:action,followUpAt:due?new Date(due).toISOString():null})}>Save work plan</button>
    {!lead.hold_reason&&(!lead.next_action?.trim()||!lead.follow_up_at)?<p>Incomplete work plan — visible in the Incomplete work queue until an eligible owner and action / due date or reviewed hold are recorded.</p>:null}
    <details><summary>Record past manual contact</summary><p>Record an interaction that already happened outside AIRE, supported by a retained receipt or note. This does not send anything or verify delivery.</p>
      <label>Contact occurred at<input type="datetime-local" value={contactAt} onChange={e=>setContactAt(e.target.value)}/></label>
      <label>Manual contact channel<select value={channel} onChange={e=>setChannel(e.target.value)}><option value="PHONE">Phone</option><option value="IN_PERSON">In person</option><option value="VIDEO">Video call</option><option value="EMAIL">Previously sent email</option></select></label>
      <label>Contact receipt / evidence reference<input value={contactReference} maxLength={1000} onChange={e=>setContactReference(e.target.value)} placeholder="Retained call log, meeting note or external receipt reference"/></label>
      <label>Manual contact summary<textarea value={contactSummary} maxLength={2000} onChange={e=>setContactSummary(e.target.value)}/></label>
      <button className="operator-button secondary" disabled={customer||Boolean(opportunity)||Boolean(lead.hold_reason)||!lead.owner_id||!lead.next_action?.trim()||!lead.follow_up_at||!contactAt||!contactReference.trim()||!contactSummary.trim()} onClick={()=>void save('MARK_CONTACTED',{contactedAt:new Date(contactAt).toISOString(),channel,evidenceReference:contactReference,summary:contactSummary})}>Record manual contact evidence</button>
      {opportunity?<p>The existing opportunity progression restriction applies; this legacy contact action cannot update a linked opportunity.</p>:null}
    </details>
    <details open={Boolean(lead.hold_reason)}><summary>Hold and review condition</summary>{lead.hold_reason?<p><strong>On hold: {lead.hold_reason}</strong><br/>{lead.hold_review_condition} · {new Date(lead.hold_review_at).toLocaleString()}</p>:null}
      <label>Hold reason<textarea value={holdReason} maxLength={1000} onChange={e=>setHoldReason(e.target.value)}/></label>
      <label>Next review condition<input value={condition} maxLength={1000} onChange={e=>setCondition(e.target.value)}/></label>
      <label>Review date<input type="datetime-local" value={reviewAt} onChange={e=>setReviewAt(e.target.value)}/></label>
      <button className="operator-button secondary" disabled={!holdReason.trim()||!condition.trim()||!reviewAt} onClick={()=>void save('HOLD',{reason:holdReason,reviewCondition:condition,reviewAt:reviewAt?new Date(reviewAt).toISOString():null})}>Save hold</button>
      {lead.hold_reason?<button className="operator-button secondary" disabled={!reason.trim()} onClick={()=>void save('RELEASE_HOLD',{reason})}>Release hold with evidence below</button>:null}
    </details>
    <h3>Product opportunity</h3><p>{opportunity?`Linked opportunity: ${opportunity.stage}`:customer?'Customer service work — no new-sales opportunity assumed.':'No opportunity linked. Review identity, classification and work plan first.'}</p>
    <label>Decision evidence<textarea value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)} placeholder="Source evidence supporting this link, progression or hold release"/></label>
    {!opportunity&&data.opportunityCandidates?.length?<label>Existing matching opportunity<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select explicitly after review</option>{data.opportunityCandidates.map(o=><option key={o.id} value={o.id}>{o.id.slice(0,8)} · {o.stage}</option>)}</select></label>:null}
    {!opportunity?<button className="operator-button" disabled={customer||lead.lead_classification!=='GENUINE_PROSPECT'||Boolean(lead.hold_reason)||!lead.owner_id||!lead.next_action||!lead.follow_up_at||!reason.trim()} onClick={()=>void save('LINK_OPPORTUNITY',{reason,opportunityId:selected||undefined})}>Link justified opportunity</button>:<><label>Next opportunity stage<select value={stage} onChange={e=>setStage(e.target.value)}>{(nextStages[opportunity.stage]??[]).map(s=><option key={s} value={s}>{s.replaceAll('_',' ')}</option>)}</select></label><button className="operator-button" disabled={!reason.trim()||Boolean(lead.hold_reason)||!(nextStages[opportunity.stage]??[]).includes(stage)} onClick={()=>void save('PROGRESS_OPPORTUNITY',{stage,reason})}>Record opportunity progression</button></>}
    </fieldset>{message?<p role="status">{message}</p>:null}<p className="muted">Recording a stage never sends a message or marks someone contacted.</p>
  </section>;
}
