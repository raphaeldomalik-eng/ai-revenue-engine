import { createHash } from "node:crypto";
import { getGooglePlaceDetails, type GooglePlacesDetailsInput } from "../ai-sales-team/google-places.ts";
import { officialWebsiteDetailsAuthorization, validateResearchRequest, type ResearchRequest } from "./contracts.ts";
import { crawlVerifiedSource, extractFromFetchedDocuments, type CrawlBudget, type CrawlOutput,type FetchLike, type ResolveHost } from "./source-discovery/crawler.ts";
import type {CrawlInput} from './source-discovery/types.ts';
import {discoverOrganisationSource,type OrganisationSeedOptions} from "./organisation-source-seed.ts";
import type { ProviderResult, ResearchContext } from "./executor.ts";
import { acceptVenueEmail, distinctiveNameTokens } from "./venue-email.ts";

export type PublicWebProviderOptions = {
  onCrawl?: (output: CrawlOutput) => void | Promise<void>;
  fetchImpl?: FetchLike;
  resolveHost?: ResolveHost;
  now?: () => string;
  budget?: Partial<CrawlBudget>;
  emailGoal?: boolean;
  renderAdapter?: CrawlInput['renderAdapter'];
  renderPolicy?: CrawlInput['renderPolicy'];
  placeDetails?: typeof getGooglePlaceDetails;
  organisationSeed?:Pick<OrganisationSeedOptions,"searchProvider"|"reserveSearch">;
};

export function researchContextFromPayload(input: Record<string, unknown>): ResearchContext {
  return validateResearchRequest(input).researchContext ?? {};
}

const DEFAULT_BUDGET: CrawlBudget = {
  maxPages: 2,
  maxRequests: 4,
  maxBytesPerResponse: 500_000,
  maxRedirects: 2,
  maxRetries: 0,
  timeoutMs: 5_000,
  minRequestDelayMs: 0,
};

const SOCIAL_HOSTS = new Set([
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "tiktok.com",
  "linktr.ee",
]);
const INTERCHANGEABLE_VENUE_SUFFIXES = new Set([
  "venue", "venues", "centre", "center", "hall", "halls", "room", "rooms", "space", "spaces",
  "function", "functions", "event", "events", "estate", "farm", "lodge", "hotel", "guesthouse",
  "inn", "resort", "retreat", "garden", "gardens", "park", "club", "group", "bar", "lounge",
  "restaurant", "cafe", "bistro", "grill", "theatre", "theater", "studio", "studios", "house",
  "manor", "villa", "villas", "court", "place", "pavilion", "arena",
]);
const COUNTRY_AND_PROVINCE_STOP_WORDS = new Set([
  "south africa", "uk", "united kingdom", "england", "scotland", "wales", "northern ireland",
  "gauteng", "western cape", "kwazulu natal", "eastern cape", "free state", "mpumalanga",
  "limpopo", "north west", "northern cape",
]);

function nowOf(options: PublicWebProviderOptions) { return options.now?.() ?? new Date().toISOString(); }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function normalise(value: string) {
  const small=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const tens=['twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  let text=value.toLowerCase().replace(/&(?:amp;)?/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
  text=text.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:\s+(one|two|three|four|five|six|seven|eight|nine))?\b/g,(_,a:string,b:string)=>String((tens.indexOf(a)+2)*10+(b?small.indexOf(b):0)));
  return text;
}
function tokens(value: string) { return new Set(normalise(value).split(/\s+/).filter((item) => item.length > 2 || /^\d+$/.test(item))); }

export function locationCandidateTerms(locality: string | null | undefined, heldAddress: string | null | undefined): string[] {
  const terms = new Set<string>();
  if (locality) {
    const cleanLoc = normalise(locality);
    if (cleanLoc.length >= 3) terms.add(cleanLoc);
    const stripped = normalise(locality.replace(/\s+region$/i, ""));
    if (stripped.length >= 3) terms.add(stripped);
    for(const alias of locality.split(/\s*\/\s*|\s+or\s+/i)){const term=normalise(alias);if(term.length>=3)terms.add(term);}
  }
  if (heldAddress) {
    const full = normalise(heldAddress);
    if (full.length >= 4) terms.add(full);
    for (const part of heldAddress.split(",")) {
      const withoutParens = part.replace(/\([^)]*\)/g, " ").replace(/\b\d{4}\b/g, " ").replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi, " ");
      for (const candidatePart of [part, withoutParens,...withoutParens.split(/\s*\/\s*/)]) {
        const cleaned = normalise(candidatePart).replace(/\b(\w+(?:\s+\w+)?)\s+\1\b/g, "$1");
        if (cleaned.length >= 4 && !COUNTRY_AND_PROVINCE_STOP_WORDS.has(cleaned) && !/^\d+$/.test(cleaned)) {
          terms.add(cleaned);
        }
      }
    }
  }
  return [...terms];
}

