import test from 'node:test';
import assert from 'node:assert/strict';
import {policyHash,validateStandingPolicy,selectContinuousWork,runContinuousDirectoryTick} from '../src/nexus/source-discovery/continuous-directory-policy.ts';
const now='2026-10-21T12:00:00Z';
const policy={policyId:'resources-continuous-v1',version:1,enabled:true,validFrom:'2026-10-21T00:00:00Z',validUntil:'2026-11-21T00:00:00Z',countries:['GB','ZA'],maxVenuesPerDay:1000,maxRequestsPerDay:14000,maxRequestsPerVenue:14,maxBatchVenues:26,paidProviderBudgetUsd:0,minHostDelayMs:1500,freshnessHours:720,maxAttempts:3,retryBackoffHours:24,stopAfterConsecutiveFailures:5,publicationAllowed:false,outreachAllowed:false};
const item=(id='a')=>({queueId:id,country:'GB',identityKey:'canonical:'+id,verifiedSourceUrl:'https://'+id+'.example.org',verifiedAt:'2026-10-20T00:00:00Z',evidenceRef:'e:'+id,entityType:'VENUE',gaps:['PUBLIC_CONTACT'],ownership:'INTERNAL',status:'PENDING',attempts:0,requestBudget:14});
test('policy hash and explicit activation are required',()=>{
 assert.throws(()=>validateStandingPolicy(policy,'wrong',now),/HASH/);
 assert.throws(()=>validateStandingPolicy({...policy,enabled:false},policyHash({...policy,enabled:false}),now),/INACTIVE/);
 assert.throws(()=>validateStandingPolicy({...policy,paidProviderBudgetUsd:1},policyHash({...policy,paidProviderBudgetUsd:1}),now),/SCOPE/);
});
test('selection reuses fresh evidence and quarantines genuine conflicts without manual review of ordinary gaps',()=>{
 const p=validateStandingPolicy(policy,policyHash(policy),now);
 const rows=[item('a'),{...item('b'),cacheObservedAt:now,cacheSatisfiedGaps:['PUBLIC_CONTACT']},{...item('c'),status:'BLOCKED'},{...item('d'),identityConflict:true},{...item('e'),verifiedAt:null},{...item('f'),gaps:[]}];
 const x=selectContinuousWork(rows,p,now);assert.deepEqual(x.selected.map(x=>x.queueId),['a']);assert.equal(x.reuseCache.length,1);assert.equal(x.quarantined.length,2);assert.equal(x.websiteResolution.length,1);
});
test('one host is selected per tick, backoff is honoured, and suppressed sources stay excluded',()=>{
 const p=validateStandingPolicy(policy,policyHash(policy),now);
 const x=selectContinuousWork([item('a'),{...item('b'),verifiedSourceUrl:item('a').verifiedSourceUrl},{...item('c'),nextAttemptAt:'2026-10-22T00:00:00Z'},{...item('d'),suppressed:true}],p,now);
 assert.equal(x.selected.length,1);assert.equal(x.deferred.length,2);assert.equal(x.quarantined.length,1);
});
test('durable reservation denial never calls executor; lost execution keeps reservation consumed',async()=>{
 let calls=0;const receipts:any[]=[];
 const result=await runContinuousDirectoryTick([item('a'),item('b')],policy,policyHash(policy),{reserve:async r=>r.queueId==='b',complete:async r=>{receipts.push(r)}},async()=>{calls++;throw Error('timeout')},now);
 assert.equal(calls,1);assert.equal(result.denied,1);assert.equal(receipts[0].state,'RETRYABLE');assert.equal(receipts[0].nextAttemptAt,'2026-10-22T12:00:00.000Z');assert.equal(result.actualHttpRequestsKnown,0);assert.equal(result.actualRequestsUnknown,1);
});
test('unsafe executor receipts stop the run and cannot claim zero cost',async()=>{
 const result=await runContinuousDirectoryTick([item('a'),item('b')],policy,policyHash(policy),{reserve:async()=>true,complete:async()=>{}},async()=>({requestCount:15,costUsd:0,status:'COMPLETED'}),now);
 assert.equal(result.stopped,'EXECUTOR_BUDGET_VIOLATION');assert.equal(result.executed,1);
});
test('fresh partial cache does not hide an outstanding email gap',()=>{
 const p=validateStandingPolicy(policy,policyHash(policy),now);
 const result=selectContinuousWork([{...item(),cacheObservedAt:now,cacheSatisfiedGaps:['IDENTITY']}],p,now);
 assert.equal(result.selected.length,1);assert.equal(result.reuseCache.length,0);
});

test('retryable partial results remain retryable rather than complete',async()=>{
 let state='';await runContinuousDirectoryTick([item()],policy,policyHash(policy),{reserve:async()=>true,complete:async r=>{state=r.state}},async()=>({requestCount:2,costUsd:0,status:'PARTIAL',retryable:true}),now);assert.equal(state,'RETRYABLE');
});
test('explicit permanent failure is quarantined',async()=>{
 let state='';await runContinuousDirectoryTick([item()],policy,policyHash(policy),{reserve:async()=>true,complete:async r=>{state=r.state}},async()=>({requestCount:2,costUsd:0,status:'FAILED',retryable:false}),now);assert.equal(state,'QUARANTINED');
});

test('unverified or blocked websites do not stop unrelated eligible work in the tick',async()=>{
 const rows=Array.from({length:7},(_,i)=>item('site'+i));
 const result=await runContinuousDirectoryTick(rows,policy,policyHash(policy),{reserve:async()=>true,complete:async()=>{}},async work=>({requestCount:2,costUsd:0,status:work.queueId==='site6'?'COMPLETED':'BLOCKED',retryable:false}),now);
 assert.equal(result.executed,7);assert.equal(result.stopped,null);
});

test('version 2 uses bounded runs without requiring daily quotas and binds every durable reservation to the run',async()=>{
 const {maxVenuesPerDay,maxRequestsPerDay,...base}=policy;
 const p={...base,version:2,budgetMode:'PER_RUN' as const,maxVenuesPerRun:500,maxRequestsPerRun:2500,maxBatchVenues:500};
 const runId='11111111-1111-4111-8111-111111111111',reservations:any[]=[];
 assert.equal(validateStandingPolicy(p,policyHash(p),now).version,2);
 const r=await runContinuousDirectoryTick([item('a'),item('b')],p,policyHash(p),{reserve:async value=>{reservations.push(value);return true},complete:async()=>{}},async()=>({requestCount:1,costUsd:0,status:'COMPLETED'}),now,runId);
 assert.equal(r.executed,2);assert(reservations.every(value=>value.runId===runId));
 for(const invalid of [{...p,maxVenuesPerRun:501},{...p,maxRequestsPerRun:2501}])assert.throws(()=>validateStandingPolicy(invalid,policyHash(invalid),now),/SCOPE/);
 await assert.rejects(runContinuousDirectoryTick([item()],p,policyHash(p),{reserve:async()=>true,complete:async()=>{}},async()=>({requestCount:1,costUsd:0,status:'COMPLETED'}),now),/RUN_ID/);
});
