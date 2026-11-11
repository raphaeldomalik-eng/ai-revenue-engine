import {createHash} from 'node:crypto';
import type {CrawlOutput} from './types.ts';

const VERSION='aire.directory-audit-receipt.v1';
const MAX_WINDOW_MS=30*60*1000;
export const DIRECTORY_AUDIT_MAX_STORED_BYTES=8_000_000;
const METADATA_RESERVE=100_000;
const MAX_RECORDS=128;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const size=(value:unknown)=>Buffer.byteLength(JSON.stringify(value),'utf8');
export type DirectoryAuditConfig={requestId:string;validFrom:string;validUntil:string};
export type PrivateAuditStore={get(key:string):Promise<Record<string,unknown>|null>;set(key:string,value:Record<string,unknown>):Promise<void>};
export type AuditBinding={requestId:string;requestSha256:string;identityKey:string;queueId:string;policySha256:string;runId:string|null;attempt:number;reservationKey:string};
export type AuditResponse={url:string;status:number;contentType:string|null;contentEncoding:string|null;bytes:Uint8Array};
export type CrawlAuditSink={response(value:AuditResponse):void;failure(url:string,reason:string):void};
export type DirectoryAuditReference={receiptKey:string;state:'STORED'|'REUSED'|'UNAVAILABLE';auditSha256?:string;captureComplete?:boolean;reason?:string};

/** Server-only exact selector. Invalid configuration disables capture, never normal acquisition. */
export function directoryAuditConfigFromEnvironment(env:Record<string,string|undefined>):DirectoryAuditConfig|undefined{
 const requestId=env.NEXUS_DIRECTORY_AUDIT_REQUEST_ID,validFrom=env.NEXUS_DIRECTORY_AUDIT_VALID_FROM,validUntil=env.NEXUS_DIRECTORY_AUDIT_VALID_UNTIL;
 return requestId&&validFrom&&validUntil?{requestId,validFrom,validUntil}:undefined;
}
export function activeDirectoryAuditConfig(value:unknown,requestId:string,now:number):DirectoryAuditConfig|null{
 if(!value||typeof value!=='object')return null;
 const c=value as DirectoryAuditConfig;
 const iso=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v)&&Number.isFinite(Date.parse(v));
 if(typeof c.requestId!=='string'||!uuid.test(c.requestId)||c.requestId!==requestId||!iso(c.validFrom)||!iso(c.validUntil))return null;
 const start=Date.parse(c.validFrom),end=Date.parse(c.validUntil);
 return end>start&&end-start<=MAX_WINDOW_MS&&now>=start&&now<end?{requestId:c.requestId,validFrom:c.validFrom,validUntil:c.validUntil}:null;
}
export const directoryAuditKey=(requestId:string)=>'directory-audit:'+requestId;
function safeUrl(value:string){
 const u=new URL(value);u.username='';u.password='';u.hash='';
 for(const key of [...u.searchParams.keys()])if(/token|secret|password|auth|session|signature|credential|(?:api|access)[\s._-]*key|^sig$|^key$|email|code/i.test(key))u.searchParams.delete(key);
 const url=u.href.length<=2048?u.href:u.origin+'/';
 return {url,urlSha256:hash(value),urlRedacted:url!==value};
}
function safeContentType(value:string|null){
 const mime=value?.match(/^\s*([a-z0-9.+-]+\/[a-z0-9.+-]+)/i)?.[1];
 const charset=value?.match(/;\s*charset\s*=\s*["']?([a-z0-9_-]+)/i)?.[1];
 return mime&&mime.length<=128?mime.toLowerCase()+(charset&&charset.length<=40?'; charset='+charset:''):null;
}
function ordered(value:unknown):unknown{
 if(Array.isArray(value))return value.map(ordered);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,ordered(item)]));
 return value;
}
function digest(record:Record<string,unknown>){const {auditSha256:_ignored,...rest}=record;return hash(JSON.stringify(ordered(rest)));}
function seal(record:Record<string,unknown>){
 record.auditSha256='0'.repeat(64);record.storedBytes=0;
 for(let i=0;i<5;i++){const bytes=size(record);if(bytes===record.storedBytes)break;record.storedBytes=bytes;}
 record.auditSha256=digest(record);return record;
}
function validRecord(value:Record<string,unknown>|null,binding:AuditBinding):value is Record<string,unknown>{
 if(!value||value.contractVersion!==VERSION||value.requestId!=='directory-audit-receipt:'+binding.requestId||value.dataClassification!=='INTERNAL'||value.auditSha256!==digest(value)||value.storedBytes!==size(value)||Number(value.storedBytes)>DIRECTORY_AUDIT_MAX_STORED_BYTES)return false;
 const corpus=value.directoryAuditCorpus as {binding?:AuditBinding}|undefined,b=corpus?.binding;
 return !!b&&b.requestId===binding.requestId&&b.requestSha256===binding.requestSha256&&b.identityKey===binding.identityKey&&b.queueId===binding.queueId&&b.policySha256===binding.policySha256;
}
function reference(key:string,record:Record<string,unknown>,state:'STORED'|'REUSED'):DirectoryAuditReference{
 return {receiptKey:key,state,auditSha256:String(record.auditSha256),captureComplete:(record.directoryAuditCorpus as {captureComplete:boolean}).captureComplete};
}

