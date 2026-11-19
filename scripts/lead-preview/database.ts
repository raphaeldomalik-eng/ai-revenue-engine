// Isolated acceptance harness: real AIRE migrations, local PostgreSQL/WASM only.
import { PGlite } from '@electric-sql/pglite';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export const operatorId = '12300000-0000-4000-8000-000000000001';
export const viewerId = '12300000-0000-4000-8000-000000000002';
export const previewMigrations = [
  '20260818000000_foundation.sql', '20260819000001_secure_persistence_foundation.sql',
  '20260828142049_incoming_leads_v1.sql', '20260828142543_incoming_leads_v1_activity_idempotency.sql',
  '20260831150000_incoming_leads_operator_workspace_v1.sql',
  '20260831180000_event_suite_incoming_leads_receiver_v1.sql',
  '20261117192332_incoming_lead_workflow.sql',
  '20261119064444_incoming_lead_accountability_contact_evidence.sql',
];

export async function createPreviewDatabase(dataDir?: string) {
  if(dataDir) await mkdir(path.dirname(dataDir),{recursive:true});
  const db = new PGlite(dataDir);
  await db.waitReady;
  const exists = await db.query<{ table: string | null }>("select to_regclass('public.incoming_leads')::text as table");
  if (exists.rows[0].table) return db;
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.preview_user',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select current_setting('app.preview_role',true)$$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    grant execute on function auth.uid(),auth.role() to authenticated,anon,service_role;`);
  for (const migration of previewMigrations) {
    const sql = (await readFile(path.resolve('supabase/migrations', migration), 'utf8')).replace('create extension if not exists pgcrypto;', '');
    await db.exec(sql);
  }
  await db.exec(`insert into auth.users values ('${operatorId}'),('${viewerId}');
    insert into revenue_members(user_id,member_role) values ('${operatorId}','operator'),('${viewerId}','viewer');
    insert into products(code,name,status) values ('event-suite','Event Suite','active');
    insert into sales_motions(code,name) values ('direct','Direct');`);
  return db;
}

export async function asMember<T>(db: PGlite, userId: string, work: (tx: Parameters<Parameters<PGlite['transaction']>[0]>[0]) => Promise<T>) {
  return db.transaction(async tx => {
    await tx.query("select set_config('app.preview_user',$1,true),set_config('app.preview_role','authenticated',true)", [userId]);
    await tx.exec('set local role authenticated');
    return work(tx);
  });
}

export async function receiveScenario(db: PGlite, scenario = 'demo') {
  if (!['demo','trial','held'].includes(scenario)) throw Error('Unknown synthetic scenario');
  const payload = {
    sourceSystem: 'event_suite', sourceRecordId: `aire-123-synthetic-${scenario}`, schemaVersion: 'event-suite.incoming-lead.v1',
    productCode: 'event-suite', sourceCategory: scenario === 'trial' ? 'TRIAL_STARTED' : scenario === 'held' ? 'RESOURCE_DOWNLOAD' : 'DEMO_REQUEST',
    submittedEmail: `${scenario}@aire-123.invalid`, contactName: scenario === 'demo' ? 'Alex · synthetic demo' : scenario === 'trial' ? 'Sam · synthetic trial' : 'Jordan · synthetic review',
    organisationName: `AIRE synthetic ${scenario}`, countryCode: 'GB', environment: 'PRODUCTION',
    sourceDetail: 'Isolated synthetic acceptance fixture; no customer record', occurredAt: new Date().toISOString(),
    initialClassification: scenario === 'trial' ? 'EXISTING_CUSTOMER' : 'NEEDS_REVIEW',
    initialClassificationReason: scenario === 'trial' ? 'Synthetic trial service fixture; product status represented for acceptance only.' : undefined,
    originalPayload: { fixture: true, synthetic: true, organisationConfidence: scenario === 'held' ? 'AMBIGUOUS' : 'HIGH' },
  };
  return db.transaction(async tx => {
    await tx.query("select set_config('app.preview_role','service_role',true)");
    const result = await tx.query<{ submission_id: string; lead_id: string; duplicate: boolean }>('select * from ingest_event_suite_incoming_submission($1::jsonb)', [JSON.stringify(payload)]);
    return result.rows[0];
  });
}
