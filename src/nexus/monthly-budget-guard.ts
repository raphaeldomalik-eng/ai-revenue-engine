// monthly-budget-guard.ts — Portfolio-global monthly budget guard for Google Places Pro and Enterprise.
// Enforces hard monthly caps, calendar month UTC accounting, concurrency-safe atomic reservations,
// durable Supabase/Nexus RPC integration, independent tier ceilings, and owner kill switches.
import { randomUUID } from "node:crypto";
import type { GooglePlacesBillingTier } from "../ai-sales-team/google-places-evidence.ts";

export type MonthlyBudgetTier = "PRO" | "ENTERPRISE" | "ENTERPRISE_ATMOSPHERE";

export interface MonthlyBudgetRecord {
  provider: string;
  billingTier: MonthlyBudgetTier;
  monthlyCallLimit: number;
  isEnabled: boolean;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  callsConsumed: number;
  callsReserved: number;
  updatedBy: string;
  updatedAt: string;
  remaining: number;
}

export interface BudgetReservationResult {
  success: boolean;
  reason?: "ZERO_BUDGET_LIMIT" | "MONTHLY_LIMIT_EXCEEDED" | "BUDGET_DISABLED" | "INVALID_COUNT";
  reservationId?: string;
  limit: number;
  consumed: number;
  reserved: number;
  remaining: number;
}

export interface BudgetReconciliationResult {
  success: boolean;
  reservationId?: string;
  state?: "CONSUMED" | "RELEASED" | "RECONCILIATION_REQUIRED";
  actualConsumed?: number;
  limit: number;
  consumed: number;
  reserved: number;
  remaining: number;
}

export interface ClaimedQueueJob {
  queueId: string;
  provider: string;
  billingTier: MonthlyBudgetTier;
  externalReferenceId: string;
  reservationId: string;
  targetName?: string;
  locality?: string;
  discoveryQuery?: string;
  originatingProduct: string;
  marketCampaign?: string;
  computedPriority: number;
  evidenceGapReason: string;
  resourcesVenueEligibility?: "ELIGIBLE" | "INELIGIBLE" | "REQUIRES_REVIEW";
  eligibilityRef?: string;
  targetType?: string;
  lane?: string;
}

export interface ClaimJobResult {
  success: boolean;
  reason?: string;
  job?: ClaimedQueueJob;
  budget?: {
    limit: number;
    consumed: number;
    reserved: number;
    remaining: number;
  };
}

/**
 * Common store interface for budget governance.
 * Production implementations bind to durable Supabase RPCs/tables.
 * In-memory implementations are used exclusively for unit testing.
 */
export interface ProviderBudgetStore {
  getOrCreateBudget(provider: string, tier: MonthlyBudgetTier, targetTime?: Date | string | number): Promise<MonthlyBudgetRecord>;
  setMonthlyLimit(provider: string, tier: MonthlyBudgetTier, limit: number, isEnabled?: boolean, updatedBy?: string, targetTime?: Date | string | number): Promise<MonthlyBudgetRecord>;
  reserveBudget(provider: string, tier: MonthlyBudgetTier, count?: number, targetTime?: Date | string | number, options?: { originatingProduct?: string; queueId?: string }): Promise<BudgetReservationResult>;
  reconcileReservation(reservationId: string, actualConsumed: number, reason?: string): Promise<BudgetReconciliationResult>;
  claimNextJob?(provider: string, tier: MonthlyBudgetTier, workerId?: string, targetTime?: Date | string | number): Promise<ClaimJobResult>;
}

/**
 * Returns UTC calendar month boundaries for a target date.
 */
export function getCalendarMonthUtcBounds(targetTime: Date | string | number = new Date()): { periodStart: Date; periodEnd: Date } {
  const d = new Date(targetTime);
  const periodStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { periodStart, periodEnd };
}

/**
 * Durable production budget store backed by Nexus Supabase RPCs.
 * Survives worker restarts and scales across concurrent worker instances.
 */
export class DurableSupabaseBudgetStore implements ProviderBudgetStore {
  private readonly client: any;

