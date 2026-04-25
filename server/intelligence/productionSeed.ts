import { db } from "../db";
import { sql, eq } from "drizzle-orm";
import {
  universalEvents, entityIdentityMap, entityActivityRollups,
  intelligenceScores, intelligenceRecommendations,
  integrationHealthState, executionTimeline,
  apexModuleEventRegistry, apexModuleCoverage,
  autonomyActions, autonomyPolicyRules, subAccounts,
} from "@shared/schema";
import { MODULE_GROUP_EVENT_MAP } from "./moduleRegistry";

interface SeedResult {
  table: string;
  status: "exists" | "seeded" | "skipped" | "error";
  count?: number;
  message?: string;
}

interface VerificationResult {
  passed: boolean;
  tables: { name: string; exists: boolean; rowCount: number }[];
  registryStatus: { moduleGroups: number; eventTypes: number; complete: boolean };
  policyRulesStatus: { count: number; hasBlocked: boolean; hasAutoExec: boolean; hasRequireReview: boolean };
  coverageStatus: { accountsWithCoverage: number };
  warnings: string[];
  errors: string[];
}

interface SeedSnapshot {
  ranAt: string;
  ready: boolean;
  results: SeedResult[];
  verification: VerificationResult;
}

let lastSeedSnapshot: SeedSnapshot | null = null;
let lastVerification: { ranAt: string; result: VerificationResult } | null = null;

export function getLastSeedSnapshot(): SeedSnapshot | null {
  return lastSeedSnapshot;
}

export function getLastVerification(): { ranAt: string; result: VerificationResult } | null {
  return lastVerification;
}

const REQUIRED_TABLES = [
  "universal_events",
  "entity_identity_map",
  "entity_activity_rollups",
  "intelligence_scores",
  "intelligence_recommendations",
  "integration_health_state",
  "execution_timeline",
  "apex_module_event_registry",
  "apex_module_coverage",
  "autonomy_actions",
  "autonomy_policy_rules",
];

const SCORE_TYPES = [
  "account_maturity_score",
  "launch_readiness_score",
  "workflow_effectiveness_score",
  "campaign_effectiveness_score",
  "pipeline_health_score",
  "messaging_performance_score",
  "reputation_health_score",
  "calendar_conversion_score",
  "digital_card_effectiveness_score",
  "ad_to_lead_quality_score",
  "module_adoption_score",
  "integration_health_score",
  "site_health_score",
  "domain_health_score",
  "lead_intent_score",
];

const RECOMMENDATION_TYPES = [
  "setup_missing_pipeline",
  "setup_missing_workflow",
  "setup_missing_calendar",
  "activate_integration",
  "improve_site_health",
  "improve_domain_health",
  "boost_engagement",
  "repair_broken_reference",
  "enable_module",
  "connect_integration",
];

const isProduction = process.env.NODE_ENV === "production";

