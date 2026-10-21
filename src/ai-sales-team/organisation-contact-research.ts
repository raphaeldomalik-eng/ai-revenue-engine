import {createHash} from 'node:crypto';
import {searchPrimaryApolloBuyers,type ApolloBuyerSearchResult} from './apollo.ts';
import {contactResearchEligibility,type ContactResearchCandidateState} from './contact-research.ts';
import type {DiscoveryLane} from './prospect-intelligence.ts';

export type OrganisationResearchIdentity={nexusOrganisationId:string;entityType:'ORGANISATION';name:string;legalName:string|null;domain:string;evidenceRefs:string[];legalCompanies:Array<{provider:string;id:string}>;venues:Array<{id:string;name:string;evidenceRef:string}>};
export type ResearchSelection={person: ApolloBuyerSearchResult;selectedBy:string;selectedAt:string;replayFingerprint:string;sourceMode:'REPLAY';emailReady:false;enrichmentAuthorised:false;outreachAuthorised:false};
export type OrganisationResearchRecord={nexusOrganisationId:string;identity:OrganisationResearchIdentity;revision:number;shortlist:ApolloBuyerSearchResult[];selections:ResearchSelection[];replayFingerprint:string|null;replayObservedAt:string|null;createdBy:string};
export type ResearchAccount={id:string;name:string;website:string|null;metadata:Record<string,unknown>};
export type ResearchCandidate=ContactResearchCandidateState&{id:string;origin?:string};
export type NexusResearchReference={system:'prestige_nexus';entityType:'ORGANISATION';id:string;evidenceRefs:string[];linkedBy:string;linkedAt:string};
export type ApolloPeopleReplay={nexusOrganisationId:string;domain:string;observedAt:string;people:unknown[]};
export type OrganisationContactStore={
  loadCandidate:(id:string)=>Promise<{candidate:ResearchCandidate;account:ResearchAccount}|null>;
  linkAccount:(id:string,previous:Record<string,unknown>,reference:NexusResearchReference)=>Promise<void>;
  read:(id:string)=>Promise<OrganisationResearchRecord|null>;
  create:(record:OrganisationResearchRecord)=>Promise<OrganisationResearchRecord>;
  save:(record:OrganisationResearchRecord,expectedRevision:number)=>Promise<OrganisationResearchRecord>;
};
export type OrganisationContactDependencies={store:OrganisationContactStore;findOrganisation:(id:string)=>Promise<OrganisationResearchIdentity|null>;loadReplay:(identity:OrganisationResearchIdentity)=>Promise<ApolloPeopleReplay|null>;now?:()=>string};
export type OrganisationContactInput={action?:string;candidateId?:string;provider?:string;nexusOrganisationId?:string;personId?:string;revision?:number};
export type ResearchActor={id:string;role:'admin'|'operator'|'viewer'};
export class ContactResearchError extends Error{code:string;status:number;constructor(code:string,status=409){super(code);this.code=code;this.status=status;}}
function fail(code:string,status=409):never{throw new ContactResearchError(code,status);}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const name=(s:string|null|undefined)=>(s??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function organisationDomain(value:string|null|undefined){try{return new URL(/^https?:\/\//i.test(value??'')?value!:'https://'+value).hostname.toLowerCase().replace(/^www\./,'').replace(/\.$/,'');}catch{return '';}}
function referenceOf(account:ResearchAccount){const value=account.metadata.nexusResearchReference as Partial<NexusResearchReference>|undefined;return value?.system==='prestige_nexus'&&value.entityType==='ORGANISATION'&&uuid.test(value.id??'')?value as NexusResearchReference:null;}
function boundIdentity(candidate:ResearchCandidate,account:ResearchAccount,identity:OrganisationResearchIdentity){
  const p=candidate.prospect_intelligence as {organisationResolution?:{canonicalOrganisationName?:string;officialWebsite?:string}};
  const resolution=p?.organisationResolution;
  const names=[resolution?.canonicalOrganisationName,account.name].map(name).filter(Boolean);
  if(identity.entityType!=='ORGANISATION'||!uuid.test(identity.nexusOrganisationId)||!identity.evidenceRefs.length||!identity.domain||!names.some(n=>[identity.name,identity.legalName].map(name).includes(n))||organisationDomain(resolution?.officialWebsite??account.website)!==organisationDomain(identity.domain))fail('ORGANISATION_IDENTITY_CONFLICT');
  if(candidate.origin==='VENUE_FIRST'&&!identity.venues.some(v=>name(v.name)===name(candidate.candidate_name)))fail('VENUE_OPERATOR_RELATIONSHIP_REQUIRED');
  return identity;
}
function replayFingerprint(replay:ApolloPeopleReplay){return createHash('sha256').update(JSON.stringify(replay)).digest('hex');}

/** Existing eligibility + Apollo normalization/ranking; no live provider fallback,
 * person enrichment, contact verification, communications or canonical writes. */
export async function runOrganisationContactResearch(input:OrganisationContactInput,actor:ResearchActor,deps:OrganisationContactDependencies){
  if(!actor.id||!['admin','operator','viewer'].includes(actor.role))fail('MEMBER_REQUIRED',403);
  const action=input.action;
  if(typeof action!=='string'||!['read','link','search','select'].includes(action)||typeof input.candidateId!=='string'||!input.candidateId||input.candidateId.length>128)fail('CONTACT_RESEARCH_REQUEST_INVALID',400);
  if(action!=='read'&&actor.role==='viewer')fail('OPERATOR_REQUIRED',403);
  if(['search','select'].includes(action)&&input.provider!=='APOLLO_REPLAY')fail('EXPLICIT_REPLAY_PROVIDER_REQUIRED',400);
  const loaded=await deps.store.loadCandidate(input.candidateId!);if(!loaded)fail('PROSPECT_ACCOUNT_REQUIRED',404);
  const {candidate,account}=loaded!;
  const commercialAssessment=candidate.prospect_intelligence;
  const existingReference=referenceOf(account);
  if(action==='read')return {record:existingReference?await deps.store.read(existingReference.id):null,commercialAssessment,reference:existingReference};
  if(account.metadata.nexusResearchReference&&!existingReference)fail('NEXUS_REFERENCE_REVIEW_REQUIRED');
  const eligibility=contactResearchEligibility(candidate,{accountName:account.name,accountWebsite:account.website,candidateName:candidate.organiser_name,candidateWebsite:candidate.website});
  if(!eligibility.eligible)fail(eligibility.reason);
  const id=action==='link'?input.nexusOrganisationId:existingReference?.id;
  if(typeof id!=='string'||!uuid.test(id))fail('NEXUS_ORGANISATION_REFERENCE_REQUIRED',400);
  if(existingReference&&id!==existingReference.id)fail('NEXUS_ORGANISATION_LINK_CONFLICT');
  const canonical=await deps.findOrganisation(id!);if(!canonical||canonical.nexusOrganisationId!==id)fail('NEXUS_ORGANISATION_NOT_FOUND',404);
  const identity=boundIdentity(candidate,account,canonical!);const now=deps.now?.()??new Date().toISOString();
  let record=await deps.store.read(id!);
  if(record&&organisationDomain(record.identity.domain)!==organisationDomain(identity.domain))fail('ORGANISATION_DOMAIN_CHANGED');
  if(!record)record=await deps.store.create({nexusOrganisationId:id!,identity,revision:1,shortlist:[],selections:[],replayFingerprint:null,replayObservedAt:null,createdBy:actor.id});
  if(record.nexusOrganisationId!==id||organisationDomain(record.identity.domain)!==organisationDomain(identity.domain))fail('ORGANISATION_DOMAIN_CHANGED');
  if(action==='link'){
    const reference:NexusResearchReference=existingReference??{system:'prestige_nexus',entityType:'ORGANISATION',id:id!,evidenceRefs:identity.evidenceRefs,linkedBy:actor.id,linkedAt:now};
    if(!existingReference)await deps.store.linkAccount(account.id,account.metadata,reference);
    return {record,commercialAssessment,reference};
  }
  if(action==='search'){
    const replay=await deps.loadReplay(identity);if(!replay)fail('APOLLO_REPLAY_NOT_CONFIGURED',503);
    if(replay!.nexusOrganisationId!==id||organisationDomain(replay!.domain)!==organisationDomain(identity.domain)||!Array.isArray(replay!.people)||replay!.people.length>100)fail('REPLAY_IDENTITY_MISMATCH');
    const age=Date.parse(now)-Date.parse(replay!.observedAt);if(!Number.isFinite(age)||age< -60000||age>30*86400000)fail('REPLAY_EXPIRED');
    const fingerprint=replayFingerprint(replay!);
    if(record.replayFingerprint===fingerprint)return {record,commercialAssessment,reference:existingReference};
    const lane=['EVENT_FIRST','ORGANISATION_FIRST','PERSON_FIRST','VENUE_FIRST'].includes(candidate.origin??'')?candidate.origin as DiscoveryLane:'ORGANISATION_FIRST';
    const searched=await searchPrimaryApolloBuyers({candidate,identity:{accountName:identity.name,accountWebsite:'https://'+identity.domain},discoveryLane:lane,mode:'search_only'},{apiKey:'offline-replay-no-credential',mode:'search_only',now:()=>replay!.observedAt,fetchImpl:async(url,init)=>{
      if(String(url)!=='https://api.apollo.io/api/v1/mixed_people/api_search'||init?.method!=='POST')fail('REPLAY_ENDPOINT_FORBIDDEN');
      return new Response(JSON.stringify({people:replay!.people}),{headers:{'content-type':'application/json'}});
    }});
    if(searched.blocked)fail(searched.reason);
    const shortlist=searched.result!.results.filter(p=>p.status!=='REJECTED'&&p.roleClassification);
    record=await deps.store.save({...record,identity,revision:record.revision+1,shortlist,replayFingerprint:fingerprint,replayObservedAt:replay!.observedAt},record.revision);
    return {record,commercialAssessment,reference:existingReference};
  }
  if(!Number.isSafeInteger(input.revision)||input.revision!==record.revision)fail('RESEARCH_REVISION_CONFLICT');
  const age=Date.parse(now)-Date.parse(record.replayObservedAt??'');if(!Number.isFinite(age)||age< -60000||age>30*86400000)fail('REPLAY_EXPIRED');
  const person=record.shortlist.find(p=>p.providerPersonId===input.personId);
  if(!record.replayFingerprint||!person||person.status!=='ACCEPTED'||person.employerDomainOutcome!=='DOMAIN_CONFIRMED'||!person.provenance.targetOwnershipValidated||!person.fullName)fail('PERSON_NOT_SELECTABLE');
  const currentFingerprint=record.replayFingerprint;
  if(!record.selections.some(s=>s.person.providerPersonId===person!.providerPersonId&&s.replayFingerprint===currentFingerprint)){
    if(record.selections.length>=50)fail('SELECTION_HISTORY_LIMIT');
    record=await deps.store.save({...record,revision:record.revision+1,selections:[...record.selections,{person:person!,selectedBy:actor.id,selectedAt:now,replayFingerprint:record.replayFingerprint!,sourceMode:'REPLAY',emailReady:false,enrichmentAuthorised:false,outreachAuthorised:false}]},record.revision);
  }
  return {record,commercialAssessment,reference:existingReference};
}