  constructor(client: any) {
    this.client = client;
  }

  async getOrCreateBudget(provider: string, tier: MonthlyBudgetTier, targetTime: Date | string | number = new Date()): Promise<MonthlyBudgetRecord> {
    const { data, error } = await this.client.rpc("get_or_create_monthly_provider_budget", {
      p_provider: provider.toLowerCase(),
      p_billing_tier: tier.toUpperCase(),
      p_target_time: new Date(targetTime).toISOString(),
    });
    if (error) throw error;
    const row = data;
    const remaining = Math.max(0, row.monthly_call_limit - (row.calls_consumed + row.calls_reserved));
    return {
      provider: row.provider,
      billingTier: row.billing_tier,
      monthlyCallLimit: row.monthly_call_limit,
      isEnabled: row.is_enabled,
      billingPeriodStart: row.billing_period_start,
      billingPeriodEnd: row.billing_period_end,
      callsConsumed: row.calls_consumed,
      callsReserved: row.calls_reserved,
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
      remaining,
    };
  }

  async setMonthlyLimit(
    provider: string,
    tier: MonthlyBudgetTier,
    limit: number,
    isEnabled = true,
    updatedBy = "owner",
    targetTime: Date | string | number = new Date()
  ): Promise<MonthlyBudgetRecord> {
    const { data, error } = await this.client.rpc("set_monthly_provider_budget_limit", {
      p_provider: provider.toLowerCase(),
      p_billing_tier: tier.toUpperCase(),
      p_limit: limit,
      p_is_enabled: isEnabled,
      p_updated_by: updatedBy,
      p_target_time: new Date(targetTime).toISOString(),
    });
    if (error) throw error;
    return this.getOrCreateBudget(provider, tier, targetTime);
  }

  async reserveBudget(
    provider: string,
    tier: MonthlyBudgetTier,
    count = 1,
    targetTime: Date | string | number = new Date(),
    options?: { originatingProduct?: string; queueId?: string }
  ): Promise<BudgetReservationResult> {
    const { data, error } = await this.client.rpc("reserve_monthly_provider_budget", {
      p_provider: provider.toLowerCase(),
      p_billing_tier: tier.toUpperCase(),
      p_count: count,
      p_originating_product: options?.originatingProduct ?? "resources",
      p_queue_id: options?.queueId ?? null,
      p_target_time: new Date(targetTime).toISOString(),
    });
    if (error) throw error;
    return {
      success: data.success,
      reason: data.reason,
      reservationId: data.reservation_id,
      limit: data.limit,
      consumed: data.consumed,
      reserved: data.reserved,
      remaining: data.remaining,
    };
  }

  async reconcileReservation(reservationId: string, actualConsumed: number, reason?: string): Promise<BudgetReconciliationResult> {
    const { data, error } = await this.client.rpc("reconcile_provider_budget_reservation", {
      p_reservation_id: reservationId,
      p_actual_consumed: actualConsumed,
      p_reason: reason ?? null,
    });
    if (error) throw error;
    return {
      success: data.success,
      reservationId: data.reservation_id,
      state: data.state,
      actualConsumed: data.actual_consumed,
      limit: data.limit,
      consumed: data.consumed,
      reserved: data.reserved,
      remaining: data.remaining,
    };
  }

  async claimNextJob(
    provider: string,
    tier: MonthlyBudgetTier,
    workerId = "aire-worker",
    targetTime: Date | string | number = new Date()
  ): Promise<ClaimJobResult> {
    const { data, error } = await this.client.rpc("claim_next_paid_enrichment_job", {
      p_provider: provider.toLowerCase(),
      p_billing_tier: tier.toUpperCase(),
      p_worker_id: workerId,
      p_target_time: new Date(targetTime).toISOString(),
    });
    if (error) throw error;
    if (!data.success) {
      return { success: false, reason: data.reason, budget: data.budget };
    }
    const j = data.job;
    return {
      success: true,
      job: {
        queueId: j.queue_id,
        provider: j.provider,
        billingTier: j.billing_tier,
        externalReferenceId: j.external_reference_id,
        reservationId: j.reservation_id,
        discoveryQuery: j.discovery_query,
        originatingProduct: j.originating_product,
        marketCampaign: j.market_campaign,
        computedPriority: j.computed_priority,
        evidenceGapReason: j.evidence_gap_reason,
      },
      budget: data.budget,
    };
  }
}

