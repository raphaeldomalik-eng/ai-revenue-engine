import {createClient} from '@supabase/supabase-js';

export interface ResourcesProviderBudget {
 providerId:string;name:string;stage:string;reason:string|null;verifiedAt:string|null;
 authoritativeBalanceUsd:number|null;projectedBalanceUsd:number|null;spendableUsd:number|null;remainingAllowanceUsd:number|null;
 remainingRequests:number|null;monthlyConsumedUsd:number|null;lifetimeConsumedUsd:number|null;lifetimeRequests:number|null;last24hBurnUsd:number|null;budgetPeriod:string;
}
export interface ResourcesProviderBudgetStatus {
 available:boolean;message:string;observedAt:string|null;providers:ResourcesProviderBudget[];
}
type RpcClient={rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>};
type Options={env?:Record<string,string|undefined>;createClientImpl?:(url:string,key:string,options:{auth:{persistSession:false;autoRefreshToken:false}})=>RpcClient};
const unavailable=():ResourcesProviderBudgetStatus=>({available:false,message:'Resources provider budget data is unavailable. The governed budget policy or migration may not yet be active.',observedAt:null,providers:[]});
const numeric=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const usd=(value:unknown):number|null=>{const n=numeric(value);return n===null?null:n/1000000;};
const instant=(value:unknown):string|null=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};

/** Server-only read using AIRE's existing service client. The operator catalogue
 * API must authenticate before invoking this helper. Raw RPC data stays server-side. */
export async function fetchResourcesProviderBudgetStatus({env=process.env,createClientImpl}:Options={}):Promise<ResourcesProviderBudgetStatus>{
 const url=env.NEXT_PUBLIC_SUPABASE_URL?.trim(),key=(env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
 const policyId=env.NEXUS_DIRECTORY_STANDING_POLICY_ID?.trim(),hash=env.NEXUS_DIRECTORY_STANDING_POLICY_SHA256?.trim();
 if(!url||!key||!policyId||!/^[a-f0-9]{64}$/i.test(hash??''))return unavailable();
 try{
  const client:RpcClient=(createClientImpl??createClient)(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await client.rpc('read_directory_provider_budget_status',{p_policy_id:policyId,p_hash:hash});
  const result=record(data);if(error||result.state!=='READ'||!Array.isArray(result.providers))return unavailable();
  const names:Record<string,string>={'brave-web-search':'Brave','serper-google-search':'Serper'};
  const entries=result.providers.map(record).filter(row=>typeof row.providerId==='string'&&Object.hasOwn(names,row.providerId));
  if(!entries.length)return unavailable();
  const providers=Object.entries(names).map(([providerId,name]):ResourcesProviderBudget=>{
   const row=entries.find(value=>value.providerId===providerId)??{},verifiedAt=instant(row.verifiedAt);
   return {providerId,name,stage:['healthy','25_percent','10_percent','blocked'].includes(String(row.currentStage))?String(row.currentStage):'unknown',reason:typeof row.reason==='string'?row.reason:null,verifiedAt,
    authoritativeBalanceUsd:verifiedAt?usd(row.authoritativeBalanceMicroUsd):null,projectedBalanceUsd:usd(row.projectedBalanceMicroUsd),spendableUsd:usd(row.conservativeRemainingMicroUsd),remainingAllowanceUsd:usd(row.actualRemainingAllowanceMicroUsd),
    remainingRequests:numeric(row.remainingRequests),monthlyConsumedUsd:usd(row.currentMonthConsumptionMicroUsd),lifetimeConsumedUsd:usd(row.lifetimeReservedMicroUsd),lifetimeRequests:numeric(row.lifetimeRequestCount),last24hBurnUsd:usd(row.last24hBurnMicroUsd),budgetPeriod:row.budgetPeriod==='MONTHLY'?'Monthly':row.budgetPeriod==='LIFETIME'?'Lifetime':'Unknown'};
  });
  return {available:true,message:'Account observations and conservative ledger estimates are shown separately. Google paid-tier controls are unchanged.',observedAt:instant(result.observedAt),providers};
 }catch{return unavailable();}
}
