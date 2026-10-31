import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const pgliteModule=process.env.PGLITE_MODULE_PATH??path.resolve('../nexus-identity-work/node_modules/@electric-sql/pglite/dist/index.js');
const pglitePackage:string='@electric-sql/pglite';
const {PGlite}=process.env.PGLITE_MODULE_PATH?await import(pathToFileURL(pgliteModule).href):await import(pglitePackage).catch(()=>import(pathToFileURL(pgliteModule).href));
const hash='a'.repeat(64);
const policy={enabled:true,standing:true,validFrom:'2020-01-01',validUntil:null,quotaMode:'PER_RUN',paidProviderBudgetUsd:.05,publicationAllowed:false,productPublicationAllowed:false,outreachAllowed:false,maxVenuesPerRun:10,maxRequestsPerRun:140,maxVenuesPerDay:100,maxRequestsPerDay:1400,maxRequestsPerVenue:14,braveMaxRequestsPerRun:2,serperMaxRequestsPerRun:8,braveMaxRequestsPerDay:50,serperMaxRequestsPerDay:100,braveMonthlyBudgetUsd:10,providerLimits:{brave:{monthlyUsd:10,dailyRequests:50,reserveUsd:.5},serper:{allocationUsd:5,dailyRequests:100}},minHostDelayMs:1500,maxAttempts:3,retryBackoffHours:24,stopAfterConsecutiveFailures:5,countries:['GB','ZA'],actions:['VERIFY_WEBSITE','ENRICH_VERIFIED_VENUE','DISCOVER_WEBSITE']};
async function setup({combinedConstraints=false}={}){
 const db=new PGlite();
 await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;select set_config('request.jwt.claim.role','service_role',false)");
 const suffixes=['_resources_directory_standing_policy.sql','_resources_directory_search_allowance.sql','_resources_directory_transient_search_cache.sql','_resources_provider_and_run_budgets.sql','_resources_directory_store_result_v2_and_run_queue_isolation.sql','_resources_brave_monthly_budget_ceiling.sql','_resources_standing_governance.sql'];
 for(const suffix of suffixes){const file=fs.readdirSync('supabase/migrations').find(n=>n.endsWith(suffix));assert(file);const sql=fs.readFileSync('supabase/migrations/'+file,'utf8');if(combinedConstraints&&suffix==='_resources_standing_governance.sql')await db.exec('alter table public.nexus_directory_search_allowance drop constraint nexus_directory_search_allowance_check1,drop constraint nexus_directory_search_allowance_check2,drop constraint nexus_directory_search_allowance_reserved_micro_usd_check,drop constraint nexus_directory_search_allowance_request_count_check,add constraint old_combined_credit check(reserved_micro_usd>=0 and reserved_micro_usd<=allocated_micro_usd),add constraint old_combined_count check(request_count>=0 and request_count<=max_requests)');try{await db.exec(sql);}catch(error){const e=error as {message:string;position?:string};const pos=Number(e.position);throw Error(file+': '+e.message+' near '+sql.slice(pos-100,pos+100));}}
 await db.query('insert into public.nexus_directory_standing_policy(policy_id,policy_sha256,policy,enabled) values($1,$2,$3,true)',['p',hash,policy]);
 await db.exec("insert into public.nexus_directory_search_allowance(allowance_id,provider_id,policy_id,requires_run,allocated_micro_usd,price_per_request_micro_usd,max_requests,reserved_micro_usd,request_count,verified_at,expires_at,verification_ref,enabled) values('brave','brave-web-search','p',true,10000000,5000,2000,4050000,810,now()-interval '1 hour',now()+interval '1 year','verified dashboard',true),('serper','serper-google-search','p',true,5000000,1000,5000,1342000,1342,now()-interval '1 hour',now()+interval '1 year','verified dashboard',true)");
 const now=(await db.query('select clock_timestamp()::text n')).rows[0].n;
 const month=now.slice(0,7);
 const observe=async(provider:string,extra:Record<string,unknown>={})=>(await db.query('select public.observe_directory_provider_balance($1,$2,$3,$4) r',['p',hash,provider,{verifiedAt:now,verificationRef:'signed-in-dashboard-evidence',availableMicroUsd:provider==='brave-web-search'?5920000:46197000,ledgerReservedMicroUsd:provider==='brave-web-search'?4050000:1342000,ledgerRequestCount:provider==='brave-web-search'?810:1342,ledgerMonthReservedMicroUsd:0,providerMonth:month,providerMonthConsumedMicroUsd:provider==='brave-web-search'?4075000:0,...(provider==='brave-web-search'?{grantRemainingMicroUsd:0}:{}),...extra}])).rows[0].r;
 await observe('brave-web-search');await observe('serper-google-search');
 const open=async()=>(await db.query('select public.open_nexus_directory_run($1,$2,$3,10,140) r',['p',hash,'worker'])).rows[0].r;
 const reserve=async(runId:string,key:string,provider='brave-web-search')=>(await db.query('select public.reserve_directory_search($1) r',[{allowanceId:provider==='brave-web-search'?'brave':'serper',runId,querySha256:key.repeat(64),requestKey:'request-'+key,parameters:{provider}}])).rows[0].r;
 const status=async()=>(await db.query('select public.read_directory_provider_budget_status($1,$2) r',['p',hash])).rows[0].r;
 return {db,observe,open,reserve,status,now,month};
}
test('standing policy requires bounded finance; balances preserve external baselines and provider stocks',async()=>{
 const f=await setup();try{
  const s=await f.status();const b=s.providers.find((p:any)=>p.providerId==='brave-web-search'),r=s.providers.find((p:any)=>p.providerId==='serper-google-search');
  assert.equal(b.currentMonthConsumptionMicroUsd,4075000);assert.equal(b.authoritativeBalanceMicroUsd,5920000);assert.equal(b.conservativeRemainingMicroUsd,5420000);assert.equal(r.actualRemainingAllowanceMicroUsd,3658000);
  assert.equal((await f.open()).state,'OPENED');
  assert.equal((await f.db.query('select public.policy_is_active($1) active',[{...policy,standing:false}])).rows[0].active,false);
  assert.equal((await f.db.query('select public.policy_is_active($1) active',[{...policy,paidProviderBudgetUsd:1}])).rows[0].active,false);
  assert.equal((await f.db.query('select public.policy_is_active($1) active',[{...policy,maxRequestsPerDay:null}])).rows[0].active,false);
  assert.equal((await f.db.query('select public.policy_is_active($1) active',[{...policy,productPublicationAllowed:true}])).rows[0].active,false);
  assert.equal(b.actualRemainingAllowanceMicroUsd,5925000);
  assert.equal(b.accountCreditBasisMicroUsd,9995000);assert.equal(b.providerRemainingFraction,5920000/9995000);
 }finally{await f.db.close();}
});
test('search reserves race safely, cache precedes budgets, provider scopes and durable spacing stay separate',async()=>{
 const f=await setup();try{
  const run=await f.open();const raced=await Promise.all([f.reserve(run.runId,'b'),f.reserve(run.runId,'b')]);assert.equal(raced.filter(r=>r.state==='RESERVED').length,1);
  assert.equal((await f.reserve(run.runId,'c')).reason,'PROVIDER_RATE_LIMIT');
  assert.equal((await f.reserve(run.runId,'d','serper-google-search')).state,'RESERVED');
  await f.db.query('select public.complete_directory_search($1,$2,$3,$4)',['b'.repeat(64),'request-b',[],{}]);
  await f.db.exec("update public.nexus_directory_search_allowance set enabled=false where allowance_id='brave'");assert.equal((await f.reserve(run.runId,'b')).state,'CACHED');
  const s=await f.status();assert.equal(s.providers.find((p:any)=>p.providerId==='brave-web-search').currentMonthConsumptionMicroUsd,4080000);
  assert.equal((await f.db.query("select request_count from public.nexus_directory_search_allowance where allowance_id='brave'")).rows[0].request_count,811);
 }finally{await f.db.close();}
});
test('account reserve, run spending cap and daily provider cap fail closed without deleting usage',async()=>{
 const f=await setup();try{
  const run=await f.open();await f.observe('brave-web-search',{availableMicroUsd:504999});assert.equal((await f.reserve(run.runId,'b')).reason,'PROVIDER_ACCOUNT_RESERVE');
  await f.db.exec("update public.nexus_directory_search_allowance set provider_account_snapshot=jsonb_set(provider_account_snapshot,'{availableMicroUsd}','5920000') where allowance_id='brave'; update public.nexus_directory_run set brave_requests=2 where run_id='"+run.runId+"'");
  assert.equal((await f.reserve(run.runId,'c')).reason,'RUN_PROVIDER_BUDGET');
  await f.db.query('insert into public.nexus_directory_search_receipt(query_sha256,allowance_id,request_key,parameters,reserved_micro_usd) select lpad(n::text,64,\'0\'),\'serper\',n::text,jsonb_build_object(\'runId\',$1::text),1000 from generate_series(1,51) n',[run.runId]);
  assert.equal((await f.reserve(run.runId,'d','serper-google-search')).reason,'RUN_SEARCH_SPEND_BUDGET');
  assert.equal((await f.db.query('select count(*)::int n from public.nexus_directory_search_receipt')).rows[0].n,51);
 }finally{await f.db.close();}
});
test('month rollover removes expired free credit without minting new allowance or resetting lifetime counters',async()=>{
 const f=await setup();try{
  const expiry=new Date(Date.now()+3600000).toISOString();await f.observe('brave-web-search',{grantRemainingMicroUsd:5920000,grantExpiresAt:expiry});
  const n=new Date();const future=new Date(Date.UTC(n.getUTCFullYear(),n.getUTCMonth()+1,2)).toISOString();
  const next=(await f.db.query('select public.directory_provider_budget_state($1,$2::timestamptz) r',['brave',future])).rows[0].r;
  assert.equal(next.projectedBalanceMicroUsd,0);assert.equal(next.currentStage,'blocked');
  assert.equal(next.currentMonthConsumptionMicroUsd,0);
  const row=(await f.db.query("select request_count,reserved_micro_usd,jsonb_array_length(provider_account_history)::int observations from public.nexus_directory_search_allowance where allowance_id='brave'")).rows[0];assert.equal(row.request_count,810);assert.equal(row.reserved_micro_usd,4050000);assert.equal(row.observations,2);
 }finally{await f.db.close();}
});
test('provider daily limits and Brave monthly limit are independent of lifetime counters and do not refund failures',async()=>{
 const f=await setup();try{
  const run=await f.open();
  await f.db.query("insert into public.nexus_directory_search_receipt(query_sha256,allowance_id,request_key,parameters,reserved_micro_usd,state,reserved_at) select lpad(n::text,64,'0'),'brave',n::text,'{}',5000,'FAILED',clock_timestamp()-interval '2 seconds' from generate_series(1,50) n");
  assert.equal((await f.reserve(run.runId,'b')).reason,'PROVIDER_DAILY_BUDGET');
  await f.observe('brave-web-search',{providerMonthConsumedMicroUsd:10000000,ledgerMonthReservedMicroUsd:250000});assert.equal((await f.reserve(run.runId,'c')).reason,'ALLOCATION_EXHAUSTED');
  assert.equal((await f.reserve(run.runId,'d','serper-google-search')).state,'RESERVED');
  await f.db.exec("update public.nexus_directory_search_allowance set request_count=2500,reserved_micro_usd=12500000 where allowance_id='brave'");
  assert.equal((await f.db.query("select request_count from public.nexus_directory_search_allowance where allowance_id='brave'")).rows[0].request_count,2500);
  await assert.rejects(f.db.exec("update public.nexus_directory_search_allowance set request_count=5001 where allowance_id='serper'"),/directory_provider_lifetime_calls/);
 }finally{await f.db.close();}
});
test('alerts use true account/internal fractions at 25 and 10 percent while blocked retains the reserve guard',async()=>{
 const f=await setup();try{
  const state=async(availableMicroUsd:number,providerMonthConsumedMicroUsd=4075000)=>{
   await f.observe('brave-web-search',{availableMicroUsd,providerMonthConsumedMicroUsd,accountCreditBasisMicroUsd:10000000});
   return (await f.status()).providers.find((p:any)=>p.providerId==='brave-web-search');
  };
  const thirty=await state(3000000);assert.equal(thirty.currentStage,'healthy');assert.equal(thirty.conservativeRemainingMicroUsd,2500000);assert.equal(thirty.providerRemainingFraction,.3);
  assert.equal((await state(2500000)).currentStage,'25_percent');assert.equal((await state(1500000)).currentStage,'25_percent');assert.equal((await state(1000000)).currentStage,'10_percent');
  assert.equal((await state(504999)).currentStage,'blocked');
  const internal=await state(4000000,9000000);assert.equal(internal.currentStage,'10_percent');assert.equal(internal.internalRemainingFraction,.1);
  await assert.rejects(f.observe('brave-web-search',{accountCreditBasisMicroUsd:0}),/OBSERVATION_INVALID/);
 }finally{await f.db.close();}
});
test('combined legacy bounds permit Brave month rollover without relaxing Serper stock or nonnegative history',async()=>{
 const f=await setup({combinedConstraints:true});try{
  await f.db.exec("update public.nexus_directory_search_allowance set request_count=2500,reserved_micro_usd=12500000 where allowance_id='brave'");
  const r=(await f.db.query("select request_count,reserved_micro_usd,jsonb_array_length(provider_account_history)::int history from public.nexus_directory_search_allowance where allowance_id='brave'")).rows[0];assert.equal(r.request_count,2500);assert.equal(r.reserved_micro_usd,12500000);assert.equal(r.history,1);
  const now=new Date();const nextMonth=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,2)).toISOString();
  const month=(await f.db.query('select public.directory_provider_budget_state($1,$2) r',['brave',nextMonth])).rows[0].r;assert.equal(month.currentMonthConsumptionMicroUsd,0);assert.equal(month.actualRemainingAllowanceMicroUsd,10000000);assert.equal(month.lifetimeRequestCount,2500);assert.equal(month.projectedBalanceMicroUsd,0);
  await assert.rejects(f.db.exec("update public.nexus_directory_search_allowance set request_count=5001 where allowance_id='serper'"),/directory_provider_lifetime_calls/);
  await assert.rejects(f.db.exec("update public.nexus_directory_search_allowance set reserved_micro_usd=5000001 where allowance_id='serper'"),/directory_provider_lifetime_credit/);
  await assert.rejects(f.db.exec("update public.nexus_directory_search_allowance set request_count=-1 where allowance_id='brave'"),/directory_provider_lifetime_calls/);
  await assert.rejects(f.db.exec("update public.nexus_directory_search_allowance set reserved_micro_usd=-1 where allowance_id='brave'"),/directory_provider_lifetime_credit/);
 }finally{await f.db.close();}
});
test('nested provider financial/day limits govern smaller scopes before legacy flat fallbacks',async()=>{
 const f=await setup();try{
  const bounded={...policy,providerLimits:{brave:{monthlyUsd:6,dailyRequests:1,reserveUsd:.75},serper:{allocationUsd:2,dailyRequests:1}}};
  await f.db.query('update public.nexus_directory_standing_policy set policy=$1 where policy_id=$2',[bounded,'p']);
  const s=await f.status();assert.equal(s.providers.find((p:any)=>p.providerId==='brave-web-search').actualRemainingAllowanceMicroUsd,1925000);assert.equal(s.providers.find((p:any)=>p.providerId==='serper-google-search').actualRemainingAllowanceMicroUsd,658000);
  const run=await f.open();
  await f.db.exec("insert into public.nexus_directory_search_receipt(query_sha256,allowance_id,request_key,parameters,reserved_micro_usd,state,reserved_at) values(repeat('1',64),'brave','old-brave','{}',5000,'FAILED',clock_timestamp()-interval '2 seconds'),(repeat('2',64),'serper','old-serper','{}',1000,'FAILED',clock_timestamp()-interval '2 seconds')");
  assert.equal((await f.reserve(run.runId,'b')).reason,'PROVIDER_DAILY_BUDGET');assert.equal((await f.reserve(run.runId,'c','serper-google-search')).reason,'PROVIDER_DAILY_BUDGET');
 }finally{await f.db.close();}
});
test('observations are service-only, policy/provider scoped, monotonic and preserve Serper actual credit expiry',async()=>{
 const f=await setup();try{
  const expired=(await f.db.query('select public.observe_directory_provider_balance($1,$2,$3,$4) r',['p','b'.repeat(64),'brave-web-search',{}])).rows[0].r;assert.equal(expired.reason,'POLICY_SCOPE');
  await assert.rejects(f.observe('brave-web-search',{verifiedAt:'2020-01-01'}),/OBSERVATION_SCOPE/);
  await assert.rejects(f.observe('brave-web-search',{grantRemainingMicroUsd:undefined}),/GRANT_INVALID/);
  await assert.rejects(f.observe('brave-web-search',{grantRemainingMicroUsd:1}),/GRANT_INVALID/);
  await f.observe('serper-google-search',{creditExpiresAt:'2027-04-03T00:00:00Z'});
  const state=(await f.db.query('select public.directory_provider_budget_state($1,$2) r',['serper','2027-04-04T00:00:00Z'])).rows[0].r;
  assert.equal(state.currentStage,'blocked');assert.equal(state.reason,'ALLOWANCE_INACTIVE');assert.match(state.expiresAt,/2027-04-03/);
  const permissions=(await f.db.query("select has_function_privilege('authenticated','public.observe_directory_provider_balance(text,text,text,jsonb)','execute') allowed")).rows[0];assert.equal(permissions.allowed,false);
 }finally{await f.db.close();}
});
test('standing crawl reservations still enforce daily budget and queue-specific identity protections',async()=>{
 const f=await setup();try{
  const run=await f.open();const day=new Date().toISOString().slice(0,10);
  await f.db.query('insert into public.nexus_directory_daily_budget values($1,$2,100,1400)',['p',day]);
  const r=(await f.db.query('select public.reserve_nexus_directory_run_work($1) r',[{policyId:'p',policySha256:hash,runId:run.runId,day,host:'example.test',identityKey:'l:1',queueId:'q:1',reservationKey:'c'.repeat(64),country:'GB',action:'VERIFY_WEBSITE',requestBudget:6}])).rows[0].r;
  assert.equal(r.reason,'DAILY_BUDGET');assert.equal((await f.db.query('select count(*)::int n from public.nexus_directory_work_receipt')).rows[0].n,0);
 }finally{await f.db.close();}
});
test('first standing cycle counts earlier same-day PER_RUN crawl receipts and preserves their history',async()=>{
 const f=await setup();try{
  const run=await f.open();const day=new Date().toISOString().slice(0,10);
  await f.db.query("insert into public.nexus_directory_work_receipt(reservation_key,policy_id,day,queue_id,identity_key,host,country,reserved_requests,state) select lpad(n::text,64,'0'),'p',$1,'old-q:'||n,'old-i:'||n,'old.example','GB',14,'COMPLETED' from generate_series(1,100) n",[day]);
  const result=(await f.db.query('select public.reserve_nexus_directory_run_work($1) r',[{policyId:'p',policySha256:hash,runId:run.runId,day,host:'new.example',identityKey:'new:1',queueId:'new:1',reservationKey:'f'.repeat(64),country:'GB',action:'ENRICH_VERIFIED_VENUE',requestBudget:14}])).rows[0].r;
  assert.equal(result.reason,'DAILY_BUDGET');assert.equal((await f.db.query('select count(*)::int n from public.nexus_directory_work_receipt')).rows[0].n,100);
  const budget=(await f.db.query('select reserved_venues,reserved_requests from public.nexus_directory_daily_budget')).rows[0];assert.equal(budget.reserved_venues,100);assert.equal(budget.reserved_requests,1400);
 }finally{await f.db.close();}
});
test('Brave alerts claim once per stage/period, retry with original ID and keep queue acknowledgment durable',async()=>{
 const f=await setup();try{
  const claim=async(provider='brave-web-search')=>(await f.db.query('select public.claim_directory_provider_alert($1,$2,$3,$4,$5,$6) r',['p',hash,provider,'25_percent',f.month,{reason:'budget threshold'}])).rows[0].r;
  const a=await claim();assert.equal(a.state,'CLAIMED');assert.equal((await claim()).state,'INFLIGHT');
  await f.db.query('select public.complete_directory_provider_alert($1,$2,$3,$4,$5,$6)',['p',hash,'brave-web-search','25_percent',f.month,null]);const retry=await claim();assert.equal(retry.idempotencyKey,a.idempotencyKey);
  const queue='11111111-1111-4111-8111-111111111111';await f.db.query('select public.complete_directory_provider_alert($1,$2,$3,$4,$5,$6)',['p',hash,'brave-web-search','25_percent',f.month,queue]);assert.equal((await claim()).state,'REUSED');assert.equal((await claim('serper-google-search')).reason,'PROVIDER_NOT_ALERTABLE');
  await f.db.exec("select set_config('request.jwt.claim.role','authenticated',false)");await assert.rejects(f.status(),/SERVICE_ROLE_REQUIRED/);
 }finally{await f.db.close();}
});
