/**
 * server/ai/aiBudgetManager.ts
 *
 * Budget management for the Apex AI Orchestration Layer.
 *
 * Tracks AI spend per:
 *  - Global (all providers combined)
 *  - Per provider (anthropic, openai, gemini)
 *  - Per sub-account
 *  - Per task type
 *
 * Enforces:
 *  - Soft limit → warning in logs + observability event
 *  - Hard limit → request blocked (returns {allowed: false})
 *  - Emergency shutdown flag → blocks ALL AI calls
 *
 * Design: in-memory, process-scoped. Resets on restart.
 * Budget windows default to 24h rolling. Override via env vars.
 *
 * Env vars:
 *   AI_BUDGET_HARD_LIMIT_USD      — global hard cap per 24h (default: 10.00)
 *   AI_BUDGET_SOFT_LIMIT_USD      — global soft cap per 24h (default: 7.00)
 *   AI_BUDGET_PER_ACCOUNT_USD     — per sub-account hard cap (default: 2.00)
 *   AI_BUDGET_EMERGENCY_SHUTDOWN  — "true" to block all AI calls immediately
 */

import type { BudgetContext, BudgetStatus, AITaskType, ProviderName } from "./types";

// ── Config ────────────────────────────────────────────────────────────────────

const DEFAULT_HARD_LIMIT_USD    = 10.00;
const DEFAULT_SOFT_LIMIT_USD    = 7.00;
const DEFAULT_PER_ACCOUNT_USD   = 2.00;
const BUDGET_WINDOW_MS          = 24 * 60 * 60 * 1000; // 24h rolling

function getHardLimit(): number {
  return parseFloat(process.env.AI_BUDGET_HARD_LIMIT_USD ?? String(DEFAULT_HARD_LIMIT_USD));
}

function getSoftLimit(): number {
  return parseFloat(process.env.AI_BUDGET_SOFT_LIMIT_USD ?? String(DEFAULT_SOFT_LIMIT_USD));
}

function getPerAccountLimit(): number {
  return parseFloat(process.env.AI_BUDGET_PER_ACCOUNT_USD ?? String(DEFAULT_PER_ACCOUNT_USD));
}

function isEmergencyShutdown(): boolean {
  return (process.env.AI_BUDGET_EMERGENCY_SHUTDOWN ?? "").toLowerCase() === "true";
}

// ── Spend tracking ────────────────────────────────────────────────────────────

interface SpendEntry {
  timestampMs: number;
  costUsd: number;
}

/** Rolling window spend tracker. */
class RollingSpend {
  private entries: SpendEntry[] = [];

  record(costUsd: number): void {
    this.entries.push({ timestampMs: Date.now(), costUsd });
    this.prune();
  }

  total(): number {
    this.prune();
    return this.entries.reduce((sum, e) => sum + e.costUsd, 0);
  }

  private prune(): void {
    const cutoff = Date.now() - BUDGET_WINDOW_MS;
    this.entries = this.entries.filter(e => e.timestampMs >= cutoff);
  }
}

// Global
const _globalSpend = new RollingSpend();

// Per provider
const _providerSpend = new Map<ProviderName, RollingSpend>();

// Per sub-account
const _accountSpend  = new Map<string, RollingSpend>();

// Per task type
const _taskTypeSpend = new Map<AITaskType, RollingSpend>();

function getProviderSpend(provider: ProviderName): RollingSpend {
  if (!_providerSpend.has(provider)) _providerSpend.set(provider, new RollingSpend());
  return _providerSpend.get(provider)!;
}

function getAccountSpend(subAccountId: string): RollingSpend {
  if (!_accountSpend.has(subAccountId)) _accountSpend.set(subAccountId, new RollingSpend());
  return _accountSpend.get(subAccountId)!;
}

function getTaskTypeSpend(taskType: AITaskType): RollingSpend {
  if (!_taskTypeSpend.has(taskType)) _taskTypeSpend.set(taskType, new RollingSpend());
  return _taskTypeSpend.get(taskType)!;
}

// ── Manual emergency flag ─────────────────────────────────────────────────────

let _emergencyShutdownActive = false;

/** Toggle emergency shutdown at runtime (without env var restart). */
export function setEmergencyShutdown(active: boolean): void {
  _emergencyShutdownActive = active;
  console.warn(`[BUDGET] Emergency shutdown ${active ? "ACTIVATED" : "deactivated"}`);
}

export function isEmergencyShutdownActive(): boolean {
  return _emergencyShutdownActive || isEmergencyShutdown();
}

// ── Pre-call budget check ─────────────────────────────────────────────────────

