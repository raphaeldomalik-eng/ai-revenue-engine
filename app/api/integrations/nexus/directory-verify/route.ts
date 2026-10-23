import {createClient} from '@supabase/supabase-js';
import {SupabaseContinuousDirectoryLedger,SupabaseDirectoryResultStore} from '../../../../../src/nexus/source-discovery/continuous-directory-store.ts';
import {handleDirectoryVerificationRequest,validatedVerificationContinuation,type VerificationPolicy} from '../../../../../src/nexus/source-discovery/continuous-directory-verification.ts';
import {policyHash} from '../../../../../src/nexus/source-discovery/continuous-directory-policy.ts';
export const runtime='nodejs';
const ORIGINAL_POLICY_ID='resources-directory-uk-verify-canary-20261022';
const CONTINUATION_POLICY_ID='resources-directory-uk-verify-continuation-20261024';
export async function POST(request:Request){
 const policyId=process.env.NEXUS_DIRECTORY_STANDING_POLICY_ID?.trim(),approvedPolicyHash=process.env.NEXUS_DIRECTORY_STANDING_POLICY_SHA256?.trim();
 if(!policyId||!approvedPolicyHash)return Response.json({code:'DIRECTORY_STANDING_POLICY_INACTIVE'},{status:404});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(),key=(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim(),secret=process.env.NEXUS_HMAC_SECRET?.trim();
 if(!url||!key||!secret)return Response.json({code:'DIRECTORY_CONFIGURATION_MISSING'},{status:503});
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await client.from('nexus_directory_standing_policy').select('policy,policy_sha256,enabled').eq('policy_id',policyId).single();
 if(error||!data?.enabled||data.policy_sha256!==approvedPolicyHash||policyHash(data.policy)!==approvedPolicyHash)return Response.json({code:'DIRECTORY_STANDING_POLICY_INACTIVE'},{status:404});
 let policy=data.policy as VerificationPolicy,selectedHash=approvedPolicyHash;
 // The one-off continuation has its own short window and budget. Requests
 // retain the original policy hash; no existing request or result is rewritten.
 if(policyId===ORIGINAL_POLICY_ID&&Date.now()>=Date.parse(policy.validUntil)){
  const {data:next,error:nextError}=await client.from('nexus_directory_standing_policy').select('policy,policy_sha256,enabled').eq('policy_id',CONTINUATION_POLICY_ID).single();
  if(!nextError&&next?.enabled){
   const candidate=next.policy as VerificationPolicy;
   try{
    const continuation=validatedVerificationContinuation(candidate);
    if(continuation?.sourcePolicyId===policyId&&continuation.sourcePolicySha256===approvedPolicyHash
     &&candidate.policyId===CONTINUATION_POLICY_ID&&next.policy_sha256===policyHash(candidate)){
     policy=candidate;selectedHash=next.policy_sha256;
    }
   }catch{return Response.json({code:'DIRECTORY_CONTINUATION_SCOPE_INVALID'},{status:404})}
  }
 }
 const continuation=validatedVerificationContinuation(policy);
 return handleDirectoryVerificationRequest(request,{policy,approvedPolicyHash:selectedHash,secret,
  ledger:new SupabaseContinuousDirectoryLedger(client),store:new SupabaseDirectoryResultStore(client),
  continuationReady:continuation?async(entry,now)=>{
   const {data:prior,error:priorError}=await client.from('nexus_directory_work_receipt')
    .select('state,request_count,next_attempt_at,identity_key,host')
    .eq('policy_id',continuation.sourcePolicyId).eq('queue_id',entry.queueId)
    .order('reserved_at',{ascending:false}).limit(1).maybeSingle();
   return !priorError&&prior?.state==='RETRYABLE'&&prior.request_count===continuation.priorRequestCount
    &&prior.identity_key===entry.identityKey&&prior.host===entry.host
    &&Boolean(prior.next_attempt_at)&&Date.parse(prior.next_attempt_at)<=Date.parse(now);
  }:undefined});
}
