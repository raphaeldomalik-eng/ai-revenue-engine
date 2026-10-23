import {createHash} from 'node:crypto';
export type DirectoryAction='ENRICH_VERIFIED_VENUE'|'VERIFY_WEBSITE'|'DISCOVER_WEBSITE';
export type StandingPolicy={policyId:string;version:number;enabled:boolean;validFrom:string;validUntil:string;countries:string[];actions?:string[];budgetMode?:'PER_RUN';maxVenuesPerDay?:number;maxRequestsPerDay?:number;maxVenuesPerRun?:number;maxRequestsPerRun?:number;maxRequestsPerVenue:number;maxBatchVenues:number;paidProviderBudgetUsd:number;minHostDelayMs:number;freshnessHours:number;maxAttempts:number;retryBackoffHours:number;stopAfterConsecutiveFailures:number;publicationAllowed:boolean;outreachAllowed:boolean};
export type DirectoryWork={queueId:string;identityKey:string;country:string;verifiedSourceUrl:string;verifiedAt:string|null;evidenceRef:string;entityType:string;gaps:string[];ownership:string;status:string;attempts:number;requestBudget:number;cacheObservedAt?:string;cacheSatisfiedGaps?:string[];nextAttemptAt?:string;identityConflict?:boolean;suppressed?:boolean};
export type Reservation={policyId:string;policySha256:string;queueId:string;identityKey:string;country:string;host:string;reservationKey:string;requestBudget:number;day:string;runId?:string;action?:DirectoryAction};
export type ExecutionReceipt={requestCount:number;costUsd:number;status:string;retryable?:boolean;resultRef?:string};
export type Completion=Reservation&{state:string;requestCount:number|null;costUsd:number|null;nextAttemptAt:string|null;error?:string;resultRef?:string};
export type ContinuousLedger={reserve:(r:Reservation)=>Promise<boolean>;complete:(r:Completion)=>Promise<void>;isQuarantined?:(policyId:string,identityKey:string)=>Promise<boolean>};
const stable=(v:unknown):string=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+stable(x)).join(',')+'}':JSON.stringify(v)??'null';
export const policyHash=(p:unknown)=>createHash('sha256').update(stable(p)).digest('hex');
export const standingPolicyAllows=(p:StandingPolicy,action:DirectoryAction)=>(p.actions??['ENRICH_VERIFIED_VENUE']).includes(action);
export function validateStandingPolicy(p:StandingPolicy,approvedHash:string,now:string){
 if(!approvedHash||policyHash(p)!==approvedHash)throw Error('STANDING_POLICY_HASH_MISMATCH');
 const time=Date.parse(now),start=Date.parse(p.validFrom),end=Date.parse(p.validUntil);
 if(!p.enabled||!Number.isFinite(time)||!Number.isFinite(start)||!Number.isFinite(end)||time<start||time>=end)throw Error('STANDING_POLICY_INACTIVE');
 const perRun=p.budgetMode==='PER_RUN';
 const positive=[p.version,...(perRun?[p.maxVenuesPerRun,p.maxRequestsPerRun]:[p.maxVenuesPerDay,p.maxRequestsPerDay]),p.maxRequestsPerVenue,p.maxBatchVenues,p.minHostDelayMs,p.freshnessHours,p.maxAttempts,p.retryBackoffHours,p.stopAfterConsecutiveFailures];
 if((p.budgetMode!==undefined&&!perRun)||!p.policyId||positive.some(n=>typeof n!=='number'||!Number.isSafeInteger(n)||n<1)||p.maxRequestsPerVenue>14||p.maxBatchVenues>(perRun?500:50)||(perRun&&((p.maxVenuesPerRun??Infinity)>500||(p.maxRequestsPerRun??Infinity)>2500||p.maxVenuesPerDay!==undefined||p.maxRequestsPerDay!==undefined))||p.minHostDelayMs<1000||p.maxAttempts>5||p.paidProviderBudgetUsd!==0||p.publicationAllowed!==false||p.outreachAllowed!==false||!p.countries.length||p.countries.some(c=>!['GB','ZA'].includes(c)))throw Error('STANDING_POLICY_SCOPE_INVALID');
 if(p.actions&&(!Array.isArray(p.actions)||!p.actions.length||p.actions.some(a=>!['ENRICH_VERIFIED_VENUE','VERIFY_WEBSITE','DISCOVER_WEBSITE'].includes(a))))throw Error('STANDING_POLICY_ACTION_INVALID');
 return Object.freeze({...p,countries:[...p.countries]});
}
export function selectContinuousWork(items:DirectoryWork[],p:StandingPolicy,now:string){
 const selected:DirectoryWork[]=[],reuseCache:DirectoryWork[]=[],quarantined:DirectoryWork[]=[],websiteResolution:DirectoryWork[]=[],deferred:DirectoryWork[]=[];const hosts=new Set<string>(),identities=new Set<string>();const time=Date.parse(now);
 for(const item of items){
  if(!p.countries.includes(item.country)||item.suppressed||item.identityConflict||['BLOCKED','PROHIBITED','AMBIGUOUS','QUARANTINED'].includes(item.status)||item.attempts>=p.maxAttempts){quarantined.push(item);continue;}
  if(!item.gaps.length)continue;
  if(item.cacheObservedAt&&item.gaps.every(g=>(item.cacheSatisfiedGaps||[]).includes(g))&&Number.isFinite(Date.parse(item.cacheObservedAt))&&Date.parse(item.cacheObservedAt)<=time&&time-Date.parse(item.cacheObservedAt)<p.freshnessHours*3600000){reuseCache.push(item);continue;}
  let u:URL;try{u=new URL(item.verifiedSourceUrl)}catch{websiteResolution.push(item);continue;}
  const action=(item as DirectoryWork&{action?:DirectoryAction}).action??'ENRICH_VERIFIED_VENUE';
  if(!standingPolicyAllows(p,action))throw Error('STANDING_POLICY_ACTION_DENIED');
  if(u.protocol!=='https:'||u.username||u.password||!item.evidenceRef||(action==='VERIFY_WEBSITE'?item.entityType!=='UNKNOWN':!item.verifiedAt||!Number.isFinite(Date.parse(item.verifiedAt))||Date.parse(item.verifiedAt)>time||item.entityType!=='VENUE')){websiteResolution.push(item);continue;}
  if(item.nextAttemptAt&&(!Number.isFinite(Date.parse(item.nextAttemptAt))||Date.parse(item.nextAttemptAt)>time)){deferred.push(item);continue;}
  if(!Number.isInteger(item.requestBudget)||item.requestBudget<1||item.requestBudget>p.maxRequestsPerVenue)throw Error('WORK_REQUEST_BUDGET_INVALID');
  const host=u.hostname.toLowerCase();if(hosts.has(host)||identities.has(item.identityKey)||selected.length>=p.maxBatchVenues){deferred.push(item);continue;}
  hosts.add(host);identities.add(item.identityKey);selected.push(item);
 }
 return {selected,reuseCache,quarantined,websiteResolution,deferred};
}
/** Uses the existing AIRE executor via a supplied adapter. No crawler/provider implementation here. */
export async function runContinuousDirectoryTick(items:DirectoryWork[],policy:StandingPolicy,approvedHash:string,ledger:ContinuousLedger,execute:(item:DirectoryWork,reservation:Reservation)=>Promise<ExecutionReceipt>,now=new Date().toISOString(),runId?:string){
 const p=validateStandingPolicy(policy,approvedHash,now),selection=selectContinuousWork(items,p,now),day=new Date(now).toISOString().slice(0,10);
 if(p.budgetMode==='PER_RUN'&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(runId??''))throw Error('STANDING_POLICY_RUN_ID_REQUIRED');
 const result={selected:selection.selected.length,cacheReused:selection.reuseCache.length,quarantined:selection.quarantined.length,needsWebsiteResolution:selection.websiteResolution.length,deferred:selection.deferred.length,executed:0,denied:0,actualHttpRequestsKnown:0,actualRequestsUnknown:0,knownCostUsd:0,unknownCostReceipts:0,stopped:null as string|null};let failures=0;
 for(const item of selection.selected){
  const reservation:Reservation={policyId:p.policyId,policySha256:approvedHash,queueId:item.queueId,identityKey:item.identityKey,country:item.country,host:new URL(item.verifiedSourceUrl).hostname.toLowerCase(),requestBudget:item.requestBudget,day,...(p.budgetMode==='PER_RUN'?{runId}:{}),action:(item as DirectoryWork&{action?:DirectoryAction}).action??'ENRICH_VERIFIED_VENUE',reservationKey:policyHash({policy:p.policyId,version:p.version,queue:item.queueId,attempt:item.attempts,...(p.budgetMode==='PER_RUN'?{runId}:{day}),evidence:item.evidenceRef,url:item.verifiedSourceUrl})};
  if(!await ledger.reserve(reservation)){result.denied++;continue;}
  result.executed++;
  let receipt:ExecutionReceipt;
  try{receipt=await execute(item,reservation)}catch(error){
   failures++;result.actualRequestsUnknown++;result.unknownCostReceipts++;
   await ledger.complete({...reservation,state:'RETRYABLE',requestCount:null,costUsd:null,nextAttemptAt:new Date(Date.parse(now)+p.retryBackoffHours*3600000*2**item.attempts).toISOString(),error:error instanceof Error?error.message:'EXECUTION_FAILED'});
   if(failures>=p.stopAfterConsecutiveFailures){result.stopped='CONSECUTIVE_FAILURE_LIMIT';break;}continue;
  }
  if(!Number.isSafeInteger(receipt.requestCount)||receipt.requestCount<0||receipt.requestCount>item.requestBudget||receipt.costUsd!==0){
   await ledger.complete({...reservation,state:'QUARANTINED',requestCount:Number.isFinite(receipt.requestCount)?receipt.requestCount:null,costUsd:Number.isFinite(receipt.costUsd)?receipt.costUsd:null,nextAttemptAt:null,error:'EXECUTOR_BUDGET_VIOLATION'});result.stopped='EXECUTOR_BUDGET_VIOLATION';break;
  }
  result.actualHttpRequestsKnown+=receipt.requestCount;result.knownCostUsd+=receipt.costUsd;
  const ok=!receipt.retryable&&['COMPLETED','PARTIAL'].includes(receipt.status);failures=0;
  const state=ok?'COMPLETED':receipt.status==='BLOCKED'||receipt.retryable===false?'QUARANTINED':'RETRYABLE';
  await ledger.complete({...reservation,state,requestCount:receipt.requestCount,costUsd:receipt.costUsd,resultRef:receipt.resultRef,nextAttemptAt:state==='RETRYABLE'?new Date(Date.parse(now)+p.retryBackoffHours*3600000*2**item.attempts).toISOString():null});
  if(failures>=p.stopAfterConsecutiveFailures){result.stopped='CONSECUTIVE_FAILURE_LIMIT';break;}
 }
 return result;
}
