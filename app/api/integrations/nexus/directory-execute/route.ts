import {createClient} from '@supabase/supabase-js';
import {SupabaseDirectoryResultStore,SupabaseContinuousDirectoryLedger} from '../../../../../src/nexus/source-discovery/continuous-directory-store.ts';
import {handleContinuousDirectoryRequest} from '../../../../../src/nexus/source-discovery/continuous-directory-http.ts';
import type {StandingPolicy} from '../../../../../src/nexus/source-discovery/continuous-directory-policy.ts';
import {directoryPolicyConfig} from '../../../../../src/nexus/source-discovery/directory-policy-config.ts';
export const runtime='nodejs';
export async function POST(request:Request){
 const selected=directoryPolicyConfig(request.url,process.env);
 if(!selected)return Response.json({code:'DIRECTORY_STANDING_POLICY_INACTIVE'},{status:404});
 const {policyId,approvedPolicyHash}=selected;
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(),key=(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim(),secret=process.env.NEXUS_HMAC_SECRET?.trim();
 if(!url||!key||!secret)return Response.json({code:'DIRECTORY_CONFIGURATION_MISSING'},{status:503});
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await client.from('nexus_directory_standing_policy').select('policy,policy_sha256,enabled').eq('policy_id',policyId).single();
 if(error||!data?.enabled||data.policy_sha256!==approvedPolicyHash)return Response.json({code:'DIRECTORY_STANDING_POLICY_INACTIVE'},{status:404});
 return handleContinuousDirectoryRequest(request,{policy:data.policy as StandingPolicy,approvedPolicyHash,ledger:new SupabaseContinuousDirectoryLedger(client),executor:{secret,store:new SupabaseDirectoryResultStore(client)}});
}
