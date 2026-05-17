/**
 * server/hpl/permitParser.ts
 *
 * Permit Parser & Trade Classifier
 *
 * Converts raw permit text / permit type strings into typed trade classifications.
 * Pure keyword matching — no API calls, no LLM inference, deterministic output.
 *
 * Also exports STORM_TRADE_MAP — the canonical mapping from storm event types
 * to primary contractor trades.
 */

import type { ServiceTrade } from "./types";

// ── Trade classification output ───────────────────────────────────────────────

export interface TradeClassification {
  trade: ServiceTrade;
  confidence: number;       // 0.0 – 1.0
  matchedKeywords: string[];
  estimatedValue?: number;
  isEmergency: boolean;
}

// ── Pattern table ─────────────────────────────────────────────────────────────

interface TradePattern {
  trade: ServiceTrade;
  keywords: string[];
  emergencyKeywords: string[];
  baseConfidence: number;
}

const TRADE_PATTERNS: TradePattern[] = [
  {
    trade: "roofing",
    keywords: ["roof", "roofing", "shingle", "tile", "metal roof", "flat roof", "membrane", "flashing", "soffit", "fascia", "decking"],
    emergencyKeywords: ["emergency roof", "roof collapse", "storm damage roof", "hail damage"],
    baseConfidence: 0.92,
  },
  {
    trade: "hvac",
    keywords: ["hvac", "air condition", "ac unit", "heat pump", "furnace", "ductwork", "duct", "ventilation", "refrigerant", "compressor", "air handler"],
    emergencyKeywords: ["no heat", "no cooling", "hvac failure"],
    baseConfidence: 0.91,
  },
  {
    trade: "plumbing",
    keywords: ["plumbing", "pipe", "sewer", "drain", "water heater", "toilet", "faucet", "backflow", "water main", "gas line"],
    emergencyKeywords: ["burst pipe", "flood", "sewage backup", "gas leak"],
    baseConfidence: 0.90,
  },
  {
    trade: "electrical",
    keywords: ["electrical", "electric", "wiring", "panel", "breaker", "outlet", "generator", "solar electric", "ev charger", "low voltage"],
    emergencyKeywords: ["power outage", "electrical fire", "arc fault"],
    baseConfidence: 0.90,
  },
  {
    trade: "windows_doors",
    keywords: ["window", "door", "sliding glass", "impact window", "hurricane window", "entry door", "garage door", "skylight"],
    emergencyKeywords: ["broken window", "door damage", "storm impact"],
    baseConfidence: 0.87,
  },
  {
    trade: "gutters",
    keywords: ["gutter", "downspout", "rain gutter", "leaf guard", "fascia board"],
    emergencyKeywords: [],
    baseConfidence: 0.88,
  },
  {
    trade: "siding",
    keywords: ["siding", "stucco", "cladding", "hardi", "vinyl siding", "fiber cement", "exterior wall"],
    emergencyKeywords: ["storm damage siding"],
    baseConfidence: 0.85,
  },
  {
    trade: "painting",
    keywords: ["paint", "painting", "exterior paint", "interior paint", "coat", "primer", "stain"],
    emergencyKeywords: [],
    baseConfidence: 0.80,
  },
  {
    trade: "flooring",
    keywords: ["floor", "flooring", "tile floor", "hardwood", "carpet", "laminate", "vinyl plank", "subfloor"],
    emergencyKeywords: ["water damaged floor"],
    baseConfidence: 0.82,
  },
  {
    trade: "insulation",
    keywords: ["insulation", "attic insulation", "spray foam", "blown in", "r-value", "weatherization"],
    emergencyKeywords: [],
    baseConfidence: 0.85,
  },
  {
    trade: "restoration",
    keywords: ["restoration", "remediation", "mold", "water damage", "fire damage", "smoke damage", "flood restoration", "biohazard"],
    emergencyKeywords: ["emergency restoration", "mold remediation", "sewage cleanup", "fire restoration"],
    baseConfidence: 0.90,
  },
  {
    trade: "waterproofing",
    keywords: ["waterproof", "basement waterproofing", "french drain", "sump pump", "vapor barrier", "seawall"],
    emergencyKeywords: ["basement flood"],
    baseConfidence: 0.86,
  },
  {
    trade: "foundation",
    keywords: ["foundation", "concrete foundation", "slab", "piering", "helical pier", "underpinning", "crack repair"],
    emergencyKeywords: ["foundation failure", "sinkhole"],
    baseConfidence: 0.88,
  },
  {
    trade: "solar",
    keywords: ["solar", "photovoltaic", "pv system", "solar panel", "battery storage", "solar installation"],
    emergencyKeywords: [],
    baseConfidence: 0.91,
  },
  {
    trade: "fencing",
    keywords: ["fence", "fencing", "privacy fence", "wood fence", "chain link", "vinyl fence", "gate"],
    emergencyKeywords: ["storm fence"],
    baseConfidence: 0.82,
  },
  {
    trade: "pool_spa",
    keywords: ["pool", "spa", "hot tub", "swimming pool", "pool deck", "pool resurfacing", "pool equipment"],
    emergencyKeywords: [],
    baseConfidence: 0.88,
  },
];

