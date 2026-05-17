/**
 * server/intelligence/correlationWorker.ts
 *
 * Cross-Signal Correlation Worker  (Phase 4)
 *
 * Automatically links incoming signals to intelligence_cases and
 * intelligence_entities, and recalculates composite scores.
 *
 * HOW IT WORKS:
 *  1. A new signal arrives (legal, crash, home-service, court, etc.)
 *  2. correlateSignal() normalizes the signal's entity (company/person/property)
 *     and upserts into intelligence_entities
 *  3. It finds or creates the intelligence_case for the entity+category+window
 *  4. Inserts a case_signals row linking the signal to the case
 *  5. Recalculates the case's composite opportunity score
 *  6. Returns the case_id for downstream use (AI summary, outreach routing)
 *
 * ENTITY KEY NORMALIZATION:
 *   company  → slugify(canonicalName) + county
 *   person   → normalized_name:dob or normalized_name:address
 *   property → address_normalized:county
 */

import { sql, eq, and } from "drizzle-orm";
import { db } from "../db";
import {
  intelligenceEntities,
  intelligenceCases,
  caseSignals,
  type InsertIntelligenceEntity,
  type InsertIntelligenceCase,
} from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SignalEntityType = "company" | "person" | "property";
export type CaseCategory     = "recall" | "osha" | "arrest" | "court" | "crash" | "license" | "permit" | "insurance" | "other";

export interface IncomingSignal {
  signalId:       number;
  signalTable:    string;   // "legal_signals" | "crash_reports" | "home_service_signals"
  signalType:     string;
  detectedAt?:    Date;
  summary?:       string;
  sourceUrl?:     string;

  // Entity resolution inputs — provide as many as available
  entityType:     SignalEntityType;
  canonicalName:  string;       // company name, person name, property address
  domain?:        string;
  address?:       string;
  county?:        string;
  state?:         string;
  aliases?:       string[];

  // Case grouping
  category:       CaseCategory;
  incidentWindow?: string;      // YYYY-MM — defaults to current month

  // Signal-level scores (0–100)
  opportunityScore?:   number;
  urgencyScore?:       number;
  financialScore?:     number;
  legalSeverity?:      number;
  consumerImpact?:     number;
  localRelevance?:     number;
}

export interface CorrelationResult {
  entityId:   number;
  caseId:     number;
  signalRow:  number;
  isNewCase:  boolean;
  isNewEntity: boolean;
}

// ── Key normalization ─────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function buildEntityKey(signal: IncomingSignal): string {
  const base = slugify(signal.canonicalName);
  const county = signal.county ? slugify(signal.county) : "unknown";
  switch (signal.entityType) {
    case "company":   return `company:${base}:${county}`;
    case "person":    return `person:${base}:${county}`;
    case "property":  return `property:${slugify(signal.address ?? signal.canonicalName)}:${county}`;
    default:          return `entity:${base}:${county}`;
  }
}

function buildCaseKey(entityId: number, category: CaseCategory, window: string): string {
  return `${entityId}:${category}:${window}`;
}

function currentWindow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── Score computation ─────────────────────────────────────────────────────────

function computeComposite(fields: {
  opportunityScore: number;
  urgencyScore:     number;
  financialScore:   number;
  outreachViability: number;
  consumerImpact:   number;
  legalSeverity:    number;
  localRelevance:   number;
}): number {
  const weights = {
    opportunityScore:  0.25,
    urgencyScore:      0.20,
    financialScore:    0.15,
    outreachViability: 0.15,
    consumerImpact:    0.10,
    legalSeverity:     0.10,
    localRelevance:    0.05,
  };
  return Math.round(
    Object.entries(weights).reduce((sum, [k, w]) => sum + ((fields as any)[k] ?? 0) * w, 0)
  );
}

// ── Upsert entity ──────────────────────────────────────────────────────────────

