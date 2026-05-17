// @ts-nocheck
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
  jail_booking:                   "arrest",   // jail booking pipeline
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
  const LOCAL_COUNTIES = new Set([
    "LEE", "COLLIER", "CHARLOTTE", "SARASOTA", "MANATEE", "HILLSBOROUGH",
    "HENDRY", "GLADES", "POLK", "PINELLAS", "PASCO",  // jail booking counties
  ]);
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
    // Actionable if score is high enough; recall/osha/arrest are always outreach-viable via entity name
    actionable: compositeScore >= 40 && (outreachViability >= 15 || category === "recall" || category === "osha" || category === "arrest"),
  };
}

// ── Narrative Generation ─────────────────────────────────────────────────────

interface CaseNarrative {
  headline:      string;   // "3 FDA recalls — potential consumer injury claims"
  whatHappened:  string;   // One sentence: the incident in plain English
  whyItMatters:  string;   // Why this is a business opportunity
  whatToDo:      string;   // Specific action for the operator
  urgencyLabel:  string;   // "Act within 72h" / "Monitor" / "High priority"
  pitchLine:     string;   // One sentence they can say to a client
}

const CATEGORY_NARRATIVES: Record<string, (signals: LegalSignal[], name: string, n: number) => CaseNarrative> = {
  recall: (signals, name, n) => {
    const products = [...new Set(signals.map(s =>
      s.chargeDescription?.split(" — ")[1] || s.chargeDescription || ""
    ).filter(Boolean))].slice(0, 2).join(", ") || "products";
    const cls1 = signals.some(s => (s.rawData as any)?.classification === "Class I");
    return {
      headline:     `${n} FDA/CPSC recall${n > 1 ? "s" : ""} — consumer injury exposure`,
      whatHappened: `${name} issued ${n} recall${n > 1 ? "s" : ""} covering ${products}${cls1 ? " (Class I — highest severity)" : ""}.`,
      whyItMatters: "Recalls create a defined window for personal injury and product liability claims. Affected consumers are actively searching for legal help.",
      whatToDo:     "Connect personal injury attorneys with affected consumers before competing firms saturate the market.",
      urgencyLabel: cls1 ? "Act within 48h" : "Act within 7 days",
      pitchLine:    `${name} has active recall exposure — personal injury attorneys can reach affected consumers now.`,
    };
  },
  osha: (signals, name, n) => ({
    headline:     `${n} OSHA violation${n > 1 ? "s" : ""} — worker injury claims open`,
    whatHappened: `${name} was cited by OSHA for ${n} workplace violation${n > 1 ? "s" : ""} in the past 30 days.`,
    whyItMatters: "OSHA citations generate workers' compensation and workplace injury claims. Injured workers need legal representation quickly.",
    whatToDo:     "Route to workers' comp attorneys and occupational injury firms for outreach to affected employees.",
    urgencyLabel: "Act within 72h",
    pitchLine:    `${name} has fresh OSHA violations — workers' comp attorneys have a limited window before injured parties retain counsel.`,
  }),
  arrest: (signals, name, n) => {
    const hasDUI = signals.some(s => s.signalType === "dui_arrest");
    return {
      headline:     `${n} ${hasDUI ? "DUI " : ""}arrest${n > 1 ? "s" : ""} — immediate legal representation need`,
      whatHappened: `${n} ${hasDUI ? "DUI " : ""}arrest record${n > 1 ? "s" : ""} associated with ${name} detected in the past 48 hours.`,
      whyItMatters: "Arrested individuals retain criminal defense attorneys within 24–72 hours of booking. Early outreach wins the case.",
      whatToDo:     hasDUI ? "DUI defense attorneys should reach out immediately — DUI clients move fast." : "Criminal defense attorneys: call within 24h of arrest.",
      urgencyLabel: "Act within 24h",
      pitchLine:    `Fresh ${hasDUI ? "DUI " : ""}arrest — criminal defense attorneys need to move today.`,
    };
  },
  court: (signals, name, n) => {
    const hasDivorce = signals.some(s => s.signalType === "divorce_filing");
    return {
      headline:     `${n} court filing${n > 1 ? "s" : ""} — family law opportunity`,
      whatHappened: `${n} ${hasDivorce ? "divorce/family court" : "court"} filing${n > 1 ? "s" : ""} linked to ${name}.`,
      whyItMatters: "Court filings signal active legal need. Parties in family proceedings need representation, often urgently.",
      whatToDo:     "Family law attorneys should reach out — these individuals are actively in the legal system and receptive.",
      urgencyLabel: "Act within 7 days",
      pitchLine:    `${n} court filing${n > 1 ? "s" : ""} — family law attorneys have a clear opening.`,
    };
  },
  business: (signals, name, n) => ({
    headline:     `New business activity — marketing services opportunity`,
    whatHappened: `${name} filed ${n} new business license${n > 1 ? "s" : ""} or business registration${n > 1 ? "s" : ""}.`,
    whyItMatters: "New businesses need CRM, marketing automation, website, and advertising services. They have budget and urgency.",
    whatToDo:     "Reach out with a business starter package — timing is ideal when they just filed.",
    urgencyLabel: "Act within 14 days",
    pitchLine:    `${name} just registered — new businesses are the best marketing clients you'll find.`,
  }),
};

