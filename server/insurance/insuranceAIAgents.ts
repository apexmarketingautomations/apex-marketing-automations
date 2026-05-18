/**
 * server/insurance/insuranceAIAgents.ts
 *
 * Insurance AI Agents
 *
 * Six specialized agents for insurance intelligence, all routed through
 * the existing agentCoordinator (Phase 6) for policy enforcement, budget
 * governance, and audit trail.
 *
 * Agents:
 *   1. householdRiskAnalysisAgent  — full household risk summary
 *   2. stormOpportunityAgent       — storm → claim opportunity mapping
 *   3. commercialPolicyAgent       — business risk → coverage recommendations
 *   4. homeownerOpportunityAgent   — property signals → homeowner coverage
 *   5. autoPolicyOpportunityAgent  — crash/DUI/lapse → auto coverage
 *   6. bundlingRecommendationAgent — cross-sell opportunity analysis
 *
 * All outputs:
 *   - Written as structured JSON (validated before use)
 *   - Stored in AI audit trail
 *   - Require human review before any communication is drafted
 *   - NEVER directly trigger communications
 */

import { runAgent } from "../ai/agentCoordinator";
import type { AgentDefinition } from "../ai/agentCoordinator";
import type { HouseholdEntity, InsuranceOpportunity, CommercialRiskEntity } from "./types";
import { scorePolicy, detectOpportunityTypes, estimateHouseholdPremium } from "./policyScoringService";

// ── Output types ──────────────────────────────────────────────────────────────

interface HouseholdRiskSummary {
  householdId: string;
  riskLevel: "low" | "moderate" | "high" | "critical";
  primaryRiskFactors: string[];
  opportunityTypes: string[];
  estimatedAnnualPremium: number;
  recommendedLines: string[];
  followUpStrategy: string;
  urgency: "routine" | "elevated" | "immediate";
}

interface StormOpportunitySummary {
  county: string;
  stormType: string;
  claimsLikely: boolean;
  roofReplacementWindow: string;
  outreachTiming: string;
  contactStrategy: string;
  estimatedOpportunityCount: number;
}

interface CommercialPolicySummary {
  businessId: string;
  coverageGaps: string[];
  priorityLine: string;
  estimatedPremium: number;
  approachStrategy: string;
}

interface BundlingSummary {
  householdId: string;
  bundlingLines: string[];
  estimatedSavings: number;
  approachAngle: string;
}

// ── Type guards ───────────────────────────────────────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function hasKeys(v: Record<string, unknown>, keys: string[]): boolean {
  return keys.every(k => k in v);
}

// ── Agent 1: Household Risk Analysis ─────────────────────────────────────────

const householdRiskAgent = {
  agentId: "insurance_household_risk",
  displayName: "Household Risk Analysis Agent",
  model: "claude-sonnet",
  systemPrompt: `You are an insurance risk analyst. Given a household intelligence record,
produce a structured JSON risk analysis. Be precise, factual, and conservative.
Do NOT recommend actions beyond your scope. Do NOT fabricate data.
Output ONLY valid JSON matching the required schema.`,
  buildPrompt: (input: unknown) => {
    const h = input as HouseholdEntity;
    const score = scorePolicy(h);
    const opps = detectOpportunityTypes(h);
    const premium = estimateHouseholdPremium(h);
    return `Analyze this household insurance profile and return JSON:

Household: ${h.primaryAddress}, ${h.county} ${h.state}
Policy Score: ${score.total}/100 (auto=${score.autoScore}, home=${score.homeownerScore}, commercial=${score.commercialScore})
Signals: ${(h.activeSignals ?? []).join(", ") || "none"}
Recent Crashes: ${h.crashCount12Mo ?? 0}  |  DUI (36mo): ${h.duiCount36Mo ?? 0}
Homeowner: ${h.isHomeowner ? "Yes" : "No"}  |  Home Value: $${h.estimatedHomeValue?.toLocaleString() ?? "unknown"}
Roof Age: ${h.roofAgeEstimate ?? "unknown"} years  |  Storm Exposure: ${h.stormExposureScore ?? 0}/100
Vehicles: ${h.vehicleCount ?? 0}  |  Business Owner: ${h.businessOwner ? "Yes" : "No"}
Detected Opportunities: ${opps.map(o => o.opportunityType).join(", ") || "none"}
Estimated Annual Premium: $${premium.toLocaleString()}

Return JSON with fields: householdId, riskLevel, primaryRiskFactors (array),
opportunityTypes (array), estimatedAnnualPremium (number), recommendedLines (array),
followUpStrategy (string), urgency.`;
  },
  outputValidator: (v: unknown): v is HouseholdRiskSummary =>
    isObj(v) &&
    hasKeys(v, ["riskLevel", "primaryRiskFactors", "opportunityTypes", "recommendedLines", "followUpStrategy", "urgency"]) &&
    ["low", "moderate", "high", "critical"].includes(v.riskLevel as string),
  requiredAction: "read_data",
  maxRetries: 2,
};

