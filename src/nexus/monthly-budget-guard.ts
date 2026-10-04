// monthly-budget-guard.ts — Portfolio-global monthly budget guard for Google Places Pro and Enterprise.
// Enforces hard monthly caps, calendar month UTC accounting, concurrency-safe atomic reservations,
// independent tier ceilings, and owner kill switches.
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
  limit: number;
  consumed: number;
  reserved: number;
  remaining: number;
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

export class MonthlyProviderBudgetGuard {
  private budgets = new Map<string, MonthlyBudgetRecord>();
  private defaultLimits: Record<string, number> = {
    "google_places:PRO": 0, // Initial limit = 0 (Frozen until owner approval)
    "google_places:ENTERPRISE": 0, // Initial limit = 0 (Frozen until owner approval)
    "google_places:ENTERPRISE_ATMOSPHERE": 0,
  };
  private reservations = new Map<string, { provider: string; tier: MonthlyBudgetTier; periodStart: string; count: number }>();
  private _lock: Promise<void> = Promise.resolve();

  constructor(initialLimits?: { proLimit?: number; enterpriseLimit?: number }) {
    if (initialLimits?.proLimit !== undefined) {
      this.defaultLimits["google_places:PRO"] = initialLimits.proLimit;
    }
    if (initialLimits?.enterpriseLimit !== undefined) {
      this.defaultLimits["google_places:ENTERPRISE"] = initialLimits.enterpriseLimit;
    }
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

  /**
   * Gets or initializes the monthly budget for the given period.
   * Auto-resets consumed/reserved when a new month begins.
   */
  getOrCreateBudget(provider: string, tier: MonthlyBudgetTier, targetTime: Date | string | number = new Date()): MonthlyBudgetRecord {
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

  /**
   * Configures monthly call limit and enabled status. Owner control / kill switch.
   */
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
      const existing = this.getOrCreateBudget(provider, tier, targetTime);

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

  /**
   * Atomically reserves a count from the monthly allowance before an external call.
   */
  async reserveBudget(
    provider: string,
    tier: MonthlyBudgetTier,
    count = 1,
    targetTime: Date | string | number = new Date()
  ): Promise<BudgetReservationResult> {
    if (count <= 0) {
      return { success: false, reason: "INVALID_COUNT", limit: 0, consumed: 0, reserved: 0, remaining: 0 };
    }

    return this._withLock(async () => {
      const { periodStart } = getCalendarMonthUtcBounds(targetTime);
      const key = this._getKey(provider, tier, periodStart);
      const budget = this.getOrCreateBudget(provider, tier, targetTime);

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
        provider: provider.toLowerCase(),
        tier,
        periodStart: periodStart.toISOString(),
        count,
      });

      return {
        success: true,
        reservationId,
        limit: updated.monthlyCallLimit,
        consumed: updated.callsConsumed,
        reserved: updated.callsReserved,
        remaining: updated.remaining,
      };
    });
  }

  /**
   * Reconciles reservation with actual provider consumption.
   * If actualConsumed < count, unconsumed units are returned to the available balance.
   */
  async reconcileReservation(reservationId: string, actualConsumed: number): Promise<BudgetReconciliationResult> {
    return this._withLock(async () => {
      const res = this.reservations.get(reservationId);
      if (!res) {
        throw new Error(`Reservation not found: ${reservationId}`);
      }

      const key = `${res.provider}:${res.tier}:${res.periodStart}`;
      const budget = this.budgets.get(key);
      if (!budget) {
        throw new Error(`Budget not found for reservation: ${reservationId}`);
      }

      const updated: MonthlyBudgetRecord = {
        ...budget,
        callsReserved: Math.max(0, budget.callsReserved - res.count),
        callsConsumed: budget.callsConsumed + actualConsumed,
        updatedAt: new Date().toISOString(),
        remaining: Math.max(0, budget.monthlyCallLimit - (budget.callsConsumed + actualConsumed + Math.max(0, budget.callsReserved - res.count))),
      };
      this.budgets.set(key, updated);
      this.reservations.delete(reservationId);

      return {
        success: true,
        limit: updated.monthlyCallLimit,
        consumed: updated.callsConsumed,
        reserved: updated.callsReserved,
        remaining: updated.remaining,
      };
    });
  }

  /**
   * Kill switch to immediately halt reservations for a tier.
   */
  async killSwitch(provider: string, tier: MonthlyBudgetTier, updatedBy = "owner_kill_switch"): Promise<MonthlyBudgetRecord> {
    return this.setMonthlyLimit(provider, tier, 0, false, updatedBy);
  }
}
