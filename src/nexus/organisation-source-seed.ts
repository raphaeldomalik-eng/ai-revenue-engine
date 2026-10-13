import {createHash} from "node:crypto";
import type {ResearchRequest} from "./contracts.ts";
import type {ProviderResult} from "./executor.ts";
import type {PublicWebSearchProvider} from "./official-website-discovery.ts";
import {verifyFirstPartyIdentity,isSocialUrl} from "./public-web.ts";
import {crawlVerifiedSource,extractFromFetchedDocuments,type CrawlOutput,type FetchLike,type ResolveHost} from "./source-discovery/crawler.ts";
export type OrganisationSeedOptions={searchProvider:PublicWebSearchProvider|null;reserveSearch:(request:ResearchRequest,fingerprint:string)=>Promise<boolean>;fetchImpl?:FetchLike;resolveHost?:ResolveHost;now?:()=>string};
export type OrganisationSeedResult={status:"HELD"|"AMBIGUOUS"|"VERIFIED";reason:string;website:string|null;crawl:CrawlOutput|null;extraction:ReturnType<typeof extractFromFetchedDocuments>|null;searchEvidence:ProviderResult["evidence"][number]|null;providerUsage:NonNullable<ProviderResult["providerUsage"]>};
const normal=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const intermediaries=new Set(["universe.com","ticketmaster.com","ticketmaster.co.uk","ticketweb.com","ticketweb.uk","wegottickets.com","eventbrite.com","eventbrite.co.uk","seetickets.com","dice.fm","skiddle.com","axs.com","companieshouse.gov.uk","find-and-update.company-information.service.gov.uk"]);
function firstPartyCandidate(value:string){
  try{const url=new URL(value);const host=url.hostname.toLowerCase();return url.protocol==="https:"&&!url.username&&!url.password&&!isSocialUrl(url.href)&&![...intermediaries].some(domain=>host===domain||host.endsWith("."+domain));}catch{return false;}
}
/** Organisation discovery reuses the shared first-party crawler; it never substitutes Places or merges identities. */
export async function discoverOrganisationSource(request:ResearchRequest,options:OrganisationSeedOptions):Promise<OrganisationSeedResult>{
  const result:OrganisationSeedResult={status:"HELD",reason:"SOURCE_SEED_NOT_AUTHORISED",website:null,crawl:null,extraction:null,searchEvidence:null,providerUsage:[]};
  const context=request.researchContext;const name=context?.targetName?.trim();const provider=options.searchProvider;
  const now=options.now?.()??new Date().toISOString();const instant=Date.parse(now);
  if(!Number.isFinite(instant) || Date.parse(request.createdAt)>instant || instant-Date.parse(request.createdAt)>request.freshnessRequirements.maxAgeHours*3600000)return {...result,reason:"SOURCE_SEED_REQUEST_STALE_OR_FUTURE"};
  if(!name || !context?.territory || !["UNKNOWN","ORGANISATION"].includes(request.subject.entityType) || request.researchPurpose!=="SOURCE_ENTITY_CLASSIFICATION" || !request.providerAllowances.includes("PUBLIC_WEB")
    || !provider || provider.costModel.kind!=="ZERO_INCREMENTAL" || provider.costModel.amountPerCall!==0 || request.costCeiling.amount!==0)return result;
  const distinctive=normal(name).split(" ").filter(token=>token.length>=4 && !["music","events","event","promotions","promotion","promoter","limited","company","group","entertainment"].includes(token));
  if(!distinctive.length)return {...result,reason:"GENERIC_ORGANISATION_NAME_REQUIRES_REVIEW"};
  const query='"'+name.replace(/["\r\n]/g," ").slice(0,200)+'" official '+(context.territory==="GB"?"United Kingdom":"South Africa");
  const fingerprint=createHash("sha256").update(JSON.stringify({version:"organisation-source-seed.v1",request,query,provider:provider.id})).digest("hex");
  if(!await options.reserveSearch(request,fingerprint))return {...result,reason:"SOURCE_SEED_BUDGET_RESERVED_OR_EXHAUSTED"};
  // Reservation survives timeout/failure: uncertain acquisition must not be rebought automatically.
  result.providerUsage.push({provider:"PUBLIC_WEB",callCount:1,purpose:"ORGANISATION_SOURCE_SEED_SEARCH",cost:{currency:request.costCeiling.currency,amount:0}});
  try{
    const candidates=await provider.search({query,country:context.territory,maxResults:5});
    const urls=[...new Set(candidates.filter(candidate=>firstPartyCandidate(candidate.url)).map(candidate=>new URL(candidate.url).href))].slice(0,5);
    const observedAt=now;
    result.searchEvidence={evidenceRef:"research:"+request.requestId+":source_seed:"+fingerprint,provider:"PUBLIC_WEB",externalRecordId:"source-seed:"+fingerprint,sourceUrl:null,observedAt,dataClassification:"PUBLIC",licenceType:"PUBLIC_SOURCE",payload:{kind:"UNVERIFIED_SEARCH_CANDIDATES",query,provider:provider.id,candidateUrls:urls.slice(0,5),requestFingerprint:fingerprint}};
    const verified:Array<{website:string;crawl:CrawlOutput;extraction:ReturnType<typeof extractFromFetchedDocuments>}>=[];
    const attempts:Array<Record<string,unknown>>=[];
    (result.searchEvidence.payload as Record<string,unknown>).verificationAttempts=attempts;
    const origins=new Set<string>();let checked=0;
    for(const candidate of urls){
      const origin=new URL(candidate).origin;if(origins.has(origin))continue;origins.add(origin);if(checked++>=2)break;
      // Verify the site's own home page, rather than a directory/event page naming the seed.
      const crawl=await crawlVerifiedSource({verifiedUrl:origin+"/",requestedExtractors:["IDENTITY","SOURCE_CLASSIFICATION","PUBLIC_CONTACT"],budget:{maxPages:2,maxRequests:4,maxBytesPerResponse:500000,maxRedirects:1,maxRetries:0,timeoutMs:2000,minRequestDelayMs:0},fetchImpl:options.fetchImpl,resolveHost:options.resolveHost});
      result.providerUsage.push({provider:"PUBLIC_WEB",callCount:1,purpose:"ORGANISATION_FIRST_PARTY_VERIFICATION",cost:{currency:request.costCeiling.currency,amount:0}});
      const extraction=extractFromFetchedDocuments(crawl.documents,["IDENTITY","SOURCE_CLASSIFICATION","PUBLIC_CONTACT"]);
      if(Buffer.byteLength(JSON.stringify(extraction),"utf8")>32000){attempts.push({candidate,finalUrl:crawl.finalUrl,documentCount:crawl.documents.length,identityVerified:false,reason:"SOURCE_IDENTITY_EVIDENCE_EXCEEDS_BOUNDED_RESULT",sourceHashes:crawl.documents.map(d=>d.sourceHash)});continue;}
      const exactLegal=extraction.identityFacts.some(fact=>fact.fieldName==="legalName" && typeof fact.value==="string" && normal(fact.value)===normal(name));
      const identity=verifyFirstPartyIdentity(name,context,extraction.identityFacts);
      const declaredWebsite=extraction.identityFacts.some(fact=>fact.fieldName==="website"&&typeof fact.value==="string"&&new URL(fact.value).origin===new URL(crawl.finalUrl).origin);
      const heading=extraction.identityFacts.some(fact=>fact.fieldName==="explicitVenueName"&&typeof fact.value==="string"&&normal(fact.value)===normal(name));
      const identityVerified=firstPartyCandidate(crawl.finalUrl)&&(identity.verified||(exactLegal&&declaredWebsite&&heading));
      attempts.push({candidate,finalUrl:crawl.finalUrl,documentCount:crawl.documents.length,identityVerified,sourceHashes:crawl.documents.map(d=>d.sourceHash),identityFacts:extraction.identityFacts.slice(0,20),warnings:crawl.stats.warnings.slice(0,10)});
      if(crawl.documents.length && identityVerified)verified.push({website:crawl.finalUrl,crawl,extraction});
    }
    if(verified.length>1)return {...result,status:"AMBIGUOUS",reason:"MULTIPLE_FIRST_PARTY_IDENTITIES_REQUIRE_NEXUS_REVIEW"};
    if(!verified.length)return {...result,reason:"NO_VERIFIED_FIRST_PARTY_IDENTITY"};
    return {...result,...verified[0],status:"VERIFIED",reason:"FIRST_PARTY_IDENTITY_EVIDENCE_PROPOSED_FOR_NEXUS_REVIEW"};
  }catch{return {...result,reason:"SOURCE_SEED_PROVIDER_OR_NETWORK_FAILED"};}
}
