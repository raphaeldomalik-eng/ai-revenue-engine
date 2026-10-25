import type {SupabaseClient} from '@supabase/supabase-js';
import {createBravePublicWebSearchProvider,type BraveReservation,type BraveReservationResult} from './brave-public-web-search.ts';
import type {PublicWebSearchResult} from '../official-website-discovery.ts';
import {createGovernedSerperSearch,preferGovernedSearch} from './governed-directory-search.ts';
export class SupabaseBraveSearchGovernor{
 constructor(private readonly client:SupabaseClient){}
 async reserve(reservation:BraveReservation):Promise<BraveReservationResult>{const {data,error}=await this.client.rpc('reserve_directory_search',{p_reservation:reservation});if(error)throw Error('BRAVE_RESERVATION_UNAVAILABLE');return data;}
 async complete(r:BraveReservation,results:PublicWebSearchResult[],usage:Record<string,unknown>){const {data,error}=await this.client.rpc('complete_directory_search',{p_query_sha256:r.querySha256,p_request_key:r.requestKey,p_results:results,p_usage:usage});if(error||!['RECORDED','REUSED'].includes(data?.state))throw Error('BRAVE_CACHE_WRITE_FAILED');}
 async fail(r:BraveReservation,code:string){const {error}=await this.client.rpc('fail_directory_search',{p_query_sha256:r.querySha256,p_request_key:r.requestKey,p_code:code});if(error)throw Error('BRAVE_FAILURE_RECEIPT_UNAVAILABLE');}
}
export function configuredDirectorySearch(client:SupabaseClient,requestKey:string,scope:{locality?:string;category?:string;runId?:string}={},env:Record<string,string|undefined>=process.env){
 const brave=configuredBraveDirectorySearch(client,requestKey,scope,env);
 const apiKey=env.SERPER_API_KEY?.trim(),allowanceId=env.SERPER_SEARCH_ALLOWANCE_ID?.trim();
 const governor=new SupabaseBraveSearchGovernor(client);
 const serper=apiKey&&allowanceId?createGovernedSerperSearch({apiKey,allowanceId,requestKey,...scope,reserve:r=>governor.reserve(r),complete:(r,results,usage)=>governor.complete(r,results,usage),fail:(r,code)=>governor.fail(r,code)}):null;
 return preferGovernedSearch(brave,serper);
}
/** Key presence alone never enables calls. The database must contain an active,
 * finite allocation priced from verified account evidence. */
export function configuredBraveDirectorySearch(client:SupabaseClient,requestKey:string,scope:{locality?:string;category?:string;runId?:string}={},env:Record<string,string|undefined>=process.env){
 const apiKey=env.BRAVE_SEARCH_API_KEY?.trim(),allowanceId=env.BRAVE_SEARCH_TEST_ALLOWANCE_ID?.trim();
 if(!apiKey||!allowanceId)return null;
 const governor=new SupabaseBraveSearchGovernor(client);
 return createBravePublicWebSearchProvider({apiKey,allowanceId,requestKey,...scope,reserve:r=>governor.reserve(r),complete:(r,results,usage)=>governor.complete(r,results,usage),fail:(r,code)=>governor.fail(r,code)});
}
