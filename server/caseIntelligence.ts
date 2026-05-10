/**
 * caseIntelligence.ts
 *
 * Post-processing layer over raw legalSignals/legalLeads.
 * Groups signals into canonical entities → actionable cases.
 *
 * Does NOT modify ingestion. Runs as a separate pass every 30 minutes.
 *
 * Pipeline:
 *   legalSignals → entity resolution → case grouping → opportunity scoring → cases
 */

import { db } from "./db";
import {
  legalSignals, legalLeads,
  intelligenceEntities, intelligenceCases, caseSignals,
  type LegalSignal, type IntelligenceCase,
} from "@shared/schema";
import { eq, desc, sql, and, gte, isNull, not, inArray } from "drizzle-orm";

// ── Entity Normalisation ────────────────────────────────────────────────────

/**
 * Convert a raw subject/company name into a stable slug key.
 * "LIPMAN FAMILY FARMS INC" → "lipman-family-farms"
 * "Rich Ice Cream Co." → "rich-ice-cream-co"
 */
function normalizeEntityKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|corp|ltd|co|company|incorporated|limited|the|a|an)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Strip legal suffixes for canonical display name */
function canonicaliseName(name: string): string {
  return name
    .trim()
    .replace(/\s+(Inc\.?|LLC\.?|Corp\.?|Ltd\.?|Co\.?|Company|Incorporated)$/i, "")
    .trim();
}

// ── Signal → Category Mapping ───────────────────────────────────────────────

const SIGNAL_CATEGORY: Record<string, string> = {
  fda_recall:                     "recall",
  cpsc_recall:                    "recall",
  osha_incident:                  "osha",
  dui_arrest:                     "arrest",
  arrest_record:                  "arrest",
  divorce_filing:                 "court",
  domestic_violence_injunction:   "court",
  custody_modification:           "court",
  probate_filing:                 "court",
  license_suspension:             "license",
  traffic_violation:              "license",
  new_business_filing:            "business",
  salon_license:                  "business",
  business_growth_signal:         "business",
};

function signalCategory(signalType: string): string {
  return SIGNAL_CATEGORY[signalType] || "other";
}

// ── Opportunity Scorer ──────────────────────────────────────────────────────

interface ScoreResult {
  opportunityScore:   number;
  urgencyScore:       number;
  financialScore:     number;
  outreachViability:  number;
  consumerImpact:     number;
  legalSeverity:      number;
  localRelevance:     number;
  compositeScore:     number;
  actionable:         boolean;
}

function scoreCase(signals: LegalSignal[], category: string, county: string): ScoreResult {
  const n = signals.length;

  // Urgency: more signals = higher urgency
  const urgencyScore = Math.min(100, 20 + n * 12 +
    signals.filter(s => s.urgency === "critical").length * 25 +
    signals.filter(s => s.urgency === "high").length * 15);

  // Financial: recall/osha categories have highest financial exposure
  const financialScore =
    category === "recall"  ? Math.min(100, 60 + n * 8) :
    category === "osha"    ? Math.min(100, 55 + n * 10) :
    category === "arrest"  ? Math.min(100, 50 + n * 5) :
    category === "court"   ? 40 :
    30;

  // Outreach viability: do we have contact info?
  const withPhone = signals.filter(s => s.subjectPhone).length;
  const outreachViability = Math.min(100,
    (withPhone / Math.max(1, n)) * 60 +
    (signals.some(s => s.subjectAddress) ? 20 : 0) +
    (signals.some(s => s.subjectName)    ? 20 : 0));

  // Consumer impact: FDA/CPSC recalls affect consumers directly
  const consumerImpact =
    category === "recall"  ? Math.min(100, 70 + n * 5) :
    category === "osha"    ? Math.min(100, 50 + n * 8) :
    20;

  // Legal severity
  const legalSeverity =
    category === "recall"  ? Math.min(100, 65 + n * 5) :
    category === "osha"    ? Math.min(100, 60 + n * 8) :
    category === "arrest"  ? signals.filter(s => s.urgency === "critical").length > 0 ? 70 : 45 :
    30;

  // Local relevance: SW Florida counties score higher
  const LOCAL_COUNTIES = new Set(["LEE", "COLLIER", "CHARLOTTE", "SARASOTA", "MANATEE", "HILLSBOROUGH"]);
  const localRelevance = LOCAL_COUNTIES.has(county?.toUpperCase()) ? 80 : 40;

  // Composite (weighted)
  const compositeScore = Math.round(
    urgencyScore       * 0.20 +
    financialScore     * 0.20 +
    outreachViability  * 0.20 +
    consumerImpact     * 0.15 +
    legalSeverity      * 0.15 +
    localRelevance     * 0.10
  );

  return {
    urgencyScore:      Math.round(urgencyScore),
    financialScore:    Math.round(financialScore),
    outreachViability: Math.round(outreachViability),
    consumerImpact:    Math.round(consumerImpact),
    legalSeverity:     Math.round(legalSeverity),
    localRelevance:    Math.round(localRelevance),
    opportunityScore:  Math.round((financialScore + consumerImpact) / 2),
    compositeScore,
    // Must meet threshold AND have some contact viability OR be a high-severity recall/osha
    actionable: compositeScore >= 45 && (outreachViability >= 20 || category === "recall" || category === "osha"),
  };
}

