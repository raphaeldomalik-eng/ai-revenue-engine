import {createHash} from 'node:crypto';
import {validateOfficialWebsiteDiscoveryRequest,validateOfficialWebsiteDiscoveryResult} from '../contracts.ts';
import {executeOfficialWebsiteDiscovery,distinctiveNameTokens,type PublicWebSearchResult} from '../official-website-discovery.ts';
import {InMemoryNexusResultStore,type NexusResultStore} from '../executor.ts';

export type HeldSearchEvidence={query:string;country:string;observedAt:string;evidenceRef:string;mechanism:string;paidProviderCostUsd:number;results:PublicWebSearchResult[]};
const stable=(value:unknown):string=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+stable(v)).join(',')+'}':JSON.stringify(value)??'null';
const hash=(value:unknown)=>createHash('sha256').update(stable(value)).digest('hex');
const normal=(value:string)=>value.trim().replace(/\s+/g,' ').toLowerCase();
/** Replays held search observations through AIRE's discovery executor. Never fetches a venue or search API. */
export async function consumeDirectorySearchEvidence(input:unknown,receipts:HeldSearchEvidence[],options:{store?:NexusResultStore;now?:string;maxAgeHours?:number}={}){
 const request=validateOfficialWebsiteDiscoveryRequest(input),now=options.now??new Date().toISOString();
 if(request.originatingProduct!=='event_suite_resources'||request.subject.entityType!=='UNKNOWN'||JSON.stringify(request.providerAllowances)!=='["PUBLIC_WEB_SEARCH"]'||request.costCeiling.currency!=='USD'||request.costCeiling.amount!==0||Object.values(request.heldEvidence).some(v=>Object.values(v).some(Boolean)))throw Error('DIRECTORY_SEARCH_ONLY_REQUIRED');
 const maxAgeHours=options.maxAgeHours??720;
 if(!Number.isFinite(Date.parse(now))||!Number.isFinite(maxAgeHours)||maxAgeHours<=0||maxAgeHours>720||!Array.isArray(receipts)||!receipts.length||receipts.length>2)throw Error('DIRECTORY_SEARCH_EVIDENCE_REQUIRED');
 const expected=`"${request.identity.venueName}" "${request.identity.locality}" "${request.identity.country==='GB'?'United Kingdom':'South Africa'}" official website`;
 const matching=receipts.filter(r=>normal(r.query)===normal(expected)&&r.country===request.identity.country);
 if(matching.length!==1)throw Error('DIRECTORY_SEARCH_EVIDENCE_SCOPE');
 const evidence=matching[0],age=Date.parse(now)-Date.parse(evidence.observedAt);
 if(!Number.isFinite(age)||age<0||age>maxAgeHours*3600000||evidence.mechanism!=='native_web_search'||evidence.paidProviderCostUsd!==0||!evidence.evidenceRef||evidence.evidenceRef.length>512||!Array.isArray(evidence.results)||evidence.results.length>10||evidence.results.some(r=>typeof r.url!=='string'||r.url.length>4096||(r.title!=null&&r.title.length>2048)||(r.snippet!=null&&r.snippet.length>6000)))throw Error('DIRECTORY_SEARCH_EVIDENCE_INVALID');
 const {createdAt:_createdAt,...semanticRequest}=request;
 const fingerprint=hash({request:semanticRequest,evidence}),key='directory-held-search-v5:'+request.idempotencyKey,store=options.store??new InMemoryNexusResultStore(),prior=await store.get(key);
 if(prior&&prior.fingerprint!==fingerprint)throw Error('DIRECTORY_SEARCH_REPLAY_SCOPE');
 if(prior)return {...prior,cacheReused:true} as unknown as Awaited<ReturnType<typeof finish>>;
 const result=validateOfficialWebsiteDiscoveryResult(await executeOfficialWebsiteDiscovery(request,{now:()=>now,maxSearchCalls:1,maxResultsPerQuery:10,searchProvider:{id:'held-native-search-evidence',costModel:{kind:'ZERO_INCREMENTAL',currency:'USD',amountPerCall:0},async search({query,country,maxResults}){if(normal(query)!==normal(expected)||country!==evidence.country)throw Error('DIRECTORY_SEARCH_EVIDENCE_SCOPE');return evidence.results.slice(0,maxResults)}},fetchImpl:async()=>{throw Error('DIRECTORY_SEARCH_CRAWL_FORBIDDEN')}}));
 if(result.crawl.requestCount!==0||result.officialWebsite||result.publicContacts.length||result.sourceDiscovery||result.costSummary.amount!==0)throw Error('DIRECTORY_SEARCH_ACQUISITION_FORBIDDEN');
 async function finish(){
  const candidates=result.candidates.filter(c=>c.state==='NOT_EVALUATED'&&!c.reasons.includes('EVENT_DETAIL_PATH_DEPRIORITISED')&&!/^\/wiki\//i.test(new URL(c.url).pathname)&&distinctiveNameTokens(request.identity.venueName).length>0&&c.reasons.some(r=>r==='DOMAIN_NAME_ALIGNMENT'||r==='TITLE_NAME_ALIGNMENT')).slice(0,5).map(c=>{const url=new URL(c.url);url.protocol='https:';return {websiteSeed:url.href,sourceUrl:c.url,websiteAuthority:'UNVERIFIED_SEARCH_RESULT' as const,evidenceRefs:[evidence.evidenceRef],observedAt:evidence.observedAt,identityEstablished:false,canonicalImportAllowed:false}});
  return {fingerprint,requestId:request.requestId,subject:request.subject,sourceObservedAt:evidence.observedAt,result,candidates,cacheReused:false,actualSearchApiCalls:0,actualWebsiteRequests:0,paidProviderCostUsd:0};
 }
 const output=await finish();await store.set(key,output as unknown as Record<string,unknown>);return output;
}