export function nameMatches(target: string, candidate: string, locationTerms: string[] = []) {
  target=normalise(target);candidate=normalise(candidate);
  const targetTokens = tokens(target);
  const candidateTokens = tokens(candidate);
  if (targetTokens.size === 0) return false;
  if ([...targetTokens].every((token) => candidateTokens.has(token))) return true;
  const foldedTarget = normalise(target).replace(/\s+/g, "");
  const foldedCandidate = normalise(candidate).replace(/\s+/g, "");
  if (foldedTarget.length >= 6 && foldedCandidate.includes(foldedTarget)) return true;

  const distinctive = distinctiveNameTokens(target);
  if (!distinctive.length) return false;

  const locTokens = new Set(locationTerms.flatMap((term) => term.split(/\s+/)).filter((t) => t.length > 2));
  const coreDistinctive = distinctive.filter((t) => !locTokens.has(t));
  const effectiveDistinctive = coreDistinctive.length > 0 ? coreDistinctive : distinctive;
  if (!effectiveDistinctive.every((t) => candidateTokens.has(t) || foldedCandidate.includes(t))) return false;

  const requiredNonSuffix = [...targetTokens].filter((t) => !INTERCHANGEABLE_VENUE_SUFFIXES.has(t) && (!locTokens.has(t) || coreDistinctive.length === 0));
  if (!requiredNonSuffix.length || !requiredNonSuffix.every((t) => candidateTokens.has(t) || foldedCandidate.includes(t))) return false;

  const targetSuffixes = [...targetTokens].filter((t) => INTERCHANGEABLE_VENUE_SUFFIXES.has(t));
  if (targetSuffixes.length > 0) {
    const candidateHasSuffix = [...candidateTokens].some((t) => INTERCHANGEABLE_VENUE_SUFFIXES.has(t));
    if (!candidateHasSuffix) return false;
  }
  return true;
}
function tokenOverlap(left: string, right: string) { const rightTokens = tokens(right); return [...tokens(left)].filter((token) => rightTokens.has(token)); }
function hostOf(value: string) { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); }
export function isSocialUrl(value: string) {
  const host = hostOf(value);
  return [...SOCIAL_HOSTS].some((socialHost) => host === socialHost || host.endsWith(`.${socialHost}`));
}
function sourceRecordUrl(request: ResearchRequest) {
  const sourceRecordId = request.subject.candidateReference?.sourceRecordId;
  return sourceRecordId && /^https:\/\//i.test(sourceRecordId) ? sourceRecordId : null;
}
function targetName(request: ResearchRequest, context: ResearchContext) {
  return context.targetName?.trim()
    || text(context.existingFacts?.find((item) => item.fieldName === "placeName")?.value)
    || (request.subject.candidateReference?.sourceRecordId && !/^https?:\/\//i.test(request.subject.candidateReference.sourceRecordId) ? request.subject.candidateReference.sourceRecordId : null)
    || request.subject.canonicalEntityId
    || null;
}
function targetWebsite(request: ResearchRequest, context: ResearchContext) {
  const candidate = context.targetWebsite?.trim() || sourceRecordUrl(request);
  if (!candidate || isSocialUrl(candidate)) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}
function evidenceRef(request: ResearchRequest, fingerprint: string) { return `research:${request.requestId}:public_web:${fingerprint}`; }
function bounded(value: unknown, max = 2048): unknown {
  if (typeof value === "string") return value.slice(0, max);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => bounded(item, 512));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, item]) => [key, bounded(item, 512)]));
  return value;
}
function verifyIdentity(request: ResearchRequest, context: ResearchContext, identityFacts: Array<{ fieldName: string; value: unknown; sourceUrl?: string }>, finalUrl?:string,contacts:PropertyContactObservation[]=[]) {
  const accepted=withVerifiedNexusOrigin(request,context),scope=accepted.existingFacts?.find(f=>f.fieldName==='acceptedWebsiteScope')?.value;
  if(typeof scope==='string'&&finalUrl&&!withinAcceptedSite(finalUrl,scope))return{verified:false,path:null,signals:[] as string[],nameSignal:false,locationSignal:false};
  return verifyFirstPartyIdentity(targetName(request, context), accepted, identityFacts,contacts);
}

export function withVerifiedNexusOrigin(request: ResearchRequest, context: ResearchContext): ResearchContext {
  const targetHost = (() => { try { return new URL(context.targetWebsite ?? "").hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } })();
  const verifiedSource = context.existingFacts?.find(f => f.fieldName === "verifiedWebsiteOrigin" && f.value === targetHost && Boolean(f.evidenceRef) && request.existingEvidenceRefs.includes(f.evidenceRef!));
  const association = context.existingFacts?.find(f => {
    if(f.fieldName!=='acceptedWebsiteAssociation'||!f.evidenceRef||!request.existingEvidenceRefs.includes(f.evidenceRef))return false;
    const a=f.value as Record<string,any>|null;if(!a||typeof a!=='object')return false;
    const subject=request.subject;
    const bound=subject.canonicalEntityId ? a.canonicalEntityId===subject.canonicalEntityId
      :subject.candidateReference&&a.candidateReference?.sourceSystem===subject.candidateReference.sourceSystem&&a.candidateReference?.sourceRecordId===subject.candidateReference.sourceRecordId;
    return bound&&typeof a.siteUrl==='string'&&withinAcceptedSite(context.targetWebsite??'',a.siteUrl);
  });
  const facts=(context.existingFacts??[]).filter(f=>!['verifiedWebsiteOriginMatch','acceptedWebsiteScope'].includes(f.fieldName)&&(f.fieldName!=='acceptedWebsiteAssociation'||f===association));
  const ref=association?.evidenceRef??verifiedSource?.evidenceRef;
  if(ref)facts.push({fieldName:'verifiedWebsiteOriginMatch',value:true,evidenceRef:ref},{fieldName:'acceptedWebsiteScope',value:association?(association.value as Record<string,unknown>).siteUrl:context.targetWebsite,evidenceRef:ref});
  return {...context,existingFacts:facts};
}