// ── Entity Resolution ───────────────────────────────────────────────────────

async function resolveEntity(name: string, county: string | null): Promise<number> {
  const key = normalizeEntityKey(name);
  if (!key) return -1;

  // Check if entity exists
  const [existing] = await db
    .select({ id: intelligenceEntities.id })
    .from(intelligenceEntities)
    .where(eq(intelligenceEntities.normalizedKey, key))
    .limit(1);

  if (existing) return existing.id;

  // Create new entity
  const canonical = canonicaliseName(name);
  const entityType = /^\w+ \w+$/.test(canonical) ? "person" : "company";

  const [created] = await db.insert(intelligenceEntities).values({
    canonicalName: canonical,
    normalizedKey: key,
    entityType,
    county: county || undefined,
    state: "FL",
    aliases: [name],
  }).returning({ id: intelligenceEntities.id });

  return created.id;
}

// ── Case Grouping ───────────────────────────────────────────────────────────

async function upsertCase(
  entityId: number,
  signals: LegalSignal[],
  category: string,
  window: string,
  entityName: string,
): Promise<void> {
  const caseKey = `${entityId}:${category}:${window}`;
  const scores  = scoreCase(signals, category, signals[0]?.county || "");

  const timeline = signals.map(s => ({
    date:        s.detectedAt?.toISOString().slice(0, 10) || window,
    type:        s.signalType,
    description: s.chargeDescription || s.subjectName || "",
    caseNumber:  s.caseNumber || null,
  }));

  const title = `${entityName} — ${category.charAt(0).toUpperCase() + category.slice(1)} Cluster (${window})`;

  const [existing] = await db
    .select({ id: intelligenceCases.id, signalCount: intelligenceCases.signalCount })
    .from(intelligenceCases)
    .where(eq(intelligenceCases.caseKey, caseKey))
    .limit(1);

  let caseId: number;

  if (existing) {
    await db.update(intelligenceCases).set({
      signalCount:       signals.length,
      latestSignalAt:    signals[0]?.detectedAt || new Date(),
      timeline:          timeline as any,
      updatedAt:         new Date(),
      ...scores,
    }).where(eq(intelligenceCases.id, existing.id));
    caseId = existing.id;
  } else {
    const [created] = await db.insert(intelligenceCases).values({
      entityId,
      caseKey,
      title,
      category,
      incidentWindow:    window,
      signalCount:       signals.length,
      latestSignalAt:    signals[0]?.detectedAt || new Date(),
      recommendedVertical: category === "recall" || category === "osha" ? "personal_injury" :
                           category === "arrest" ? "criminal" : "business",
      timeline:          timeline as any,
      ...scores,
    }).returning({ id: intelligenceCases.id });
    caseId = created.id;
  }

  // Upsert case_signals (skip already-linked)
  const existingLinks = await db
    .select({ signalId: caseSignals.signalId })
    .from(caseSignals)
    .where(eq(caseSignals.caseId, caseId));

  const linkedIds = new Set(existingLinks.map(l => l.signalId));

  const newLinks = signals
    .filter(s => !linkedIds.has(s.id))
    .map(s => ({
      caseId,
      signalId:    s.id,
      signalTable: "legal_signals" as const,
      signalType:  s.signalType,
      detectedAt:  s.detectedAt || undefined,
      summary:     s.chargeDescription || s.subjectName || undefined,
    }));

  if (newLinks.length > 0) {
    await db.insert(caseSignals).values(newLinks);
  }
}