export async function runHouseholdRiskAnalysis(
  household: HouseholdEntity,
  subAccountId?: number,
): Promise<HouseholdRiskSummary | null> {
  const result: any = await runAgent(householdRiskAgent as any, household, { subAccountId });
  if (!result.ok || !result.output) return null;
  return result.output;
}

// ── Agent 2: Storm Opportunity ────────────────────────────────────────────────

const stormOpportunityAgent = {
  agentId: "insurance_storm_opportunity",
  displayName: "Storm Insurance Opportunity Agent",
  model: "claude-sonnet",
  systemPrompt: `You are an insurance storm intelligence analyst. Given storm event data,
identify the insurance claim and coverage opportunity window. Be precise about timing.
Output ONLY valid JSON matching the required schema. Do NOT fabricate data.`,
  buildPrompt: (input: unknown) => {
    const d = input as { county: string; stormType: string; score: number; hailSize?: number; windSpeed?: number; roofReplacementCount: number };
    return `Analyze this storm event for insurance opportunity:

County: ${d.county}
Storm Type: ${d.stormType}
Opportunity Score: ${d.score}/100
Hail Size: ${d.hailSize ?? "N/A"} inches
Wind Speed: ${d.windSpeed ?? "N/A"} mph
Properties with aging roofs: ${d.roofReplacementCount}

Return JSON with: county, stormType, claimsLikely (boolean), roofReplacementWindow (string),
outreachTiming (string), contactStrategy (string), estimatedOpportunityCount (number).`;
  },
  outputValidator: (v: unknown): v is StormOpportunitySummary =>
    isObj(v) && hasKeys(v, ["county", "stormType", "claimsLikely", "outreachTiming", "contactStrategy"]),
  requiredAction: "read_data",
  maxRetries: 2,
};

export async function runStormOpportunityAnalysis(opts: {
  county: string;
  stormType: string;
  score: number;
  hailSize?: number;
  windSpeed?: number;
  roofReplacementCount: number;
}, subAccountId?: number): Promise<StormOpportunitySummary | null> {
  const result: any = await runAgent(stormOpportunityAgent as any, opts, { subAccountId });
  return result.ok ? result.output ?? null : null;
}

// ── Agent 3: Commercial Policy ────────────────────────────────────────────────

const commercialPolicyAgent = {
  agentId: "insurance_commercial_policy",
  displayName: "Commercial Policy Opportunity Agent",
  model: "claude-sonnet",
  systemPrompt: `You are a commercial insurance specialist. Analyze business risk data
and identify coverage gaps. Be specific about line of business priority.
Output ONLY valid JSON. Do NOT make compliance claims or legal statements.`,
  buildPrompt: (input: unknown) => {
    const b = input as CommercialRiskEntity;
    return `Analyze this business for commercial insurance opportunities:

Business: ${b.businessName}, ${b.businessType ?? "unknown type"}
Location: ${b.county}, ${b.state}
Contractor License: ${b.hasContractorLicense ? "Yes" : "No"}
Fleet Vehicles: ${b.hasFleetVehicles ? "Yes" : "No"}
DBPR License: ${b.dbprLicenseType ?? "none"}
Employees: ${b.employeeCount ?? "unknown"}
Detected Signals: ${(b.activeSignals ?? []).join(", ") || "none"}
GL: ${b.glOpportunity ? "✓" : "—"}  WC: ${b.wcOpportunity ? "✓" : "—"}  BOP: ${b.bopOpportunity ? "✓" : "—"}

Return JSON with: businessId, coverageGaps (array), priorityLine (string),
estimatedPremium (number), approachStrategy (string).`;
  },
  outputValidator: (v: unknown): v is CommercialPolicySummary =>
    isObj(v) && hasKeys(v, ["coverageGaps", "priorityLine", "estimatedPremium", "approachStrategy"]),
  requiredAction: "read_data",
  maxRetries: 2,
};

export async function runCommercialPolicyAnalysis(
  business: CommercialRiskEntity,
  subAccountId?: number,
): Promise<CommercialPolicySummary | null> {
  const result: any = await runAgent(commercialPolicyAgent as any, business, { subAccountId });
  return result.ok ? result.output ?? null : null;
}