/** An accepted branch association never authorises a sibling property page. */
export function withinAcceptedSite(value:string,scope:string){
  try{const a=new URL(value),b=new URL(scope);const host=(u:URL)=>u.hostname.toLowerCase().replace(/^www\./,'');const path=b.pathname.replace(/\/+$/,'');
    return a.protocol==='https:'&&b.protocol==='https:'&&!a.username&&!a.password&&!a.port&&!b.port&&host(a)===host(b)&&(!path||a.pathname===path||a.pathname.startsWith(path+'/'));
  }catch{return false;}
}

/** A fetched property title or shorter branch name needs the held postcode on
 * that same page. A URL can corroborate a trailing branch qualifier, never the name
 * itself. Neither a group description nor a sibling page supplies this proof. */
function corroboratedPropertyPage(name: string, context: Pick<ResearchContext, "targetWebsite" | "existingFacts">, address: string | null, facts: Array<{ fieldName: string; value: unknown; sourceUrl?: string }>) {
  const postcode = (value: string) => value.toUpperCase().match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/)?.[0]?.replace(/\s/g, "");
  const held = address && postcode(address);
  const propertyTokens=(value:string)=>tokens(normalise(value).replace(/\b(?:holiday|caravan) park\b/g,'park'));
  const wanted = [...propertyTokens(name)].filter(token => token !== "the");
  if (!held || !wanted.length) return null;
  const scope = context.existingFacts?.find(fact => fact.fieldName === "acceptedWebsiteScope")?.value;
  for (const fact of facts) {
    if (!["pageTitle", "siteName", "explicitVenueName", "placeName",'siteDescription'].includes(fact.fieldName) || typeof fact.value !== "string" || !fact.sourceUrl) continue;
    let page: URL;
    try {
      page = new URL(fact.sourceUrl);
      if (page.protocol !== "https:" || page.username || page.password || page.port) continue;
      if(fact.fieldName==='siteDescription'&&(page.pathname==='/'||!/\b(?:at|is|welcome to|discover)\b/i.test(fact.value)))continue;
      if (typeof scope === "string" && !withinAcceptedSite(fact.sourceUrl, scope)) continue;
      if (context.targetWebsite && !withinAcceptedSite(fact.sourceUrl, new URL(context.targetWebsite).origin)) continue;
    } catch { continue; }
    if (!facts.some(addressFact => addressFact.fieldName === "address" && addressFact.sourceUrl === fact.sourceUrl && typeof addressFact.value === "string" && postcode(addressFact.value) === held)) continue;
    const observed = propertyTokens(fact.value);
    const missing = wanted.filter(token => !observed.has(token));
    const direct = missing.length === 0;
    const core=wanted.filter(token=>!['pub','showbar'].includes(token));
    const descriptorAlias=core.some(t=>!INTERCHANGEABLE_VENUE_SUFFIXES.has(t))&&missing.length>0&&missing.every(token=>['pub','showbar'].includes(token))&&core.every(token=>observed.has(token));
    const firstMissing = wanted.findIndex(token => !observed.has(token));
    const alias = firstMissing >= 2
      && wanted.slice(0, firstMissing).filter(token => !INTERCHANGEABLE_VENUE_SUFFIXES.has(token)).length >= 2
      && wanted.slice(firstMissing).every(token => !observed.has(token) && tokens(page.pathname).has(token));
    if (direct || alias || descriptorAlias) return [direct ? "corroborated first-party page title" : "corroborated property-page alias", "matching property postcode", `property proof: ${fact.sourceUrl}`];
  }
  return null;
}

type PropertyContactObservation={label?:string|null;sourceUrl:string;evidenceRef?:string};
/** Literal address/name text beside a retained contact is source evidence too;
 * a different document cannot supply its title or postcode. */
function corroboratedPropertyContact(name:string,context:Pick<ResearchContext,'targetWebsite'|'existingFacts'>,address:string|null,facts:Array<{fieldName:string;value:unknown;sourceUrl?:string}>,contacts:PropertyContactObservation[]){
 const postal=(value:string)=>value.toUpperCase().match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/)?.[0]?.replace(/\s/g,'');
 const held=address&&postal(address);if(!held)return null;
 const wanted=[...tokens(name)].filter(t=>!['the','pub','showbar'].includes(t));
 for(const c of contacts){
  if(!c.label||postal(c.label)!==held||!c.evidenceRef)continue;
  if(context.targetWebsite&&!withinAcceptedSite(c.sourceUrl,new URL(context.targetWebsite).origin))continue;
  const scope=context.existingFacts?.find(f=>f.fieldName==='acceptedWebsiteScope')?.value;if(typeof scope==='string'&&!withinAcceptedSite(c.sourceUrl,scope))continue;
  const owns=(value:string)=>{const observed=tokens(value);return wanted.length>0&&wanted.every(t=>observed.has(t));};
  const samePage=facts.filter(f=>f.sourceUrl===c.sourceUrl&&['pageTitle','siteName','placeName','explicitVenueName'].includes(f.fieldName)&&typeof f.value==='string');
  const pdf=/\.pdf(?:#page=\d+)?$/i.test(c.sourceUrl);
  if(!samePage.some(f=>owns(f.value as string))&&!(pdf&&owns(c.label)))continue;
  return ['corroborated first-party property text','matching property postcode',`property proof: ${c.sourceUrl}`,`property observation: ${c.evidenceRef}`];
 }
 return null;
}

