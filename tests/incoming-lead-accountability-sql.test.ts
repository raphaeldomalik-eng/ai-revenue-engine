import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewDatabase,asMember,operatorId,viewerId,receiveScenario} from '../scripts/lead-preview/database.ts';

test('legacy individual and bulk planning stays visible until an eligible owner and complete plan or reviewed hold exists',async()=>{
 const db=await createPreviewDatabase();
 try{
  const demo=await receiveScenario(db),trial=await receiveScenario(db,'trial');
  const mutate=(id:string,action:string,value={})=>asMember(db,operatorId,tx=>tx.query('select * from update_incoming_lead($1,$2,$3::jsonb)',[id,action,JSON.stringify(value)]));
  const queue=()=>asMember(db,operatorId,tx=>tx.query<any>("select * from list_incoming_lead_queue('incomplete-work')"));
  const count=async()=>Number((await asMember(db,operatorId,tx=>tx.query<any>('select incoming_lead_operational_metrics() as metrics'))).rows[0].metrics.incompleteWorkPlans);
  await asMember(db,operatorId,tx=>tx.query("select bulk_update_incoming_leads($1::uuid[],'ASSIGN_OWNER',$2::jsonb)",[[demo.lead_id,trial.lead_id],JSON.stringify({ownerId:operatorId})]));
  assert.deepEqual(new Set((await queue()).rows.map(r=>r.id)),new Set([demo.lead_id,trial.lead_id]));assert.equal(await count(),2);
  await mutate(demo.lead_id,'SET_NEXT_ACTION',{nextAction:'   '});
  await mutate(demo.lead_id,'SET_FOLLOW_UP',{followUpAt:'2026-11-20T09:00:00Z'});assert.equal(await count(),2);
  await mutate(demo.lead_id,'SET_NEXT_ACTION',{nextAction:'Review retained synthetic requirements'});assert.equal(await count(),1);
  await mutate(demo.lead_id,'SET_FOLLOW_UP',{});assert.equal(await count(),2);
  await mutate(demo.lead_id,'HOLD',{reason:'Await synthetic source',reviewCondition:'Review when supplied',reviewAt:'2026-11-20T09:00:00Z'});assert.equal(await count(),1);
  await mutate(demo.lead_id,'RELEASE_HOLD',{reason:'Synthetic evidence received'});assert.equal(await count(),2);
  await mutate(demo.lead_id,'SET_FOLLOW_UP',{followUpAt:'2026-11-20T09:00:00Z'});
  await db.query('update revenue_members set active=false where user_id=$1',[operatorId]);
  // Read role is exercised separately: re-enable the actor after checking an inactive assigned owner with a second operator.
  await db.exec("insert into auth.users values ('12300000-0000-4000-8000-000000000003'); insert into revenue_members(user_id,member_role) values ('12300000-0000-4000-8000-000000000003','operator')");
  const inactive=await asMember(db,'12300000-0000-4000-8000-000000000003',tx=>tx.query<any>("select * from list_incoming_lead_queue('incomplete-work')"));assert(inactive.rows.some(r=>r.id===demo.lead_id));
  await db.query('update revenue_members set active=true where user_id=$1',[operatorId]);
  const otherOperatorMetrics=await asMember(db,'12300000-0000-4000-8000-000000000003',tx=>tx.query<any>('select incoming_lead_operational_metrics() as metrics'));
  assert.equal(Number(otherOperatorMetrics.rows[0].metrics.incompleteWorkPlans),1,'Another operator must recognise the eligible assigned owner through existing membership RLS');
  const visibility=await asMember(db,'12300000-0000-4000-8000-000000000003',tx=>tx.query<any>('select * from revenue_members where user_id=$1',[operatorId]));assert.equal(visibility.rows.length,0,'Membership-table RLS remains unchanged');
  await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');return tx.query('select private.incoming_lead_owner_eligible($1)',[operatorId]);}),/permission denied/);
  await mutate(trial.lead_id,'CLASSIFY',{classification:'OTHER_NON_LEAD',reason:'Synthetic non-lead disposition'});assert.equal(await count(),0);
  await mutate(demo.lead_id,'CHANGE_STAGE',{stage:'LOST',reason:'Synthetic closed work'});await mutate(demo.lead_id,'SET_NEXT_ACTION',{});assert.equal(await count(),0);
  await assert.rejects(asMember(db,viewerId,tx=>tx.query("select bulk_update_incoming_leads($1::uuid[],'ASSIGN_OWNER','{}')",[[demo.lead_id]])),/OPERATOR_REQUIRED/);
 }finally{await db.close();}
});

