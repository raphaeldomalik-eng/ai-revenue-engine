import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountProfile, ContactProfile, ProductOpportunityRecommendation, ResearchEvidence } from "../lead-intelligence/model.ts";

type ResolvedCommercialContext = { productId: string; territoryId: string; salesMotionId: string; commercialProgramId: string | null };
export type ActivityInput = { accountId: string; contactId?: string; opportunityId?: string; activityType: string; occurredAt?: string; summary?: string; metadata?: Record<string, unknown> };

function countryCode(country?: string) {
  const value = country?.trim().toUpperCase();
  if (value === "ZA" || value === "SOUTH AFRICA") return "ZA";
  if (value === "GB" || value === "UK" || value === "UNITED KINGDOM") return "GB";
  return null;
}

function territoryLookupCode(territory: ProductOpportunityRecommendation["territory"]) {
  if (territory === "ZA") return "za";
  if (territory === "GB") return "uk";
  return territory;
}

export function databaseConversionGoal(route: ProductOpportunityRecommendation["conversionRoute"]) {
  if (route === "BUSINESS_OPPORTUNITY_ENQUIRY") return "business_opportunity_enquiry";
  if (route === "SELF_SERVICE") return "self_service_signup";
  if (route === "QUALIFIED_LIVE_DEMO") return "live_demo_booking";
  return null;
}

export function commercialProgramLookup(recommendation: ProductOpportunityRecommendation) {
  return {
    productCode: recommendation.product,
    territoryCode: territoryLookupCode(recommendation.territory),
    salesMotionCode: recommendation.salesMotion,
    conversionGoal: databaseConversionGoal(recommendation.conversionRoute),
  };
}

export function mapAccountProfile(profile: AccountProfile) {
  return {
    name: profile.organisationName,
    website: profile.website ?? null,
    country_code: countryCode(profile.country),
    region: profile.region ?? null,
    organisation_type: profile.organisationType && profile.organisationType !== "UNKNOWN" ? profile.organisationType : null,
    source: "lead_intelligence",
    metadata: {
      domain: profile.domain ?? null,
      industrySector: profile.industrySector ?? null,
      sizeSignals: profile.sizeSignals ?? [],
      eventActivity: profile.eventActivity ?? "UNKNOWN",
      eventFrequency: profile.eventFrequency ?? "UNKNOWN",
      estimatedEventsPerYear: profile.estimatedEventsPerYear ?? null,
      currentSystems: profile.currentSystems ?? {},
      operationalNeeds: profile.operationalNeeds ?? [],
      localNetworkSignal: profile.localNetworkSignal ?? null,
      customerServicingCapability: profile.customerServicingCapability ?? null,
      sourceEvidenceIds: profile.sourceEvidenceIds,
      lastResearchedDate: profile.lastResearchedDate ?? null,
    },
  };
}

export function mapContactProfile(accountId: string, contact: ContactProfile) {
  return {
    account_id: accountId,
    full_name: contact.name ?? null,
    email: contact.email ?? null,
    role_title: contact.roleTitle ?? null,
    phone: contact.phone ?? null,
    seniority: contact.seniority ?? null,
    decision_role: contact.likelyDecisionRole ?? null,
    verification_status: contact.verificationState,
    source: "lead_intelligence",
    metadata: { evidenceIds: contact.evidenceIds },
  };
}

export function mapResearchEvidence(accountId: string, evidence: ResearchEvidence) {
  const sourceUrl = /^https?:\/\//i.test(evidence.sourceReference) ? evidence.sourceReference : null;
  return {
    account_id: accountId,
    evidence_type: evidence.sourceType,
    claim: evidence.observedFact,
    source_url: sourceUrl,
    source_reference: evidence.sourceReference,
    source_title: evidence.title,
    observed_at: evidence.observedAt,
    evidence_kind: evidence.kind,
    qualitative_confidence: evidence.confidence,
    notes: evidence.notes ?? null,
    metadata: {},
  };
}

export function mapProductOpportunity(accountId: string, recommendation: ProductOpportunityRecommendation, context: ResolvedCommercialContext) {
  return {
    account_id: accountId,
    product_id: context.productId,
    territory_id: context.territoryId,
    sales_motion_id: context.salesMotionId,
    commercial_program_id: context.commercialProgramId,
    stage: "identified",
    client_segment: recommendation.clientSegment ?? null,
    conversion_route: recommendation.conversionRoute,
    qualitative_confidence: recommendation.confidence === "UNKNOWN" ? null : recommendation.confidence,
    metadata: {
      commercialPlaybook: recommendation.commercialProgram ?? null,
      relevantCapabilities: recommendation.relevantCapabilities,
      observedProblems: recommendation.observedProblems,
      commercialSignals: recommendation.commercialSignals,
      evidenceIds: recommendation.evidenceIds,
      pricingTreatment: recommendation.pricingTreatment ?? null,
      pricingStatus: recommendation.pricingStatus ?? null,
      rationale: recommendation.rationale,
      nextResearchActions: recommendation.nextResearchActions,
      humanReviewRequired: recommendation.humanReviewRequired,
    },
  };
}

async function lookupSingleId(client: SupabaseClient, table: string, column: string, value: string) {
  const { data, error } = await client.from(table).select("id").eq(column, value).maybeSingle();
  if (error || !data) throw new Error(`Missing commercial configuration: ${table}.${column}=${value}.`);
  return data.id as string;
}