export async function verifyIntelligenceTables(): Promise<VerificationResult> {
  const result: VerificationResult = {
    passed: true,
    tables: [],
    registryStatus: { moduleGroups: 0, eventTypes: 0, complete: false },
    policyRulesStatus: { count: 0, hasBlocked: false, hasAutoExec: false, hasRequireReview: false },
    coverageStatus: { accountsWithCoverage: 0 },
    warnings: [],
    errors: [],
  };

  for (const tableName of REQUIRED_TABLES) {
    try {
      const existsResult = await db.execute(sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = ${tableName}
        ) as exists_flag
      `);
      const rows = existsResult.rows ?? existsResult;
      const exists = Array.isArray(rows) && rows.length > 0 ? (rows[0] as any)?.exists_flag === true : false;

      let rowCount = 0;
      if (exists) {
        const countResult = await db.execute(sql.raw(`SELECT count(*)::int as cnt FROM "${tableName}"`));
        const countRows = countResult.rows ?? countResult;
        rowCount = Array.isArray(countRows) && countRows.length > 0 ? ((countRows[0] as any)?.cnt ?? 0) : 0;
      }

      result.tables.push({ name: tableName, exists, rowCount });

      if (!exists) {
        result.errors.push(`Required table "${tableName}" does not exist`);
        result.passed = false;
      }
    } catch (err) {
      result.tables.push({ name: tableName, exists: false, rowCount: 0 });
      result.errors.push(`Failed to check table "${tableName}": ${(err as Error).message}`);
      result.passed = false;
    }
  }

  try {
    const [regCount] = await db.select({ count: sql<number>`count(*)::int` }).from(apexModuleEventRegistry);
    const [groupCount] = await db.select({ count: sql<number>`count(distinct module_group)::int` }).from(apexModuleEventRegistry);
    result.registryStatus.eventTypes = regCount?.count ?? 0;
    result.registryStatus.moduleGroups = groupCount?.count ?? 0;

    const expectedGroups = Object.keys(MODULE_GROUP_EVENT_MAP).length;
    const expectedEvents = Object.values(MODULE_GROUP_EVENT_MAP).reduce((n, arr) => n + arr.length, 0);
    result.registryStatus.complete = result.registryStatus.moduleGroups >= expectedGroups && result.registryStatus.eventTypes >= expectedEvents * 0.9;

    if (!result.registryStatus.complete) {
      result.warnings.push(`Module event registry incomplete: ${result.registryStatus.moduleGroups}/${expectedGroups} groups, ${result.registryStatus.eventTypes}/${expectedEvents} events`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[APEX-SEED] Failed to verify module event registry:", err);
    result.warnings.push(`Could not verify module event registry: ${message}`);
  }

  try {
    const [ruleCount] = await db.select({ count: sql<number>`count(*)::int` }).from(autonomyPolicyRules);
    result.policyRulesStatus.count = ruleCount?.count ?? 0;

    const [blocked] = await db.select({ count: sql<number>`count(*)::int` }).from(autonomyPolicyRules).where(eq(autonomyPolicyRules.defaultSafetyClass, "blocked"));
    const [autoExec] = await db.select({ count: sql<number>`count(*)::int` }).from(autonomyPolicyRules).where(eq(autonomyPolicyRules.defaultSafetyClass, "auto_execute"));
    const [requireReview] = await db.select({ count: sql<number>`count(*)::int` }).from(autonomyPolicyRules).where(eq(autonomyPolicyRules.defaultSafetyClass, "require_review"));

    result.policyRulesStatus.hasBlocked = (blocked?.count ?? 0) > 0;
    result.policyRulesStatus.hasAutoExec = (autoExec?.count ?? 0) > 0;
    result.policyRulesStatus.hasRequireReview = (requireReview?.count ?? 0) > 0;

    if (result.policyRulesStatus.count === 0) {
      result.warnings.push("No autonomy policy rules found — autonomy layer will not function");
    }
    if (!result.policyRulesStatus.hasBlocked) {
      result.errors.push("CRITICAL: No blocked policy rules found — destructive actions may be permitted");
      result.passed = false;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[APEX-SEED] Failed to verify autonomy policy rules:", err);
    result.warnings.push(`Could not verify autonomy policy rules: ${message}`);
  }

  try {
    const [covCount] = await db.select({ count: sql<number>`count(distinct ${apexModuleCoverage.accountId})::int` }).from(apexModuleCoverage);
    result.coverageStatus.accountsWithCoverage = covCount?.count ?? 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[APEX-SEED] Failed to verify module coverage data:", err);
    result.warnings.push(`Could not verify module coverage data: ${message}`);
  }

  lastVerification = { ranAt: new Date().toISOString(), result };
  if (lastSeedSnapshot) {
    lastSeedSnapshot = {
      ...lastSeedSnapshot,
      verification: result,
      ready: result.passed && !lastSeedSnapshot.results.some(r => r.status === "error"),
    };
  }

  return result;
}

export async function seedModuleEventRegistryProduction(): Promise<SeedResult> {
  const { storage } = await import("../storage");
  let seeded = 0;
  let skipped = 0;
  let firstEventRegistrationError: string | null = null;

  for (const [moduleGroup, eventTypes] of Object.entries(MODULE_GROUP_EVENT_MAP)) {
    for (const eventType of eventTypes) {
      try {
        const existing = await storage.getModuleEventByType(moduleGroup, eventType);
        if (existing) {
          skipped++;
          continue;
        }
        await storage.registerModuleEvent({
          moduleGroup,
          eventType,
          description: `${moduleGroup} module: ${eventType}`,
          isActive: true,
        });
        seeded++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[APEX-SEED] Failed to register module event ${moduleGroup}/${eventType}:`, err);
        skipped++;
        if (!firstEventRegistrationError) {
          firstEventRegistrationError = `${moduleGroup}/${eventType}: ${message}`;
        }
      }
    }
  }

  if (firstEventRegistrationError) {
    console.warn(`[APEX-SEED] Module event registry encountered errors during seeding (first: ${firstEventRegistrationError})`);
  }

  const baseMessage = `${seeded} new events registered, ${skipped} already present`;
  return {
    table: "apex_module_event_registry",
    status: seeded > 0 ? "seeded" : "exists",
    count: seeded,
    message: firstEventRegistrationError
      ? `${baseMessage} (errors occurred — first: ${firstEventRegistrationError})`
      : baseMessage,
  };
}

export async function seedAutonomyPolicyRulesProduction(): Promise<SeedResult> {
  try {
    const { seedDefaultPolicyRules } = await import("../autonomy/seedPolicyRules");
    const count = await seedDefaultPolicyRules();
    return {
      table: "autonomy_policy_rules",
      status: count > 0 ? "seeded" : "exists",
      count,
      message: `${count} policy rules seeded/verified`,
    };
  } catch (err) {
    return {
      table: "autonomy_policy_rules",
      status: "error",
      message: (err as Error).message,
    };
  }
}

