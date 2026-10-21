import {validateResearchRequest,validateResearchResult} from '../contracts.ts';
import {candidateRejection,type PublicWebSearchProvider,type PublicWebSearchResult} from '../official-website-discovery.ts';
import {parseNexusEnvelope,verifyNexusSignature,NEXUS_MAX_BODY_BYTES} from '../transport.ts';
import {policyHash,validateStandingPolicy,standingPolicyAllows,type StandingPolicy} from '../source-discovery/continuous-directory-policy.ts';
import {consumeDirectorySearchEvidence} from './directory-held-search.ts';

type Options={policy:StandingPolicy;approvedPolicyHash:string;secret:string;searchProvider:PublicWebSearchProvider|null;providerFor?:(requestKey:string,scope:{locality:string;category:string})=>PublicWebSearchProvider|null;now?:()=>number};
export const DIRECTORY_COVERAGE_CATEGORIES=['events_venue','conference','live_music','private_hire','wedding'] as const;
const nameQuery=(name:string,locality:string,country:string)=>`"${name}" "${locality}" "${country==='GB'?'United Kingdom':'South Africa'}" official website`;
export function directoryCoverageCandidates(results:PublicWebSearchResult[],locality=''){
 const origins=new Map<string,{websiteSeed:string;sourceUrl:string;proposedName:string;identityEstablished:false;websiteAuthority:string;canonicalImportAllowed:false}>();
 for(const r of results){
  if(candidateRejection(r.url)||!r.title)continue;const u=new URL(r.url);if(/^\/wiki\//i.test(u.pathname)||/\/(?:events?|tickets?|gigs?|shows?|listings?|e)\/[^/]+/i.test(u.pathname))continue;
  u.protocol='https:';u.hash='';
  const generic=new Set(('venue venues hire private meeting meetings room rooms event events spaces space wedding weddings conference conferences live music corporate celebration celebrations party parties city centre center in at and the near of for with free birthday birthdays functions function dedicated best top home official website '+locality).toLowerCase().split(/[^\p{L}\p{N}]+/u));
  // Select a name actually present in the search title. Generic hire/category copy
  // cannot stand in for a venue name; a later brand segment is often the useful one.
  const proposedName=r.title.split(/\s*[|–—]\s*|\s+-\s+/).map(s=>s.trim().replace(/^(?:venue hire|private hire|weddings?|events?|conferences?) (?:at|in) /i,'')).find(s=>s.length>=4&&s.length<=160&&!/\b(?:top \d+|best \d+|venues in|venues near|community cent(?:re|er)s)\b/i.test(s)&&s.toLowerCase().split(/[^\p{L}\p{N}]+/u).some(t=>t.length>=3&&!generic.has(t)));
  if(!proposedName)continue;
  const c={websiteSeed:u.href,sourceUrl:r.url,proposedName,identityEstablished:false as const,websiteAuthority:'UNVERIFIED_SEARCH_RESULT',canonicalImportAllowed:false as const};
  const previous=origins.get(u.origin);if(!previous||u.pathname==='/'&&new URL(previous.websiteSeed).pathname!=='/')origins.set(u.origin,c);
 }return [...origins.values()].slice(0,5);
}
/** Uses the existing signed research request/result boundary. Search produces no
 * official website fact, canonical identity, contact or publication authority. */
export async function handleDirectorySearchRequest(request:Request,options:Options):Promise<Response>{
 const nowMs=options.now?.()??Date.now(),now=new Date(nowMs).toISOString();
 try{validateStandingPolicy(options.policy,options.approvedPolicyHash,now);}catch{return Response.json({code:'DIRECTORY_STANDING_POLICY_INACTIVE'},{status:404});}
 if(!standingPolicyAllows(options.policy,'DISCOVER_WEBSITE'))return Response.json({code:'DIRECTORY_SEARCH_INACTIVE'},{status:404});
 const chunks:Uint8Array[]=[];let bytes=0;const reader=request.body?.getReader();if(!reader)return Response.json({code:'BODY_REQUIRED'},{status:400});
 while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>NEXUS_MAX_BODY_BYTES){await reader.cancel();return Response.json({code:'NEXUS_PAYLOAD_TOO_LARGE'},{status:413});}chunks.push(part.value);}
 const body=Buffer.concat(chunks).toString('utf8');
 if(!options.secret||!verifyNexusSignature(request.headers.get('x-nexus-signature'),request.headers.get('x-nexus-timestamp'),body,options.secret,nowMs))return Response.json({code:'NEXUS_SIGNATURE_INVALID'},{status:401});
 try{
  const input=validateResearchRequest(parseNexusEnvelope(body)),context=JSON.parse(body).directoryContext,research=input.researchContext;
  const identity=input.subject.canonicalEntityId?'canonical:'+input.subject.canonicalEntityId:input.subject.candidateReference?.sourceSystem+':'+input.subject.candidateReference?.sourceRecordId;
  const scope=research?.existingFacts?.find(f=>f.fieldName==='directorySearch')?.value as {mode?:string;query?:string;category?:string}|undefined;
  if(input.originatingProduct!=='event_suite_resources'||input.researchPurpose!=='SOURCE_ENTITY_CLASSIFICATION'||input.subject.entityType!=='UNKNOWN'||JSON.stringify(input.providerAllowances)!=='["PUBLIC_WEB"]'||input.costCeiling.currency!=='USD'||input.costCeiling.amount!==0||research?.targetWebsite)return Response.json({code:'DIRECTORY_SEARCH_SCOPE'},{status:403});
  if(context?.policyId!==options.policy.policyId||context?.policySha256!==options.approvedPolicyHash||context?.action!=='DISCOVER_WEBSITE'||context.identityKey!==identity||context.country!==research?.territory||!options.policy.countries.includes(context.country)||context.canonicalImportAllowed!==false||!input.existingEvidenceRefs.includes(context.evidenceRef)||policyHash(context.sourceLineage??[])!==policyHash(research?.existingFacts?.find(f=>f.fieldName==='sourceLineage')?.value??[]))return Response.json({code:'DIRECTORY_SEARCH_BINDING_REQUIRED'},{status:403});
  if(!scope||!['NAME','COVERAGE'].includes(scope.mode??'')||!scope.query||scope.query.length>400||!research?.targetName||!research.locality||!DIRECTORY_COVERAGE_CATEGORIES.includes(scope.category as typeof DIRECTORY_COVERAGE_CATEGORIES[number]))return Response.json({code:'DIRECTORY_SEARCH_CONTEXT_REQUIRED'},{status:400});
  if(scope.mode==='NAME'&&scope.query!==nameQuery(research.targetName,research.locality,context.country))return Response.json({code:'DIRECTORY_SEARCH_QUERY_SCOPE'},{status:403});
  const provider=options.providerFor?.(input.idempotencyKey,{locality:research.locality,category:scope.category!})??options.searchProvider;if(!provider||provider.costModel.kind!=='ZERO_INCREMENTAL'||provider.costModel.amountPerCall!==0)return Response.json({code:'BRAVE_VERIFIED_TEST_ALLOCATION_REQUIRED'},{status:503});
  const results=await provider.search({query:scope.query,country:context.country,maxResults:10});
  const finishedMs=options.now?.()??Date.now(),observedAt=provider.usage?.observedAt??new Date(finishedMs).toISOString(),age=finishedMs-Date.parse(observedAt);
  if(!Number.isFinite(age)||age< -60000||age>options.policy.freshnessHours*3600000)return Response.json({code:'DIRECTORY_SEARCH_CACHE_STALE'},{status:409});
  const ref='directory-search:'+policyHash({provider:provider.id,query:scope.query,results,observedAt});
  let candidates:Array<Record<string,unknown>>;
  if(scope.mode==='NAME'){
   const consumed=await consumeDirectorySearchEvidence({contractVersion:'aire.official-website-discovery-request.v1',requestId:input.requestId,idempotencyKey:input.idempotencyKey,correlationId:input.correlationId,originatingProduct:input.originatingProduct,subject:input.subject,identity:{venueName:research.targetName,locality:research.locality,country:context.country},providerAllowances:['PUBLIC_WEB_SEARCH'],costCeiling:input.costCeiling,requestedBy:input.requestedBy,createdAt:input.createdAt},[{query:scope.query,country:context.country,observedAt,evidenceRef:ref,mechanism:'brave-web-search',paidProviderCostUsd:0,results}],{now:new Date(Math.max(finishedMs,Date.parse(observedAt))).toISOString(),maxAgeHours:options.policy.freshnessHours});
   candidates=consumed.candidates.map(c=>({...c,proposedName:research.targetName}));
  }else candidates=directoryCoverageCandidates(results,research.locality).map(c=>({...c,evidenceRefs:[ref],observedAt}));
  const usage=provider.usage??{requests:1,cacheReused:0,reservedCreditMicroUsd:null};
  const result=validateResearchResult({contractVersion:'nexus.research-result.v1',requestId:input.requestId,idempotencyKey:input.idempotencyKey,status:'COMPLETED',facts:[],evidence:[{evidenceRef:ref,provider:'PUBLIC_WEB',externalRecordId:ref,sourceUrl:null,observedAt,dataClassification:'PUBLIC',licenceType:'PUBLIC_SOURCE',payload:{kind:'UNVERIFIED_SEARCH_CANDIDATES',directorySearch:{mode:scope.mode,query:scope.query,category:scope.category,provider:provider.id,results,candidates,sourceLineage:context.sourceLineage??[],canonicalIdentityEstablished:false,usage}}}],unknowns:[],conflicts:[],providerUsage:[{provider:'PUBLIC_WEB',callCount:usage.requests,purpose:'DIRECTORY_WEB_SEARCH',cost:{currency:'USD',amount:0}}],costSummary:{currency:'USD',amount:0},researchErrors:[],observedAt});
  return Response.json({result,receipt:{...usage,websiteRequests:0,publicationWrites:0,outreachEmails:0}});
 }catch(error){return Response.json({code:error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'DIRECTORY_SEARCH_FAILED'},{status:503});}
}