export function verifyFirstPartyIdentity(name: string | null, context: Pick<ResearchContext, "locality" | "existingFacts" | "targetWebsite">, identityFacts: Array<{ fieldName: string; value: unknown; sourceUrl?: string }>,contacts:PropertyContactObservation[]=[]) {
  if (!name) return { verified: false, path: null, signals: [] as string[], nameSignal: false, locationSignal: false };
  const existingAddress = text(context.existingFacts?.find((item) => ["address", "formattedAddress"].includes(item.fieldName))?.value);
  const locality = context.locality?.trim();
  const locTerms = locationCandidateTerms(locality, existingAddress);

  const values = identityFacts.filter((item) => ["siteName", "explicitVenueName", "placeName"].includes(item.fieldName)).map((item) => text(item.value)).filter((item): item is string => Boolean(item));
  const nameSignal = values.some((value) => nameMatches(name, value, locTerms));

  const addressValues = identityFacts.filter((item) => item.fieldName === "address").map((item) => text(item.value)).filter((item): item is string => Boolean(item));
  const locationRequired = Boolean(locality || existingAddress);
  const locationSignal = Boolean(
    locTerms.length && addressValues.some((value) => {
      const normAddr = ` ${normalise(value)} `;
      return locTerms.some((term) => normAddr.includes(` ${term} `));
    }),
  );

  const hasTitle = identityFacts.some((item) => ["siteName", "placeName"].includes(item.fieldName) && text(item.value) && nameMatches(name, text(item.value)!, locTerms));
  const hasHeading = identityFacts.some((item) => ["explicitVenueName", "placeName"].includes(item.fieldName) && text(item.value) && nameMatches(name, text(item.value)!, locTerms));
  const existingPlaceEvidence = Boolean(context.existingFacts?.some((place) =>
    ["placeId", "google_place_id"].includes(place.fieldName)
      && /^ChIJ[A-Za-z0-9_-]{23}$/.test(text(place.value) ?? "")
      && Boolean(place.evidenceRef)
      && context.existingFacts?.some((known) => known.fieldName === "placeName" && known.evidenceRef === place.evidenceRef && nameMatches(name, text(known.value) ?? "", locTerms)),
  ));
  const existingVerifiedOrigin = Boolean(context.existingFacts?.some((item) => item.fieldName === "verifiedWebsiteOriginMatch" && item.value === true && item.evidenceRef));
  if(existingVerifiedOrigin)return {verified:true,path:'DIRECT' as const,signals:['existing verified Nexus origin','accepted subject-to-site association'],nameSignal,locationSignal};
  const propertyProof = corroboratedPropertyPage(name, context, existingAddress, identityFacts);
  if (propertyProof) return { verified: true, path: "DIRECT" as const, signals: propertyProof, nameSignal: true, locationSignal: true };
  const contactProof=corroboratedPropertyContact(name,context,existingAddress,identityFacts,contacts);
  if(contactProof)return {verified:true,path:'DIRECT' as const,signals:contactProof,nameSignal:true,locationSignal:true};
  // Source-local metadata can state the venue's own name and location without
  // a structured address. Never combine a title with another page's locality.
  for(const pageUrl of new Set(identityFacts.map(f=>f.sourceUrl).filter((u):u is string=>Boolean(u)))){
   if(!context.targetWebsite)continue;
   const comparable=(s:string)=>{const u=new URL(s);return u.hostname.replace(/^www\./,'')+u.pathname.replace(/\/$/,'')+u.search;};
   if(comparable(pageUrl)!==comparable(context.targetWebsite))continue;
   // Concrete postcode evidence must use the same-page proof above; do not
   // replace a failed branch/postcode association with a weaker city match.
   if(identityFacts.some(f=>f.fieldName==='address'&&typeof f.value==='string'&&/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(f.value)))continue;
   if(context.targetWebsite&&!withinAcceptedSite(pageUrl,new URL(context.targetWebsite).origin))continue;
   const scope=context.existingFacts?.find(f=>f.fieldName==='acceptedWebsiteScope')?.value;if(typeof scope==='string'&&!withinAcceptedSite(pageUrl,scope))continue;
   const page=identityFacts.filter(f=>f.sourceUrl===pageUrl),named=page.some(f=>['siteName','pageTitle','placeName'].includes(f.fieldName)&&typeof f.value==='string'&&nameMatches(name,f.value,locTerms));
   const located=page.some(f=>['siteName','pageTitle','explicitVenueName','siteDescription'].includes(f.fieldName)&&typeof f.value==='string'&&locTerms.filter(term=>!COUNTRY_AND_PROVINCE_STOP_WORDS.has(term)).some(term=>(' '+normalise(String(f.value))+' ').includes(' '+term+' ')));
   if(named&&located)return {verified:true,path:'DIRECT' as const,signals:['direct venue name','same-page first-party name and locality',`property proof: ${pageUrl}`],nameSignal:true,locationSignal:true};
  }
  if (nameSignal && (locationSignal || ((existingPlaceEvidence || existingVerifiedOrigin) && hasTitle) || (!locationRequired && hasTitle && hasHeading))) {
    return { verified: true, path: "DIRECT" as const, signals: ["direct venue name", ...(locationSignal ? ["location alignment"] : []), ...(existingPlaceEvidence ? ["known Place identity"] : []), ...(existingVerifiedOrigin ? ["existing verified Nexus origin"] : [])], nameSignal, locationSignal };
  }

  const siteNames = identityFacts.filter((item) => item.fieldName === "siteName").map((item) => text(item.value)).filter((item): item is string => Boolean(item));
  const relationshipFacts = identityFacts.filter((item) => ["siteDescription", "explicitVenueName"].includes(item.fieldName));
  const organisationSignal = siteNames.some((value) => tokenOverlap(name, value).some((token) => token.length >= 4));
  const facilitySignal = relationshipFacts.some((item) => {
    const value = text(item.value);
    return Boolean(value && tokenOverlap(name, value).length >= 2 && /\b(?:facility|facilities|venue|conference|centre|center|operator|offers?)\b/i.test(value));
  });
  const relationshipPageSignal = relationshipFacts.some((item) => {
    try { return Boolean(item.sourceUrl && new URL(item.sourceUrl).pathname !== "/"); } catch { return false; }
  });
  if (existingPlaceEvidence && organisationSignal && facilitySignal && relationshipPageSignal && locationSignal) {
    return { verified: true, path: "FACILITY_OPERATOR" as const, signals: ["known Place identity", "first-party organisation alignment", "explicit facility relationship", "linked facility page", "location alignment"], nameSignal, locationSignal };
  }
  return { verified: false, path: null, signals: [] as string[], nameSignal: nameSignal || (organisationSignal && facilitySignal), locationSignal };
}