export async function seedBaselineCoverageForAccounts(): Promise<SeedResult> {
  const { storage } = await import("../storage");
  const accounts = await db.select({ id: subAccounts.id }).from(subAccounts);
  let seeded = 0;

  for (const account of accounts) {
    for (const moduleGroup of Object.keys(MODULE_GROUP_EVENT_MAP)) {
      try {
        const existing = await storage.getModuleCoverage(account.id, moduleGroup);
        if (existing && existing.length > 0) continue;
        const eventTypes = MODULE_GROUP_EVENT_MAP[moduleGroup] ?? [];
        await storage.upsertModuleCoverage({
          accountId: account.id,
          moduleGroup,
          totalEventTypes: eventTypes.length || 1,
          observedEventTypes: 0,
          eventCount: 0,
          coverageScore: 0,
        });
        seeded++;
      } catch (err) {
        console.warn(`[APEX-SEED] Coverage baseline for account ${account.id} / ${moduleGroup} failed:`, (err as Error).message);
      }
    }
  }

  return {
    table: "apex_module_coverage",
    status: seeded > 0 ? "seeded" : "exists",
    count: seeded,
    message: `${seeded} baseline coverage records created for ${accounts.length} accounts`,
  };
}

export async function seedSystemTimelineMarker(): Promise<SeedResult> {
  try {
    const { storage } = await import("../storage");
    const marker = {
      accountId: parseInt(process.env.APEX_PARENT_ACCOUNT_ID || "13"),
      title: "Apex Intelligence Production Seed",
      sourceModule: "apex_intelligence",
      description: `Production seed completed — ${isProduction ? "production" : "development"} environment. ${SCORE_TYPES.length} score types, ${RECOMMENDATION_TYPES.length} recommendation types, ${Object.keys(MODULE_GROUP_EVENT_MAP).length} module groups.`,
      severity: "info",
    };
    await storage.createExecutionTimelineEntry(marker);
    return { table: "execution_timeline", status: "seeded", count: 1, message: "System seed marker recorded" };
  } catch (err) {
    return { table: "execution_timeline", status: "error", message: (err as Error).message };
  }
}

export async function runProductionSeed(): Promise<{
  results: SeedResult[];
  verification: VerificationResult;
  ready: boolean;
}> {
  const env = isProduction ? "PRODUCTION" : "DEVELOPMENT";
  console.log(`[APEX-SEED] Starting Apex Intelligence production seed (${env})...`);

  const results: SeedResult[] = [];

  const registryResult = await seedModuleEventRegistryProduction();
  results.push(registryResult);
  console.log(`[APEX-SEED] Module registry: ${registryResult.message}`);

  const policyResult = await seedAutonomyPolicyRulesProduction();
  results.push(policyResult);
  console.log(`[APEX-SEED] Policy rules: ${policyResult.message}`);

  const coverageResult = await seedBaselineCoverageForAccounts();
  results.push(coverageResult);
  console.log(`[APEX-SEED] Coverage baseline: ${coverageResult.message}`);

  const timelineResult = await seedSystemTimelineMarker();
  results.push(timelineResult);
  console.log(`[APEX-SEED] Timeline marker: ${timelineResult.message}`);

  const verification = await verifyIntelligenceTables();

  const hasErrors = results.some(r => r.status === "error");
  const ready = verification.passed && !hasErrors;

  if (ready) {
    console.log(`[APEX-SEED] ✅ Apex Intelligence production seed complete — system ready`);
  } else {
    const errorCount = verification.errors.length + results.filter(r => r.status === "error").length;
    const warnCount = verification.warnings.length;
    console.warn(`[APEX-SEED] ⚠️ Apex Intelligence seed completed with issues: ${errorCount} errors, ${warnCount} warnings`);
    for (const err of verification.errors) {
      console.error(`[APEX-SEED]   ERROR: ${err}`);
    }
    for (const warn of verification.warnings) {
      console.warn(`[APEX-SEED]   WARN: ${warn}`);
    }
  }

  console.log(`[APEX-SEED] Tables verified: ${verification.tables.filter(t => t.exists).length}/${REQUIRED_TABLES.length}`);
  console.log(`[APEX-SEED] Registry: ${verification.registryStatus.moduleGroups} groups, ${verification.registryStatus.eventTypes} events`);
  console.log(`[APEX-SEED] Policy rules: ${verification.policyRulesStatus.count} rules`);
  console.log(`[APEX-SEED] Coverage: ${verification.coverageStatus.accountsWithCoverage} accounts`);

  lastSeedSnapshot = { ranAt: new Date().toISOString(), ready, results, verification };

  return { results, verification, ready };
}
