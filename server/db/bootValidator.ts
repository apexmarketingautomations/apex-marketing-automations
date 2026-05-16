/**
 * server/db/bootValidator.ts
 *
 * Database Boot Validation
 *
 * Runs at application startup BEFORE accepting traffic.
 * Verifies migration integrity, sequence health, tenant consistency,
 * and critical orphan presence. Emits structured logs to Axiom/Sentry.
 *
 * Policy:
 * - CRITICAL failures: logged + Sentry captured, startup continues but
 *   the /api/admin/db-health endpoint reflects degraded state
 * - WARNING failures: logged, startup proceeds normally
 * - All results stored in module-level cache for instant /api/admin/db-health reads
 */

import { verifyMigrations, detectSchemaDrift } from "./migrationVerifier";
import { auditTenantIntegrity }                from "./tenantIntegrity";

export interface BootValidationResult {
  passed: boolean;
  criticalFailures: string[];
  warnings: string[];
  migrationStatus:  "healthy" | "degraded" | "critical";
  schemaDriftStatus: "healthy" | "degraded";
  tenantStatus:     "clean" | "degraded" | "critical";
  durationMs: number;
  completedAt: string;
}

// Module-level cache — written once at boot, read by health endpoint
let _lastBootResult: BootValidationResult | null = null;

export function getLastBootResult(): BootValidationResult | null {
  return _lastBootResult;
}

export async function runBootValidation(): Promise<BootValidationResult> {
  const start = Date.now();
  const criticalFailures: string[] = [];
  const warnings: string[] = [];

  console.log("[BOOT-VALIDATOR] Starting database integrity validation...");

  // ── 1. Migration verification ─────────────────────────────────────────────
  let migrationStatus: BootValidationResult["migrationStatus"] = "healthy";
  try {
    const migReport = await verifyMigrations();
    migrationStatus = migReport.status;

    if (migReport.status === "critical") {
      criticalFailures.push(
        `Migration tracking table missing — cannot verify migration state`
      );
    } else if (migReport.status === "degraded") {
      warnings.push(
        `${migReport.totalMissing} migration(s) not applied: ${migReport.missingMigrations.join(", ")}`
      );
    }
  } catch (err: any) {
    warnings.push(`Migration verification threw: ${err?.message}`);
    migrationStatus = "degraded";
  }

  // ── 2. Schema drift detection ──────────────────────────────────────────────
  let schemaDriftStatus: BootValidationResult["schemaDriftStatus"] = "healthy";
  try {
    const driftReport = await detectSchemaDrift();
    schemaDriftStatus = driftReport.status;

    if (driftReport.status === "degraded") {
      warnings.push(
        `Missing DB indexes: ${driftReport.missingIndexes.join(", ")}`
      );
    }
  } catch (err: any) {
    warnings.push(`Schema drift detection threw: ${err?.message}`);
    schemaDriftStatus = "degraded";
  }

  // ── 3. Tenant integrity quick-scan ────────────────────────────────────────
  let tenantStatus: BootValidationResult["tenantStatus"] = "clean";
  try {
    const tenantReport = await auditTenantIntegrity();
    tenantStatus = tenantReport.status;

    if (tenantReport.status === "critical") {
      criticalFailures.push(
        `Tenant contamination detected: ${tenantReport.criticalIssues.map(i => `${i.table}(${i.affectedCount})`).join(", ")}`
      );
    } else if (tenantReport.status === "degraded") {
      warnings.push(
        `Tenant integrity warnings: ${tenantReport.results.map(r => `${r.table}.${r.issue}`).join(", ")}`
      );
    }
  } catch (err: any) {
    warnings.push(`Tenant integrity scan threw: ${err?.message}`);
    tenantStatus = "degraded";
  }

  const durationMs = Date.now() - start;
  const passed = criticalFailures.length === 0;
  const completedAt = new Date().toISOString();

  const result: BootValidationResult = {
    passed,
    criticalFailures,
    warnings,
    migrationStatus,
    schemaDriftStatus,
    tenantStatus,
    durationMs,
    completedAt,
  };

  _lastBootResult = result;

  if (!passed) {
    console.error(
      `[BOOT-VALIDATOR] ✗ CRITICAL FAILURES (${criticalFailures.length}): ${criticalFailures.join(" | ")}`
    );
    // Capture to Sentry if available — fire-and-forget
    import("../instrument").then(({ Sentry }) => {
      Sentry.withScope(scope => {
        scope.setLevel("fatal");
        scope.setContext("boot_validation", { criticalFailures, warnings, durationMs });
        Sentry.captureMessage(`DB Boot Validation FAILED: ${criticalFailures[0]}`, "fatal");
      });
    }).catch(() => {});
  } else if (warnings.length > 0) {
    console.warn(`[BOOT-VALIDATOR] ⚠ passed with ${warnings.length} warning(s): ${warnings.join(" | ")}`);
  } else {
    console.log(`[BOOT-VALIDATOR] ✓ all checks passed in ${durationMs}ms`);
  }

  return result;
}
