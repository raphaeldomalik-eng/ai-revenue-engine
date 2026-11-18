// Local acceptance adapter only. Never import live credentials or provider clients.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import path from 'node:path';
import { createPreviewDatabase, asMember, operatorId, viewerId, receiveScenario } from './database.ts';
import type { PGlite } from '@electric-sql/pglite';

const state = globalThis as typeof globalThis & { aireLeadPreviewDb?: Promise<PGlite> };
export function previewEnabled() {
  if (process.env.AIRE_LEAD_PREVIEW !== '1') return false;
  if (process.env.VERCEL || Object.keys(process.env).some(key => /SUPABASE|OPENAI_API_KEY|APOLLO_API_KEY/.test(key) && process.env[key])) throw Error('Preview refuses hosted deployment or live provider configuration');
  if (!process.env.AIRE_LEAD_PREVIEW_SECRET) throw Error('Preview session signing key missing');
  return true;
}
function sign(role: string) { return createHmac('sha256', process.env.AIRE_LEAD_PREVIEW_SECRET!).update(role).digest('hex'); }
function identity(request: Request) {
  const cookie = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith('aire_preview='))?.slice(13) ?? '';
  const [role, signature = ''] = cookie.split('.');
  if (!['operator','viewer'].includes(role) || signature.length !== 64 || !timingSafeEqual(Buffer.from(signature), Buffer.from(sign(role)))) return null;
  return { id: role === 'operator' ? operatorId : viewerId, role, access: role.toUpperCase() };
}
function localRequest(request: Request) {
  // Next dev can canonicalise request.url to localhost while the browser uses 127.0.0.1.
  const host=request.headers.get('host');
  if (!['localhost:3123','127.0.0.1:3123'].includes(host??'')) throw Error('Preview is loopback-only');
  const origin=`http://${host}`;
  if (request.method !== 'GET' && request.headers.get('origin') !== origin) throw Error('Preview requires same-origin requests');
  return origin;
}
export async function previewSession(request: Request) {
  if (!previewEnabled()) return new NextResponse('Not found', { status: 404 });
  const origin=localRequest(request);
  if (request.method === 'POST') {
    const data = await request.formData(); const role = String(data.get('role'));
    if (!['operator','viewer'].includes(role)) return new NextResponse('Invalid synthetic role', { status: 400 });
    const response = NextResponse.redirect(new URL('/operator/incoming-leads?view=all',origin),303);
    response.cookies.set('aire_preview',`${role}.${sign(role)}`,{ httpOnly:true,sameSite:'strict',path:'/',maxAge:28800 });
    return response;
  }
  return new NextResponse(`<!doctype html><html><head><meta name="robots" content="noindex,nofollow"><title>AIRE isolated lead preview</title></head><body style="font:18px system-ui;background:#f4f7fb;color:#172b4d;padding:8vh 12%;max-width:780px"><p>AIRE #123 · LOCAL ACCEPTANCE PREVIEW</p><h1>Work a lead from evidence to opportunity</h1><p>This is the existing AIRE workspace with three fictional records in a separate local PostgreSQL database. No customer data, external messages, enrichment or paid providers.</p><form method="post"><button name="role" value="operator" style="padding:16px;font:inherit">Open synthetic operator</button> <button name="role" value="viewer" style="padding:16px;font:inherit">Open read-only viewer</button></form><p>Demo roles are acceptance fixtures, not real user authentication. Decisions persist locally across reloads and server restarts.</p></body></html>`,{headers:{'content-type':'text/html','x-robots-tag':'noindex, nofollow','cache-control':'no-store'}});
}
async function database() {
  state.aireLeadPreviewDb ??= (async () => {
    const key=process.env.AIRE_LEAD_PREVIEW_DATA_KEY??'default';
    if(!/^(default|\d{13})$/.test(key)) throw Error('Invalid local preview data key');
    const db = await createPreviewDatabase(path.resolve(`scratch/aire-123-preview-${key}`));
    for (const scenario of ['demo','trial','held']) await receiveScenario(db,scenario);
    return db;
  })();
  return state.aireLeadPreviewDb;
}
export async function previewApi(request: Request) {
  try {
    if (!previewEnabled()) return NextResponse.json({message:'Not found'},{status:404});
    localRequest(request);
    const actor=identity(request);
    if (!actor) return NextResponse.json({message:'Open a synthetic preview session at /lead-preview.'},{status:401});
    const url=new URL(request.url);
    if (url.pathname==='/api/operator') return NextResponse.json({access:actor.access,preview:true});
    const db=await database();
    if (request.method==='POST') {
      if (actor.role!=='operator') return NextResponse.json({message:'Active operator access is required.'},{status:403});
      const body=await request.json();
      if (body.action==='PREVIEW_RECEIVE') return NextResponse.json(await receiveScenario(db,String(body.scenario)));
      // Same RPC used by the production route; database checks roles and records actor/before/after.
      return await asMember(db,actor.id,async tx=>{
        if (body.action==='BULK') {
          const result=await tx.query<any>('select bulk_update_incoming_leads($1::uuid[],$2,$3::jsonb) as count',[body.leadIds,body.bulkAction,JSON.stringify(body.value??{})]);
          return NextResponse.json({count:result.rows[0].count});
        }
        const result=await tx.query('select * from update_incoming_lead($1,$2,$3::jsonb)',[body.leadId,body.action,JSON.stringify(body.value??{})]);
        return NextResponse.json({lead:result.rows[0],message:'Incoming lead updated.'});
      });
    }
    return await asMember(db,actor.id,async tx=>{
      const rows=async(sql:string,args:unknown[]=[]) => (await tx.query<any>(sql,args)).rows;
      const members=(await rows('select user_id,member_role,active from revenue_members where active')).map(m=>({...m,display_name:m.user_id===operatorId?'Alex · synthetic owner':'Read-only reviewer'}));
      const leadId=url.searchParams.get('leadId');
      if (leadId) {
        const lead=(await rows('select * from incoming_leads where id=$1',[leadId]))[0];
        if(!lead) return NextResponse.json({message:'Lead not found'},{status:404});
        return NextResponse.json({access:actor.access,preview:true,lead,members,
          changes:await rows('select * from incoming_lead_changes where incoming_lead_id=$1 order by created_at desc',[leadId]),
          notes:await rows('select * from incoming_lead_notes where incoming_lead_id=$1 order by created_at desc',[leadId]),
          submissions:await rows('select * from incoming_submissions where incoming_lead_id=$1 order by occurred_at desc',[leadId]),
          activities:await rows('select * from activities where incoming_lead_id=$1 order by occurred_at desc',[leadId]),evidence:[],
          account:(await rows('select * from accounts where id=$1',[lead.account_id]))[0]??null,
          contact:(await rows('select * from contacts where id=$1',[lead.contact_id]))[0]??null,
          opportunity:(await rows('select * from product_opportunities where id=$1',[lead.product_opportunity_id]))[0]??null,
          opportunityCandidates:await rows("select id,stage from product_opportunities where account_id=$1 and product_id=$2 and stage not in ('converted','disqualified','lost')",[lead.account_id,lead.product_id])});
      }
      const p=url.searchParams; const owner=p.get('owner')??'ALL'; const page=Math.max(1,Number(p.get('page')??1)); const pageSize=25;
      const leads=await rows('select * from list_incoming_lead_queue($1,$2,$3,$4,$5,$6,$7,$8,null,null,$9,$10,$11,$12,$13)',[
        p.get('view')??'all',p.get('search')||null,p.get('source')??'ALL',p.get('classification')??'ALL',p.get('intent')??'ALL',
        ['ALL','UNASSIGNED'].includes(owner)?null:owner,owner==='UNASSIGNED',p.get('stage')??'ALL',p.get('followUpState')??'ALL',p.get('dataQualityState')??'ALL',p.get('enrichmentState')??'ALL',pageSize,(page-1)*pageSize]);
      const all=await rows('select id,hold_reason,hold_review_condition,hold_review_at from incoming_leads');
      for(const lead of leads) { Object.assign(lead,all.find(r=>r.id===lead.id)); lead.owner_display_name=members.find(m=>m.user_id===lead.owner_id)?.display_name; }
      const metrics=(await rows('select incoming_lead_operational_metrics() as metrics'))[0].metrics;
      const counts=(await rows("select count(*)::int as total, count(*) filter(where owner_id is null)::int as unassigned, count(*) filter(where lead_classification='EXISTING_CUSTOMER' or stage='TRIAL_ACTIVE')::int as customers from incoming_leads"))[0];
      return NextResponse.json({access:actor.access,preview:true,leads,totalCount:Number(leads[0]?.total_count??0),members,page,pageSize,metrics:{...metrics,totalLeads:counts.total,unassigned:counts.unassigned,customers:counts.customers}});
    });
  } catch(error) {
    const message=error instanceof Error?error.message:'Preview action failed';
    return NextResponse.json({message},{status:400});
  }
}
