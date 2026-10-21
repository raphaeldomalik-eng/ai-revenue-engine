import { createClient } from "@supabase/supabase-js";
import { handleNexusExecuteRequest, nexusExecutorDisabled, nexusSourceDiscoveryDisabled, nexusContentInterpretationDisabled } from "../../../../../src/nexus/http.ts";
import { createContentInterpretationModel } from "../../../../../src/nexus/content-interpretation-model.ts";
import { SupabaseNexusResultStore } from "../../../../../src/nexus/persistence.ts";
import { createPublicWebProvider, researchContextFromPayload } from "../../../../../src/nexus/public-web.ts";
import {configuredOrganisationSeed} from "../../../../../src/nexus/organisation-source-seed-config.ts";
import type { SourceDiscoveryBatchScope } from "../../../../../src/nexus/source-discovery/batch-scope.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const researchDisabled = nexusExecutorDisabled();
  const sourceDiscoveryDisabled = nexusSourceDiscoveryDisabled();
  const contentInterpretationDisabled = nexusContentInterpretationDisabled();
  let batchScope: SourceDiscoveryBatchScope | null = null;
  try {
    const encoded = process.env.NEXUS_SOURCE_DISCOVERY_BATCH_SCOPE?.trim();
    if (encoded) batchScope = JSON.parse(encoded) as SourceDiscoveryBatchScope;
  } catch {
    return Response.json({ code: "NEXUS_SOURCE_DISCOVERY_NOT_AVAILABLE" }, { status: 404 });
  }
  // Keep global discovery closed. The signed handler admits only requests in the short-lived manifest scope.
  if (researchDisabled && sourceDiscoveryDisabled && contentInterpretationDisabled && !batchScope) {
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
  const store=new SupabaseNexusResultStore(client);
  return handleNexusExecuteRequest(request, {
    secret,
    store,
    publicWeb: createPublicWebProvider({organisationSeed:configuredOrganisationSeed(store)}),
    researchContext: researchContextFromPayload,
    allowResearch: !researchDisabled,
    allowSourceDiscovery: !sourceDiscoveryDisabled,
    allowScopedSourceDiscovery: true,
    sourceDiscoveryBatchScope: batchScope ?? undefined,
    allowContentInterpretation: !contentInterpretationDisabled,
    contentModel: contentInterpretationDisabled ? null : createContentInterpretationModel(),
    // Research generation stays v6. Source-discovery replay uses SOURCE_DISCOVERY_EXECUTION_VERSION.
    researchExecutionVersion: "resources-v2-unclassified-evidence-v6",
  });
}
