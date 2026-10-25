import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';
import {policyHash} from '../src/nexus/source-discovery/continuous-directory-policy.ts';
const root=new URL('../supabase/migrations/',import.meta.url);
const policy={policyId:'shared-run-test',version:2,quotaMode:'PER_RUN',enabled:true,validFrom:'2026-01-01T00:00:00Z',validUntil:'2030-01-01T00:00:00Z',countries:['GB'],actions:['VERIFY_WEBSITE','ENRICH_VERIFIED_VENUE'],maxVenuesPerRun:2,maxRequestsPerRun:10,maxRequestsPerVenue:6,maxBatchVenues:2,paidProviderBudgetUsd:0,minHostDelayMs:1000,freshnessHours:720,maxAttempts:3,retryBackoffHours:1,stopAfterConsecutiveFailures:5,publicationAllowed:false,outreachAllowed:false};
async function setup(){const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;select set_config('request.jwt.claim.role','service_role',false)`);
 for(const name of ['20261021044018_resources_directory_standing_policy.sql','20261021114947_resources_directory_search_allowance.sql','20261021121320_resources_directory_failure_isolation.sql','20261021134357_resources_directory_transient_search_cache.sql','20261023182003_resources_provider_and_run_budgets.sql'])await db.exec(fs.readFileSync(new URL(name,root),'utf8'));
 await db.query('insert into public.nexus_directory_standing_policy(policy_id,policy_sha256,policy,enabled) values($1,$2,$3,true)',[policy.policyId,policyHash(policy),JSON.stringify(policy)]);return db;}
async function open(db:PGlite){return (await db.query<{result:{state:string;runId:string}}>('select public.open_nexus_directory_run($1,$2,$3,2,10) result',[policy.policyId,policyHash(policy),'shared-worker'])).rows[0].result;}
async function reserve(db:PGlite,n:number,runId:string){const day=(await db.query<{day:string}>("select to_char(now() at time zone 'UTC','YYYY-MM-DD') as day")).rows[0].day;
 const reservation={policyId:policy.policyId,policySha256:policyHash(policy),queueId:'q'+n,identityKey:'canonical:'+n,country:'GB',host:'venue'+n+'.example',reservationKey:n.toString(16).padStart(64,'0'),requestBudget:6,day,runId,action:'VERIFY_WEBSITE'};
 const result=(await db.query<{result:{state:string;reason?:string}}>('select public.reserve_nexus_directory_run_work($1::jsonb) result',[JSON.stringify(reservation)])).rows[0].result;return {result,reservation};}
test('shared processing uses the existing opened run, durable bounds and replay ledger, without daily quota',async()=>{const db=await setup();try{
 const run=await open(db);assert.equal(run.state,'OPENED');assert.equal((await reserve(db,1,run.runId)).result.state,'RESERVED');assert.equal((await reserve(db,1,run.runId)).result.reason,'REPLAY');assert.equal((await reserve(db,2,run.runId)).result.reason,'RUN_BUDGET');assert.equal((await open(db)).state,'DENIED');
 assert.equal((await db.query<{n:number}>('select count(*)::int n from public.nexus_directory_daily_budget')).rows[0].n,0);
 assert.deepEqual((await db.query('select reserved_venues,reserved_requests from public.nexus_directory_run')).rows,[{reserved_venues:1,reserved_requests:6}]);
}finally{await db.close()}});
test('unknown expired work retains its reservation and anonymous users cannot access run authority',async()=>{const db=await setup();try{
 const run=await open(db);await reserve(db,1,run.runId);await db.exec("update public.nexus_directory_work_receipt set lease_until=now()-interval '1 hour'");assert.equal((await reserve(db,2,run.runId)).result.reason,'RUN_BUDGET');
 assert.equal((await db.query<{state:string}>('select state from public.nexus_directory_work_receipt')).rows[0].state,'RETRYABLE');assert.equal((await db.query<{n:number}>('select reserved_requests n from public.nexus_directory_run')).rows[0].n,6);
 assert.deepEqual((await db.query("select has_function_privilege('anon','public.open_nexus_directory_run(text,text,text,integer,integer)','execute') callable,has_table_privilege('authenticated','public.nexus_directory_run','select') readable")).rows[0],{callable:false,readable:false});
 await db.exec("select set_config('request.jwt.claim.role','authenticated',false)");await assert.rejects(open(db),/SERVICE_ROLE_REQUIRED/);
}finally{await db.close()}});
