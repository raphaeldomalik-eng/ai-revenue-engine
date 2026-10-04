import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../src/lib/supabase-server";
import {
  queryCataloguePage,
  fetchCatalogueItem,
  fetchCatalogueBudgets,
  promoteCatalogueEntity,
} from "../../../../src/nexus/db.ts";
import type {
  CatalogueFilterParams,
  NormalizedProfile,
  EventCapability,
  CanonicalIdentityState,
  RouteState,
  ResearchDisposition,
  PaidEligibility,
} from "../../../../src/nexus/catalogue.ts";

async function readOperatorAccess(client: Awaited<ReturnType<typeof createServerSupabaseClient>>) {
  try {
    const { data: auth } = await client.auth.getUser();
    if (auth?.user) {
      const { data: member, error } = await client
        .from("revenue_members")
        .select("member_role, active")
        .eq("user_id", auth.user.id)
        .maybeSingle();
      if (!error && member?.active) {
        return {
          access: String(member.member_role).toUpperCase() as "VIEWER" | "OPERATOR" | "ADMIN",
          userId: auth.user.id,
          memberRole: String(member.member_role).toLowerCase(),
        };
      }
    }
  } catch {
    // ignore
  }

  if (process.env.NODE_ENV !== "production" || process.env.ALLOW_LOCAL_OPERATOR === "true") {
    return { access: "ADMIN" as const, userId: "local-dev-operator", memberRole: "admin" };
  }

  return { error: NextResponse.json({ message: "Active operator access is required." }, { status: 401 }) };
}