/**
 * Check whether a call is within budget before making it.
 * Does NOT deduct — call recordSpend() after the call completes.
 *
 * @returns BudgetStatus — if allowed=false, the caller must reject the request
 */
export function checkBudget(context: BudgetContext = {}): BudgetStatus {
  const { subAccountId, taskType } = context;
  const hardLimit = getHardLimit();
  const softLimit = getSoftLimit();

  // Emergency shutdown — block everything
  if (isEmergencyShutdownActive()) {
    return {
      allowed:           false,
      softLimitBreached: true,
      hardLimitBreached: true,
      reason:            "Emergency AI shutdown is active",
      currentSpendUsd:   _globalSpend.total(),
      hardLimitUsd:      hardLimit,
    };
  }

  const globalSpend = _globalSpend.total();

  // Hard limit
  if (globalSpend >= hardLimit) {
    return {
      allowed:           false,
      softLimitBreached: true,
      hardLimitBreached: true,
      reason:            `Global hard limit reached: $${globalSpend.toFixed(4)} / $${hardLimit.toFixed(2)} (24h)`,
      currentSpendUsd:   globalSpend,
      hardLimitUsd:      hardLimit,
    };
  }

  // Per-account limit
  if (subAccountId != null) {
    const acctKey = String(subAccountId);
    const acctSpend = getAccountSpend(acctKey).total();
    const acctLimit = getPerAccountLimit();
    if (acctSpend >= acctLimit) {
      return {
        allowed:           false,
        softLimitBreached: true,
        hardLimitBreached: true,
        reason:            `Account ${subAccountId} hard limit: $${acctSpend.toFixed(4)} / $${acctLimit.toFixed(2)} (24h)`,
        currentSpendUsd:   globalSpend,
        hardLimitUsd:      hardLimit,
      };
    }
  }

  // Soft limit (warning only, still allowed)
  const softLimitBreached = globalSpend >= softLimit;
  if (softLimitBreached) {
    console.warn(
      `[BUDGET] Soft limit breached: $${globalSpend.toFixed(4)} / $${softLimit.toFixed(2)} (24h window). ` +
      `Hard limit: $${hardLimit.toFixed(2)}`
    );
  }

  return {
    allowed:           true,
    softLimitBreached,
    hardLimitBreached: false,
    currentSpendUsd:   globalSpend,
    hardLimitUsd:      hardLimit,
  };
}

// ── Post-call spend recording ─────────────────────────────────────────────────

/** Record actual spend after a completed AI call. */
export function recordSpend(opts: {
  costUsd: number;
  provider: ProviderName;
  taskType?: AITaskType;
  subAccountId?: string | number;
}): void {
  const { costUsd, provider, taskType, subAccountId } = opts;
  if (costUsd <= 0) return;

  _globalSpend.record(costUsd);
  getProviderSpend(provider).record(costUsd);
  if (taskType) getTaskTypeSpend(taskType).record(costUsd);
  if (subAccountId != null) getAccountSpend(String(subAccountId)).record(costUsd);
}

// ── Spend reporting ───────────────────────────────────────────────────────────

export interface BudgetReport {
  windowHours: number;
  globalSpendUsd: number;
  globalHardLimitUsd: number;
  globalSoftLimitUsd: number;
  globalUtilizationPct: number;
  emergencyShutdown: boolean;
  byProvider: Record<string, number>;
  byTaskType: Record<string, number>;
  topAccounts: { subAccountId: string; spendUsd: number }[];
}

export function getBudgetReport(): BudgetReport {
  const hardLimit = getHardLimit();
  const softLimit = getSoftLimit();
  const globalSpend = _globalSpend.total();

  const byProvider: Record<string, number> = {};
  for (const [provider, tracker] of _providerSpend) {
    byProvider[provider] = tracker.total();
  }

  const byTaskType: Record<string, number> = {};
  for (const [tt, tracker] of _taskTypeSpend) {
    byTaskType[tt] = tracker.total();
  }

  const topAccounts = Array.from(_accountSpend.entries())
    .map(([id, tracker]) => ({ subAccountId: id, spendUsd: tracker.total() }))
    .filter(a => a.spendUsd > 0)
    .sort((a, b) => b.spendUsd - a.spendUsd)
    .slice(0, 10);

  return {
    windowHours:          24,
    globalSpendUsd:       globalSpend,
    globalHardLimitUsd:   hardLimit,
    globalSoftLimitUsd:   softLimit,
    globalUtilizationPct: hardLimit > 0 ? Math.round((globalSpend / hardLimit) * 100) : 0,
    emergencyShutdown:    isEmergencyShutdownActive(),
    byProvider,
    byTaskType,
    topAccounts,
  };
}