/** A verified property page does not make every mailbox on an operator's
 * multi-property contact directory applicable to that property. */
export function verifiedPropertyContactScope(name:string,context:Pick<ResearchContext,'locality'|'existingFacts'|'targetWebsite'>,identityFacts:Array<{fieldName:string;value:unknown;sourceUrl?:string}>,contacts:Array<PropertyContactObservation&{type?:string;value:string;purpose?:string}>,finalUrl:string){
 const explicitScope=context.existingFacts?.find(f=>f.fieldName==='acceptedWebsiteScope')?.value;
 const physicalContext={...context,existingFacts:context.existingFacts?.filter(f=>f.fieldName!=='verifiedWebsiteOriginMatch')};
 const scope=typeof explicitScope==='string'?explicitScope:finalUrl;
 const postcode=(s:string)=>s.toUpperCase().match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/)?.[0]?.replace(/\s/g,'');
 const held=context.existingFacts?.find(f=>['address','formattedAddress'].includes(f.fieldName)&&typeof f.value==='string')?.value;
 const wanted=typeof held==='string'?postcode(held):null;
 const documentUrl=(s:string)=>{try{const u=new URL(s);u.hash='';return u.href;}catch{return '';}};
 return new Map([...new Set(contacts.map(c=>c.sourceUrl))].map(url=>{
  if(!withinAcceptedSite(url,new URL(finalUrl).origin))return [url,false] as const;
  const page=identityFacts.filter(f=>documentUrl(f.sourceUrl??'')===documentUrl(url)),pageContacts=contacts.filter(c=>c.sourceUrl===url);
  const postcodes=page.filter(f=>f.fieldName==='address'&&typeof f.value==='string').map(f=>postcode(f.value as string)).filter(Boolean);
  if(wanted&&postcodes.length&&!postcodes.includes(wanted))return [url,false] as const;
  if(withinAcceptedSite(url,scope))return [url,true] as const;
  if(typeof explicitScope==='string')return [url,false] as const;
  const pageProof=verifyFirstPartyIdentity(name,physicalContext,page,pageContacts);
  if(pageProof.verified)return [url,true] as const;
  const emails=pageContacts.filter(c=>c.type==='EMAIL');
  const operatorHelp=emails.length===1&&/\b(?:access(?:ibility)?|customer relations|general enquiries|central bookings|group bookings|all (?:our )?(?:venues|shows|locations))\b/i.test(emails[0].label??'');
  return [url,operatorHelp] as const;
 }));
}

function unresolved(request: ResearchRequest, purpose: string, message: string, options: { error?: ProviderResult["error"]; evidence?: ProviderResult["evidence"]; facts?: ProviderResult["facts"]; providerUsage?: ProviderResult["providerUsage"] } = {}): ProviderResult {
  return { provider: "PUBLIC_WEB", purpose, facts: options.facts ?? [], evidence: options.evidence ?? [], unknowns: [message], conflicts: [], cost: { currency: "USD", amount: 0 }, ...(options.providerUsage ? { providerUsage: options.providerUsage } : {}), ...(options.error ? { error: options.error } : {}) };
}

function httpsCandidate(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol === "http:") url.protocol = "https:";
    if (url.protocol !== "https:") return null;
    const candidate = url.toString();
    return isSocialUrl(candidate) ? null : candidate;
  } catch { return null; }
}

function evidencedPlaceId(context: ResearchContext) {
  const fact = context.existingFacts?.find((item) => (item.fieldName === "placeId" || item.fieldName === "google_place_id") && text(item.value) && text(item.evidenceRef));
  return fact ? text(fact.value) : null;
}

