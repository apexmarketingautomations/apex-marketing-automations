/**
 * homeServiceLeadScorer.ts
 *
 * Scores every raw signal 0–100 before it becomes a contractor lead.
 * Minimum score to qualify: 40.
 *
 * Apex emission point:
 *   → lead_scored  fired after every score computation so Apex learns
 *                  which signal types, counties, and property profiles
 *                  produce high-scoring leads over time.
 */

import type { RawSignal, ServiceCategory } from "./homeServiceSignalPipeline";

export interface LeadScore {
  score:             number;
  qualifies:         boolean;
  tier:              "A" | "B" | "C" | "D";
  breakdown:         string;
  expiresAt:         Date;
  estimatedJobValue: { min: number; max: number };
}

const MIN_QUALIFY_SCORE = 40;
const CORE_COUNTIES     = new Set(["LEE", "COLLIER", "CHARLOTTE"]);

// ── Apex hook — same pattern as crashIngestPipeline ──────────────────────────

function apexReport(params: {
  action:       string;
  subject:      string;
  result:       string;
  confidence:   number;
  subAccountId: number;
  metadata:     Record<string, unknown>;
}): void {
  import("../operator/apexIntelligence")
    .then(({ reportOutcome }) =>
      reportOutcome({
        agentName:    "home-service-scorer",
        niche:        "home_services",
        action:       params.action,
        subject:      params.subject,
        result:       params.result,
        confidence:   params.confidence,
        subAccountId: params.subAccountId,
        metadata:     params.metadata,
      }),
    )
    .catch(() => {});
}

// ── Scorer ────────────────────────────────────────────────────────────────────