async function upsertEntity(signal: IncomingSignal): Promise<{ id: number; isNew: boolean }> {
  const normalizedKey = buildEntityKey(signal);

  const existing = await db.select({ id: intelligenceEntities.id })
    .from(intelligenceEntities)
    .where(eq(intelligenceEntities.normalizedKey, normalizedKey))
    .limit(1);

  if (existing.length > 0) {
    // Merge aliases if new ones provided
    if (signal.aliases && signal.aliases.length > 0) {
      await db.execute(sql`
        UPDATE intelligence_entities
        SET aliases  = (
              SELECT jsonb_agg(DISTINCT val)
              FROM jsonb_array_elements_text(aliases || ${JSON.stringify(signal.aliases)}::jsonb) AS val
            ),
            updated_at = NOW()
        WHERE id = ${existing[0].id}
      `);
    }
    return { id: existing[0].id, isNew: false };
  }

  const insert: InsertIntelligenceEntity = {
    canonicalName: signal.canonicalName,
    normalizedKey,
    entityType:    signal.entityType,
    domain:        signal.domain ?? null,
    address:       signal.address ?? null,
    county:        signal.county ?? null,
    state:         signal.state ?? "FL",
    aliases:       signal.aliases ?? [],
    profileData:   {},
  };

  const [row] = await db.insert(intelligenceEntities).values(insert).returning({ id: intelligenceEntities.id });
  return { id: row.id, isNew: true };
}

// ── Upsert case ────────────────────────────────────────────────────────────────