/**
 * In-memory implementation of ProviderBudgetStore for focused unit tests.
 * Models durable state transitions, fail-closed reconciliation, and recurring limit inheritance.
 */
export class InMemoryBudgetStore implements ProviderBudgetStore {
  private budgets: Map<string, MonthlyBudgetRecord>;
  private defaultLimits: Record<string, number>;
  private reservations: Map<string, {
    id: string;
    provider: string;
    tier: MonthlyBudgetTier;
    periodStart: string;
    count: number;
    state: "RESERVED" | "CONSUMED" | "RELEASED";
    actualConsumed?: number;
    reason?: string;
  }>;
  private queuedJobs: ClaimedQueueJob[];
  private _lock: Promise<void>;

  constructor(initialLimits?: { proLimit?: number; enterpriseLimit?: number }) {
    this.budgets = new Map();
    this.defaultLimits = {
      "google_places:PRO": initialLimits?.proLimit ?? 0,
      "google_places:ENTERPRISE": initialLimits?.enterpriseLimit ?? 0,
      "google_places:ENTERPRISE_ATMOSPHERE": 0,
    };
    this.reservations = new Map();
    this.queuedJobs = [];
    this._lock = Promise.resolve();
  }

  private _getKey(provider: string, tier: MonthlyBudgetTier, periodStart: Date): string {
    return `${provider.toLowerCase()}:${tier.toUpperCase()}:${periodStart.toISOString()}`;
  }

  private async _withLock<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void = () => {};
    const nextLock = new Promise<void>((resolve) => { release = resolve; });
    const currentLock = this._lock;
    this._lock = currentLock.then(() => nextLock);
    await currentLock;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  enqueueTestJob(job: ClaimedQueueJob): void {
    this.queuedJobs.push(job);
  }

  async getOrCreateBudget(provider: string, tier: MonthlyBudgetTier, targetTime: Date | string | number = new Date()): Promise<MonthlyBudgetRecord> {
    const { periodStart, periodEnd } = getCalendarMonthUtcBounds(targetTime);
    const key = this._getKey(provider, tier, periodStart);

    let budget = this.budgets.get(key);
    if (!budget) {
      const limitKey = `${provider.toLowerCase()}:${tier.toUpperCase()}`;
      const configuredLimit = this.defaultLimits[limitKey] ?? 0;
      budget = {
        provider: provider.toLowerCase(),
        billingTier: tier,
        monthlyCallLimit: configuredLimit,
        isEnabled: true,
        billingPeriodStart: periodStart.toISOString(),
        billingPeriodEnd: periodEnd.toISOString(),
        callsConsumed: 0,
        callsReserved: 0,
        updatedBy: "system_auto_init",
        updatedAt: new Date().toISOString(),
        remaining: configuredLimit,
      };
      this.budgets.set(key, budget);
    }

    const remaining = Math.max(0, budget.monthlyCallLimit - (budget.callsConsumed + budget.callsReserved));
    return { ...budget, remaining };
  }

  async setMonthlyLimit(
    provider: string,
    tier: MonthlyBudgetTier,
    limit: number,
    isEnabled = true,
    updatedBy = "owner",
    targetTime: Date | string | number = new Date()
  ): Promise<MonthlyBudgetRecord> {
    if (limit < 0) {
      throw new Error(`Monthly limit cannot be negative: ${limit}`);
    }

    return this._withLock(async () => {
      const limitKey = `${provider.toLowerCase()}:${tier.toUpperCase()}`;
      this.defaultLimits[limitKey] = limit;

      const { periodStart } = getCalendarMonthUtcBounds(targetTime);
      const key = this._getKey(provider, tier, periodStart);
      const existing = await this.getOrCreateBudget(provider, tier, targetTime);

      const updated: MonthlyBudgetRecord = {
        ...existing,
        monthlyCallLimit: limit,
        isEnabled,
        updatedBy,
        updatedAt: new Date().toISOString(),
        remaining: Math.max(0, limit - (existing.callsConsumed + existing.callsReserved)),
      };
      this.budgets.set(key, updated);
      return updated;
    });
  }