export async function scoreHomeServiceLead(
  signal:       RawSignal,
  signalId:     number,
  subAccountId: number,
): Promise<LeadScore> {
  const signals: string[] = [];
  let score = 0;

  // Signal 1: Property value → up to +25
  const pv = signal.propertyValue ?? 0;
  if      (pv >= 1_000_000) { score += 25; signals.push("propertyValue($1M+)+25"); }
  else if (pv >= 500_000)   { score += 20; signals.push("propertyValue($500K+)+20"); }
  else if (pv >= 300_000)   { score += 15; signals.push("propertyValue($300K+)+15"); }
  else if (pv >= 150_000)   { score += 10; signals.push("propertyValue($150K+)+10"); }
  else if (pv >= 75_000)    { score +=  5; signals.push("propertyValue($75K+)+5"); }

  // Signal 2: Urgency → up to +20
  const urgencyScores: Record<string, number> = { critical: 20, high: 15, medium: 8, low: 3 };
  const urgencyScore = urgencyScores[signal.urgency] ?? 0;
  score += urgencyScore;
  signals.push(`urgency(${signal.urgency})+${urgencyScore}`);

  // Signal 3: Signal type — highest-intent types rank highest → up to +20
  const typeScores: Record<string, number> = {
    noaa_weather_alert: 20,
    code_enforcement:   18,
    pre_foreclosure:    16,
    lis_pendens:        16,
    probate:            15,
    sinkhole_report:    14,
    permit_filing:      12,
    new_homeowner:      10,
    flood_zone_change:   8,
    short_term_rental:   8,
  };
  const typeScore = typeScores[signal.signalType] ?? 5;
  score += typeScore;
  signals.push(`signalType(${signal.signalType})+${typeScore}`);

  // Signal 4: Property age → up to +10
  if (signal.yearBuilt) {
    const age = new Date().getFullYear() - signal.yearBuilt;
    if      (age > 40) { score += 10; signals.push(`age(${age}yr)+10`); }
    else if (age > 25) { score +=  7; signals.push(`age(${age}yr)+7`); }
    else if (age > 15) { score +=  4; signals.push(`age(${age}yr)+4`); }
    else               { score +=  2; signals.push(`age(${age}yr)+2`); }
  }

  // Signal 5: Square footage → up to +10
  const sqft = signal.squareFootage ?? 0;
  if      (sqft >= 4_000) { score += 10; signals.push(`sqft(${sqft})+10`); }
  else if (sqft >= 2_500) { score +=  7; signals.push(`sqft(${sqft})+7`); }
  else if (sqft >= 1_500) { score +=  4; signals.push(`sqft(${sqft})+4`); }
  else if (sqft > 0)      { score +=  2; signals.push(`sqft(${sqft})+2`); }

  // Signal 6: Core county bonus → +5
  if (CORE_COUNTIES.has(signal.county.toUpperCase())) {
    score += 5;
    signals.push(`coreCounty(${signal.county})+5`);
  }

  // Signal 7: Recency → up to +10
  const ageHrs = (Date.now() - signal.detectedAt.getTime()) / 3_600_000;
  if      (ageHrs < 1)  { score += 10; signals.push("recency(<1hr)+10"); }
  else if (ageHrs < 6)  { score +=  7; signals.push("recency(<6hr)+7"); }
  else if (ageHrs < 24) { score +=  4; signals.push("recency(<24hr)+4"); }
  else if (ageHrs < 72) { score +=  2; signals.push("recency(<72hr)+2"); }

  score = Math.min(100, score);

  const qualifies = score >= MIN_QUALIFY_SCORE;
  const tier: "A" | "B" | "C" | "D" =
    score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : "D";

  const expiryHours: Record<string, number> = {
    noaa_weather_alert: 48,
    code_enforcement:   168,
    pre_foreclosure:    336,
    new_homeowner:      720,
    permit_filing:      336,
  };
  const expiresAt = new Date(
    Date.now() + (expiryHours[signal.signalType] ?? 168) * 3_600_000,
  );

  const estimatedJobValue = estimateJobValue(
    signal.serviceCategories, signal.propertyValue, signal.squareFootage,
  );

  const breakdown = signals.join(" | ");

  // ── Apex: lead scored ──────────────────────────────────────────────────────
  apexReport({
    action:       "lead_scored",
    subject:      signal.signalType,
    result:       `Lead scored ${score}/100 (Tier ${tier}) — ${qualifies ? "qualifies" : "disqualified"}`,
    confidence:   score / 100,
    subAccountId,
    metadata: {
      signalId:          signalId,
      signalType:        signal.signalType,
      county:            signal.county,
      score,
      tier,
      qualifies,
      breakdown,
      propertyValue:     signal.propertyValue,
      squareFootage:     signal.squareFootage,
      yearBuilt:         signal.yearBuilt,
      urgency:           signal.urgency,
      serviceCategories: signal.serviceCategories,
      estimatedJobMin:   estimatedJobValue.min,
      estimatedJobMax:   estimatedJobValue.max,
    },
  });

  console.log(`[HS-SCORER] signalId=${signalId} score=${score} tier=${tier} qualifies=${qualifies} [${breakdown}]`);

  return { score, qualifies, tier, breakdown, expiresAt, estimatedJobValue };
}

// ── Job value estimation ──────────────────────────────────────────────────────

function estimateJobValue(
  categories:    ServiceCategory[],
  propertyValue?: number,
  sqft?:          number,
): { min: number; max: number } {
  const baseRanges: Record<ServiceCategory, [number, number]> = {
    roofing:            [8_000,  45_000],
    hvac:               [4_000,  20_000],
    water_damage:       [3_000,  30_000],
    pool:               [15_000, 80_000],
    solar:              [12_000, 50_000],
    foundation:         [5_000,  40_000],
    general_contractor: [10_000, 200_000],
    electrical:         [2_000,  15_000],
    plumbing:           [1_500,  12_000],
    landscaping:        [1_000,   8_000],
    painting:           [2_000,  12_000],
  };

  let min = 0, max = 0;
  for (const cat of categories) {
    const [lo, hi] = baseRanges[cat] ?? [1_000, 10_000];
    min = Math.max(min, lo);
    max = Math.max(max, hi);
  }

  const pvMult   = (propertyValue ?? 0) > 500_000 ? 1.4 : (propertyValue ?? 0) > 250_000 ? 1.2 : 1.0;
  const sqftMult = (sqft ?? 0) > 3_000 ? 1.3 : (sqft ?? 0) > 2_000 ? 1.1 : 1.0;

  return {
    min: Math.round(min * pvMult * sqftMult),
    max: Math.round(max * pvMult * sqftMult),
  };
}