export async function resolveCommercialContext(client: SupabaseClient, recommendation: ProductOpportunityRecommendation): Promise<ResolvedCommercialContext> {
  if (recommendation.territory === "UNKNOWN") throw new Error("Cannot persist an opportunity without a resolved territory.");
  const productId = await lookupSingleId(client, "products", "code", recommendation.product);
  const territoryId = await lookupSingleId(client, "territories", "code", territoryLookupCode(recommendation.territory));
  const salesMotionId = await lookupSingleId(client, "sales_motions", "code", recommendation.salesMotion);
  const conversionGoal = commercialProgramLookup(recommendation).conversionGoal;
  if (!conversionGoal) return { productId, territoryId, salesMotionId, commercialProgramId: null };
  const { data, error } = await client.from("commercial_programs").select("id").eq("product_id", productId).eq("territory_id", territoryId).eq("sales_motion_id", salesMotionId).eq("conversion_goal", conversionGoal).maybeSingle();
  if (error || !data) throw new Error(`Missing commercial program for ${recommendation.product}/${recommendation.territory}/${recommendation.salesMotion}/${conversionGoal}.`);
  return { productId, territoryId, salesMotionId, commercialProgramId: data.id as string };
}

export class RevenueRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) { this.client = client; }

  async listAccounts() {
    const { data, error } = await this.client.from("accounts").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async listContacts(accountId: string) {
    const { data, error } = await this.client.from("contacts").select("*").eq("account_id", accountId).order("created_at");
    if (error) throw error;
    return data ?? [];
  }

  async listResearchEvidence(accountId: string) {
    const { data, error } = await this.client.from("research_evidence").select("*").eq("account_id", accountId).order("created_at");
    if (error) throw error;
    return data ?? [];
  }

  async listProductOpportunities(accountId: string) {
    const { data, error } = await this.client.from("product_opportunities").select("*").eq("account_id", accountId).order("created_at");
    if (error) throw error;
    return data ?? [];
  }

  async listActivities(accountId: string) {
    const { data, error } = await this.client.from("activities").select("*").eq("account_id", accountId).order("occurred_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async saveAccount(profile: AccountProfile, id?: string) {
    const query = id
      ? this.client.from("accounts").update(mapAccountProfile(profile)).eq("id", id).select("id").single()
      : this.client.from("accounts").insert(mapAccountProfile(profile)).select("id").single();
    const { data, error } = await query;
    if (error) throw error;
    return data.id as string;
  }

  async persistAccount(profile: AccountProfile) { return this.saveAccount(profile); }

  async saveContact(accountId: string, contact: ContactProfile, id?: string) {
    const values = mapContactProfile(accountId, contact);
    const query = id
      ? this.client.from("contacts").update(values).eq("id", id).eq("account_id", accountId).select("id").single()
      : this.client.from("contacts").insert(values).select("id").single();
    const { data, error } = await query;
    if (error) throw error;
    return data.id as string;
  }

  async persistContact(accountId: string, contact: ContactProfile) { return this.saveContact(accountId, contact); }

  async saveResearchEvidence(accountId: string, evidence: ResearchEvidence, id?: string, opportunityId?: string) {
    const values = { ...mapResearchEvidence(accountId, evidence), opportunity_id: opportunityId ?? null };
    const query = id
      ? this.client.from("research_evidence").update(values).eq("id", id).eq("account_id", accountId).select("id").single()
      : this.client.from("research_evidence").insert(values).select("id").single();
    const { data, error } = await query;
    if (error) throw error;
    return data.id as string;
  }

  async persistResearchEvidence(accountId: string, evidence: ResearchEvidence) { return this.saveResearchEvidence(accountId, evidence); }

  async saveProductOpportunity(accountId: string, recommendation: ProductOpportunityRecommendation, id?: string) {
    const context = await resolveCommercialContext(this.client, recommendation);
    const values = mapProductOpportunity(accountId, recommendation, context);
    const query = id
      ? this.client.from("product_opportunities").update(values).eq("id", id).eq("account_id", accountId).select("id").single()
      : this.client.from("product_opportunities").insert(values).select("id").single();
    const { data, error } = await query;
    if (error) throw error;
    return data.id as string;
  }

  async persistProductOpportunity(accountId: string, recommendation: ProductOpportunityRecommendation) { return this.saveProductOpportunity(accountId, recommendation); }

  async saveActivity(activity: ActivityInput, id?: string) {
    const values = { account_id: activity.accountId, contact_id: activity.contactId ?? null, opportunity_id: activity.opportunityId ?? null, activity_type: activity.activityType, occurred_at: activity.occurredAt ?? new Date().toISOString(), summary: activity.summary ?? null, metadata: activity.metadata ?? {} };
    const query = id
      ? this.client.from("activities").update(values).eq("id", id).eq("account_id", activity.accountId).select("id").single()
      : this.client.from("activities").insert(values).select("id").single();
    const { data, error } = await query;
    if (error) throw error;
    return data.id as string;
  }

  async persistActivity(activity: ActivityInput) { return this.saveActivity(activity); }

  async latestAiSalesBrief(accountId: string) {
    const { data, error } = await this.client.from("ai_sales_briefs").select("*").eq("account_id", accountId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data;
  }
}
