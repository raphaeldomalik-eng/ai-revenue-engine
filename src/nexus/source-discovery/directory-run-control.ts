import {verifyNexusSignature} from '../transport.ts';
type Options={secret:string;policyId:string;policySha256:string;now?:()=>number;invoke:(name:string,args:Record<string,unknown>)=>Promise<unknown>};
/** Administrative lease control for the existing standing worker. It cannot
 * research, publish, purchase credits or send communications. */
export async function handleDirectoryRunControl(request:Request,options:Options){
 const chunks:Uint8Array[]=[];let bytes=0;const reader=request.body?.getReader();if(!reader)return Response.json({code:'BODY_REQUIRED'},{status:400});
 while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>16384){await reader.cancel();return Response.json({code:'BODY_TOO_LARGE'},{status:413});}chunks.push(part.value);}
 const body=Buffer.concat(chunks).toString('utf8');
 if(!options.secret||!verifyNexusSignature(request.headers.get('x-nexus-signature'),request.headers.get('x-nexus-timestamp'),body,options.secret,options.now?.()??Date.now()))return Response.json({code:'NEXUS_SIGNATURE_INVALID'},{status:401});
 try{
 const input=JSON.parse(body);
 if(!options.policyId||!options.policySha256||input.policyId!==options.policyId||input.policySha256!==options.policySha256||typeof input.workerId!=='string'||!input.workerId.trim()||input.workerId.length>200)return Response.json({code:'RUN_SCOPE'},{status:403});
 let name:string,args:Record<string,unknown>;
 if(input.action==='OPEN'){
 if(!Number.isSafeInteger(input.maxVenues)||input.maxVenues<1||input.maxVenues>500||!Number.isSafeInteger(input.maxRequests)||input.maxRequests<1||input.maxRequests>2500)return Response.json({code:'RUN_BUDGET'},{status:403});
 name='open_nexus_directory_run';args={p_policy_id:input.policyId,p_hash:input.policySha256,p_worker:input.workerId,p_max_venues:input.maxVenues,p_max_requests:input.maxRequests};
 }else if(input.action==='FINISH'&&typeof input.runId==='string'&&/^[a-f0-9-]{36}$/i.test(input.runId)){
 name='finish_nexus_directory_run';args={p_run_id:input.runId,p_worker:input.workerId,p_receipt:input.receipt??{},p_policy_id:input.policyId,p_hash:input.policySha256};
 }else if(input.action==='PROVIDER_STATUS'){
 name='read_directory_provider_budget_status';args={p_policy_id:input.policyId,p_hash:input.policySha256};
 }else if(input.action==='OBSERVE_PROVIDER_BALANCE'&&['brave-web-search','serper-google-search'].includes(input.providerId)&&input.observation&&typeof input.observation==='object'&&!Array.isArray(input.observation)){
 name='observe_directory_provider_balance';args={p_policy_id:input.policyId,p_hash:input.policySha256,p_provider:input.providerId,p_observation:input.observation};
 }else if(input.action==='CLAIM_PROVIDER_ALERT'&&input.providerId==='brave-web-search'&&['25_percent','10_percent','blocked'].includes(input.stage)&&/^\d{4}-\d{2}$/.test(input.period??'')){
 name='claim_directory_provider_alert';args={p_policy_id:input.policyId,p_hash:input.policySha256,p_provider:input.providerId,p_stage:input.stage,p_period:input.period,p_alert:input.alert??{}};
 }else if(input.action==='COMPLETE_PROVIDER_ALERT'&&input.providerId==='brave-web-search'&&['25_percent','10_percent','blocked'].includes(input.stage)&&/^\d{4}-\d{2}$/.test(input.period??'')&&(input.messageQueueId===null||/^[0-9a-f-]{36}$/i.test(input.messageQueueId??''))){
 name='complete_directory_provider_alert';args={p_policy_id:input.policyId,p_hash:input.policySha256,p_provider:input.providerId,p_stage:input.stage,p_period:input.period,p_message_queue_id:input.messageQueueId};
 }else return Response.json({code:'RUN_ACTION'},{status:403});
 return Response.json(await options.invoke(name,args));
 }catch{return Response.json({code:'DIRECTORY_RUN_CONTROL_FAILED'},{status:503});}
}
