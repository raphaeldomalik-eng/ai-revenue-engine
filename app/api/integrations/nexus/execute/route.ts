import { createClient } from "@supabase/supabase-js";
import { handleNexusExecuteRequest } from "../../../../../src/nexus/http.ts";
import { SupabaseNexusResultStore } from "../../../../../src/nexus/persistence.ts";
import { createPublicWebProvider, researchContextFromPayload } from "../../../../../src/nexus/public-web.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV === "production" || process.env.NEXUS_EXECUTOR_ENABLED !== "true") {
    return Response.json({ code: "NEXUS_EXECUTOR_NOT_AVAILABLE" }, { status: 404 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  const secret = process.env.NEXUS_HMAC_SECRET?.trim();
  if (!url || !serviceKey || !secret) {
    return Response.json({ code: "NEXUS_EXECUTOR_CONFIGURATION_MISSING" }, { status: 503 });
  }

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return handleNexusExecuteRequest(request, {
    secret,
    store: new SupabaseNexusResultStore(client),
    publicWeb: createPublicWebProvider(),
    researchContext: researchContextFromPayload,
    researchExecutionVersion: "resources-v2-public-web-v3",
  });
}
