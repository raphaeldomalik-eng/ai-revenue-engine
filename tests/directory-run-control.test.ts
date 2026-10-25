import test from 'node:test';import assert from 'node:assert/strict';
import {handleDirectoryRunControl} from '../src/nexus/source-discovery/directory-run-control.ts';
import {nexusSignatureFor} from '../src/nexus/transport.ts';
test('run control authenticates before RPC and binds finite run limits to the configured policy',async()=>{
 const now=Date.now(),secret='fixture',input={action:'OPEN',policyId:'p',policySha256:'a'.repeat(64),workerId:'worker',maxVenues:500,maxRequests:2500};let calls=0;
 const request=(data:unknown=input,signed=true)=>{const body=JSON.stringify(data),timestamp=String(Math.floor(now/1000));return new Request('https://aire.example/api/integrations/nexus/directory-run',{method:'POST',body,headers:{'x-nexus-timestamp':timestamp,'x-nexus-signature':signed?nexusSignatureFor(timestamp,body,secret):'wrong'}});};
 const options={secret,policyId:'p',policySha256:'a'.repeat(64),now:()=>now,invoke:async(name:string,args:Record<string,unknown>)=>{calls++;assert.equal(name,'open_nexus_directory_run');assert.equal(args.p_max_requests,2500);return {state:'OPENED'};}};
 assert.equal((await handleDirectoryRunControl(request(input,false),options)).status,401);
 assert.equal((await handleDirectoryRunControl(request({...input,maxRequests:2501}),options)).status,403);
 assert.equal((await handleDirectoryRunControl(request({...input,policyId:'other'}),options)).status,403);assert.equal(calls,0);
 assert.equal((await handleDirectoryRunControl(request(),options)).status,200);assert.equal(calls,1);
});

test('finish binds the run to the configured policy and hash as well as its worker',async()=>{
 const secret='fixture',policySha256='a'.repeat(64),input={action:'FINISH',policyId:'p',policySha256,workerId:'worker',runId:'11111111-1111-4111-8111-111111111111',receipt:{delivered:1}};
 const body=JSON.stringify(input),timestamp=String(Math.floor(Date.now()/1000));
 const response=await handleDirectoryRunControl(new Request('https://aire.example/api/integrations/nexus/directory-run',{method:'POST',body,headers:{'x-nexus-timestamp':timestamp,'x-nexus-signature':nexusSignatureFor(timestamp,body,secret)}}),{secret,policyId:'p',policySha256,invoke:async(name,args)=>{assert.equal(name,'finish_nexus_directory_run');assert.deepEqual(args,{p_run_id:input.runId,p_worker:'worker',p_receipt:{delivered:1},p_policy_id:'p',p_hash:policySha256});return {state:'COMPLETED'};}});
 assert.equal(response.status,200);
});