/** One bounded corpus, captured passively. No fetch, renderer, public result or credential access. */
class AuditCollector implements CrawlAuditSink{
 private responses:Record<string,unknown>[]=[];
 private derived:Record<string,unknown>[]=[];
 private gaps:Record<string,unknown>[]=[];
 private retainedBytes=0;
 private omittedRecords=0;
 private closed=false;
 private readonly config:DirectoryAuditConfig;
 private readonly binding:AuditBinding;
 private readonly now:()=>number;
 constructor(config:DirectoryAuditConfig,binding:AuditBinding,now:()=>number){this.config=config;this.binding=binding;this.now=now;}
 private retain(row:Record<string,unknown>,bytes:Uint8Array){
  const bodyBase64=Buffer.from(bytes).toString('base64'),candidate={...row,bodyBase64};
  if(this.now()>=Date.parse(this.config.validUntil)){row.bodyState='CAPTURE_WINDOW_EXPIRED';return;}
  if(this.retainedBytes+size(candidate)>DIRECTORY_AUDIT_MAX_STORED_BYTES-METADATA_RESERVE){row.bodyState='AUDIT_BYTE_CEILING';return;}
  row.bodyBase64=bodyBase64;row.bodyState='CAPTURED';this.retainedBytes+=size(candidate);
 }
 response(value:AuditResponse){
  if(this.closed)return;
  if(this.responses.length>=MAX_RECORDS){this.omittedRecords++;return;}
  const row:Record<string,unknown>={...safeUrl(value.url),observedAt:new Date(this.now()).toISOString(),status:value.status,
   contentType:safeContentType(value.contentType),contentEncoding:value.contentEncoding&&/^(identity|gzip|deflate|br)$/i.test(value.contentEncoding)?value.contentEncoding.toLowerCase():null,bytes:value.bytes.length,sha256:hash(value.bytes)};
  if([404,410].includes(value.status))row.bodyState='TERMINAL_BODY_NOT_READ';
  else if(value.status>=300&&value.status<400&&!value.bytes.length)row.bodyState='REDIRECT_OR_REVALIDATION_BODY_UNAVAILABLE';
  else this.retain(row,value.bytes);
  this.responses.push(row);
 }
 failure(url:string,reason:string){if(this.closed)return;if(this.gaps.length<MAX_RECORDS)this.gaps.push({...safeUrl(url),reason,observedAt:new Date(this.now()).toISOString()});else this.omittedRecords++;}
 finish(crawl:CrawlOutput){
  this.closed=true;
  for(const document of crawl.documents){
   const entries:Array<[string,string|undefined]>=[['HYDRATION_MARKUP',document.derivedMarkup],['RENDERED_HTML',document.retrieval==='RENDERED'?document.body:undefined],['PDF_TEXT',document.kind==='PDF'?document.body:undefined]];
   for(const [kind,body]of entries){if(body===undefined)continue;if(this.derived.length>=MAX_RECORDS){this.omittedRecords++;continue;}
    const bytes=Buffer.from(body,'utf8'),row:Record<string,unknown>={...safeUrl(document.url),kind,documentSourceHash:document.sourceHash,bytes:bytes.length,sha256:hash(bytes)};
    this.retain(row,bytes);this.derived.push(row);
   }
  }
  const terminalReuses=(crawl.stats.diagnostics??[]).filter(d=>d.code==='TERMINAL_URL_HISTORY').slice(0,MAX_RECORDS).map(d=>({...safeUrl(d.url),status:d.status,observedAt:d.observedAt}));
  const requestRecordsMissing=Math.max(0,crawl.stats.requestCount-this.responses.length-this.gaps.length);
  const captureComplete=!this.gaps.length&&!this.omittedRecords&&!requestRecordsMissing&&!terminalReuses.length&&[...this.responses,...this.derived].every(r=>r.bodyState==='CAPTURED');
  return seal({contractVersion:VERSION,requestId:'directory-audit-receipt:'+this.binding.requestId,dataClassification:'INTERNAL',
   directoryAuditCorpus:{version:1,binding:this.binding,scope:'ALREADY_FETCHED_BOUNDED_RESPONSES_ONLY',captureWindow:this.config,capturedAt:new Date(this.now()).toISOString(),captureComplete,
    maxStoredBytes:DIRECTORY_AUDIT_MAX_STORED_BYTES,capturedBodyBytes:[...this.responses,...this.derived].reduce((sum,r)=>sum+(r.bodyBase64?Number(r.bytes):0),0),encodedBodyBytes:[...this.responses,...this.derived].reduce((sum,r)=>sum+(typeof r.bodyBase64==='string'?r.bodyBase64.length:0),0),responses:this.responses,derived:this.derived,gaps:this.gaps,omittedRecords:this.omittedRecords,requestRecordsMissing,terminalReuses,
    crawl:{status:crawl.stats.status,requestCount:crawl.stats.requestCount,pageCount:crawl.stats.pageCount,bytesRead:crawl.stats.bytesRead,stopReason:crawl.observability?.stopReason??null,
     finalUrl:safeUrl(crawl.finalUrl).url,renderNeededButUnavailable:(crawl.observability?.renderNeededButUnavailable??[]).slice(0,MAX_RECORDS).map(safeUrl),
     skippedContent:(crawl.observability?.skippedContent??[]).slice(0,MAX_RECORDS).map(v=>({...safeUrl(v.url),reason:v.reason.slice(0,256)}))},
    lifecycle:'FINITE_PRIVATE_AUDIT_EVIDENCE_PENDING_EXPLICIT_ARCHIVE_OR_REMOVAL_DECISION'}});
 }
}