async function upsertCase(
  entityId: number,
  signal: IncomingSignal
): Promise<{ id: number; isNew: boolean }> {
  const window   = signal.incidentWindow ?? currentWindow();
  const caseKey  = buildCaseKey(entityId, signal.category, window);
  const title    = `${signal.canonicalName} — ${signal.category} (${window})`;

  const existing = await db.select({ id: intelligenceCases.id })
    .from(intelligenceCases)
    .where(eq(intelligenceCases.caseKey, caseKey))
    .limit(1);

  if (existing.length > 0) {
    // Update signal count + latest signal timestamp + recalculate score
    const caseId = existing[0].id;

    const oppScore    = signal.opportunityScore   ?? 50;
    const urgScore    = signal.urgencyScore        ?? 50;
    const finScore    = signal.financialScore      ?? 50;
    const conImpact   = signal.consumerImpact      ?? 50;
    const legSeverity = signal.legalSeverity       ?? 50;
    const locRel      = signal.localRelevance      ?? 50;
    const outViab     = 70; // default outreach viability
    const composite   = computeComposite({
      opportunityScore: oppScore, urgencyScore: urgScore, financialScore: finScore,
      outreachViability: outViab, consumerImpact: conImpact, legalSeverity: legSeverity, localRelevance: locRel,
    });

    await db.execute(sql`
      UPDATE intelligence_cases
      SET signal_count       = signal_count + 1,
          latest_signal_at   = NOW(),
          opportunity_score  = GREATEST(opportunity_score, ${oppScore}),
          urgency_score      = GREATEST(urgency_score, ${urgScore}),
          financial_score    = GREATEST(financial_score, ${finScore}),
          consumer_impact    = GREATEST(consumer_impact, ${conImpact}),
          legal_severity     = GREATEST(legal_severity, ${legSeverity}),
          local_relevance    = GREATEST(local_relevance, ${locRel}),
          composite_score    = ${composite},
          actionable         = ${composite >= 50},
          updated_at         = NOW()
      WHERE id = ${caseId}
    `);

    return { id: caseId, isNew: false };
  }

  const oppScore    = signal.opportunityScore   ?? 50;
  const urgScore    = signal.urgencyScore        ?? 50;
  const finScore    = signal.financialScore      ?? 50;
  const conImpact   = signal.consumerImpact      ?? 50;
  const legSeverity = signal.legalSeverity       ?? 50;
  const locRel      = signal.localRelevance      ?? 50;
  const composite   = computeComposite({
    opportunityScore: oppScore, urgencyScore: urgScore, financialScore: finScore,
    outreachViability: 70, consumerImpact: conImpact, legalSeverity: legSeverity, localRelevance: locRel,
  });

  const insert: InsertIntelligenceCase = {
    entityId,
    caseKey,
    title,
    category:          signal.category,
    incidentWindow:    window,
    signalCount:       1,
    latestSignalAt:    signal.detectedAt ?? new Date(),
    opportunityScore:  oppScore,
    urgencyScore:      urgScore,
    financialScore:    finScore,
    outreachViability: 70,
    consumerImpact:    conImpact,
    legalSeverity:     legSeverity,
    localRelevance:    locRel,
    compositeScore:    composite,
    actionable:        composite >= 50,
    status:            "open",
    sourceLinks:       signal.sourceUrl ? [signal.sourceUrl] : [],
    affectedProducts:  [],
    timeline:          [],
  };

  const [row] = await db.insert(intelligenceCases).values(insert).returning({ id: intelligenceCases.id });
  return { id: row.id, isNew: true };
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function correlateSignal(signal: IncomingSignal): Promise<CorrelationResult> {
  const { id: entityId, isNew: isNewEntity } = await upsertEntity(signal);
  const { id: caseId,   isNew: isNewCase   } = await upsertCase(entityId, signal);

  // Insert case_signal link
  const [signalRow] = await db.insert(caseSignals).values({
    caseId,
    signalId:    signal.signalId,
    signalTable: signal.signalTable,
    signalType:  signal.signalType,
    detectedAt:  signal.detectedAt ?? new Date(),
    summary:     signal.summary ?? null,
    sourceUrl:   signal.sourceUrl ?? null,
  }).onConflictDoNothing().returning({ id: caseSignals.id });

  console.log(
    `[CORRELATION] entity=${entityId}(${isNewEntity ? "new" : "existing"}) case=${caseId}(${isNewCase ? "new" : "existing"}) signal=${signalRow?.id ?? "dup"}`
  );

  return {
    entityId,
    caseId,
    signalRow: signalRow?.id ?? 0,
    isNewCase,
    isNewEntity,
  };
}

/**
 * Backfill: attempt to correlate all existing legal_signals that have no
 * case_signal entry yet. Safe to run as a one-time migration or on a schedule.
 */
export async function backfillCorrelation(limit = 500): Promise<{ processed: number; linked: number }> {
  const result = await db.execute(sql`
    SELECT ls.id, ls.signal_type, ls.company_name, ls.county, ls.state,
           ls.created_at, ls.sub_account_id
    FROM legal_signals ls
    WHERE NOT EXISTS (
      SELECT 1 FROM case_signals cs WHERE cs.signal_id = ls.id AND cs.signal_table = 'legal_signals'
    )
    ORDER BY ls.created_at DESC
    LIMIT ${limit}
  `);
  const rows = (result as any).rows ?? result;
  if (!Array.isArray(rows) || rows.length === 0) return { processed: 0, linked: 0 };

  let linked = 0;
  for (const row of rows) {
    try {
      await correlateSignal({
        signalId:      Number(row.id),
        signalTable:   "legal_signals",
        signalType:    row.signal_type ?? "legal",
        canonicalName: row.company_name ?? "Unknown",
        entityType:    "company",
        county:        row.county ?? undefined,
        state:         row.state ?? "FL",
        category:      mapSignalTypeToCategory(row.signal_type),
        detectedAt:    row.created_at ? new Date(row.created_at) : undefined,
      });
      linked++;
    } catch (err: any) {
      console.error(`[CORRELATION-BACKFILL] signal ${row.id} failed:`, err?.message);
    }
  }

  console.log(`[CORRELATION-BACKFILL] processed=${rows.length} linked=${linked}`);
  return { processed: rows.length, linked };
}

function mapSignalTypeToCategory(signalType: string): CaseCategory {
  if (!signalType) return "other";
  const t = signalType.toLowerCase();
  if (t.includes("recall"))    return "recall";
  if (t.includes("osha"))      return "osha";
  if (t.includes("arrest"))    return "arrest";
  if (t.includes("court"))     return "court";
  if (t.includes("crash") || t.includes("accident")) return "crash";
  if (t.includes("license"))   return "license";
  if (t.includes("permit"))    return "permit";
  if (t.includes("insurance")) return "insurance";
  return "other";
}
