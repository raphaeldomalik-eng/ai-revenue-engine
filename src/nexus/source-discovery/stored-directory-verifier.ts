import {createHash} from 'node:crypto';
import {validateResearchResult,type ResearchRequest} from '../contracts.ts';
type NexusResearchResult=ReturnType<typeof validateResearchResult>;

/** A derived view of retained, explicitly accepted observations. The cached
 * result stays immutable; no parser, resolver, crawler or provider is called. */
export function storedDirectoryVerifierAcquisition(cached:Record<string,unknown>,input?:ResearchRequest):Record<string,unknown>{
 const raw=cached as unknown as NexusResearchResult&Record<string,any>,crawl=raw.directoryCrawlReceipt;
 if(raw.evidence.some(e=>(e.payload as any)?.firstPassAcquisition)||raw.directoryVerification?.state!=='VERIFIED'||raw.status!=='COMPLETED'||crawl?.status!=='COMPLETED')return cached;
 const site=raw.evidence.find(e=>e.provider==='PUBLIC_WEB'&&(e.payload as any)?.directoryVerification?.state==='VERIFIED');
 const pages=crawl.evidenceManifest?.pages;
 if(!site||!Array.isArray(pages)||!pages.length||!pages.every((p:any)=>p.url&&p.sourceHash))return cached;
 const origin=(u:string)=>{try{return new URL(u).hostname.toLowerCase().replace(/^www\./,'')}catch{return null}};
 const website=raw.facts.find(f=>f.fieldName==='officialWebsite'&&f.evidenceRef===site.evidenceRef&&typeof f.value==='string'&&(f.confidence??0)>=.9)?.value as string|undefined;
 const seed=input?.researchContext?.targetWebsite??website;
 if(!website||!seed||origin(seed)!==origin(website)||origin(crawl.finalUrl)!==origin(website))return cached;
 const contacts=(crawl.contactObservations??[]).filter((c:any)=>c.accepted===true&&!c.rejectionReason&&typeof c.evidenceRef==='string'&&pages.some((p:any)=>p.url===c.sourceUrl&&origin(p.url)===origin(website)));
 if(!contacts.some((c:any)=>c.type==='EMAIL'))return cached;
 const identityFacts=raw.facts.filter(f=>f.evidenceRef===site.evidenceRef&&typeof f.value==='string'&&['siteName','explicitVenueName','placeName','address','pageTitle','metaDescription','sourceTextExcerpt'].includes(f.fieldName)).map(f=>({...f,sourceUrl:site.sourceUrl}));
 const refs=[...new Set([site.evidenceRef,...identityFacts.map(f=>f.evidenceRef),...contacts.map((c:any)=>c.evidenceRef)])];
 const acquisition={version:1,requestId:raw.requestId,source:{verifiedUrl:seed,finalUrl:crawl.finalUrl,observedAt:raw.observedAt,sourceHash:createHash('sha256').update(pages.map((p:any)=>`${p.url}:${p.sourceHash}`).join('\n')).digest('hex')},
  crawl:{...crawl,retryable:false,evidenceManifest:{...crawl.evidenceManifest,pages:pages.map((p:any)=>({...p,observedAt:p.observedAt??raw.observedAt,evidenceRefs:[...new Set([...(p.evidenceRefs??[]),...contacts.filter((c:any)=>c.sourceUrl===p.url).map((c:any)=>c.evidenceRef),...(p.url===site.sourceUrl?[site.evidenceRef]:[])])]}))}},
  identityFacts,publicContacts:contacts.map((c:any)=>({type:c.type,value:c.value,sourceUrl:c.sourceUrl,observedAt:c.observedAt??raw.observedAt,evidenceRef:c.evidenceRef,confidence:c.confidence,reviewRequired:false,...(c.label?{label:c.label}:{}),...(c.purpose?{purpose:c.purpose}:{})})),venueFacts:[],evidenceRefs:refs};
 return {...cached,evidence:raw.evidence.map(e=>e===site?{...e,payload:{...(e.payload as Record<string,unknown>),firstPassAcquisition:acquisition,storedVerifierRecovery:{version:1,originalRequestId:raw.requestId,originalObservedAt:raw.observedAt,originalResultSha256:createHash('sha256').update(JSON.stringify(cached)).digest('hex'),websiteRequests:0,providerRequests:0}}}:e)};
}