test('manual contact requires evidence, records actual occurrence time and retains historical audit without asserting delivery',async()=>{
 const db=await createPreviewDatabase();
 try{
  const lead=await receiveScenario(db);
  const mutate=(action:string,value={})=>asMember(db,operatorId,tx=>tx.query('select * from update_incoming_lead($1,$2,$3::jsonb)',[lead.lead_id,action,JSON.stringify(value)]));
  await mutate('SET_WORK_PLAN',{ownerId:operatorId,nextAction:'Review fictional contact receipt',followUpAt:'2026-11-20T09:00:00Z'});
  const before=(await db.query<any>('select * from incoming_leads where id=$1',[lead.lead_id])).rows[0];
  const evidence={contactedAt:'2026-11-17T09:00:00Z',channel:'PHONE',evidenceReference:'synthetic-call-log-123',summary:'Fictional operator-recorded discussion; no real recipient'};
  await assert.rejects(mutate('MARK_CONTACTED'),/CONTACT_EVIDENCE_REQUIRED/);
  await assert.rejects(mutate('MARK_CONTACTED',{...evidence,evidenceReference:' '}),/CONTACT_EVIDENCE_REQUIRED/);
  await assert.rejects(mutate('MARK_CONTACTED',{...evidence,channel:'PROVIDER_DELIVERED'}),/CONTACT_EVIDENCE_INVALID/);
  await assert.rejects(mutate('MARK_CONTACTED',{...evidence,contactedAt:'2099-01-01T00:00:00Z'}),/CONTACT_EVIDENCE_INVALID/);
  await assert.rejects(mutate('MARK_CONTACTED',{...evidence,contactedAt:'not-a-date'}),/CONTACT_EVIDENCE_INVALID/);
  const rejected=(await db.query<any>('select * from incoming_leads where id=$1',[lead.lead_id])).rows[0];assert.equal(rejected.last_contacted_at,before.last_contacted_at);
  assert.equal((await db.query("select * from incoming_lead_changes where action='MARK_CONTACTED'")).rows.length,0);
  await mutate('MARK_CONTACTED',evidence);
  await mutate('MARK_CONTACTED',{...evidence,contactedAt:'2026-11-16T09:00:00Z',evidenceReference:'synthetic-earlier-call-log'});
  const updated=(await db.query<any>('select * from incoming_leads where id=$1',[lead.lead_id])).rows[0];assert.equal(new Date(updated.last_contacted_at).toISOString(),evidence.contactedAt.replace('Z','.000Z'));
  const history=(await db.query<any>("select * from incoming_lead_changes where action='MARK_CONTACTED' order by created_at")).rows;
  assert.equal(history.length,2);assert(history.every(r=>r.actor_id===operatorId&&r.new_values.contactEvidence.kind==='MANUAL_RECORDED'&&r.new_values.contactEvidence.deliveryVerified===false));
  assert.equal(history[0].new_values.contactEvidence.evidenceReference,evidence.evidenceReference);
  assert.equal(history[1].previous_values.last_contacted_at,history[1].new_values.last_contacted_at);
  assert.equal((await db.query('select * from activities')).rows.length,1,'Manual record must not fabricate an inbound or delivered activity');
  await assert.rejects(asMember(db,operatorId,tx=>tx.query("select bulk_update_incoming_leads($1::uuid[],'MARK_CONTACTED',$2::jsonb)",[[lead.lead_id],JSON.stringify(evidence)])),/BULK_ACTION_INVALID/);
  await assert.rejects(asMember(db,viewerId,tx=>tx.query("select update_incoming_lead($1,'MARK_CONTACTED',$2::jsonb)",[lead.lead_id,JSON.stringify(evidence)])),/OPERATOR_REQUIRED/);
 }finally{await db.close();}
});
