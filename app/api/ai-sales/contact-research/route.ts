import {readFile,stat} from 'node:fs/promises';
import {createServerSupabaseClient} from '../../../../src/lib/supabase-server';
import {contactResearchProductionEnabled} from '../../../../src/lib/server-production-activation';
import {handleOrganisationContactRequest} from '../../../../src/ai-sales-team/organisation-contact-http';
import {createOrganisationContactStore} from '../../../../src/ai-sales-team/organisation-contact-store';
import type {ApolloPeopleReplay,ResearchActor} from '../../../../src/ai-sales-team/organisation-contact-research';
import {getDbPool} from '../../../../src/nexus/db';
import {readNexusOrganisationResearchIdentity} from '../../../../src/nexus/organisation-research-reference';

export const runtime='nodejs';
async function operatorClient(){
  const client=await createServerSupabaseClient();
  const {data:auth}=await client.auth.getUser();
  if(!auth.user)return Response.json({code:'SIGN_IN_REQUIRED'},{status:401});
  const {data:member}=await client.from('revenue_members').select('member_role,active').eq('user_id',auth.user.id).maybeSingle();
  if(!member?.active||!['viewer','operator','admin'].includes(member.member_role))return Response.json({code:'MEMBER_REQUIRED'},{status:403});
  return {actor:{id:auth.user.id,role:member.member_role} as ResearchActor,deps:{
    store:createOrganisationContactStore(client,auth.user.id),
    findOrganisation:(id:string)=>readNexusOrganisationResearchIdentity(getDbPool(),id),
    // Request bodies cannot supply provider payloads or filesystem paths.
    // No provider key, live fetch or selected enrichment is used here.
    loadReplay:async():Promise<ApolloPeopleReplay|null>=>{
      const file=process.env.AIRE_CONTACT_RESEARCH_REPLAY_FILE?.trim();if(!file)return null;
      if((await stat(file)).size>131072)throw Error('REPLAY_TOO_LARGE');
      return JSON.parse(await readFile(file,'utf8')) as ApolloPeopleReplay;
    },
  }};
}
function handle(request:Request){
  return handleOrganisationContactRequest(request,{
    enabled:contactResearchProductionEnabled(),
    production:process.env.VERCEL_ENV==='production'||(process.env.NODE_ENV==='production'&&process.env.VERCEL_ENV!=='preview'),
    authorize:operatorClient,
  });
}
export async function GET(request:Request){return handle(request);}
export async function POST(request:Request){return handle(request);}
