import type {OrganisationResearchIdentity} from '../ai-sales-team/organisation-contact-research.ts';
type Reader={query:(sql:string,values:unknown[])=>Promise<{rows:Record<string,unknown>[]}>};

/** Governed Nexus read surface only. No identity creation, provider execution,
 * classification, relationship mutation or product projection. */
export async function readNexusOrganisationResearchIdentity(db:Reader,id:string):Promise<OrganisationResearchIdentity|null>{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))return null;
  const {rows}=await db.query(`select id::text,display_name as name,legal_name,primary_domain as domain
    from entity.canonical_organisation where id=$1::uuid and status='ACTIVE'`,[id]);
  const org=rows[0];if(rows.length!==1||typeof org.name!=='string'||typeof org.domain!=='string'||!org.domain.trim())return null;
  const venues=await db.query(`select v.id::text,v.name from entity.canonical_venue v
    where v.status='ACTIVE' and (v.operating_organisation_id=$1::uuid or exists
      (select 1 from entity.entity_relationship r where r.subject_entity_id=$1::uuid
       and r.predicate='OPERATES' and r.object_entity_id=v.id and r.confidence>=0.8)) order by v.id limit 100`,[id]);
  const legal=await db.query(`select provider_key as provider,external_id as id from entity.external_reference
    where canonical_entity_id=$1::uuid and provider_key='companies_house' and status='ACTIVE' order by external_id limit 20`,[id]);
  return {nexusOrganisationId:id,entityType:'ORGANISATION',name:org.name,legalName:typeof org.legal_name==='string'?org.legal_name:null,domain:org.domain,evidenceRefs:['nexus:organisation:'+id],
    venues:venues.rows.map(v=>({id:String(v.id),name:String(v.name),evidenceRef:`nexus:organisation:${id}:OPERATES:${v.id}`})),
    legalCompanies:legal.rows.map(r=>({provider:String(r.provider),id:String(r.id)}))};
}