  private _reserveBudgetInternal(
    provider: string,
    tier: MonthlyBudgetTier,
    count = 1,
    targetTime: Date | string | number = new Date(),
    options?: { originatingProduct?: string; queueId?: string }
  ): BudgetReservationResult {
    const { periodStart } = getCalendarMonthUtcBounds(targetTime);
    const key = this._getKey(provider, tier, periodStart);
    let budget = this.budgets.get(key);
    if (!budget) {
      const limitKey = `${provider.toLowerCase()}:${tier.toUpperCase()}`;
      const configuredLimit = this.defaultLimits[limitKey] ?? 0;
      budget = {
        provider: provider.toLowerCase(),
        billingTier: tier,
        monthlyCallLimit: configuredLimit,
        isEnabled: true,
        periodStart: periodStart.toISOString(),
        periodEnd: getCalendarMonthUtcBounds(targetTime).periodEnd.toISOString(),
        callsConsumed: 0,
        callsReserved: 0,
        updatedAt: new Date().toISOString(),
        remaining: configuredLimit,
      };
      this.budgets.set(key, budget);
    }

    if (!budget.isEnabled) {
      return {
        success: false,
        reason: "BUDGET_DISABLED",
        limit: budget.monthlyCallLimit,
        consumed: budget.callsConsumed,
        reserved: budget.callsReserved,
        remaining: 0,
      };
    }

    const available = Math.max(0, budget.monthlyCallLimit - (budget.callsConsumed + budget.callsReserved));
    if (available < count) {
      return {
        success: false,
        reason: budget.monthlyCallLimit === 0 ? "ZERO_BUDGET_LIMIT" : "MONTHLY_LIMIT_EXCEEDED",
        limit: budget.monthlyCallLimit,
        consumed: budget.callsConsumed,
        reserved: budget.callsReserved,
        remaining: available,
      };
    }

    const reservationId = randomUUID();
    const updated: MonthlyBudgetRecord = {
      ...budget,
      callsReserved: budget.callsReserved + count,
      updatedAt: new Date().toISOString(),
      remaining: available - count,
    };
    this.budgets.set(key, updated);

    this.reservations.set(reservationId, {
      id: reservationId,
      provider: provider.toLowerCase(),
      tier,
      periodStart: periodStart.toISOString(),
      count,
      state: "RESERVED",
    });

    return {
      success: true,
      reservationId,
      limit: updated.monthlyCallLimit,
      consumed: updated.callsConsumed,
      reserved: updated.callsReserved,
      remaining: updated.remaining,
    };
  }

  async reserveBudget(
    provider: string,
    tier: MonthlyBudgetTier,
    count = 1,
    targetTime: Date | string | number = new Date(),
    options?: { originatingProduct?: string; queueId?: string }
  ): Promise<BudgetReservationResult> {
    if (count <= 0) {
      return { success: false, reason: "INVALID_COUNT", limit: 0, consumed: 0, reserved: 0, remaining: 0 };
    }

    return this._withLock(async () => {
      return this._reserveBudgetInternal(provider, tier, count, targetTime, options);
    });
  }