// ── Main Processing Cycle ───────────────────────────────────────────────────

const MIN_SIGNALS_TO_GROUP = 1;  // Even a single signal creates a case
const SUPPRESSION_THRESHOLD = 25; // Cases below this score are suppressed

let lastRunAt: Date | null = null;

export async function runCaseGroupingCycle(): Promise<void> {
  const start = Date.now();
  const sinceDate = lastRunAt
    ? new Date(lastRunAt.getTime() - 60 * 60 * 1000) // 1h overlap for re-processing
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // First run: last 7 days

  console.log(`[CASE-INTEL] Cycle start — processing signals since ${sinceDate.toISOString()}`);

  // Load qualified signals that have a subject name (grouped signals need an entity)
  const signals = await db
    .select()
    .from(legalSignals)
    .where(
      and(
        not(eq(legalSignals.status, "disqualified")),
        gte(legalSignals.createdAt, sinceDate),
        not(isNull(legalSignals.subjectName)),
      )
    )
    .orderBy(desc(legalSignals.detectedAt))
    .limit(2000);

  console.log(`[CASE-INTEL] Loaded ${signals.length} qualified signals`);

  // Group by normalizedKey + category + month window
  const groups = new Map<string, { name: string; county: string; signals: LegalSignal[] }>();

  for (const sig of signals) {
    if (!sig.subjectName?.trim()) continue;
    const key      = normalizeEntityKey(sig.subjectName);
    if (!key) continue;
    const cat      = signalCategory(sig.signalType);
    const window   = sig.detectedAt?.toISOString().slice(0, 7) || new Date().toISOString().slice(0, 7);
    const groupKey = `${key}::${cat}::${window}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, { name: sig.subjectName, county: sig.county || "", signals: [] });
    }
    groups.get(groupKey)!.signals.push(sig);
  }

  console.log(`[CASE-INTEL] ${groups.size} signal groups formed`);

  let casesCreated = 0;
  let casesUpdated = 0;
  let suppressed   = 0;

  for (const [groupKey, { name, county, signals: grpSignals }] of groups) {
    try {
      const parts   = groupKey.split("::");
      const cat     = parts[1];
      const window  = parts[2];

      const entityId = await resolveEntity(name, county);
      if (entityId < 0) continue;

      const scores = scoreCase(grpSignals, cat, county);

      if (scores.compositeScore < SUPPRESSION_THRESHOLD) {
        suppressed++;
        continue;
      }

      const existingBefore = await db
        .select({ id: intelligenceCases.id })
        .from(intelligenceCases)
        .where(eq(intelligenceCases.caseKey, `${entityId}:${cat}:${window}`))
        .limit(1);

      await upsertCase(entityId, grpSignals, cat, window, name);

      if (existingBefore.length > 0) casesUpdated++;
      else casesCreated++;

    } catch (err: any) {
      console.warn(`[CASE-INTEL] Group ${groupKey} failed: ${err.message}`);
    }
  }

  lastRunAt = new Date();
  console.log(
    `[CASE-INTEL] Cycle complete in ${Date.now() - start}ms — ` +
    `created=${casesCreated} updated=${casesUpdated} suppressed=${suppressed}`
  );
}

export function startCaseIntelligence(): void {
  // Stagger startup by 90 seconds to let DB settle
  setTimeout(async () => {
    try {
      await runCaseGroupingCycle();
    } catch (err: any) {
      console.error("[CASE-INTEL] Initial cycle error:", err.message);
    }
  }, 90_000);

  // Run every 30 minutes
  setInterval(async () => {
    try {
      await runCaseGroupingCycle();
    } catch (err: any) {
      console.error("[CASE-INTEL] Cycle error:", err.message);
    }
  }, 30 * 60 * 1000);

  console.log("[CASE-INTEL] Started — 90s initial delay, then every 30min");
}

export function getCaseIntelligenceStats() {
  return { lastRunAt: lastRunAt?.toISOString() ?? null };
}
