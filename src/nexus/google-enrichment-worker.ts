// google-enrichment-worker.ts — Automated production worker for Google Places Pro and Enterprise enrichment.
// Rechecks durable evidence before any call, consumes durable Nexus queue directly,
// enforces hard monthly budget caps, respects tier ceilings, and stops cleanly when allowance is exhausted.
import {
  MonthlyProviderBudgetGuard,
  type ProviderBudgetStore,
  type MonthlyBudgetTier,
  type ClaimedQueueJob,
} from "./monthly-budget-guard.ts";
import {
  type GooglePlacesEvidenceStore,
  type GooglePlacesDetailsAuthorization,
  GOOGLE_PLACES_VENUE_IDENTITY_AUTHORIZATION,
} from "../ai-sales-team/google-places-evidence.ts";
import {
  getGooglePlaceDetails,
  type GooglePlacesOptions,
  type GooglePlaceDetailsRun,
} from "../ai-sales-team/google-places.ts";

export const GOOGLE_PLACE_ID_RE = /^ChIJ[A-Za-z0-9_-]{23}$/;

export interface EnrichedQueueCandidate {
  externalReferenceId: string;
  targetName?: string;
  locality?: string;
  discoveryQuery?: string;
  originatingProduct: string;
  marketCampaign?: string;
  computedPriority: number;
  status: string;
  targetType?: string;
  lane?: string;
  resourcesVenueEligibility?: "ELIGIBLE" | "INELIGIBLE" | "REQUIRES_REVIEW";
  eligibilityRef?: string;
}

export interface WorkerBatchResult {
  provider: string;
  tier: MonthlyBudgetTier;
  monthlyLimit: number;
  initialBudgetRemaining: number;
  candidatesProcessed: number;
  callsExecuted: number;
  callsSuppressed: number;
  callsFailed: number;
  finalBudgetRemaining: number;
  results: Array<{
    externalReferenceId: string;
    outcome:
      | "EVIDENCE_REUSED"
      | "CALL_EXECUTED"
      | "BUDGET_EXHAUSTED"
      | "MALFORMED_REJECTED"
      | "ENTERPRISE_ELIGIBILITY_MISSING"
      | "FAILED";
    error?: string;
  }>;
}

export class GoogleEnrichmentWorker {
  public readonly budgetGuard: MonthlyProviderBudgetGuard;
  public readonly evidenceStore: GooglePlacesEvidenceStore;
  private readonly fetchImpl?: typeof fetch;
  private readonly apiKey: string;

  constructor(
    budgetGuard: MonthlyProviderBudgetGuard | ProviderBudgetStore,
    evidenceStore: GooglePlacesEvidenceStore,
    fetchImpl?: typeof fetch,
    apiKey?: string
  ) {
    this.budgetGuard =
      budgetGuard instanceof MonthlyProviderBudgetGuard
        ? budgetGuard
        : new MonthlyProviderBudgetGuard(budgetGuard);
    this.evidenceStore = evidenceStore;
    this.fetchImpl = fetchImpl;
    // Approved credential from environment/config; NO hardcoded default test key
    // Strictly requires GOOGLE_PLACES_API_KEY; GOOGLE_MAPS_API_KEY fallback is prohibited.
    this.apiKey = apiKey ?? process.env.GOOGLE_PLACES_API_KEY ?? "";
  }

  /**
   * Helper to check if existing durable evidence already satisfies the requested tier.
   */
  private isEvidenceUsable(evidence: any, tier: MonthlyBudgetTier): boolean {
    if (!evidence) return false;
    const held = evidence.heldClassification;
    if (tier === "PRO") {
      return Boolean(held && (held.primaryType || held.displayName || (Array.isArray(held.types) && held.types.length > 0)));
    }
    if (tier === "ENTERPRISE" || tier === "ENTERPRISE_ATMOSPHERE") {
      return Boolean(held && held.websiteUri);
    }
    return false;
  }

