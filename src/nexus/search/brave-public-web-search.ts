import {createHash} from 'node:crypto';
import type {PublicWebSearchProvider,PublicWebSearchResult} from '../official-website-discovery.ts';
import {PublicWebSearchBudgetExhaustedError} from './serper-public-web-search.ts';

export const BRAVE_SEARCH_URL='https://api.search.brave.com/res/v1/web/search';
export type BraveSearchInput={query:string;country:'GB'|'ZA';maxResults:number;locality?:string;category?:string};
export type BraveReservation={allowanceId:string;requestKey:string;querySha256:string;parameters:Record<string,string|number>;runId?:string};
export type BraveReservationResult=boolean|{state:string;reason?:string;results?:PublicWebSearchResult[];observedAt?:string;reservedMicroUsd?:number};
export class DirectorySearchAllocationDeniedError extends PublicWebSearchBudgetExhaustedError {
 readonly reason:string;
 constructor(reason:string){super();this.reason=reason;}
}
export type BraveSearchOptions={apiKey:string;allowanceId:string;requestKey:string;locality?:string;category?:string;runId?:string;reserve:(reservation:BraveReservation)=>Promise<BraveReservationResult>;complete?:(reservation:BraveReservation,results:PublicWebSearchResult[],usage:Record<string,unknown>)=>Promise<void>;fail?:(reservation:BraveReservation,code:string)=>Promise<void>;fetchImpl?:typeof fetch;onResponse?:(headers:Headers,status:number)=>Promise<void>};
export function braveSearchParameters(input:BraveSearchInput){
 if(!['GB','ZA'].includes(input.country)||!input.query.trim()||input.query.length>400||!Number.isSafeInteger(input.maxResults)||input.maxResults<1)throw Error('BRAVE_QUERY_INVALID');
 return {q:input.query.normalize('NFKC').trim().replace(/\s+/g,' '),country:input.country.toLowerCase(),search_lang:'en',count:Math.min(10,input.maxResults),safesearch:'moderate',result_filter:'web'};
}
export function braveQueryFingerprint(input:BraveSearchInput){
 const parameters=braveSearchParameters(input);
 return createHash('sha256').update(JSON.stringify({...parameters,q:parameters.q.toLocaleLowerCase('en'),locality:(input.locality??'').trim().toLowerCase(),category:(input.category??'').trim().toLowerCase()})).digest('hex');
}
export class BraveSearchFailure extends Error{
 readonly code:string;readonly retryable:boolean;readonly retryAfterSeconds:number|null;
 constructor(status:number|null,code='BRAVE_PROVIDER_FAILURE',retryAfterSeconds:number|null=null){super(code);this.code=code;this.retryable=status===null||status===429||status>=500;this.retryAfterSeconds=retryAfterSeconds;}
}
/** Implements the existing search interface. The caller's durable governor owns the
 * verified account price, finite credit allocation and query cache. No automatic retries. */
export function createBravePublicWebSearchProvider(options:BraveSearchOptions):PublicWebSearchProvider{
 const usage={requests:0,cacheReused:0,reservedCreditMicroUsd:0,observedAt:undefined as string|undefined};
 return {id:'brave-web-search',usage,costModel:{kind:'ZERO_INCREMENTAL',currency:'USD',amountPerCall:0},async search(input){
  if(!options.apiKey?.trim()||!options.allowanceId||!options.requestKey)throw Error('BRAVE_CONFIGURATION_REQUIRED');
  const parameters=braveSearchParameters(input),querySha256=braveQueryFingerprint({...input,locality:options.locality,category:options.category});
  const reservation={allowanceId:options.allowanceId,requestKey:options.requestKey,querySha256,parameters,...(options.runId?{runId:options.runId}:{})};
  const reserved=await options.reserve(reservation);
  if(typeof reserved==='object'&&reserved.state==='CACHED'&&Array.isArray(reserved.results)){usage.cacheReused++;usage.observedAt=reserved.observedAt;return reserved.results;}
  if(reserved!==true&&(typeof reserved!=='object'||reserved.state!=='RESERVED'))throw new DirectorySearchAllocationDeniedError(typeof reserved==='object'?reserved.reason??'DENIAL_UNKNOWN':'DENIAL_UNKNOWN');
  try{
  usage.requests++;usage.reservedCreditMicroUsd+=typeof reserved==='object'?Number(reserved.reservedMicroUsd??0):0;
  const url=new URL(BRAVE_SEARCH_URL);for(const [key,value] of Object.entries(parameters))url.searchParams.set(key,String(value));
  let response:Response;
  try{response=await (options.fetchImpl??fetch)(url,{headers:{'X-Subscription-Token':options.apiKey.trim(),Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10000)});}catch{throw new BraveSearchFailure(null);}
  await options.onResponse?.(response.headers,response.status);
  if(!response.ok){await response.body?.cancel();const reset=response.headers.get('Retry-After')??response.headers.get('X-RateLimit-Reset');const seconds=reset?Math.max(...reset.split(',').map(Number).filter(Number.isFinite)):null;throw new BraveSearchFailure(response.status,'BRAVE_HTTP_'+response.status,seconds);}
  let bytes=0;const chunks:Uint8Array[]=[];const reader=response.body?.getReader();
  if(reader)while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>131072){await reader.cancel();throw new BraveSearchFailure(200,'BRAVE_RESPONSE_TOO_LARGE');}chunks.push(part.value);}
  let payload:{type?:unknown;query?:{original?:unknown;more_results_available?:unknown};web?:{results?:unknown}|null};try{payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new BraveSearchFailure(200,'BRAVE_RESPONSE_INVALID');}
  // Brave documents nullable web results. Only an explicitly final, matching
  // search response proves emptiness; malformed/unknown outcomes stay consumed.
  const empty=payload?.web==null&&payload?.type==='search'&&payload.query?.original===parameters.q&&payload.query.more_results_available===false;
  if(!Array.isArray(payload?.web?.results)&&!empty)throw new BraveSearchFailure(200,'BRAVE_RESPONSE_INVALID');
  const rows=empty?[]:payload.web!.results as unknown[];
  const results:PublicWebSearchResult[]=[];
  for(const row of rows.slice(0,parameters.count)){
   if(!row||typeof row!=='object')continue;const r=row as Record<string,unknown>;if(typeof r.url!=='string'||r.url.length>4096)continue;
   try{const u=new URL(r.url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)continue;}catch{continue;}
   results.push({url:r.url,title:typeof r.title==='string'?r.title.slice(0,2048):null,snippet:typeof r.description==='string'?r.description.slice(0,6000):null});
  }
  usage.observedAt=new Date().toISOString();
  await options.complete?.(reservation,results,{provider:'brave-web-search',status:response.status,responsePayload:payload,observedAt:usage.observedAt,requestCost:response.headers.get('X-Request-Requests-Cost'),rateLimitRemaining:response.headers.get('X-RateLimit-Remaining'),rateLimitReset:response.headers.get('X-RateLimit-Reset')});
  return results;
  }catch(error){await options.fail?.(reservation,error instanceof BraveSearchFailure?error.code:'BRAVE_RESPONSE_FAILED');throw error;}
 }};
}