  async reconcileReservation(reservationId: string, actualConsumed: number, reason?: string): Promise<BudgetReconciliationResult> {
    return this._withLock(async () => {
      const res = this.reservations.get(reservationId);
      if (!res) {
        throw new Error(`Reservation not found: ${reservationId}`);
      }

      if (res.state !== "RESERVED") {
        throw new Error(`Reservation ${reservationId} already reconciled with state: ${res.state}`);
      }

      if (actualConsumed < 0) {
        throw new Error(`Actual consumed cannot be negative: ${actualConsumed}`);
      }

      if (actualConsumed > res.count) {
        throw new Error(`Actual consumed (${actualConsumed}) exceeds reserved count (${res.count})`);
      }

      const key = `${res.provider}:${res.tier}:${res.periodStart}`;
      const budget = this.budgets.get(key);
      if (!budget) {
        throw new Error(`Budget not found for reservation: ${reservationId}`);
      }

      if ((budget.callsConsumed + actualConsumed) > budget.monthlyCallLimit) {
        throw new Error(`Reconciliation would exceed monthly limit: limit=${budget.monthlyCallLimit}, current=${budget.callsConsumed}, adding=${actualConsumed}`);
      }

      const updated: MonthlyBudgetRecord = {
        ...budget,
        callsReserved: Math.max(0, budget.callsReserved - res.count),
        callsConsumed: budget.callsConsumed + actualConsumed,
        updatedAt: new Date().toISOString(),
        remaining: Math.max(0, budget.monthlyCallLimit - (budget.callsConsumed + actualConsumed + Math.max(0, budget.callsReserved - res.count))),
      };
      this.budgets.set(key, updated);

      res.state = actualConsumed > 0 ? "CONSUMED" : "RELEASED";
      res.actualConsumed = actualConsumed;
      res.reason = reason;

      return {
        success: true,
        reservationId,
        state: res.state,
        actualConsumed,
        limit: updated.monthlyCallLimit,
        consumed: updated.callsConsumed,
        reserved: updated.callsReserved,
        remaining: updated.remaining,
      };
    });
  }

  async claimNextJob(
    provider: string,
    tier: MonthlyBudgetTier,
    workerId = "worker",
    targetTime: Date | string | number = new Date()
  ): Promise<ClaimJobResult> {
    return this._withLock(async () => {
      const budget = await this.getOrCreateBudget(provider, tier, targetTime);
      if (!budget.isEnabled) return { success: false, reason: "BUDGET_DISABLED" };
      const available = Math.max(0, budget.monthlyCallLimit - (budget.callsConsumed + budget.callsReserved));
      if (available < 1) {
        return {
          success: false,
          reason: budget.monthlyCallLimit === 0 ? "ZERO_BUDGET_LIMIT" : "MONTHLY_LIMIT_EXCEEDED",
          budget: { limit: budget.monthlyCallLimit, consumed: budget.callsConsumed, reserved: budget.callsReserved, remaining: available },
        };
      }

      const jobIndex = this.queuedJobs.findIndex(
        (j) => j.provider === provider.toLowerCase() && j.billingTier === tier && !j.reservationId
      );
      if (jobIndex === -1) {
        return {
          success: false,
          reason: "NO_ELIGIBLE_JOBS",
          budget: { limit: budget.monthlyCallLimit, consumed: budget.callsConsumed, reserved: budget.callsReserved, remaining: available },
        };
      }

      const job = this.queuedJobs[jobIndex];
      const reservation = this._reserveBudgetInternal(provider, tier, 1, targetTime, {
        originatingProduct: job.originatingProduct,
        queueId: job.queueId,
      });

      if (!reservation.success) {
        return { success: false, reason: reservation.reason };
      }

      job.reservationId = reservation.reservationId!;

      return {
        success: true,
        job,
        budget: {
          limit: reservation.limit,
          consumed: reservation.consumed,
          reserved: reservation.reserved,
          remaining: reservation.remaining,
        },
      };
    });
  }
}

/**
 * High-level MonthlyProviderBudgetGuard wrapper.
 * Defaults to InMemoryBudgetStore for tests unless an explicit ProviderBudgetStore is passed.
 */
export class MonthlyProviderBudgetGuard {
  private readonly store: ProviderBudgetStore;

  constructor(storeOrLimits?: ProviderBudgetStore | { proLimit?: number; enterpriseLimit?: number }) {
    if (storeOrLimits && typeof (storeOrLimits as any).getOrCreateBudget === "function") {
      this.store = storeOrLimits as ProviderBudgetStore;
    } else {
      this.store = new InMemoryBudgetStore(storeOrLimits as { proLimit?: number; enterpriseLimit?: number } | undefined);
    }
  }

