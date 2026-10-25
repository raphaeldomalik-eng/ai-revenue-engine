import {createClient} from '@supabase/supabase-js';
import {handleDirectoryRunControl} from '../../../../../src/nexus/source-discovery/directory-run-control.ts';
import {directoryPolicyConfig} from '../../../../../src/nexus/source-discovery/directory-policy-config.ts';
export const runtime='nodejs';
export async function POST(request:Request){
 const selected=directoryPolicyConfig(request.url,process.env);
 if(!selected)return Response.json({code:'DIRECTORY_STANDING_POLICY_INACTIVE'},{status:404});
 const {policyId,approvedPolicyHash:policySha256}=selected;
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(),key=(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim(),secret=process.env.NEXUS_HMAC_SECRET?.trim();
 if(!url||!key||!secret)return Response.json({code:'DIRECTORY_CONFIGURATION_MISSING'},{status:503});
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 return handleDirectoryRunControl(request,{secret,policyId,policySha256,invoke:async(name,args)=>{const {data,error}=await client.rpc(name,args);if(error)throw Error('DIRECTORY_RUN_RPC_FAILED');return data;}});
}