function detailsInput(request: ResearchRequest, context: ResearchContext, googlePlaceId: string): GooglePlacesDetailsInput | null {
  const name = targetName(request, context);
  if (!name) return null;
  if (request.subject.entityType === "UNKNOWN") return { googlePlaceId, targetName: name, targetWebsite: null, locality: context.locality ?? null, lane: "EXACT_ID", targetType: "UNCLASSIFIED", limit: 1 };
  if (!context.locality?.trim()) return null;
  return { googlePlaceId, targetName: name, targetWebsite: null, locality: context.locality.trim(), lane: request.subject.entityType === "ORGANISATION" ? "ORGANISATION_FIRST" : "VENUE_FIRST", targetType: request.subject.entityType === "ORGANISATION" ? "ORGANISATION" : "VENUE", limit: 1 };
}

export function createPublicWebProvider(options: PublicWebProviderOptions = {}) {
  return async ({ request, context }: { request: ResearchRequest; context: ResearchContext }): Promise<ProviderResult> => {
    const purpose = request.researchPurpose;
    if (!["OFFICIAL_WEBSITE", "PUBLIC_CONTACT", "CONFLICT_RESOLUTION", "SOURCE_ENTITY_CLASSIFICATION"].includes(purpose)) return unresolved(request, purpose, "This bounded public-web adapter is limited to official website, public business contact, conflict, and classification evidence.");
    const suppliedWebsite = targetWebsite(request, context);
    let website = suppliedWebsite;
    let verificationContext = context;
    const seedEvidence: ProviderResult["evidence"] = [];
    let seededPlaceFacts: ProviderResult["facts"] = [];
    const providerUsage: NonNullable<ProviderResult["providerUsage"]> = [];
    let seedCrawl:CrawlOutput|null=null;
    let seedExtraction:ReturnType<typeof extractFromFetchedDocuments>|null=null;
    if(!website && options.organisationSeed && request.originatingProduct==="last_train_home" && request.subject.candidateReference?.sourceRecordId.startsWith("ticketmaster:promoter:")){
      const seed=await discoverOrganisationSource({...request,researchContext:{targetName:context.targetName,territory:context.territory,locality:context.locality,existingFacts:context.existingFacts}},{...options.organisationSeed,fetchImpl:options.fetchImpl,resolveHost:options.resolveHost,now:options.now});
      providerUsage.push(...seed.providerUsage);if(seed.searchEvidence)seedEvidence.push(seed.searchEvidence);
      if(seed.status!=="VERIFIED")return unresolved(request,purpose,seed.reason,{evidence:seedEvidence,providerUsage});
      website=seed.website;seedCrawl=seed.crawl;seedExtraction=seed.extraction;
    }
    if (!website && !request.providerAllowances.includes("GOOGLE_PLACES")) {
      return unresolved(request, purpose, "No evidenced public first-party HTTPS website was held. A Place ID is identity context only; Google Places is not authorised for this request, so no website seed was fetched.");
    }
    if (!website) {
      const placeId = evidencedPlaceId(context);
      const input = placeId ? detailsInput(request, context, placeId) : null;
      if (!input) return unresolved(request, purpose, "No evidenced public first-party HTTPS website or complete evidence-backed Place identity was available for bounded discovery.");
      const detailsAuthorization = officialWebsiteDetailsAuthorization(request, context);
      try {
        const details = await (options.placeDetails ?? getGooglePlaceDetails)(input, { mode: "details_selected", detailsAuthorization, evidenceStore: context.googlePlacesEvidenceStore ?? null, requestingApplication: request.originatingProduct, workflow: `nexus_public_web_seed:${purpose}` });
        providerUsage.push({ provider: "GOOGLE_PLACES", callCount: details.googleCalls ?? 1, purpose: "OFFICIAL_WEBSITE_SEED_PLACE_DETAILS", cost: null });
        if (details.result) {
          const observedAt = details.result.retrievedAt;
          const ref = evidenceRef(request, `google-place-${createHash("sha256").update(details.result.googlePlaceId).digest("hex").slice(0, 16)}`);
          seedEvidence.push({ evidenceRef: ref, provider: "GOOGLE_PLACES", externalRecordId: details.result.googlePlaceId, sourceUrl: details.result.sourceUrl, observedAt, dataClassification: "PUBLIC", licenceType: "PROPRIETARY", payload: { ...(bounded({ ...details.result, telemetry: details.telemetry }) as Record<string, unknown>), ...(details.evidence ? { googlePlacesEvidence: details.evidence } : {}) } });
          const placeFact = (fieldName: string, value: unknown) => ({ fieldName, value, evidenceRef: ref, confidence: 0.8, observedAt, subjectEntityType: request.subject.entityType, canonicalEntityId: request.subject.canonicalEntityId });
          seededPlaceFacts = [
            ...(details.result.displayName ? [placeFact("placeName", details.result.displayName)] : []),
            ...(details.result.formattedAddress ? [placeFact("formattedAddress", details.result.formattedAddress)] : []),
            placeFact("placeId", details.result.googlePlaceId),
            ...(details.result.types.length ? [placeFact("providerTypes", details.result.types)] : []),
            ...(details.result.businessStatus ? [placeFact("businessStatus", details.result.businessStatus)] : []),
          ];
          const venueProviderTypes = new Set(["event_venue", "convention_center", "stadium", "auditorium", "performing_arts_theater"]);
          const organisationProviderTypes = new Set(["association_or_organization", "corporate_office"]);
          if (details.result.types.some((type) => venueProviderTypes.has(type)) && details.result.types.some((type) => organisationProviderTypes.has(type))) {
            seededPlaceFacts.push(placeFact("classificationSignals", ["ORGANISATION_VENUE_CONFLICT"]));
          }
          if (detailsAuthorization.purpose === "OFFICIAL_WEBSITE" && ["EXACT_OR_STRONG", "REVIEW_REQUIRED"].includes(details.result.matchStatus)) website = httpsCandidate(details.result.websiteUri);
          verificationContext = { ...context, existingFacts: [...(context.existingFacts ?? []), ...(details.result.displayName ? [{ fieldName: "placeName", value: details.result.displayName, evidenceRef: ref }] : []), ...(details.result.formattedAddress ? [{ fieldName: "formattedAddress", value: details.result.formattedAddress, evidenceRef: ref }] : [])] };
        }
      } catch (error) {
        providerUsage.push({ provider: "GOOGLE_PLACES", callCount: 1, purpose: "OFFICIAL_WEBSITE_SEED_PLACE_DETAILS", cost: null });
        return unresolved(request, purpose, "Place Details could not safely acquire a website seed.", { evidence: seedEvidence, providerUsage, error: { code: "GOOGLE_PLACE_DETAILS_UNAVAILABLE", message: error instanceof Error ? error.message : "Place Details failed safely.", retryable: true } });
      }
    }
    if (!website && officialWebsiteDetailsAuthorization(request, context).purpose !== "OFFICIAL_WEBSITE") return unresolved(request, purpose, "Enterprise website lookup requires Resources/Nexus venue eligibility first. Pro place evidence was retained for Nexus classification.", { facts: seededPlaceFacts, evidence: seedEvidence, providerUsage });
    if (!website) return unresolved(request, purpose, "Place Details returned no safe HTTPS website candidate. Place evidence was retained for Nexus classification.", { facts: seededPlaceFacts, evidence: seedEvidence, providerUsage });

    try {
      if(!seedCrawl)providerUsage.push({ provider: "PUBLIC_WEB", callCount: 1, purpose, cost: { currency: "USD", amount: 0 } });
      const extractors = request.subject.entityType === "UNKNOWN" || purpose === "CONFLICT_RESOLUTION" || purpose === "SOURCE_ENTITY_CLASSIFICATION"
        ? ["IDENTITY", "PUBLIC_CONTACT", "SOURCE_CLASSIFICATION"] as const
        : ["IDENTITY", "PUBLIC_CONTACT"] as const;
      const crawl = seedCrawl??await crawlVerifiedSource({
        verifiedUrl: website,
        requestedExtractors: [...extractors],
        budget: { ...DEFAULT_BUDGET, ...options.budget },
        fetchImpl: options.fetchImpl,
        resolveHost: options.resolveHost,
        emailGoal: options.emailGoal === true,
        renderAdapter: options.renderAdapter,
        renderPolicy: options.renderPolicy,
        venueName: targetName(request, context) ?? '',
        seedUrls: (context.existingFacts ?? []).filter(f => f.fieldName === 'sourceSeedUrl' && typeof f.value === 'string' && f.evidenceRef && request.existingEvidenceRefs.includes(f.evidenceRef)).map(f => f.value as string),
      });
      await options.onCrawl?.(crawl);
      const extracted = seedExtraction??extractFromFetchedDocuments(crawl.documents, [...extractors], targetName(request, context) ?? '');
      if (!crawl.documents.length) {
        return unresolved(request, purpose, "Public-web discovery produced no safe first-party document.", { facts: seededPlaceFacts, evidence: seedEvidence, providerUsage, error: { code: "PUBLIC_WEB_UNAVAILABLE", message: crawl.stats.warnings.join(" ") || "No safe public-web document was fetched.", retryable: crawl.stats.disposition?.retryable ?? false } });
      }
      const verification = seedCrawl?{...verifyIdentity(request,verificationContext,extracted.identityFacts,crawl.finalUrl,extracted.publicContacts),verified:true,path:"ORGANISATION_SOURCE_SEED"}:verifyIdentity(request, verificationContext, extracted.identityFacts,crawl.finalUrl,extracted.publicContacts);
      const neutralEvidence = request.subject.entityType === "UNKNOWN" || purpose === "CONFLICT_RESOLUTION" || purpose === "SOURCE_ENTITY_CLASSIFICATION";
      if (!verification.verified && (!neutralEvidence || !suppliedWebsite)) {
        return unresolved(request, purpose, "The candidate site did not provide strong same-entity identity evidence.", { facts: seededPlaceFacts, evidence: seedEvidence, providerUsage });
      }

      const observedAt = nowOf(options);
      const finalUrl = crawl.finalUrl;
      const origin = new URL(finalUrl).origin;
      const acceptedContactScope=withVerifiedNexusOrigin(request,verificationContext).existingFacts?.find(f=>f.fieldName==='acceptedWebsiteScope')?.value;
      const propertyContactScope=verifiedPropertyContactScope(targetName(request,context)??'',withVerifiedNexusOrigin(request,verificationContext),extracted.identityFacts,extracted.publicContacts,finalUrl);
      const contacts = extracted.publicContacts.flatMap((item) => {
        if (new URL(item.sourceUrl).origin !== origin) return [];
        if (typeof acceptedContactScope==='string'&&!withinAcceptedSite(item.sourceUrl,acceptedContactScope)) return [];
        if(propertyContactScope.get(item.sourceUrl)!==true)return [];
        if (item.type === "EMAIL") {
          const verdict = acceptVenueEmail(item.value, item.sourceUrl, targetName(request, context) ?? "", item.label ?? "");
          return verdict.accepted ? [{ ...item, value: verdict.email, relationship: verdict.relationship }] : [];
        }
        if (item.type === "CONTACT_FORM") {
          try { return !item.reviewRequired && new URL(item.value).origin === origin ? [item] : []; } catch { return []; }
        }
        return item.type === "PHONE" ? [item] : [];
      });
      const fingerprint = createHash("sha256").update(`${finalUrl}:${crawl.documents.map((item) => item.sourceHash).join(":")}`).digest("hex").slice(0, 24);
      const ref = evidenceRef(request, fingerprint);
      const evidence = [...seedEvidence, {
        evidenceRef: ref,
        provider: "PUBLIC_WEB" as const,
        externalRecordId: `public-web:${fingerprint}`,
        sourceUrl: finalUrl,
        observedAt,
        dataClassification: "PUBLIC" as const,
        licenceType: "PUBLIC_SOURCE",
        payload: bounded({
          kind: "FIRST_PARTY_WEBSITE",
          verifiedUrl: website,
          finalUrl,
          identityFacts: extracted.identityFacts,
          contacts: contacts.map((item) => ({ type: item.type, value: item.value, sourceUrl: item.sourceUrl,
            confidence: item.confidence, reviewRequired: item.reviewRequired, label: item.label, purpose: item.purpose,
            evidenceRef: item.evidenceRef, sourceHash: crawl.documents.find(doc => doc.url === item.sourceUrl)?.sourceHash,
            ...(item.type === "EMAIL" && "relationship" in item ? { relationship: item.relationship } : {}) })),
          contactOutcome: contacts.some(c => c.type === 'EMAIL') ? 'EMAIL_FOUND'
            : crawl.stats.status !== 'COMPLETED' || crawl.observability?.renderNeededButUnavailable.length || crawl.observability?.contactPathsRemaining
              || ['REQUEST_BUDGET','PAGE_BUDGET'].includes(crawl.observability?.stopReason ?? '') ? 'CRAWL_INCOMPLETE'
            : contacts.some(c => c.type === 'CONTACT_FORM') ? 'FORM_ONLY'
            : contacts.some(c => c.type === 'PHONE') ? 'PHONE_ONLY' : 'NO_PUBLIC_CONTACT_FOUND',
          crawlStatus: crawl.stats.status,
          crawlStopReason: crawl.observability?.stopReason,
          grantedOrigins: crawl.observability?.grantedOrigins,
          verificationPath: verification.path,
          verificationSignals: verification.signals,
          sourceHashes: crawl.documents.map((item) => item.sourceHash),
          websiteOpportunity: crawl.websiteOpportunity,
        }),
      }];
      const facts: ProviderResult["facts"] = [...seededPlaceFacts, { fieldName: "officialWebsite", value: finalUrl, evidenceRef: ref, confidence: verification.verified ? 0.95 : 0.6, observedAt, subjectEntityType: request.subject.entityType, canonicalEntityId: request.subject.canonicalEntityId }];
      if (neutralEvidence) {
        for (const item of extracted.identityFacts) {
          if (["schemaOrgTypes", "pageTitle", "metaDescription", "classificationSignals", "siteName", "address","legalName","tradingName","sameAs"].includes(item.fieldName)) {
            // Individual extraction locators remain in the returned raw evidence payload.
            // The proposed fact must reference a real evidence row Nexus can stage.
            facts.push({ fieldName: item.fieldName, value: item.value, evidenceRef: ref, confidence: 0.7, observedAt, subjectEntityType: request.subject.entityType, canonicalEntityId: request.subject.canonicalEntityId });
          }
        }
      }
      if (purpose === "PUBLIC_CONTACT") {
        for (const contact of contacts) {
          const fieldName = contact.type === "EMAIL" ? "publicContactEmail" : contact.type === "PHONE" ? "publicContactPhone" : contact.type === "CONTACT_FORM" ? "contactFormUrl" : null;
          if (fieldName) facts.push({ fieldName, value: contact.value, evidenceRef: ref, confidence: contact.confidence, observedAt, subjectEntityType: request.subject.entityType, canonicalEntityId: request.subject.canonicalEntityId });
        }
        if (!contacts.length) return { provider: "PUBLIC_WEB", purpose, facts: [facts[0]!], evidence, unknowns: ["The verified first-party site published no bounded business email, phone, or same-origin contact form."], conflicts: [], cost: { currency: "USD", amount: 0 }, providerUsage };
      }
      return { provider: "PUBLIC_WEB", purpose, facts, evidence, unknowns: [], conflicts: [], cost: { currency: "USD", amount: 0 }, providerUsage };
    } catch (error) {
      return unresolved(request, purpose, "Public-web discovery failed safely without retaining unverified facts.", { facts: seededPlaceFacts, evidence: seedEvidence, providerUsage, error: { code: "PUBLIC_WEB_UNAVAILABLE", message: error instanceof Error ? error.message : "Public-web provider failed safely.", retryable: true } });
    }
  };
}