// ── Agent 4: Homeowner Opportunity ────────────────────────────────────────────

const homeownerOpportunityAgent = {
  agentId: "insurance_homeowner_opportunity",
  displayName: "Homeowner Coverage Opportunity Agent",
  model: "claude-haiku",
  systemPrompt: `You are a homeowner insurance specialist. Summarize property signals and coverage opportunities concisely. Output ONLY valid JSON.`,
  buildPrompt: (input: unknown) => {
    const h = input as HouseholdEntity;
    return `Summarize homeowner coverage opportunity for:
Address: ${h.primaryAddress}, ${h.county}
Home Value: $${h.estimatedHomeValue?.toLocaleString() ?? "unknown"}
Roof Age: ${h.roofAgeEstimate ?? "unknown"} years
Storm Exposure: ${h.stormExposureScore ?? 0}/100
Signals: ${(h.activeSignals ?? []).join(", ") || "none"}

Return JSON: summary (string), urgency (low/medium/high), recommendedAction (string).`;
  },
  outputValidator: (v: unknown): v is { summary: string; urgency: string; recommendedAction: string } =>
    isObj(v) && hasKeys(v, ["summary", "urgency", "recommendedAction"]),
  requiredAction: "read_data",
  maxRetries: 1,
};

export async function runHomeownerOpportunityAnalysis(
  household: HouseholdEntity,
  subAccountId?: number,
) {
  const result: any = await runAgent(homeownerOpportunityAgent as any, household, { subAccountId });
  return result.ok ? result.output ?? null : null;
}

// ── Agent 5: Auto Policy Opportunity ─────────────────────────────────────────

const autoPolicyAgent = {
  agentId: "insurance_auto_policy",
  displayName: "Auto Policy Opportunity Agent",
  model: "claude-haiku",
  systemPrompt: `You are an auto insurance placement specialist. Categorize risk and recommend placement approach. Output ONLY valid JSON.`,
  buildPrompt: (input: unknown) => {
    const h = input as HouseholdEntity;
    return `Analyze auto insurance opportunity:
Vehicles: ${h.vehicleCount ?? 0}
Crashes (12mo): ${h.crashCount12Mo ?? 0}
DUIs (36mo): ${h.duiCount36Mo ?? 0}
Teen Driver: ${h.hasTeenDriver ? "Yes" : "No"}
Signals: ${(h.activeSignals ?? []).join(", ") || "none"}

Return JSON: riskCategory (standard/preferred/high-risk/non-standard), placement (string), estimatedPremium (number), urgency (low/medium/high/immediate).`;
  },
  outputValidator: (v: unknown): v is { riskCategory: string; placement: string; estimatedPremium: number; urgency: string } =>
    isObj(v) && hasKeys(v, ["riskCategory", "placement", "estimatedPremium", "urgency"]),
  requiredAction: "read_data",
  maxRetries: 1,
};

export async function runAutoPolicyAnalysis(
  household: HouseholdEntity,
  subAccountId?: number,
) {
  const result: any = await runAgent(autoPolicyAgent as any, household, { subAccountId });
  return result.ok ? result.output ?? null : null;
}

// ── Agent 6: Bundling Recommendation ─────────────────────────────────────────

const bundlingAgent = {
  agentId: "insurance_bundling",
  displayName: "Insurance Bundling Recommendation Agent",
  model: "claude-haiku",
  systemPrompt: `You are an insurance bundling specialist. Identify cross-sell opportunities and estimate savings. Output ONLY valid JSON.`,
  buildPrompt: (input: unknown) => {
    const h = input as HouseholdEntity;
    return `Analyze bundling opportunity:
Homeowner: ${h.isHomeowner ? "Yes" : "No"}
Vehicles: ${h.vehicleCount ?? 0}
Business Owner: ${h.businessOwner ? "Yes" : "No"}
Estimated Home Value: $${h.estimatedHomeValue?.toLocaleString() ?? "unknown"}
Policy Opportunity Score: ${h.policyOpportunityScore ?? 0}/100

Return JSON: householdId, bundlingLines (array of line names), estimatedSavings (annual $), approachAngle (string).`;
  },
  outputValidator: (v: unknown): v is BundlingSummary =>
    isObj(v) && hasKeys(v, ["bundlingLines", "estimatedSavings", "approachAngle"]),
  requiredAction: "read_data",
  maxRetries: 1,
};

export async function runBundlingAnalysis(
  household: HouseholdEntity,
  subAccountId?: number,
): Promise<BundlingSummary | null> {
  const result: any = await runAgent(bundlingAgent as any, household, { subAccountId });
  return result.ok ? result.output ?? null : null;
}
