import {ContactResearchError,runOrganisationContactResearch,type OrganisationContactDependencies,type ResearchActor,type OrganisationContactInput} from './organisation-contact-research.ts';
type Options={enabled:boolean;production:boolean;authorize:()=>Promise<{actor:ResearchActor;deps:OrganisationContactDependencies}|Response>};
const json=(body:unknown,status=200)=>Response.json(body,{status});

/** Gates precede authentication, storage, canonical reads and replay loading. */
export async function handleOrganisationContactRequest(request:Request,options:Options){
  if(!options.enabled)return json({code:'PILOT_NOT_ENABLED',message:'Contact research pilot is not enabled.'},503);
  if(options.production)return json({code:'CONTACT_RESEARCH_REPLAY_UNAVAILABLE_IN_PRODUCTION',message:'Replay research is available only in the supervised non-production workflow.'},503);
  try{
    const authorized=await options.authorize();if(authorized instanceof Response)return authorized;
    let input:OrganisationContactInput;
    if(request.method==='GET')input={action:'read',candidateId:new URL(request.url).searchParams.get('candidateId')??undefined};
    else if(request.method==='POST'){
      let body='';const reader=request.body?.getReader();if(!reader)return json({code:'CONTACT_RESEARCH_REQUEST_INVALID'},400);const decoder=new TextDecoder();let bytes=0;
      while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>8192){await reader.cancel();return json({code:'CONTACT_RESEARCH_BODY_TOO_LARGE'},413);}body+=decoder.decode(next.value,{stream:true});}
      try{input=JSON.parse(body+decoder.decode());}catch{return json({code:'CONTACT_RESEARCH_REQUEST_INVALID'},400);}
      if(!input||Array.isArray(input)||typeof input!=='object')return json({code:'CONTACT_RESEARCH_REQUEST_INVALID'},400);
    }else return json({code:'METHOD_NOT_ALLOWED'},405);
    return json(await runOrganisationContactResearch(input,authorized.actor,authorized.deps));
  }catch(error){
    if(error instanceof ContactResearchError)return json({code:error.code,message:error.code.replaceAll('_',' ')},error.status);
    return json({code:'CONTACT_RESEARCH_FAILED',message:'Contact research could not be completed. No provider enrichment or communication was attempted.'},503);
  }
}
