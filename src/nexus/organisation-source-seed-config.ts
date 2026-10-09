import {createSerperPublicWebSearchProvider} from "./search/serper-public-web-search.ts";
import type {OrganisationSeedOptions} from "./organisation-source-seed.ts";
type ReservationStore={reserveOrganisationSeedSearch:(programmeId:string,key:string,fingerprint:string)=>Promise<boolean>};
/** The database programme is the authority for verified free allowance and its durable quota. */
export function configuredOrganisationSeed(store:ReservationStore,env:Record<string,string|undefined>=process.env):Pick<OrganisationSeedOptions,"searchProvider"|"reserveSearch">|undefined{
  const programme=env.NEXUS_ORGANISATION_SOURCE_SEED_PROGRAMME_ID;
  const key=env.SERPER_API_KEY?.trim();
  if(env.NEXUS_ORGANISATION_SOURCE_SEED_ENABLED!=="true" || !programme || !/^[0-9a-f-]{36}$/i.test(programme) || !key)return undefined;
  const provider=createSerperPublicWebSearchProvider({apiKey:key,fetchImpl:async(input,init)=>{
    const response=await fetch(input,{...init,signal:AbortSignal.timeout(5000)});const reader=response.body?.getReader();const chunks:Uint8Array[]=[];let bytes=0;
    if(reader)while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>65536){await reader.cancel();throw new Error("SOURCE_SEED_SEARCH_RESPONSE_TOO_LARGE");}chunks.push(chunk.value);}
    return new Response(Buffer.concat(chunks),{status:response.status,headers:{"content-type":"application/json"}});
  }});
  return {searchProvider:{...provider,costModel:{kind:"ZERO_INCREMENTAL",currency:"USD",amountPerCall:0}},reserveSearch:(request,fingerprint)=>store.reserveOrganisationSeedSearch(programme,request.idempotencyKey,fingerprint)};
}
