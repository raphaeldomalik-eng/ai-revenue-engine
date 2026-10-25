type PolicyEnvironment=Readonly<Record<string,string|undefined>>;
/** Additive selector only. The existing handler still verifies the HMAC,
 * exact signed policy/subject binding and the enabled stored policy hash. */
export function directoryPolicyConfig(url:string,env:PolicyEnvironment):{policyId:string;approvedPolicyHash:string}|null{
 const selectors=new URL(url).searchParams.getAll('policy');
 if(selectors.length>1)return null;
 if(selectors.length){
  const approvedPolicyHash=env.NEXUS_SHARED_INTELLIGENCE_POLICY_SHA256?.trim();
  return selectors[0]==='shared-intelligence-uk-v1'&&/^[a-f0-9]{64}$/.test(approvedPolicyHash??'')?{policyId:'shared-intelligence-uk-v1',approvedPolicyHash:approvedPolicyHash!}:null;
 }
 const policyId=env.NEXUS_DIRECTORY_STANDING_POLICY_ID?.trim(),approvedPolicyHash=env.NEXUS_DIRECTORY_STANDING_POLICY_SHA256?.trim();
 return policyId&&approvedPolicyHash?{policyId,approvedPolicyHash}:null;
}
