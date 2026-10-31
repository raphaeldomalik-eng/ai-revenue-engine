import test from 'node:test';import assert from 'node:assert/strict';
import {handleDirectoryRunControl} from '../src/nexus/source-discovery/directory-run-control.ts';
import {nexusSignatureFor} from '../src/nexus/transport.ts';
test('provider monitoring reuses signed run control and cannot select arbitrary RPCs or recipients',async()=>{
 const secret='fixture',hash='a'.repeat(64),calls:string[]=[];
 const request=(action:string,extra:Record<string,unknown>={},signed=true)=>{const body=JSON.stringify({action,policyId:'p',policySha256:hash,workerId:'worker',...extra}),timestamp=String(Math.floor(Date.now()/1000));return new Request('https://aire.example/api/integrations/nexus/directory-run',{method:'POST',body,headers:{'x-nexus-timestamp':timestamp,'x-nexus-signature':signed?nexusSignatureFor(timestamp,body,secret):'wrong'}});};
 const options={secret,policyId:'p',policySha256:hash,invoke:async(name:string)=>{calls.push(name);return {state:'READ'};}};
 assert.equal((await handleDirectoryRunControl(request('PROVIDER_STATUS',{},false),options)).status,401);
 assert.equal((await handleDirectoryRunControl(request('PROVIDER_STATUS',{policyId:'other'}),options)).status,403);
 assert.equal((await handleDirectoryRunControl(request('arbitrary_rpc'),options)).status,403);
 assert.equal((await handleDirectoryRunControl(request('PROVIDER_STATUS'),options)).status,200);assert.deepEqual(calls,['read_directory_provider_budget_status']);
 assert.equal((await handleDirectoryRunControl(request('CLAIM_PROVIDER_ALERT',{providerId:'serper-google-search',stage:'blocked',period:'2026-10'}),options)).status,403);
});