  getStore(): ProviderBudgetStore {
    return this.store;
  }

  getOrCreateBudget(provider: string, tier: MonthlyBudgetTier, targetTime: Date | string | number = new Date()): MonthlyBudgetRecord {
    // If backed by InMemoryBudgetStore, can read synchronously for backwards compatibility with tests
    if (this.store instanceof InMemoryBudgetStore) {
      const { periodStart, periodEnd } = getCalendarMonthUtcBounds(targetTime);
      const key = `${provider.toLowerCase()}:${tier.toUpperCase()}:${periodStart.toISOString()}`;
      const existing = (this.store as any).budgets?.get(key);
      if (existing) {
        const remaining = Math.max(0, existing.monthlyCallLimit - (existing.callsConsumed + existing.callsReserved));
        return { ...existing, remaining };
      }
      const limitKey = `${provider.toLowerCase()}:${tier.toUpperCase()}`;
      const configuredLimit = (this.store as any).defaultLimits?.[limitKey] ?? 0;
      const initial: MonthlyBudgetRecord = {
        provider: provider.toLowerCase(),
        billingTier: tier,
        monthlyCallLimit: configuredLimit,
        isEnabled: true,
        billingPeriodStart: periodStart.toISOString(),
        billingPeriodEnd: periodEnd.toISOString(),
        callsConsumed: 0,
        callsReserved: 0,
        updatedBy: "system_auto_init",
        updatedAt: new Date().toISOString(),
        remaining: configuredLimit,
      };
      (this.store as any).budgets?.set(key, initial);
      return initial;
    }
    // Default fallback
    return {
      provider,
      billingTier: tier,
      monthlyCallLimit: 0,
      isEnabled: true,
      billingPeriodStart: new Date().toISOString(),
      billingPeriodEnd: new Date().toISOString(),
      callsConsumed: 0,
      callsReserved: 0,
      updatedBy: "system",
      updatedAt: new Date().toISOString(),
      remaining: 0,
    };
  }

  async getOrCreateBudgetAsync(provider: string, tier: MonthlyBudgetTier, targetTime: Date | string | number = new Date()): Promise<MonthlyBudgetRecord> {
    return this.store.getOrCreateBudget(provider, tier, targetTime);
  }

  async setMonthlyLimit(
    provider: string,
    tier: MonthlyBudgetTier,
    limit: number,
    isEnabled = true,
    updatedBy = "owner",
    targetTime: Date | string | number = new Date()
  ): Promise<MonthlyBudgetRecord> {
    return this.store.setMonthlyLimit(provider, tier, limit, isEnabled, updatedBy, targetTime);
  }

  async reserveBudget(
    provider: string,
    tier: MonthlyBudgetTier,
    count = 1,
    targetTime: Date | string | number = new Date(),
    options?: { originatingProduct?: string; queueId?: string }
  ): Promise<BudgetReservationResult> {
    return this.store.reserveBudget(provider, tier, count, targetTime, options);
  }

  async reconcileReservation(reservationId: string, actualConsumed: number, reason?: string): Promise<BudgetReconciliationResult> {
    return this.store.reconcileReservation(reservationId, actualConsumed, reason);
  }

  async claimNextJob(
    provider: string,
    tier: MonthlyBudgetTier,
    workerId = "worker",
    targetTime: Date | string | number = new Date()
  ): Promise<ClaimJobResult> {
    if (this.store.claimNextJob) {
      return this.store.claimNextJob(provider, tier, workerId, targetTime);
    }
    return { success: false, reason: "CLAIM_NOT_SUPPORTED" };
  }

  async killSwitch(provider: string, tier: MonthlyBudgetTier, updatedBy = "owner_kill_switch"): Promise<MonthlyBudgetRecord> {
    return this.setMonthlyLimit(provider, tier, 0, false, updatedBy);
  }
}
