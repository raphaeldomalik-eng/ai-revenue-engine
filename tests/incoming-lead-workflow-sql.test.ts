import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewDatabase, asMember, operatorId, viewerId, receiveScenario } from '../scripts/lead-preview/database.ts';

test('reviewed high-intent lead retains plan, opportunity progression, replay and actor audit without contacting anyone', async () => {
  const db = await createPreviewDatabase();
  try {
    const first = await receiveScenario(db);
    const replay = await receiveScenario(db);
    assert.equal(replay.lead_id, first.lead_id); assert.equal(replay.duplicate, true);
    const mutate = (action: string, value = {}) => asMember(db, operatorId, tx => tx.query('select * from update_incoming_lead($1,$2,$3::jsonb)', [first.lead_id, action, JSON.stringify(value)]));
    await mutate('CLASSIFY', { classification: 'GENUINE_PROSPECT', reason: 'Reviewed synthetic demo source; confirmed identity and product fit.' });
    await mutate('SET_WORK_PLAN', { ownerId: operatorId, nextAction: 'Prepare offline demo brief', followUpAt: '2026-11-18T09:00:00Z' });
    await mutate('LINK_OPPORTUNITY', { reason: 'Reviewed synthetic Event Suite product fit.' });
    await mutate('LINK_OPPORTUNITY', { reason: 'Retry the same explicit link.' });
    await mutate('PROGRESS_OPPORTUNITY', { stage: 'qualified', reason: 'Confirmed synthetic requirements against retained demo submission.' });
    const lead = (await db.query<any>('select * from incoming_leads where id=$1', [first.lead_id])).rows[0];
    assert.equal(lead.stage, 'QUALIFIED'); assert.equal(lead.owner_id, operatorId); assert.equal(lead.last_contacted_at, null);
    assert(lead.product_opportunity_id); assert.equal((await db.query('select * from product_opportunities')).rows.length, 1);
    const history = (await db.query<any>('select * from incoming_lead_changes order by created_at')).rows;
    assert(history.some(h => h.action === 'SET_WORK_PLAN' && h.actor_id === operatorId && h.new_values.next_action === 'Prepare offline demo brief'));
    assert(history.some(h => h.action === 'PROGRESS_OPPORTUNITY' && h.new_values.opportunity.stage === 'qualified'));
    assert(history.some(h => h.action === 'PROGRESS_OPPORTUNITY' && h.previous_values.opportunity?.stage === 'identified'));
    assert.equal((await db.query('select * from incoming_submissions')).rows.length, 1);
    assert.equal((await db.query('select * from activities')).rows.length, 1);
    await assert.rejects(mutate('PROGRESS_OPPORTUNITY', { stage: 'converted', reason: 'Skip all evidence' }), /TRANSITION_INVALID/);
    await assert.rejects(asMember(db, viewerId, tx => tx.query("select update_incoming_lead($1,'ASSIGN_OWNER','{}')", [first.lead_id])), /OPERATOR_REQUIRED/);
    await assert.rejects(asMember(db, viewerId, tx => tx.query('update incoming_leads set owner_id=$1', [viewerId])), /permission denied/);
  } finally { await db.close(); }
});

test('customer and ambiguous paths retain explicit holds and cannot acquire a sales opportunity', async () => {
  const db = await createPreviewDatabase();
  try {
    for (const scenario of ['trial','held']) {
      const result = await receiveScenario(db, scenario);
      const mutate = (action: string, value = {}) => asMember(db, operatorId, tx => tx.query('select * from update_incoming_lead($1,$2,$3::jsonb)', [result.lead_id, action, JSON.stringify(value)]));
      await assert.rejects(mutate('SET_WORK_PLAN', { ownerId: viewerId, nextAction: 'Test', followUpAt: '2026-11-18' }), /OWNER_INVALID/);
      await mutate('HOLD', { reason: 'Await product or identity evidence', reviewCondition: 'Product owner supplies confirmation', reviewAt: '2026-11-18T10:00:00Z' });
      await assert.rejects(mutate('CHANGE_STAGE', {stage:'CONVERTED',reason:'Bypass hold'}), /HOLD_ACTIVE|USE_OPPORTUNITY_PROGRESSION/);
      const row = (await db.query<any>('select * from incoming_leads where id=$1',[result.lead_id])).rows[0];
      assert.equal(row.hold_reason, 'Await product or identity evidence'); assert(row.hold_review_at);
      await assert.rejects(mutate('LINK_OPPORTUNITY', { reason: 'No justified prospect fit' }), /OPPORTUNITY_INELIGIBLE/);
      await assert.rejects(mutate('HOLD', { reason: 'Missing review condition' }), /HOLD_REVIEW_REQUIRED/);
      if(scenario==='trial'){
        await mutate('RELEASE_HOLD',{reason:'Synthetic service evidence received'});
        await mutate('CLASSIFY',{classification:'GENUINE_PROSPECT',reason:'Synthetic fit review must not override the trial service boundary'});
        await mutate('SET_WORK_PLAN',{ownerId:operatorId,nextAction:'Review service evidence',followUpAt:'2026-11-18T10:00:00Z'});
        await assert.rejects(mutate('LINK_OPPORTUNITY',{reason:'Attempt trial reclassification bypass'}),/OPPORTUNITY_INELIGIBLE/);
      }
    }
  } finally { await db.close(); }
});

test('due queue includes customer service and held identity review without treating either as a prospect',async()=>{
  const db=await createPreviewDatabase();
  try{
    const trial=await receiveScenario(db,'trial'); const held=await receiveScenario(db,'held');
    await asMember(db,operatorId,tx=>tx.query("select * from update_incoming_lead($1,'SET_WORK_PLAN',$2::jsonb)",[trial.lead_id,JSON.stringify({ownerId:operatorId,nextAction:'Review trial service evidence',followUpAt:'2020-01-01T10:00:00Z'})]));
    await asMember(db,operatorId,tx=>tx.query("select * from update_incoming_lead($1,'HOLD',$2::jsonb)",[held.lead_id,JSON.stringify({reason:'Identity ambiguous',reviewCondition:'Review with product owner',reviewAt:'2020-01-01T10:00:00Z'})]));
    const result=await asMember(db,operatorId,tx=>tx.query<any>("select * from list_incoming_lead_queue('follow-up-due')"));
    assert.deepEqual(new Set(result.rows.map(r=>r.id)),new Set([trial.lead_id,held.lead_id]));
    const metrics=await asMember(db,operatorId,tx=>tx.query<any>('select incoming_lead_operational_metrics() as metrics'));
    assert.equal(metrics.rows[0].metrics.followUpsDue,2);assert.equal(metrics.rows[0].metrics.activeGenuineLeads,0);
  }finally{await db.close();}
});
