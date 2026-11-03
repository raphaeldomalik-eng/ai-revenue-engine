import {createHash} from 'node:crypto';
import {validateResearchResult,type ResearchRequest} from '../contracts.ts';
import {assessWebsiteIdentity} from '../official-website-discovery.ts';
import {withVerifiedNexusOrigin,verifiedPropertyContactScope} from '../public-web.ts';
import {acceptVenueEmail} from '../venue-email.ts';
type NexusResearchResult=ReturnType<typeof validateResearchResult>;

/** A derived view of retained, explicitly accepted observations. The cached
 * result stays immutable; no parser, resolver, crawler or provider is called. */
export function storedDirectoryVerifierAcquisition(cached:Record<string,unknown>,input?:ResearchRequest):Record<string,unknown>{
 const raw=cached as unknown as NexusResearchResult&Record<string,any>,crawl=raw.directoryCrawlReceipt;
 if(input&&raw.directoryVerification?.state!=='VERIFIED')return reconsiderStoredDirectoryVerifier(cached,input);
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

/** Versioned evidence-only reconsideration. The original cache, observations,
 * request budgets and historical decision remain immutable. */
function reconsiderStoredDirectoryVerifier(cached:Record<string,unknown>,input:ResearchRequest):Record<string,unknown>{
 const raw=cached as unknown as NexusResearchResult&Record<string,any>,crawl=raw.directoryCrawlReceipt;
 if(raw.requestId!==input.requestId||raw.idempotencyKey!==input.idempotencyKey||raw.conflicts?.length||!['COMPLETED','PARTIAL'].includes(crawl?.status)||!crawl.requestCount)return cached;
 const site=raw.evidence.find(e=>e.provider==='PUBLIC_WEB'&&(e.payload as any)?.kind==='FIRST_PARTY_WEBSITE'),payload=site?.payload as Record<string,any>|undefined,pages=crawl.evidenceManifest?.pages;
 if(!site||!Array.isArray(pages)||!pages.length||!Array.isArray(payload?.identityFacts)||!input.researchContext?.targetWebsite)return cached;
 const sameDocument=(a:string,b:string)=>{try{const x=new URL(a),y=new URL(b);x.hash='';y.hash='';return x.href===y.href;}catch{return false;}};
 const bound=(item:any)=>pages.some((p:any)=>sameDocument(p.url,item.sourceUrl)&&typeof item.evidenceRef==='string'&&(item.evidenceRef.startsWith('source:'+p.sourceHash+':')||p.kind==='PDF'&&/^#page=\d+$/.test(new URL(item.sourceUrl).hash)&&item.evidenceRef.startsWith('source:'+p.sourceHash+new URL(item.sourceUrl).hash+':')));
 const identityFacts=payload.identityFacts.filter((f:any)=>f.sourceUrl&&bound(f)),observations=(crawl.contactObservations??[]).filter((c:any)=>c.sourceUrl&&bound(c));
 const context=withVerifiedNexusOrigin(input,input.researchContext),address=context.existingFacts?.find(f=>f.fieldName==='formattedAddress')?.value,country=context.territory;
 if(country!=='GB'&&country!=='ZA')return cached;
 const assessment=assessWebsiteIdentity({venueName:context.targetName!,country,heldAddress:typeof address==='string'?address:null,context,finalUrl:crawl.finalUrl,identityFacts,contactObservations:observations});
 if(!assessment.verified)return cached;
 const scope=verifiedPropertyContactScope(context.targetName!,context,identityFacts,observations,crawl.finalUrl);
 const contactDecisions=observations.map((c:any)=>{
  const verdict=c.type==='EMAIL'?acceptVenueEmail(c.value,c.sourceUrl,context.targetName!,c.label??''):null;
  // A bare address on a child article has no retained enquiry-role evidence.
  // Article schema must bind to this exact document; the held property root
  // and explicitly contextual programme/general enquiries keep their authority.
  const normalized=(value:unknown)=>String(value??'').trim().toLowerCase().replace(/\s+/g,' ');
  const bareArticleContact=c.type==='EMAIL'&&c.purpose==='GENERAL'&&normalized(c.label)===normalized(c.value)
   &&!sameDocument(c.sourceUrl,context.targetWebsite!)&&new URL(c.sourceUrl).pathname!=='/'
   &&identityFacts.some((f:any)=>f.fieldName==='schemaOrgTypes'&&sameDocument(f.sourceUrl,c.sourceUrl)&&Array.isArray(f.value)&&f.value.some((type:string)=>type==='Article'||type==='NewsArticle'));
  const qualified=scope.get(c.sourceUrl)===true&&(!verdict||verdict.accepted)&&!bareArticleContact;
  return {...c,accepted:qualified,rejectionReason:qualified?null:verdict&&!verdict.accepted?verdict.reason:bareArticleContact?'ARTICLE_CONTACT_ENQUIRY_PURPOSE_UNCONFIRMED':'PROPERTY_OR_OPERATOR_ENQUIRY_SCOPE_UNCONFIRMED'};
 });
 if(!contactDecisions.some((c:any)=>c.type==='EMAIL'&&c.accepted))return cached;
 const sourceFacts=identityFacts.filter((f:any)=>scope.get(f.sourceUrl)!==false);
 const refs=[...new Set([site.evidenceRef,...sourceFacts.map((f:any)=>f.evidenceRef),...contactDecisions.map((c:any)=>c.evidenceRef)])];
 const verification={state:'VERIFIED',url:crawl.finalUrl,evidenceRef:site.evidenceRef,signals:assessment.signals,reason:assessment.reason};
 const acquisition={version:1,requestId:raw.requestId,source:{verifiedUrl:input.researchContext.targetWebsite,finalUrl:crawl.finalUrl,observedAt:raw.observedAt,sourceHash:createHash('sha256').update(pages.map((p:any)=>`${p.url}:${p.sourceHash}`).join('\n')).digest('hex')},
  crawl:{...crawl,retryable:false},identityFacts:[...sourceFacts,...contactDecisions.filter((c:any)=>c.accepted&&c.label).map((c:any)=>({fieldName:'sourceTextExcerpt',value:c.label,sourceUrl:c.sourceUrl,evidenceRef:c.evidenceRef,confidence:c.confidence,observedAt:raw.observedAt}))].map((f:any)=>({...f,subjectEntityType:'UNKNOWN',canonicalEntityId:input.subject.canonicalEntityId,observedAt:raw.observedAt})),
  publicContacts:contactDecisions.map((c:any)=>({type:c.type,value:c.value,sourceUrl:c.sourceUrl,evidenceRef:c.evidenceRef,confidence:c.confidence,observedAt:raw.observedAt,reviewRequired:!c.accepted,...(!c.accepted?{reviewReason:c.rejectionReason}:{}),...(c.label?{label:c.label}:{}),...(c.purpose?{purpose:c.purpose}:{})})),venueFacts:[],evidenceRefs:refs};
 const fact=(fieldName:string,value:unknown,confidence:number)=>({fieldName,value,evidenceRef:site.evidenceRef,confidence,observedAt:raw.observedAt,subjectEntityType:'UNKNOWN',canonicalEntityId:input.subject.canonicalEntityId});
 const facts=[fact('officialWebsite',crawl.finalUrl,.95),...sourceFacts.filter((f:any)=>['siteName','explicitVenueName','placeName','address','pageTitle','siteDescription','schemaOrgTypes','classificationSignals'].includes(f.fieldName)).map((f:any)=>fact(f.fieldName==='siteDescription'?'metaDescription':f.fieldName,f.value,typeof f.confidence==='number'?f.confidence:.8))];
 const recovery={version:2,originalRequestId:raw.requestId,originalObservedAt:raw.observedAt,originalResultSha256:createHash('sha256').update(JSON.stringify(cached)).digest('hex'),originalVerification:raw.directoryVerification,newVerification:verification,contactDecisions,websiteRequests:0,providerRequests:0};
 return {...cached,status:'COMPLETED',facts,unknowns:[],researchErrors:[],directoryVerification:verification,evidence:raw.evidence.map(e=>e===site?{...e,payload:{...(e.payload as Record<string,unknown>),directoryVerification:{...verification,sourceEvidenceRefs:input.existingEvidenceRefs,canonicalIdentityEstablished:false},firstPassAcquisition:acquisition,storedVerifierRecovery:recovery}}:e)};
}
