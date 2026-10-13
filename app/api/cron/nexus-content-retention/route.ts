import {createClient} from "@supabase/supabase-js";
export const runtime="nodejs";
export async function GET(request:Request){
  const secret=process.env.CRON_SECRET?.trim();
  if(!secret || request.headers.get("authorization")!=="Bearer "+secret)return Response.json({code:"UNAUTHORIZED"},{status:401});
  // Retention remains independently operable when interpretation execution is paused.
  if(process.env.NEXUS_CONTENT_RETENTION_ENABLED!=="true")return Response.json({code:"CONTENT_RETENTION_DISABLED"},{status:404});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();const key=(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if(!url || !key)return Response.json({code:"CONTENT_RETENTION_CONFIGURATION_MISSING"},{status:503});
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await client.rpc("purge_expired_content_interpretation_results");
  if(error)return Response.json({code:"CONTENT_RETENTION_FAILED"},{status:500});
  return Response.json({purgedDrafts:data});
}
