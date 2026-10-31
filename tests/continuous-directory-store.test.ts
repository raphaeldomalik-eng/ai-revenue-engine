import test from 'node:test';
import {execFileSync} from 'node:child_process';
test('denied work reads its existing cross-policy queue guard without changing history',()=>{
 const moduleUrl=new URL('../src/nexus/source-discovery/continuous-directory-store.ts',import.meta.url).href;
 const script=`import assert from 'node:assert/strict';const {SupabaseContinuousDirectoryLedger}=await import(${JSON.stringify(moduleUrl)});
 const now=Date.now(),future=new Date(now+172800000).toISOString(),calls=[];
 const query={select:()=>query,eq:()=>query,in:async()=>({data:[{queue_id:'same',state:'RETRYABLE',next_attempt_at:future},{queue_id:'other',state:'RETRYABLE',next_attempt_at:new Date(now+300000000).toISOString()}],error:null})};
 const client={from:(name)=>{calls.push(name);return query;},rpc:async()=>{throw Error('NO_MUTATION')}};
 const ledger=new SupabaseContinuousDirectoryLedger(client);assert.equal(await ledger.nextEligibleAt({queueId:'same',identityKey:'venue:one'}),future);assert.deepEqual(calls,['nexus_directory_work_receipt']);`;
 execFileSync(process.execPath,['--experimental-transform-types','--input-type=module','-e',script],{stdio:'pipe'});
});