// ── Storm → trade mapping ─────────────────────────────────────────────────────

export const STORM_TRADE_MAP: Record<string, ServiceTrade[]> = {
  hail:         ["roofing", "gutters", "windows_doors", "painting", "siding"],
  hurricane:    ["roofing", "restoration", "windows_doors", "fencing", "gutters"],
  tornado:      ["roofing", "restoration", "windows_doors", "fencing", "siding"],
  wind:         ["roofing", "gutters", "windows_doors", "fencing", "siding"],
  flood:        ["restoration", "waterproofing", "flooring", "electrical", "plumbing"],
  freeze:       ["plumbing", "hvac", "restoration", "insulation"],
  severe_storm: ["roofing", "restoration", "windows_doors", "gutters"],
};

// ── Main classifier ───────────────────────────────────────────────────────────

export function classifyPermit(
  permitText: string,
  permitType?: string,
  estimatedPermitValue?: number,
): TradeClassification {
  const lower = `${permitText} ${permitType ?? ""}`.toLowerCase();

  let bestMatch: TradeClassification | null = null;
  let bestScore = 0;

  for (const pattern of TRADE_PATTERNS) {
    const matched: string[] = [];
    let score = 0;

    for (const kw of pattern.keywords) {
      if (lower.includes(kw)) {
        matched.push(kw);
        score += kw.length > 6 ? 2 : 1; // longer keywords = more specific
      }
    }

    if (matched.length === 0) continue;

    const isEmergency = pattern.emergencyKeywords.some(ek => lower.includes(ek));
    const confidence = Math.min(
      pattern.baseConfidence + (matched.length - 1) * 0.02,
      0.99,
    );

    if (score > bestScore) {
      bestScore = score;
      bestMatch = {
        trade: pattern.trade,
        confidence,
        matchedKeywords: matched,
        estimatedValue: estimatedPermitValue,
        isEmergency,
      };
    }
  }

  if (bestMatch) return bestMatch;

  return {
    trade: "general_contractor",
    confidence: 0.30,
    matchedKeywords: [],
    estimatedValue: estimatedPermitValue,
    isEmergency: false,
  };
}

// ── Batch classify ────────────────────────────────────────────────────────────

export function classifyPermits(
  permits: Array<{ text: string; type?: string; value?: number }>,
): TradeClassification[] {
  return permits.map(p => classifyPermit(p.text, p.type, p.value));
}

// ── Trade signal score ────────────────────────────────────────────────────────

export function getTradeSignalScore(trade: ServiceTrade, permitValue?: number): number {
  const BASE: Partial<Record<ServiceTrade, number>> = {
    roofing: 70, restoration: 75, hvac: 60, electrical: 55,
    plumbing: 55, foundation: 80, solar: 65, windows_doors: 50,
    waterproofing: 60, siding: 45, insulation: 40, gutters: 35,
    painting: 30, flooring: 35, fencing: 25, pool_spa: 50,
  };

  let score = BASE[trade] ?? 40;

  if (permitValue) {
    if (permitValue >= 50_000)      score += 15;
    else if (permitValue >= 20_000) score += 10;
    else if (permitValue >= 5_000)  score += 5;
  }

  return Math.min(score, 100);
}
