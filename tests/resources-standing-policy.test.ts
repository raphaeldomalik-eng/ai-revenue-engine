import test from 'node:test';
import assert from 'node:assert/strict';
import {policyHash,validateStandingPolicy} from '../src/nexus/source-discovery/continuous-directory-policy.ts';
import {preferGovernedSearch} from '../src/nexus/search/governed-directory-search.ts';
import {DirectorySearchAllocationDeniedError} from '../src/nexus/search/brave-public-web-search.ts';
const policy={policyId:'resources-sa-uk-per-run-20261025',version:4,enabled:true,standing:true,validFrom:'2026-10-31T00:00:00Z',validUntil:null,countries:['GB','ZA'],actions:['VERIFY_WEBSITE','ENRICH_VERIFIED_VENUE','DISCOVER_WEBSITE'],quotaMode:'PER_RUN',maxVenuesPerRun:10,maxRequestsPerRun:140,maxVenuesPerDay:100,maxRequestsPerDay:1400,braveMaxRequestsPerRun:2,serperMaxRequestsPerRun:8,maxRequestsPerVenue:14,maxBatchVenues:10,paidProviderBudgetUsd:.05,minHostDelayMs:1500,freshnessHours:24,maxAttempts:3,retryBackoffHours:24,stopAfterConsecutiveFailures:5,publicationAllowed:false,outreachAllowed:false,productPublicationAllowed:false,providerLimits:{brave:{monthlyUsd:10,dailyRequests:50,reserveUsd:.5},serper:{allocationUsd:5,dailyRequests:100}}};
test('owner-approved standing recovery remains bounded after the old short window',()=>{
 assert.equal(validateStandingPolicy(policy as never,policyHash(policy),'2026-12-01T00:00:00Z').enabled,true);
 for(const change of [{standing:false},{paidProviderBudgetUsd:11},{publicationAllowed:true},{providerLimits:{brave:{monthlyUsd:20,dailyRequests:50,reserveUsd:.5},serper:{allocationUsd:5,dailyRequests:100}}}]){
  const altered={...policy,...change};assert.throws(()=>validateStandingPolicy(altered as never,policyHash(altered),'2026-12-01T00:00:00Z'));
 }
});
test('missing-site discovery uses Serper before Brave and leaves Brave untouched on useful results',async()=>{
 const calls:string[]=[];const provider=(id:string,results:unknown[])=>({id,costModel:{kind:'ZERO_INCREMENTAL',currency:'USD',amountPerCall:0},usage:{requests:0,cacheReused:0,reservedCreditMicroUsd:0},async search(){calls.push(id);return results;}});
 const p=preferGovernedSearch(provider('brave',[{url:'https://brave.example/'}]) as never,provider('serper',[{url:'https://venue.example/'}]) as never)!;
 assert.deepEqual(await p.search({query:'Venue official website',country:'GB',maxResults:5}),[{url:'https://venue.example/'}]);assert.deepEqual(calls,['serper']);
});
test('an independently exhausted provider does not stop its authorised alternative',async()=>{
 const calls:string[]=[];
 const brave={id:'brave',costModel:{kind:'ZERO_INCREMENTAL',currency:'USD',amountPerCall:0},async search(){calls.push('brave');return [{url:'https://venue.example/'}];}};
 const serper={id:'serper',costModel:{kind:'ZERO_INCREMENTAL',currency:'USD',amountPerCall:0},async search(){calls.push('serper');throw new DirectorySearchAllocationDeniedError('ALLOCATION_EXHAUSTED');}};
 assert.equal((await preferGovernedSearch(brave as never,serper as never)!.search({query:'Venue official website',country:'GB',maxResults:5})).length,1);assert.deepEqual(calls,['serper','brave']);
});