export async function GET(request: Request) {
  const client = await createServerSupabaseClient();
  const access = await readOperatorAccess(client);
  if ("error" in access && access.error) return access.error;

  const url = new URL(request.url);
  const externalRef = url.searchParams.get("externalReferenceId") || url.searchParams.get("selected");

  // Single entity detail fetch
  if (externalRef && url.searchParams.get("view") === "detail") {
    try {
      const entity = await fetchCatalogueItem(externalRef);
      if (!entity) {
        return NextResponse.json({ message: "Entity not found in Catalogue." }, { status: 404 });
      }
      const budgets = await fetchCatalogueBudgets();
      return NextResponse.json({ access: access.access, entity, budgets });
    } catch (err) {
      return NextResponse.json(
        { message: "Catalogue data could not be fetched.", error: (err as Error).message },
        { status: 500 }
      );
    }
  }

  // Collection list fetch
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(10, Number.parseInt(url.searchParams.get("pageSize") ?? "50", 10) || 50));
  const search = (url.searchParams.get("search") ?? "").trim();
  const saved = (url.searchParams.get("saved") ?? "all").toLowerCase();

  const filters: CatalogueFilterParams = {
    limit: pageSize,
    offset: (page - 1) * pageSize,
    searchQuery: search || undefined,
  };

  // Map saved view presets
  switch (saved) {
    case "needs_web_verification":
      filters.researchDisposition = "FIRST_PARTY_WEB_VERIFICATION";
      break;
    case "owner_confirmation":
      filters.researchDisposition = "OWNER_CONFIRMATION";
      break;
    case "resources_ready":
      filters.resourcesRoute = "STRONG_FIT";
      break;
    case "needs_identity_review":
      filters.canonicalIdentityState = "UNRESOLVED";
      break;
    case "waiting_for_paid_research":
      filters.researchDisposition = ["WAITING_FOR_BUDGET", "PRO_ELIGIBLE_LATER", "ENTERPRISE_ELIGIBLE_LATER"];
      break;
    case "event_businesses":
      filters.eventBusinessRoute = "STRONG_FIT";
      break;
    case "invalid_provider_refs":
      filters.isInvalidReference = true;
      break;
    case "commercial_possible":
      filters.commercialProspectingRoute = "POSSIBLE_FIT";
      break;
  }

  // Granular query filters
  const country = url.searchParams.get("country");
  if (country) filters.country = country;

  const region = url.searchParams.get("region");
  if (region) filters.region = region;

  const locality = url.searchParams.get("locality");
  if (locality) filters.locality = locality;

  const profile = url.searchParams.get("normalizedProfile");
  if (profile) {
    filters.normalizedProfile = profile.includes(",")
      ? (profile.split(",") as NormalizedProfile[])
      : (profile as NormalizedProfile);
  }

  const capability = url.searchParams.get("eventCapability");
  if (capability) {
    filters.eventCapability = capability.includes(",")
      ? (capability.split(",") as EventCapability[])
      : (capability as EventCapability);
  }

  const identityState = url.searchParams.get("canonicalIdentityState");
  if (identityState) filters.canonicalIdentityState = identityState as CanonicalIdentityState;

  const resourcesRoute = url.searchParams.get("resourcesRoute");
  if (resourcesRoute) filters.resourcesRoute = resourcesRoute as RouteState;

  const venueManagementRoute = url.searchParams.get("venueManagementRoute");
  if (venueManagementRoute) filters.venueManagementRoute = venueManagementRoute as RouteState;

  const contextPosRoute = url.searchParams.get("contextPosRoute");
  if (contextPosRoute) filters.contextPosRoute = contextPosRoute as RouteState;

  const ticketingRoute = url.searchParams.get("ticketingRoute");
  if (ticketingRoute) filters.ticketingRoute = ticketingRoute as RouteState;

  const workforceRoute = url.searchParams.get("workforceRoute");
  if (workforceRoute) filters.workforceRoute = workforceRoute as RouteState;

  const productionOpsRoute = url.searchParams.get("productionOpsRoute");
  if (productionOpsRoute) filters.productionOpsRoute = productionOpsRoute as RouteState;

  const eventBusinessRoute = url.searchParams.get("eventBusinessRoute");
  if (eventBusinessRoute) filters.eventBusinessRoute = eventBusinessRoute as RouteState;

  const commercialRoute = url.searchParams.get("commercialProspectingRoute");
  if (commercialRoute) filters.commercialProspectingRoute = commercialRoute as RouteState;

  const disposition = url.searchParams.get("researchDisposition");
  if (disposition) {
    filters.researchDisposition = disposition.includes(",")
      ? (disposition.split(",") as ResearchDisposition[])
      : (disposition as ResearchDisposition);
  }

  const proEligibility = url.searchParams.get("proEligibility");
  if (proEligibility) filters.proEligibility = proEligibility as PaidEligibility;

  const entEligibility = url.searchParams.get("enterpriseEligibility");
  if (entEligibility) filters.enterpriseEligibility = entEligibility as PaidEligibility;

  const isInvalid = url.searchParams.get("isInvalidReference");
  if (isInvalid !== null) filters.isInvalidReference = isInvalid === "true";

  const isDuplicate = url.searchParams.get("isDuplicate");
  if (isDuplicate !== null) filters.isDuplicate = isDuplicate === "true";

  const isClosed = url.searchParams.get("isPermanentlyClosed");
  if (isClosed !== null) filters.isPermanentlyClosed = isClosed === "true";

  const sortBy = url.searchParams.get("sortBy");
  if (sortBy) filters.sortBy = sortBy as any;

  const sortOrder = url.searchParams.get("sortOrder");
  if (sortOrder === "asc" || sortOrder === "desc") filters.sortOrder = sortOrder;

  try {
    const result = await queryCataloguePage(filters);
    return NextResponse.json({
      access: access.access,
      view: "catalogue",
      items: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      pageCount: result.pageCount,
      budgets: result.budgets,
      saved,
    });
  } catch (err) {
    return NextResponse.json(
      { message: "Catalogue data could not be queried.", error: (err as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const client = await createServerSupabaseClient();
  const access = await readOperatorAccess(client);
  if ("error" in access && access.error) return access.error;

  if (access.access !== "OPERATOR" && access.access !== "ADMIN") {
    return NextResponse.json({ message: "Operator permission required for catalogue actions." }, { status: 403 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "INVALID_JSON", message: "Malformed JSON payload." }, { status: 400 });
  }

  const { action, externalReferenceId, purpose, reason, originatingProduct, evidenceGapReason } = body;

  if (!externalReferenceId) {
    return NextResponse.json({ code: "REFERENCE_REQUIRED", message: "Provider reference ID is required." }, { status: 400 });
  }

  if (action === "PROMOTE_PRO") {
    const result = await promoteCatalogueEntity({
      externalReferenceId,
      billingTier: "PRO",
      purpose: purpose || "Operator Manual Promotion",
      reason: reason || "Manual promotion request",
      originatingProduct: originatingProduct || "resources",
      actorId: access.userId,
    });

    if (!result.success) {
      const status = result.reason === "EVIDENCE_ALREADY_AVAILABLE" ? 200 : 400;
      return NextResponse.json({ code: result.reason, message: result.message, suppressed: result.reason === "EVIDENCE_ALREADY_AVAILABLE" }, { status });
    }

    return NextResponse.json({
      success: true,
      queueId: result.queueId,
      status: result.status,
      message: result.message,
    });
  }

  if (action === "PROMOTE_ENTERPRISE") {
    const result = await promoteCatalogueEntity({
      externalReferenceId,
      billingTier: "ENTERPRISE",
      purpose: purpose || "Operator Enterprise Investigation",
      reason: reason || "Manual enterprise escalation",
      evidenceGapReason: evidenceGapReason || reason,
      originatingProduct: originatingProduct || "resources",
      actorId: access.userId,
    });

    if (!result.success) {
      const status = result.reason === "EVIDENCE_ALREADY_AVAILABLE" ? 200 : 400;
      return NextResponse.json({ code: result.reason, message: result.message, suppressed: result.reason === "EVIDENCE_ALREADY_AVAILABLE" }, { status });
    }

    return NextResponse.json({
      success: true,
      queueId: result.queueId,
      status: result.status,
      message: result.message,
    });
  }

  return NextResponse.json({ code: "UNKNOWN_ACTION", message: `Action ${action} is not supported.` }, { status: 400 });
}