function generateNarrative(signals: LegalSignal[], category: string, entityName: string): CaseNarrative {
  const n = signals.length;
  const fn = CATEGORY_NARRATIVES[category];
  if (fn) return fn(signals, entityName, n);
  return {
    headline:     `${n} signal${n > 1 ? "s" : ""} detected`,
    whatHappened: `${n} signal${n > 1 ? "s" : ""} associated with ${entityName}.`,
    whyItMatters: "Regulatory activity signals potential business or legal opportunity.",
    whatToDo:     "Review signals and determine if outreach is appropriate.",
    urgencyLabel: "Monitor",
    pitchLine:    `${entityName} has active regulatory signals.`,
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
  const caseKey   = `${entityId}:${category}:${window}`;
  const scores    = scoreCase(signals, category, signals[0]?.county || "");
  const narrative = generateNarrative(signals, category, entityName);

  const timeline = signals.map(s => ({
    date:        s.detectedAt?.toISOString().slice(0, 10) || window,
    type:        s.signalType,
    description: s.chargeDescription || s.subjectName || "",
    caseNumber:  s.caseNumber || null,
  }));

  const title = narrative.headline;

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
      title:             narrative.headline,
      outreachAngle:     narrative.pitchLine,
      aiSummary:         `${narrative.whatHappened} ${narrative.whyItMatters}`,
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
      outreachAngle: narrative.pitchLine,
      aiSummary:     `${narrative.whatHappened} ${narrative.whyItMatters}`,
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
const SUPPRESSION_THRESHOLD = 20; // Cases below this score are suppressed

let lastRunAt: Date | null = null;

export async function runCaseGroupingCycle(): Promise<void> {
  const start = Date.now();
  const sinceDate = lastRunAt
    ? new Date(lastRunAt.getTime() - 60 * 60 * 1000) // 1h overlap for re-processing
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // First run: last 7 days

  console.log(`[CASE-INTEL] Cycle start — processing signals since ${sinceDate.toISOString()}`);

  // Load all non-disqualified signals that have a subject name
  const signals = await db
    .select()
    .from(legalSignals)
    .where(
      and(
        not(eq(legalSignals.status, "disqualified")),
        gte(legalSignals.createdAt, sinceDate),
        not(isNull(legalSignals.subjectName)),
        not(inArray(legalSignals.signalType, ["business_growth_signal"])),
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

  // Report to Apex Intelligence brain (fire-and-forget)
  import("./operator/apexIntelligence").then(({ reportOutcome }) => reportOutcome({
    agentName:    "case-intelligence",
    action:       "cases_grouped",
    subject:      "case-grouping-cycle",
    result:       `Case grouping complete — created=${casesCreated} updated=${casesUpdated} suppressed=${suppressed} from ${signals.length} signals`,
    confidence:   0.8,
    subAccountId: parseInt(process.env.APEX_PARENT_ACCOUNT_ID || "3"),
    metadata: {
      casesCreated,
      casesUpdated,
      suppressed,
      signalsProcessed: signals.length,
    },
  // allow-silent-catch: fire-and-forget telemetry
  })).catch(() => {});
}

export function startCaseIntelligence(): void {
  async function safeCycle() {
    try {
      await runCaseGroupingCycle();
    } catch (err: any) {
      // Never crash the server — tables may not exist yet on first deploy
      console.error("[CASE-INTEL] Cycle error (non-fatal):", err?.message);
    }
  }

  // Wait 3 minutes after boot so createCaseTables has definitely run
  setTimeout(safeCycle, 3 * 60 * 1000);
  setInterval(safeCycle, 30 * 60 * 1000);
  console.log("[CASE-INTEL] Started — 3 min initial delay, then every 30min");
}

export function getCaseIntelligenceStats() {
  return { lastRunAt: lastRunAt?.toISOString() ?? null };
}
