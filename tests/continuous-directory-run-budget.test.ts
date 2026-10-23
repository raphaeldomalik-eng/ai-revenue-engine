import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';
import {policyHash} from '../src/nexus/source-discovery/continuous-directory-policy.ts';
const root=new URL('../supabase/migrations/',import.meta.url);
const runA='11111111-1111-4111-8111-111111111111',runB='22222222-2222-4222-8222-222222222222';
const policy={policyId:'run-test',version:2,budgetMode:'PER_RUN',enabled:true,validFrom:'2026-01-01T00:00:00Z',validUntil:'2030-01-01T00:00:00Z',countries:['GB'],actions:['VERIFY_WEBSITE','ENRICH_VERIFIED_VENUE'],maxVenuesPerRun:2,maxRequestsPerRun:10,maxRequestsPerVenue:6,maxBatchVenues:2,paidProviderBudgetUsd:0,minHostDelayMs:1000,freshnessHours:720,maxAttempts:3,retryBackoffHours:1,stopAfterConsecutiveFailures:5,publicationAllowed:false,outreachAllowed:false};
async function setup(p:Record<string,unknown>=policy){const db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role');
 for(const name of ['20261021044018_resources_directory_standing_policy.sql','20261021121320_resources_directory_failure_isolation.sql','20261023204000_shared_directory_run_budgets.sql'])await db.exec(fs.readFileSync(new URL(name,root),'utf8'));
 await db.query('insert into public.nexus_directory_standing_policy(policy_id,policy_sha256,policy,enabled) values($1,$2,$3,true)',[p.policyId,policyHash(p),JSON.stringify(p)]);return db;}
async function reserve(db:PGlite,n:number,runId=runA,p:Record<string,unknown>=policy){
 const day=(await db.query<{day:string}>("select to_char(now() at time zone 'UTC','YYYY-MM-DD') as day")).rows[0].day;
 const r={policyId:p.policyId,policySha256:policyHash(p),queueId:'q'+n,identityKey:'canonical:'+n,country:'GB',host:'venue'+n+'.example',reservationKey:n.toString(16).padStart(64,'0'),requestBudget:6,day,runId,action:'VERIFY_WEBSITE'};
 return (await db.query<{result:{state:string;reason?:string}}>('select public.reserve_nexus_directory_work($1::jsonb) result',[JSON.stringify(r)])).rows[0].result;}
test('per-run reservation is durable, replay-safe and independent of a daily quota',async()=>{const db=await setup();try{
 assert.equal((await reserve(db,1)).state,'RESERVED');assert.equal((await reserve(db,1)).reason,'REPLAY');
 assert.equal((await reserve(db,2)).reason,'RUN_BUDGET');assert.equal((await reserve(db,3,runB)).state,'RESERVED');
 assert.deepEqual((await db.query('select reserved_venues,reserved_requests from public.nexus_directory_run_budget order by run_id')).rows,[{reserved_venues:1,reserved_requests:6},{reserved_venues:1,reserved_requests:6}]);
 assert.equal((await db.query<{n:number}>('select count(*)::int n from public.nexus_directory_daily_budget')).rows[0].n,0);
}finally{await db.close()}});
test('run limits, service permissions and leases fail closed without refunding unknown work',async()=>{const db=await setup();try{
 assert.equal((await reserve(db,1,'invalid')).reason,'RUN_SCOPE');assert.equal((await reserve(db,1)).state,'RESERVED');
 await db.exec("update public.nexus_directory_work_receipt set lease_until=now()-interval '1 hour'");
 assert.equal((await reserve(db,2)).reason,'RUN_BUDGET');
 assert.equal((await db.query<{state:string}>('select state from public.nexus_directory_work_receipt')).rows[0].state,'RETRYABLE');
 assert.equal((await db.query<{reserved_requests:number}>('select reserved_requests from public.nexus_directory_run_budget')).rows[0].reserved_requests,6);
 const privileges=(await db.query("select has_function_privilege('anon','public.reserve_nexus_directory_work(jsonb)','execute') callable,has_table_privilege('authenticated','public.nexus_directory_run_budget','select') readable")).rows[0];assert.deepEqual(privileges,{callable:false,readable:false});
}finally{await db.close()}});
test('legacy daily policies keep their existing bounded ledger',async()=>{
 const {budgetMode,maxVenuesPerRun,maxRequestsPerRun,...rest}=policy;const p={...rest,maxVenuesPerDay:1,maxRequestsPerDay:10};const db=await setup(p);try{
 assert.equal((await reserve(db,1,runA,p)).state,'RESERVED');assert.equal((await reserve(db,2,runB,p)).reason,'DAILY_BUDGET');
 assert.equal((await db.query<{n:number}>('select count(*)::int n from public.nexus_directory_run_budget')).rows[0].n,0);
}finally{await db.close()}});
