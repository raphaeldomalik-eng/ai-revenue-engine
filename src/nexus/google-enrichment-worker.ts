// google-enrichment-worker.ts — Automated production worker for Google Places Pro and Enterprise enrichment.
// Rechecks evidence before any call, enforces monthly budget caps, respects tier ceilings, and stops cleanly when allowance is exhausted.
import { MonthlyProviderBudgetGuard, type MonthlyBudgetTier } from "./monthly-budget-guard.ts";
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
  discoveryQuery?: string;
  originatingProduct: string;
  marketCampaign?: string;
  computedPriority: number;
  status: string;
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
    outcome: "EVIDENCE_REUSED" | "CALL_EXECUTED" | "BUDGET_EXHAUSTED" | "MALFORMED_REJECTED" | "FAILED";
    error?: string;
  }>;
}

export class GoogleEnrichmentWorker {
  public readonly budgetGuard: MonthlyProviderBudgetGuard;
  public readonly evidenceStore: GooglePlacesEvidenceStore;
  private readonly fetchImpl?: typeof fetch;
  private readonly apiKey: string;

  constructor(
    budgetGuard: MonthlyProviderBudgetGuard,
    evidenceStore: GooglePlacesEvidenceStore,
    fetchImpl?: typeof fetch,
    apiKey = "test-api-key"
  ) {
    this.budgetGuard = budgetGuard;
    this.evidenceStore = evidenceStore;
    this.fetchImpl = fetchImpl;
    this.apiKey = apiKey;
  }

  /**
   * Processes a batch of candidates for Google Places Pro or Enterprise enrichment.
   */
  async processBatch(
    tier: MonthlyBudgetTier,
    candidates: EnrichedQueueCandidate[],
    targetTime: Date | string | number = new Date()
  ): Promise<WorkerBatchResult> {
    const budget = this.budgetGuard.getOrCreateBudget("google_places", tier, targetTime);
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

    if (availableBudget <= 0 || candidates.length === 0) {
      result.finalBudgetRemaining = this.budgetGuard.getOrCreateBudget("google_places", tier, targetTime).remaining;
      return result;
    }

    const authorization: GooglePlacesDetailsAuthorization =
      tier === "ENTERPRISE"
        ? { purpose: "OFFICIAL_WEBSITE", venueEligible: true, eligibilityRef: "venue:approved" }
        : GOOGLE_PLACES_VENUE_IDENTITY_AUTHORIZATION;

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

      // 2. Check remaining budget
      const currentBudget = this.budgetGuard.getOrCreateBudget("google_places", tier, targetTime);
      if (currentBudget.remaining <= 0) {
        result.results.push({
          externalReferenceId: placeId,
          outcome: "BUDGET_EXHAUSTED",
        });
        break; // Stop immediately when budget ceiling is reached
      }

      // 3. Concurrency-Safe Atomic Budget Reservation
      const reservation = await this.budgetGuard.reserveBudget("google_places", tier, 1, targetTime);
      if (!reservation.success) {
        result.results.push({
          externalReferenceId: placeId,
          outcome: "BUDGET_EXHAUSTED",
        });
        break;
      }

      // 4. Execute Provider Call through Governed Details Client
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
            targetName: "Candidate",
            targetWebsite: null,
            locality: "Gauteng",
            lane: "VENUE_FIRST",
            targetType: "VENUE",
            limit: 1,
            googlePlaceId: placeId,
          },
          options
        );

        if (run.googleCalls === 1) {
          // Billable network call made
          await this.budgetGuard.reconcileReservation(reservation.reservationId!, 1);
          result.callsExecuted += 1;
          result.results.push({
            externalReferenceId: placeId,
            outcome: "CALL_EXECUTED",
          });
        } else {
          // Satisfied from evidence store without making a billable call
          await this.budgetGuard.reconcileReservation(reservation.reservationId!, 0);
          result.callsSuppressed += 1;
          result.results.push({
            externalReferenceId: placeId,
            outcome: "EVIDENCE_REUSED",
          });
        }
      } catch (err: any) {
        // Failed attempt still reconciles reservation
        await this.budgetGuard.reconcileReservation(reservation.reservationId!, 1);
        result.callsFailed += 1;
        result.results.push({
          externalReferenceId: placeId,
          outcome: "FAILED",
          error: err.message,
        });
      }
    }

    result.finalBudgetRemaining = this.budgetGuard.getOrCreateBudget("google_places", tier, targetTime).remaining;
    return result;
  }
}