  /**
   * Production entry point: Consumes the durable Nexus paid enrichment queue directly.
   * Atomically claims work + reserves budget from Nexus, rechecks evidence, executes,
   * and reconciles reservation fail-closed.
   */
  async processDurableQueue(
    tier: MonthlyBudgetTier,
    maxJobs = 100,
    options: { workerId?: string; targetTime?: Date | string | number } = {}
  ): Promise<WorkerBatchResult> {
    const targetTime = options.targetTime ?? new Date();
    const workerId = options.workerId ?? "aire-worker";
    const initialBudget = await this.budgetGuard.getOrCreateBudgetAsync("google_places", tier, targetTime);

    const result: WorkerBatchResult = {
      provider: "google_places",
      tier,
      monthlyLimit: initialBudget.monthlyCallLimit,
      initialBudgetRemaining: initialBudget.remaining,
      candidatesProcessed: 0,
      callsExecuted: 0,
      callsSuppressed: 0,
      callsFailed: 0,
      finalBudgetRemaining: initialBudget.remaining,
      results: [],
    };

    while (result.candidatesProcessed < maxJobs) {
      // 1. Claim next priority job from durable Nexus queue (atomic claim + budget reservation)
      const claim = await this.budgetGuard.claimNextJob("google_places", tier, workerId, targetTime);
      if (!claim.success || !claim.job) {
        if (claim.reason === "MONTHLY_LIMIT_EXCEEDED" || claim.reason === "ZERO_BUDGET_LIMIT") {
          // Budget exhausted, stop cleanly
          break;
        }
        if (claim.reason === "NO_ELIGIBLE_JOBS" || claim.reason === "CLAIM_NOT_SUPPORTED") {
          // No more eligible jobs in queue
          break;
        }
        break;
      }

      const job = claim.job;
      const placeId = job.externalReferenceId.trim();
      result.candidatesProcessed += 1;

      // 2. Pre-call Evidence Recheck against shared durable evidence store
      const existingEvidence = await this.evidenceStore.get(placeId);
      if (this.isEvidenceUsable(existingEvidence, tier)) {
        // Suppress provider call, reconcile 0 consumed, mark EVIDENCE_ALREADY_AVAILABLE
        await this.budgetGuard.reconcileReservation(job.reservationId, 0, "EVIDENCE_ALREADY_AVAILABLE");
        result.callsSuppressed += 1;
        result.results.push({ externalReferenceId: placeId, outcome: "EVIDENCE_REUSED" });
        continue;
      }

      // 3. Enterprise Authorization Recheck: Must never be synthetic
      if (tier === "ENTERPRISE" || tier === "ENTERPRISE_ATMOSPHERE") {
        if (job.resourcesVenueEligibility !== "ELIGIBLE" || !job.eligibilityRef) {
          // Genuine eligibility evidence absent: Enterprise call = 0
          await this.budgetGuard.reconcileReservation(job.reservationId, 0, "MISSING_ENTERPRISE_ELIGIBILITY");
          result.callsSuppressed += 1;
          result.results.push({
            externalReferenceId: placeId,
            outcome: "ENTERPRISE_ELIGIBILITY_MISSING",
            error: "Genuine governed resourcesVenueEligibility = ELIGIBLE required for Enterprise enrichment",
          });
          continue;
        }
      }

      // 4. API Key Verification: Fail closed if credential is not configured
      if (!this.apiKey) {
        await this.budgetGuard.reconcileReservation(job.reservationId, 0, "MISSING_GOOGLE_API_KEY");
        result.callsFailed += 1;
        result.results.push({
          externalReferenceId: placeId,
          outcome: "FAILED",
          error: "MISSING_GOOGLE_API_KEY",
        });
        break;
      }

      // 5. Governed Provider Execution: Consume real metadata from queue request
      const authorization: GooglePlacesDetailsAuthorization =
        tier === "ENTERPRISE"
          ? { purpose: "OFFICIAL_WEBSITE", venueEligible: true, eligibilityRef: job.eligibilityRef! }
          : GOOGLE_PLACES_VENUE_IDENTITY_AUTHORIZATION;

      try {
        const clientOptions: GooglePlacesOptions = {
          mode: "details_selected",
          apiKey: this.apiKey,
          evidenceStore: this.evidenceStore,
          fetchImpl: this.fetchImpl,
          detailsAuthorization: authorization,
          now: () => new Date(targetTime).toISOString(),
        };

        const run: GooglePlaceDetailsRun = await getGooglePlaceDetails(
          {
            targetName: job.targetName || job.discoveryQuery || "Unknown",
            targetWebsite: null,
            locality: job.locality || job.marketCampaign || undefined,
            lane: (job.lane as any) || "VENUE_FIRST",
            targetType: (job.targetType as any) || "VENUE",
            limit: 1,
            googlePlaceId: placeId,
          },
          clientOptions
        );

        if (run.googleCalls === 1) {
          await this.budgetGuard.reconcileReservation(job.reservationId, 1, "CALL_EXECUTED");
          result.callsExecuted += 1;
          result.results.push({ externalReferenceId: placeId, outcome: "CALL_EXECUTED" });
        } else {
          await this.budgetGuard.reconcileReservation(job.reservationId, 0, "EVIDENCE_ALREADY_AVAILABLE");
          result.callsSuppressed += 1;
          result.results.push({ externalReferenceId: placeId, outcome: "EVIDENCE_REUSED" });
        }
      } catch (err: any) {
        await this.budgetGuard.reconcileReservation(job.reservationId, 1, "FAILED_PROVIDER_CALL");
        result.callsFailed += 1;
        result.results.push({
          externalReferenceId: placeId,
          outcome: "FAILED",
          error: err.message,
        });
      }
    }

    const finalBudget = await this.budgetGuard.getOrCreateBudgetAsync("google_places", tier, targetTime);
    result.finalBudgetRemaining = finalBudget.remaining;
    return result;
  }

