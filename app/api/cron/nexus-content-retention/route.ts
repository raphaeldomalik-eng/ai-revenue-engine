import {createClient} from "@supabase/supabase-js";
export const runtime="nodejs";
export async function GET(request:Request){
  const secret=process.env.CRON_SECRET?.trim();
  if(!secret || request.headers.get("authorization")!=="Bearer "+secret)return Response.json({code:"UNAUTHORIZED"},{status:401});
  // Retention remains independently operable when interpretation execution is paused.
  const contentEnabled=process.env.NEXUS_CONTENT_RETENTION_ENABLED==="true",searchEnabled=Boolean(process.env.BRAVE_SEARCH_TEST_ALLOWANCE_ID?.trim());
  if(!contentEnabled&&!searchEnabled)return Response.json({code:"CONTENT_RETENTION_DISABLED"},{status:404});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();const key=(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if(!url || !key)return Response.json({code:"CONTENT_RETENTION_CONFIGURATION_MISSING"},{status:503});
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const receipt:Record<string,unknown>={},failures:string[]=[];
  const purge=async(name:string,key:string)=>{try{const result=await client.rpc(name);if(result.error)failures.push(name);else receipt[key]=result.data;}catch{failures.push(name);}};
  if(contentEnabled)await purge("purge_expired_content_interpretation_results","purgedDrafts");
  if(searchEnabled)await purge("purge_expired_directory_search_cache","purgedSearchResponses");
  return Response.json({...receipt,...(failures.length?{code:"CONTENT_RETENTION_FAILED",failures}:{})},{status:failures.length?500:200});
}
