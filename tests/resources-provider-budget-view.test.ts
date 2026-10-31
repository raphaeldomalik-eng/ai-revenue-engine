import assert from 'node:assert/strict';
import test from 'node:test';
import {fetchResourcesProviderBudgetStatus} from '../src/nexus/resources-provider-budget-view.ts';

const env={NEXT_PUBLIC_SUPABASE_URL:'https://cdcfmnlmshnustrqficy.supabase.co',SUPABASE_SECRET_KEY:'test-only-secret',NEXUS_DIRECTORY_STANDING_POLICY_ID:'resources-sa-uk-per-run-20261025',NEXUS_DIRECTORY_STANDING_POLICY_SHA256:'a'.repeat(64)};
test('reads only governed AIRE budget RPC and distinguishes account observation from ledger projections',async()=>{
 const result=await fetchResourcesProviderBudgetStatus({env,createClientImpl:(url:string,key:string,options:unknown)=>{
  assert.equal(url,env.NEXT_PUBLIC_SUPABASE_URL);assert.equal(key,env.SUPABASE_SECRET_KEY);assert.deepEqual(options,{auth:{persistSession:false,autoRefreshToken:false}});
  return {rpc:async(name:string,args:Record<string,unknown>)=>{
   assert.equal(name,'read_directory_provider_budget_status');assert.deepEqual(args,{p_policy_id:env.NEXUS_DIRECTORY_STANDING_POLICY_ID,p_hash:env.NEXUS_DIRECTORY_STANDING_POLICY_SHA256});
   return {error:null,data:{state:'READ',observedAt:'2026-10-31T12:00:00Z',providers:[{providerId:'brave-web-search',authoritativeBalanceMicroUsd:14000000,verifiedAt:'2026-10-30T12:00:00Z',projectedBalanceMicroUsd:13000000,conservativeRemainingMicroUsd:9000000,actualRemainingAllowanceMicroUsd:9500000,remainingRequests:1800,currentMonthConsumptionMicroUsd:500000,lifetimeRequestCount:100,lifetimeReservedMicroUsd:500000,last24hBurnMicroUsd:10000,budgetPeriod:'MONTHLY',currentStage:'healthy',secret:'MUST_NOT_RETURN'},{providerId:'serper-google-search',remainingRequests:200,currentStage:'25_percent'},{providerId:'google_places',remainingRequests:99999}]}};
  }};
 }});
 assert.equal(result.available,true);assert.equal(result.providers.length,2);
 assert.equal(result.providers[0].authoritativeBalanceUsd,14);assert.equal(result.providers[0].projectedBalanceUsd,13);
 assert.equal(result.providers[0].verifiedAt,'2026-10-30T12:00:00Z');assert.equal(result.providers[0].remainingAllowanceUsd,9.5);
 assert.equal(result.providers[0].stage,'healthy');assert(!JSON.stringify(result).includes('MUST_NOT_RETURN'));
});
test('unconfigured, denied and unavailable migrations preserve the existing dashboard with safe explanation',async()=>{
 const missing=await fetchResourcesProviderBudgetStatus({env:{}});assert.equal(missing.available,false);assert(missing.message.includes('unavailable'));
 const denied=await fetchResourcesProviderBudgetStatus({env,createClientImpl:()=>({rpc:async()=>({data:{state:'DENIED',reason:'POLICY_SCOPE'},error:null})})});assert.equal(denied.available,false);
 const failed=await fetchResourcesProviderBudgetStatus({env,createClientImpl:()=>({rpc:async()=>{throw Error('private database text');}})});assert.equal(failed.available,false);assert(!JSON.stringify(failed).includes('private database text'));
});
test('missing numeric observations stay unknown rather than zero or invented authority',async()=>{
 const result=await fetchResourcesProviderBudgetStatus({env,createClientImpl:()=>({rpc:async()=>({error:null,data:{state:'READ',providers:[{providerId:'brave-web-search',authoritativeBalanceMicroUsd:15000000,projectedBalanceMicroUsd:14500000,remainingRequests:-1,currentStage:'invented'}]}})})});
 assert.equal(result.providers[0].authoritativeBalanceUsd,null);assert.equal(result.providers[0].projectedBalanceUsd,14.5);
 assert.equal(result.providers[0].remainingRequests,null);assert.equal(result.providers[0].stage,'unknown');
});
