/** Technical observations only. No code here establishes venue identity,
 * operator authority, contact acceptance or publication eligibility. */
export type CrawlDiagnostic={url:string;observedAt:string;code:string;message?:string;status?:number;retryAfter?:string|null;retryNotBefore?:string|null};
export type CrawlDisposition={version:1;code:string;category:'SUCCESS'|'RETRYABLE'|'TERMINAL'|'EVIDENCE_HELD';retryable:boolean;businessConclusion:false;url:string;domainReachable:boolean;httpStatus:number|null;retryNotBefore:string|null};
type Input={verifiedUrl:string;finalUrl:string;documents?:Array<{url:string}>;stats:{requestCount:number;pageCount:number;warnings:string[];status:string;failureClass?:string;diagnostics?:CrawlDiagnostic[];disposition?:CrawlDisposition};observability?:{responseManifest:Array<{url:string;status:number}>;blockedPages:Array<{url:string;reason:string}>;redirectChain?:unknown[]}};
export function classifyCrawlDisposition(c:Input,scope:{identityVerified?:boolean;contactAccepted?:boolean;conflict?:string;humanExcluded?:boolean}={}):CrawlDisposition{
 // Storage outages are operational holds, never a new website/business conclusion.
 const retained=c.stats.disposition;
 if(retained&&['TERMINAL_URL_HISTORY_READ_FAILED','TERMINAL_URL_HISTORY_WRITE_FAILED'].includes(retained.code))return {...retained};
 const responses=c.observability?.responseManifest??[],diagnostics=c.stats.diagnostics??[],blocked=c.observability?.blockedPages??[];
 const pageResponses=responses.filter(r=>!/(?:\/robots\.txt|sitemap[^/]*\.xml)(?:[?#]|$)/i.test(r.url));
 const entry=pageResponses.find(r=>r.url===c.verifiedUrl&&r.status>=400)||pageResponses.find(r=>r.status>=400)||pageResponses.find(r=>r.url===c.verifiedUrl)||pageResponses.at(-1);
 const meaningful=diagnostics.filter(d=>!([404,410].includes(d.status??0)&&/(?:\/robots\.txt|sitemap[^/]*\.xml)(?:[?#]|$)/i.test(d.url)));
 const diagnostic=meaningful.find(d=>d.url===c.verifiedUrl)??meaningful.at(-1),status=entry?.status??diagnostic?.status??null;
 const domainReachable=responses.some(r=>r.status>=200&&r.status<400);
 const retryNotBefore=diagnostics.map(d=>d.retryNotBefore).filter((s):s is string=>!!s&&Number.isFinite(Date.parse(s))).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]??null;
 const result=(code:string,category:CrawlDisposition['category']):CrawlDisposition=>({version:1,code,category,retryable:category==='RETRYABLE',businessConclusion:false,url:entry?.url??diagnostic?.url??c.finalUrl??c.verifiedUrl,domainReachable,httpStatus:status,retryNotBefore});
 if(scope.humanExcluded)return result('HUMAN_CONFIRMED_EXCLUSION','EVIDENCE_HELD');
 if(scope.conflict)return result('WRONG_PROPERTY_CONFLICT','EVIDENCE_HELD');
 if(blocked.some(b=>b.reason==='ROBOTS_DISALLOW'))return result('ROBOTS_EXCLUDED','EVIDENCE_HELD');
 if(blocked.some(b=>/NON_PUBLIC|BATCH_SCOPE|REDIRECT_(?:UNSAFE|HTTPS_DOWNGRADE)/.test(b.reason)))return result('INVALID_OR_UNSAFE_URL','EVIDENCE_HELD');
 if(blocked.some(b=>b.reason.startsWith('REDIRECT_')))return result('REDIRECT_AUTHORITY_UNVERIFIED','EVIDENCE_HELD');
 const code=diagnostic?.code??'',message=diagnostics.map(d=>d.message??'').join(' ')+' '+c.stats.warnings.join(' ');
 if(/DNS_NXDOMAIN/.test(code))return result('DNS_NXDOMAIN','TERMINAL');
 if(/ENOTFOUND/.test(code))return result('DNS_NOT_FOUND_UNCONFIRMED','EVIDENCE_HELD');
 if(/EAI_AGAIN|EBUSY/.test(code))return result('DNS_TEMPORARY','RETRYABLE');
 if(/ETIMEDOUT|DiscoveryTimeout/.test(code)||/request timed out/i.test(message))return result('CONNECTION_TIMEOUT','RETRYABLE');
 if(/ECONNRESET|ECONNABORTED|EPIPE/.test(code))return result('CONNECTION_RESET','RETRYABLE');
 if(/CERT|TLS|EPROTO/.test(code)||/certificate|TLS handshake/i.test(message))return result('TLS_CERTIFICATE_FAILURE','EVIDENCE_HELD');
 if(diagnostics.some(d=>d.code==='BOT_WAF_CHALLENGE'))return result('BOT_WAF_CHALLENGE_SUSPECTED','EVIDENCE_HELD');
 if(status===404||status===410){
  const targetReachable=pageResponses.some(r=>[c.verifiedUrl,c.finalUrl].includes(r.url)&&r.status>=200&&r.status<400);
  if(entry&&![c.verifiedUrl,c.finalUrl].includes(entry.url)&&targetReachable)return result('LINKED_PAGE_HTTP_'+status,'EVIDENCE_HELD');
  return result('HTTP_'+status,'TERMINAL');
 }
 if(status===429)return result('HTTP_429_RATE_LIMIT','RETRYABLE');
 if(status!==null&&[500,502,503,504].includes(status))return result('HTTP_'+status,'RETRYABLE');
 if(status===401)return result('HTTP_401_AUTH_REQUIRED','EVIDENCE_HELD');
 if(status===403)return result('HTTP_403_ACCESS_UNCERTAIN','EVIDENCE_HELD');
 if(status!==null&&status>=400)return result('HTTP_'+status,'EVIDENCE_HELD');
 if((c.documents?.length??c.stats.pageCount)>0){
  if(scope.identityVerified===false)return result('NO_VENUE_IDENTITY_EVIDENCE','EVIDENCE_HELD');
  if(scope.contactAccepted===false)return result('NO_USABLE_CONTACT_EVIDENCE','EVIDENCE_HELD');
  if(scope.identityVerified===true)return result((c.observability?.redirectChain?.length??0)>0?'OFFICIAL_URL_REDIRECT_VERIFIED':'WEBSITE_EVIDENCE_FETCHED','SUCCESS');
  return result('SITE_REACHABLE_UNVERIFIED','EVIDENCE_HELD');
 }
 if(/size limit|byte|budget|render|content.type/i.test(message))return result('RETRIEVAL_LIMIT_EVIDENCE_INCOMPLETE','EVIDENCE_HELD');
 return result('TECHNICAL_FAILURE_UNCLASSIFIED',c.stats.failureClass==='RETRYABLE'?'RETRYABLE':'EVIDENCE_HELD');
}
