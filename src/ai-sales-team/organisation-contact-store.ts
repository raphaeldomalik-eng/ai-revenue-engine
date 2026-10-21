import type {SupabaseClient} from '@supabase/supabase-js';
import {ContactResearchError,type OrganisationContactStore,type OrganisationResearchRecord,type ResearchAccount} from './organisation-contact-research.ts';

const table='organisation_contact_intelligence';
function checked(error:unknown){if(error)throw new ContactResearchError('CONTACT_RESEARCH_PERSISTENCE_NOT_READY',503);}
function encode(record:OrganisationResearchRecord,actor:string){return {nexus_organisation_id:record.nexusOrganisationId,identity:record.identity,revision:record.revision,shortlist:record.shortlist,selections:record.selections,replay_fingerprint:record.replayFingerprint,replay_observed_at:record.replayObservedAt,updated_by:actor,updated_at:new Date().toISOString()};}
function decode(row:Record<string,unknown>):OrganisationResearchRecord{return {nexusOrganisationId:row.nexus_organisation_id as string,identity:row.identity as OrganisationResearchRecord['identity'],revision:Number(row.revision),shortlist:row.shortlist as OrganisationResearchRecord['shortlist'],selections:row.selections as OrganisationResearchRecord['selections'],replayFingerprint:row.replay_fingerprint as string|null,replayObservedAt:row.replay_observed_at as string|null,createdBy:row.created_by as string};}

/** Session client preserves existing internal-member RLS; never uses a service key. */
export function createOrganisationContactStore(client:SupabaseClient,actor:string):OrganisationContactStore{
  const read:OrganisationContactStore['read']=async id=>{const {data,error}=await client.from(table).select('*').eq('nexus_organisation_id',id).maybeSingle();checked(error);return data?decode(data):null;};
  return {
    async loadCandidate(id){
      const {data:candidate,error}=await client.from('ai_prospect_candidates').select('id,status,relationship,account_id,candidate_name,organiser_name,website,origin,prospect_intelligence').eq('id',id).maybeSingle();checked(error);
      if(!candidate?.account_id)return null;
      const account=await client.from('accounts').select('id,name,website,metadata').eq('id',candidate.account_id).maybeSingle();checked(account.error);
      return account.data?{candidate,account:{...account.data,metadata:account.data.metadata??{}} as ResearchAccount}:null;
    },
    async linkAccount(id,previous,reference){
      const {data,error}=await client.from('accounts').update({metadata:{...previous,nexusResearchReference:reference}}).eq('id',id).eq('metadata',JSON.stringify(previous)).select('id').maybeSingle();checked(error);
      if(!data)throw new ContactResearchError('ACCOUNT_REFERENCE_CONFLICT');
    },
    read,
    async create(record){
      const {error}=await client.from(table).upsert({...encode(record,actor),created_by:actor},{onConflict:'nexus_organisation_id',ignoreDuplicates:true});checked(error);
      const saved=await read(record.nexusOrganisationId);if(!saved)throw new ContactResearchError('CONTACT_RESEARCH_PERSISTENCE_NOT_READY',503);return saved;
    },
    async save(record,expectedRevision){
      const {data,error}=await client.from(table).update(encode(record,actor)).eq('nexus_organisation_id',record.nexusOrganisationId).eq('revision',expectedRevision).select('*').maybeSingle();checked(error);
      if(!data)throw new ContactResearchError('RESEARCH_REVISION_CONFLICT');return decode(data);
    },
  };
}
