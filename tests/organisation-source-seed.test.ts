import test from "node:test";
import assert from "node:assert/strict";
import {discoverOrganisationSource} from "../src/nexus/organisation-source-seed.ts";
import {CONTRACTS,validateResearchRequest} from "../src/nexus/contracts.ts";
import {createPublicWebProvider} from "../src/nexus/public-web.ts";
const request=()=>validateResearchRequest({contractVersion:CONTRACTS.RESEARCH_REQUEST,requestId:"11111111-1111-4111-8111-111111111111",idempotencyKey:"22222222-2222-4222-8222-222222222222",correlationId:"33333333-3333-4333-8333-333333333333",originatingProduct:"last_train_home",subject:{canonicalEntityId:null,candidateReference:{sourceSystem:"last_train_home",sourceRecordId:"ticketmaster:promoter:104"},entityType:"UNKNOWN"},researchPurpose:"SOURCE_ENTITY_CLASSIFICATION",requestedFactTypes:["officialWebsite","organisationRole"],providerAllowances:["PUBLIC_WEB"],costCeiling:{currency:"GBP",amount:0},freshnessRequirements:{maxAgeHours:720},existingEvidenceRefs:[],requestedBy:{actorType:"PRODUCT",actorId:"last_train_home"},createdAt:"2026-10-09T12:00:00.000Z",researchContext:{targetName:"Example Promotions",territory:"GB"}});
const resolver=async()=>[{address:"93.184.216.34",family:4}];
const page='<html><head><title>Example Promotions</title></head><body><h1>Example Promotions</h1><a href="mailto:bookings@example.test">Bookings</a><script type="application/ld+json">{"@type":"Organization","name":"Example Promotions","legalName":"Example Promotions Limited","url":"https://example.test/"}</script></body></html>';
const fetchSite=async(input:RequestInfo|URL)=>String(input).endsWith("/robots.txt")?new Response("User-agent: *\nAllow: /",{status:200}):new Response(page,{status:200,headers:{"content-type":"text/html"}});

test("a directory mention or ticket event cannot establish organisation ownership",async()=>{
  const options={searchProvider:{id:"fixture",costModel:{kind:"ZERO_INCREMENTAL" as const,currency:"USD",amountPerCall:0},search:async()=>[{url:"https://directory.test/company/example"}]},reserveSearch:async()=>true,resolveHost:resolver,
    fetchImpl:async(input:RequestInfo|URL)=>String(input).endsWith("/robots.txt")?new Response("User-agent: *\nAllow: /",{status:200}):new Response('<html><title>Company Directory</title><h1>Company Directory</h1><script type="application/ld+json">{"@type":"Organization","name":"Example Promotions","legalName":"Example Promotions"}</script></html>',{headers:{"content-type":"text/html"}})};
  assert.equal((await discoverOrganisationSource(request(),options)).status,"HELD");
  let fetches=0;
  const ticket=await discoverOrganisationSource(request(),{...options,searchProvider:{...options.searchProvider,search:async()=>[{url:"https://www.universe.com/events/example-promotions-ABC123"}]},fetchImpl:async(input)=>{fetches++;return fetchSite(input);}});
  assert.equal(ticket.status,"HELD");assert.equal(fetches,0);
});
test("real research provider consumes the verified seed and returns stageable classification evidence without recrawling",async()=>{
  let calls=0,fetches=0;
  const seed={searchProvider:{id:"fixture",costModel:{kind:"ZERO_INCREMENTAL" as const,currency:"USD",amountPerCall:0},search:async()=>{calls++;return [{url:"https://example.test/"}];}},reserveSearch:async()=>true};
  const provider=createPublicWebProvider({organisationSeed:seed,resolveHost:resolver,fetchImpl:async(input)=>{fetches++;return fetchSite(input);}});
  const input=request();const result=await provider({request:input,context:input.researchContext!});
  assert.equal(calls,1);assert.ok(result.facts.some(f=>f.fieldName==="officialWebsite" && f.value==="https://example.test/"));assert.ok(result.facts.some(f=>f.fieldName==="legalName"));
  assert.ok(result.facts.every(f=>!f.evidenceRef || result.evidence.some(e=>e.evidenceRef===f.evidenceRef)));assert.ok(result.facts.every(f=>f.canonicalEntityId===null && f.subjectEntityType==="UNKNOWN"));
  assert.ok(fetches<=4,"Verified seed documents should be reused instead of crawled again");assert.ok(result.providerUsage?.every(u=>u.provider==="PUBLIC_WEB"));
});
test("unfunded or unreserved source discovery makes zero search calls",async()=>{
  let calls=0;const searchProvider={id:"fixture",costModel:{kind:"METERED" as const,currency:"USD",amountPerCall:0.01},search:async()=>{calls++;return [];}};
  assert.equal((await discoverOrganisationSource(request(),{searchProvider,reserveSearch:async()=>true,resolveHost:resolver,fetchImpl:fetchSite})).status,"HELD");assert.equal(calls,0);
  searchProvider.costModel.amountPerCall=0;
  assert.equal((await discoverOrganisationSource(request(),{searchProvider:{...searchProvider,costModel:{...searchProvider.costModel,kind:"ZERO_INCREMENTAL"}},reserveSearch:async()=>false,resolveHost:resolver,fetchImpl:fetchSite})).status,"HELD");assert.equal(calls,0);
});
test("search ranking stays unverified until first-party identity is proven; multiple verified domains stay ambiguous",async()=>{
  const options={searchProvider:{id:"fixture",costModel:{kind:"ZERO_INCREMENTAL" as const,currency:"USD",amountPerCall:0},search:async()=>[{url:"https://example.test/"}]},reserveSearch:async()=>true,resolveHost:resolver,fetchImpl:fetchSite};
  const result=await discoverOrganisationSource(request(),options);assert.equal(result.status,"VERIFIED",JSON.stringify(result));assert.equal(result.website,"https://example.test/");assert.ok(result.crawl?.documents.length);assert.ok(result.extraction?.identityFacts.some(f=>f.fieldName==="legalName"));assert.equal(result.searchEvidence?.provider,"PUBLIC_WEB");
  const wrong=await discoverOrganisationSource(request(),{...options,fetchImpl:async(input:RequestInfo|URL)=>String(input).endsWith("/robots.txt")?new Response("User-agent: *\nAllow: /",{status:200}):new Response("<html><title>Unrelated Agency</title><h1>Unrelated Agency</h1></html>",{headers:{"content-type":"text/html"}})});assert.equal(wrong.status,"HELD");assert.equal(wrong.website,null);
  const ambiguous=await discoverOrganisationSource(request(),{...options,searchProvider:{...options.searchProvider,search:async()=>[{url:"https://example.test/"},{url:"https://another.test/"}]}});assert.equal(ambiguous.status,"AMBIGUOUS");assert.equal(ambiguous.website,null);
});