  /**
   * Processes a supplied candidate batch.
   * Used for offline/evaluation workflows and unit tests.
   */
  async processBatch(
    tier: MonthlyBudgetTier,
    candidates: EnrichedQueueCandidate[],
    targetTime: Date | string | number = new Date()
  ): Promise<WorkerBatchResult> {
    const budget = await this.budgetGuard.getOrCreateBudgetAsync("google_places", tier, targetTime);
    let availableBudget = budget.remaining;

    const result: WorkerBatchResult = {
      provider: "google_places",
      tier,
      monthlyLimit: budget.monthlyCallLimit,
      initialBudgetRemaining: availableBudget,
      candidatesProcessed: 0,
      callsExecuted: 0,
      callsSuppressed: 0,
      callsFailed: 0,
      finalBudgetRemaining: availableBudget,
      results: [],
    };

    if (candidates.length === 0) {
      result.finalBudgetRemaining = availableBudget;
      return result;
    }

    for (const candidate of candidates) {
      const placeId = candidate.externalReferenceId.trim();
      result.candidatesProcessed += 1;

      // 1. Malformed Reference Check: Fail closed
      if (!GOOGLE_PLACE_ID_RE.test(placeId)) {
        result.results.push({
          externalReferenceId: placeId,
          outcome: "MALFORMED_REJECTED",
          error: "Place ID does not conform to standard format",
        });
        continue;
      }

      // 2. Pre-call Evidence Recheck against shared durable evidence store
      const existingEvidence = await this.evidenceStore.get(placeId);
      if (this.isEvidenceUsable(existingEvidence, tier)) {
        result.callsSuppressed += 1;
        result.results.push({
          externalReferenceId: placeId,
          outcome: "EVIDENCE_REUSED",
        });
        continue;
      }

      // 3. Enterprise Authorization: Must be genuine, never synthetic
      if (tier === "ENTERPRISE" || tier === "ENTERPRISE_ATMOSPHERE") {
        if (candidate.resourcesVenueEligibility !== "ELIGIBLE" || !candidate.eligibilityRef) {
          result.callsSuppressed += 1;
          result.results.push({
            externalReferenceId: placeId,
            outcome: "ENTERPRISE_ELIGIBILITY_MISSING",
            error: "Enterprise authorization denied: missing genuine governed resourcesVenueEligibility = ELIGIBLE",
          });
          continue;
        }
      }

      // 4. Check remaining budget
      const currentBudget = await this.budgetGuard.getOrCreateBudgetAsync("google_places", tier, targetTime);
      if (currentBudget.remaining <= 0) {
        result.results.push({
          externalReferenceId: placeId,
          outcome: "BUDGET_EXHAUSTED",
        });
        break; // Stop immediately when budget ceiling is reached
      }

      // 5. Concurrency-Safe Atomic Budget Reservation
      const reservation = await this.budgetGuard.reserveBudget("google_places", tier, 1, targetTime);
      if (!reservation.success) {
        result.results.push({
          externalReferenceId: placeId,
          outcome: "BUDGET_EXHAUSTED",
        });
        break;
      }

      // 6. Fail closed if API key is missing and network fetch is required
      if (!this.apiKey) {
        await this.budgetGuard.reconcileReservation(reservation.reservationId!, 0, "MISSING_GOOGLE_API_KEY");
        result.callsFailed += 1;
        result.results.push({
          externalReferenceId: placeId,
          outcome: "FAILED",
          error: "MISSING_GOOGLE_API_KEY",
        });
        break;
      }

      // 7. Execute Provider Call through Governed Details Client with real request context
      const authorization: GooglePlacesDetailsAuthorization =
        tier === "ENTERPRISE"
          ? { purpose: "OFFICIAL_WEBSITE", venueEligible: true, eligibilityRef: candidate.eligibilityRef! }
          : GOOGLE_PLACES_VENUE_IDENTITY_AUTHORIZATION;

      try {
        const options: GooglePlacesOptions = {
          mode: "details_selected",
          apiKey: this.apiKey,
          evidenceStore: this.evidenceStore,
          fetchImpl: this.fetchImpl,
          detailsAuthorization: authorization,
          now: () => new Date(targetTime).toISOString(),
        };

        const run: GooglePlaceDetailsRun = await getGooglePlaceDetails(
          {
            targetName: candidate.targetName || candidate.discoveryQuery || "Unknown",
            targetWebsite: null,
            locality: candidate.locality || candidate.marketCampaign || undefined,
            lane: (candidate.lane as any) || "VENUE_FIRST",
            targetType: (candidate.targetType as any) || "VENUE",
            limit: 1,
            googlePlaceId: placeId,
          },
          options
        );

        if (run.googleCalls === 1) {
          // Billable network call made
          await this.budgetGuard.reconcileReservation(reservation.reservationId!, 1, "CALL_EXECUTED");
          result.callsExecuted += 1;
          result.results.push({
            externalReferenceId: placeId,
            outcome: "CALL_EXECUTED",
          });
        } else {
          // Satisfied from evidence store without making a billable call
          await this.budgetGuard.reconcileReservation(reservation.reservationId!, 0, "EVIDENCE_ALREADY_AVAILABLE");
          result.callsSuppressed += 1;
          result.results.push({
            externalReferenceId: placeId,
            outcome: "EVIDENCE_REUSED",
          });
        }
      } catch (err: any) {
        await this.budgetGuard.reconcileReservation(reservation.reservationId!, 1, "FAILED_PROVIDER_CALL");
        result.callsFailed += 1;
        result.results.push({
          externalReferenceId: placeId,
          outcome: "FAILED",
          error: err.message,
        });
      }
    }

    const finalBudget = await this.budgetGuard.getOrCreateBudgetAsync("google_places", tier, targetTime);
    result.finalBudgetRemaining = finalBudget.remaining;
    return result;
  }
}
