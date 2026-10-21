import test from 'node:test';import assert from 'node:assert/strict';
import {GET} from '../app/api/cron/nexus-content-retention/route.ts';
test('directory-only cron purges search cache and survives unrelated cleanup failure',async t=>{
 const names=['CRON_SECRET','BRAVE_SEARCH_TEST_ALLOWANCE_ID','NEXUS_CONTENT_RETENTION_ENABLED','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SECRET_KEY'] as const;
 const previous=Object.fromEntries(names.map(k=>[k,process.env[k]])),fetchBefore=globalThis.fetch,calls:string[]=[];
 t.after(()=>{globalThis.fetch=fetchBefore;for(const key of names){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}});
 Object.assign(process.env,{CRON_SECRET:'fixture',BRAVE_SEARCH_TEST_ALLOWANCE_ID:'fixture',NEXUS_CONTENT_RETENTION_ENABLED:'false',NEXT_PUBLIC_SUPABASE_URL:'https://database.example',SUPABASE_SECRET_KEY:'fixture'});
 globalThis.fetch=async input=>{const url=String(input);calls.push(url);return url.endsWith('purge_expired_content_interpretation_results')?Response.json({message:'unrelated failure'},{status:500}):Response.json(3)};
 const request=()=>new Request('https://aire.example/api/cron/nexus-content-retention',{headers:{authorization:'Bearer fixture'}});
 const alone=await GET(request());assert.equal(alone.status,200);assert.equal((await alone.json()).purgedSearchResponses,3);assert.equal(calls.length,1);assert(calls[0].endsWith('purge_expired_directory_search_cache'));
 process.env.NEXUS_CONTENT_RETENTION_ENABLED='true';calls.length=0;
 const partial=await GET(request());assert.equal(partial.status,500);assert.equal((await partial.json()).purgedSearchResponses,3);assert(calls.at(-1)?.endsWith('purge_expired_directory_search_cache'));
});