/** The backing writer must be insert-only/ignoreDuplicates, including across process restarts. */
export async function prepareDirectoryAudit(options:{config:DirectoryAuditConfig;binding:AuditBinding;store?:PrivateAuditStore;now:()=>number}):Promise<{sink?:CrawlAuditSink;finish(crawl:CrawlOutput):Promise<DirectoryAuditReference>}>{
 const {config,binding,store,now}=options,key=directoryAuditKey(binding.requestId);
 const unavailable=(reason:string)=>({finish:async()=>({receiptKey:key,state:'UNAVAILABLE' as const,reason})});
 if(!store)return unavailable('AUDIT_STORE_UNAVAILABLE');
 let prior:Record<string,unknown>|null;
 try{prior=await store.get(key);}catch{return unavailable('AUDIT_READ_UNCERTAIN');}
 if(prior){if(!validRecord(prior,binding))return unavailable('AUDIT_RECEIPT_COLLISION_OR_INVALID');return {finish:async()=>reference(key,prior,'REUSED')};}
 const collector=new AuditCollector(config,binding,now);
 return {sink:collector,async finish(crawl){
  const receipt=collector.finish(crawl);
  if(size(receipt)>DIRECTORY_AUDIT_MAX_STORED_BYTES)return {receiptKey:key,state:'UNAVAILABLE',reason:'AUDIT_ENVELOPE_BYTE_CEILING'};
  let writeUncertain=false;try{await store.set(key,receipt);}catch{writeUncertain=true;}
  let persisted:Record<string,unknown>|null;
  try{persisted=await store.get(key);}catch{return {receiptKey:key,state:'UNAVAILABLE',reason:'AUDIT_READBACK_UNCERTAIN'};}
  if(!persisted)return {receiptKey:key,state:'UNAVAILABLE',reason:writeUncertain?'AUDIT_WRITE_UNCERTAIN':'AUDIT_NOT_RETAINED'};
  if(!validRecord(persisted,binding))return {receiptKey:key,state:'UNAVAILABLE',reason:'AUDIT_RECEIPT_COLLISION_OR_INVALID'};
  return reference(key,persisted,persisted.auditSha256===receipt.auditSha256?'STORED':'REUSED');
 }};
}
