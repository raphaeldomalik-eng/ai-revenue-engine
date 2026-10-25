import {createHash} from 'node:crypto';
import type {PublicWebSearchProvider,PublicWebSearchResult} from '../official-website-discovery.ts';
import type {BraveSearchOptions} from './brave-public-web-search.ts';
import {DirectorySearchAllocationDeniedError} from './brave-public-web-search.ts';
import {createSerperPublicWebSearchProvider,createPublicWebSearchBudget,PublicWebSearchBudgetExhaustedError} from './serper-public-web-search.ts';

/** Serper uses the same durable reservation/cache contract as Brave. The local
 * adapter budget is an additional single-call guard, never shared budget proof. */
export function createGovernedSerperSearch(options:BraveSearchOptions):PublicWebSearchProvider {
 const usage={requests:0,cacheReused:0,reservedCreditMicroUsd:0,observedAt:undefined as string|undefined};
 return {id:'serper-google-search',usage,costModel:{kind:'ZERO_INCREMENTAL',currency:'USD',amountPerCall:0},async search(input){
  if(!options.apiKey?.trim()||!options.allowanceId||!options.requestKey)throw Error('SERPER_CONFIGURATION_REQUIRED');
  if(!['GB','ZA'].includes(input.country)||!input.query.trim()||input.query.length>400||!Number.isSafeInteger(input.maxResults)||input.maxResults<1)throw Error('SERPER_QUERY_INVALID');
  const parameters={provider:'serper-google-search',q:input.query.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase(),country:input.country,count:Math.min(10,input.maxResults),locality:options.locality??'',category:options.category??''};
  const querySha256=createHash('sha256').update(JSON.stringify(parameters)).digest('hex');
  const reservation={allowanceId:options.allowanceId,requestKey:options.requestKey,querySha256,parameters,...(options.runId?{runId:options.runId}:{})};
  const reserved=await options.reserve(reservation);
  if(typeof reserved==='object'&&reserved.state==='CACHED'&&Array.isArray(reserved.results)){usage.cacheReused++;usage.observedAt=reserved.observedAt;return reserved.results;}
  if(reserved!==true&&(typeof reserved!=='object'||reserved.state!=='RESERVED'))throw new PublicWebSearchBudgetExhaustedError();
  usage.requests++;usage.reservedCreditMicroUsd+=typeof reserved==='object'?Number(reserved.reservedMicroUsd??0):0;
  try{
   const fetchImpl:typeof fetch=async(url,init)=>{
    const response=await (options.fetchImpl??fetch)(url,{...init,signal:AbortSignal.timeout(10000)});
    let bytes=0;const chunks:Uint8Array[]=[];const reader=response.body?.getReader();
    if(reader)while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>131072){await reader.cancel();throw Error('SERPER_RESPONSE_TOO_LARGE');}chunks.push(part.value);}
    return new Response(Buffer.concat(chunks),{status:response.status,headers:response.headers});
   };
   const results=await createSerperPublicWebSearchProvider({apiKey:options.apiKey,budget:createPublicWebSearchBudget(1),fetchImpl}).search(input);
   usage.observedAt=new Date().toISOString();await options.complete?.(reservation,results,{provider:'serper-google-search',observedAt:usage.observedAt,requests:1});return results;
  }catch{await options.fail?.(reservation,'SERPER_PROVIDER_FAILURE');throw Error('SERPER_PROVIDER_FAILURE');}
 }};
}

/** Unknown outcomes never trigger another purchase. Empty results and an
 * exhausted/inactive allocation may use the independently governed alternative. */
export function preferGovernedSearch(brave:PublicWebSearchProvider|null,serper:PublicWebSearchProvider|null):PublicWebSearchProvider|null {
 if(!brave)return serper;if(!serper)return brave;
 const usage={requests:0,cacheReused:0,reservedCreditMicroUsd:0,observedAt:undefined as string|undefined};
 const combined:PublicWebSearchProvider={id:brave.id,usage,costModel:{kind:'ZERO_INCREMENTAL',currency:'USD',amountPerCall:0},async search(input){
  let results:PublicWebSearchResult[]=[];
  try{results=await brave.search(input);}catch(error){if(!(error instanceof DirectorySearchAllocationDeniedError)||!['ALLOWANCE_INACTIVE','ALLOCATION_EXHAUSTED','RUN_PROVIDER_BUDGET'].includes(error.reason))throw error;}
  const chosen=results.length?brave:serper;if(!results.length)results=await serper.search(input);
  combined.id=chosen.id;
  for(const key of ['requests','cacheReused','reservedCreditMicroUsd'] as const)usage[key]=(brave.usage?.[key]??0)+(serper.usage?.[key]??0);
  usage.observedAt=chosen.usage?.observedAt;return results;
 }};return combined;
}
