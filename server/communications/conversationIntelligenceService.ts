/**
 * server/communications/conversationIntelligenceService.ts
 *
 * Conversation Intelligence Engine
 *
 * Analyzes conversations to extract actionable signals.
 * Works across SMS threads, voice transcripts, and chat sessions.
 *
 * Outputs:
 *   - Sentiment (positive/neutral/negative/mixed)
 *   - Urgency (low/medium/high/critical)
 *   - Conversion likelihood (unlikely/possible/likely/very_likely)
 *   - Appointment likelihood score (0-100)
 *   - Escalation indicators
 *   - AI summary
 *   - Next step recommendation
 *   - Optimal follow-up timing
 *
 * Safety:
 *   - Intelligence is ADVISORY only — no automated decisions based on scores alone
 *   - Scores inform human operators, not replace them
 *   - PII is never stored in metadata fields
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { esc, num } from "../hpl/sqlSafe";
import { createHash } from "crypto";
import type { ConversationIntelligence, ConversationSentiment, ConversationUrgency, ConversionLikelihood } from "./types";
import { appendTimelineEvent } from "./communicationTimelineService";

// ── Keyword signal banks ──────────────────────────────────────────────────────

const POSITIVE_SIGNALS  = ["yes", "great", "perfect", "sounds good", "interested", "let's do it", "book", "schedule", "how much", "when can", "available", "definitely", "absolutely", "love to"];
const NEGATIVE_SIGNALS  = ["not interested", "stop", "no thanks", "don't call", "remove me", "unsubscribe", "wrong number", "already have", "don't need", "too expensive", "not now"];
const URGENT_SIGNALS    = ["asap", "urgent", "emergency", "immediately", "right away", "today", "as soon as possible", "can't wait", "need help now", "critical"];
const ESCALATION_SIGNALS = ["lawyer", "attorney", "sue", "complaint", "disgusting", "unacceptable", "ridiculous", "never again", "report", "bbb", "legal action", "threatening"];
const APPOINTMENT_SIGNALS = ["book", "schedule", "appointment", "when can i come in", "available", "opening", "slot", "time", "date", "next week", "tomorrow", "this week"];

// ── Scoring functions ─────────────────────────────────────────────────────────

export function analyzeSentiment(text: string): ConversationSentiment {
  const lower = text.toLowerCase();
  const pos = POSITIVE_SIGNALS.filter(s => lower.includes(s)).length;
  const neg = NEGATIVE_SIGNALS.filter(s => lower.includes(s)).length;
  if (pos > 0 && neg > 0) return "mixed";
  if (pos > neg) return "positive";
  if (neg > pos) return "negative";
  return "neutral";
}

export function analyzeUrgency(text: string): ConversationUrgency {
  const lower = text.toLowerCase();
  const urgentCount = URGENT_SIGNALS.filter(s => lower.includes(s)).length;
  const hasEscalation = ESCALATION_SIGNALS.some(s => lower.includes(s));
  if (hasEscalation) return "critical";
  if (urgentCount >= 2) return "high";
  if (urgentCount === 1) return "medium";
  return "low";
}

export function scoreConversionLikelihood(opts: {
  sentiment:  ConversationSentiment;
  urgency:    ConversationUrgency;
  messageCount: number;
  hasAskedPrice: boolean;
  hasAskedAvailability: boolean;
}): ConversionLikelihood {
  let score = 0;
  if (opts.sentiment === "positive") score += 3;
  if (opts.sentiment === "mixed")    score += 1;
  if (opts.urgency === "high")       score += 2;
  if (opts.urgency === "medium")     score += 1;
  if (opts.urgency === "critical")   score += 2;
  if (opts.hasAskedPrice)            score += 2;
  if (opts.hasAskedAvailability)     score += 2;
  if (opts.messageCount >= 3)        score += 1;
  if (score >= 7) return "very_likely";
  if (score >= 4) return "likely";
  if (score >= 2) return "possible";
  return "unlikely";
}

export function scoreAppointmentLikelihood(text: string, sentiment: ConversationSentiment): number {
  const lower = text.toLowerCase();
  let score = 0;
  const apptSignals = APPOINTMENT_SIGNALS.filter(s => lower.includes(s)).length;
  score += Math.min(apptSignals * 15, 60);
  if (sentiment === "positive") score += 20;
  if (sentiment === "mixed")    score += 5;
  if (lower.includes("book") || lower.includes("schedule")) score += 20;
  return Math.min(score, 100);
}

export function detectEscalationIndicators(text: string): string[] {
  const lower = text.toLowerCase();
  return ESCALATION_SIGNALS.filter(s => lower.includes(s));
}

// ── AI summary generation ─────────────────────────────────────────────────────

export function buildSummary(opts: {
  messages:    Array<{ role: string; content: string }>;
  sentiment:   ConversationSentiment;
  urgency:     ConversationUrgency;
  convLikelihood: ConversionLikelihood;
  escalationIndicators: string[];
}): string {
  const { messages, sentiment, urgency, convLikelihood, escalationIndicators } = opts;
  const msgCount = messages.length;
  const lastMsg  = messages[messages.length - 1]?.content?.slice(0, 100) ?? "";

  let summary = `${msgCount}-message conversation. Sentiment: ${sentiment}. Urgency: ${urgency}. Conversion: ${convLikelihood}.`;

  if (escalationIndicators.length > 0) {
    summary += ` ⚠ Escalation signals detected: ${escalationIndicators.slice(0, 3).join(", ")}.`;
  }

  if (lastMsg) {
    summary += ` Last message: "${lastMsg}${lastMsg.length >= 100 ? "…" : ""}"`;
  }

  return summary;
}

// ── Next step recommendation ──────────────────────────────────────────────────

export function recommendNextStep(opts: {
  sentiment:       ConversationSentiment;
  urgency:         ConversationUrgency;
  convLikelihood:  ConversionLikelihood;
  escalationIndicators: string[];
  appointmentLikelihood: number;
}): { action: string; timing: string } {
  const { sentiment, urgency, convLikelihood, escalationIndicators, appointmentLikelihood } = opts;

  if (escalationIndicators.length > 0) {
    return { action: "ESCALATE_TO_HUMAN — escalation signals detected, requires immediate human attention", timing: "immediately" };
  }

  if (urgency === "critical" || urgency === "high") {
    return { action: "Call back within 1 hour — high urgency detected", timing: "within_1h" };
  }

  if (convLikelihood === "very_likely" || appointmentLikelihood >= 70) {
    return { action: "Send booking link now and follow up with call if no response in 2h", timing: "now" };
  }

  if (convLikelihood === "likely") {
    return { action: "Send follow-up SMS with booking link in 2-4 hours", timing: "2_4h" };
  }

  if (sentiment === "negative") {
    return { action: "Do not contact again for 30 days — negative sentiment", timing: "30_days" };
  }

  if (convLikelihood === "possible") {
    return { action: "Follow up in 24-48 hours with soft check-in", timing: "24_48h" };
  }

  return { action: "Monitor — add to 7-day nurture sequence", timing: "7_days" };
}

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _comm_intelligence (
        id                        SERIAL PRIMARY KEY,
        communication_id          TEXT        NOT NULL UNIQUE,
        tenant_id                 TEXT        NOT NULL,
        sentiment                 TEXT        NOT NULL DEFAULT 'neutral',
        urgency                   TEXT        NOT NULL DEFAULT 'low',
        conversion_likelihood     TEXT        NOT NULL DEFAULT 'unlikely',
        appointment_likelihood    INTEGER     NOT NULL DEFAULT 0,
        escalation_indicators     TEXT[]      NOT NULL DEFAULT '{}',
        ai_summary                TEXT,
        next_step_action          TEXT,
        next_step_timing          TEXT,
        follow_up_at              TIMESTAMPTZ,
        analyzed_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS comm_intel_tenant_idx ON _comm_intelligence (tenant_id, analyzed_at DESC);
      CREATE INDEX IF NOT EXISTS comm_intel_urgency_idx ON _comm_intelligence (tenant_id, urgency, analyzed_at DESC);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[COMM-INTEL] Failed to ensure table:", err?.message);
  }
}

// ── Analyze conversation and store ────────────────────────────────────────────

export async function analyzeConversation(opts: {
  communicationId: string;
  tenantId:        string;
  messages:        Array<{ role: string; content: string }>;
}): Promise<ConversationIntelligence> {
  await ensureTable();

  const { communicationId, tenantId, messages } = opts;
  const fullText = messages.map(m => m.content).join(" ");

  const sentiment            = analyzeSentiment(fullText);
  const urgency              = analyzeUrgency(fullText);
  const escalationIndicators = detectEscalationIndicators(fullText);
  const hasAskedPrice        = /\b(price|cost|how much|fee|rate|charge)\b/i.test(fullText);
  const hasAskedAvailability = /\b(available|availability|open|slot|when can|timing)\b/i.test(fullText);
  const appointmentLikelihood = scoreAppointmentLikelihood(fullText, sentiment);
  const conversionLikelihood  = scoreConversionLikelihood({
    sentiment, urgency, messageCount: messages.length, hasAskedPrice, hasAskedAvailability,
  });

  const summary  = buildSummary({ messages, sentiment, urgency, convLikelihood: conversionLikelihood, escalationIndicators });
  const nextStep = recommendNextStep({ sentiment, urgency, convLikelihood: conversionLikelihood, escalationIndicators, appointmentLikelihood });

  // Compute follow-up timestamp
  const timingMap: Record<string, number> = {
    immediately: 0, within_1h: 60, now: 15, "2_4h": 120,
    "24_48h": 24 * 60, "7_days": 7 * 24 * 60, "30_days": 30 * 24 * 60,
  };
  const delayMins   = timingMap[nextStep.timing] ?? 0;
  const followUpAt  = delayMins > 0 ? new Date(Date.now() + delayMins * 60_000).toISOString() : undefined;

  // Persist
  try {
    const escsArr = escalationIndicators.length > 0
      ? `ARRAY[${escalationIndicators.map(s => esc(s)).join(",")}]`
      : "ARRAY[]::TEXT[]";

    await db.execute(sql.raw(`
      INSERT INTO _comm_intelligence
        (communication_id, tenant_id, sentiment, urgency, conversion_likelihood,
         appointment_likelihood, escalation_indicators, ai_summary,
         next_step_action, next_step_timing, follow_up_at, analyzed_at)
      VALUES
        (${esc(communicationId)}, ${esc(tenantId)}, ${esc(sentiment)}, ${esc(urgency)},
         ${esc(conversionLikelihood)}, ${num(appointmentLikelihood)}, ${escsArr},
         ${esc(summary)}, ${esc(nextStep.action)}, ${esc(nextStep.timing)},
         ${followUpAt ? esc(followUpAt) : "NULL"}, NOW())
      ON CONFLICT (communication_id) DO UPDATE SET
        sentiment              = EXCLUDED.sentiment,
        urgency                = EXCLUDED.urgency,
        conversion_likelihood  = EXCLUDED.conversion_likelihood,
        appointment_likelihood = EXCLUDED.appointment_likelihood,
        escalation_indicators  = EXCLUDED.escalation_indicators,
        ai_summary             = EXCLUDED.ai_summary,
        next_step_action       = EXCLUDED.next_step_action,
        next_step_timing       = EXCLUDED.next_step_timing,
        follow_up_at           = EXCLUDED.follow_up_at,
        analyzed_at            = NOW()
    `));
  } catch (err: any) {
    console.error("[COMM-INTEL] Persist failed:", err?.message);
  }

  if (escalationIndicators.length > 0) {
    await appendTimelineEvent({
      communicationId, tenantId,
      eventType:   "escalation_triggered",
      actor:       "ai",
      description: `Escalation signals detected: ${escalationIndicators.slice(0, 3).join(", ")}`,
      metadata:    { escalationIndicators },
    });
  }

  await appendTimelineEvent({
    communicationId, tenantId,
    eventType:   "ai_summary_generated",
    actor:       "ai",
    description: `Intelligence analysis complete: ${sentiment} sentiment, ${urgency} urgency, ${conversionLikelihood} conversion`,
    metadata:    { sentiment, urgency, conversionLikelihood, appointmentLikelihood },
  });

  console.log(`[COMM-INTEL] Analyzed ${communicationId}: sentiment=${sentiment} urgency=${urgency} conv=${conversionLikelihood}`);

  return {
    communicationId, tenantId, sentiment, urgency, conversionLikelihood,
    appointmentLikelihood, escalationIndicators, aiSummary: summary,
    nextStepRecommendation: nextStep.action, followUpAt,
    createdAt: new Date().toISOString(),
  };
}

// ── Get intelligence for communication ───────────────────────────────────────

export async function getConversationIntelligence(communicationId: string, tenantId: string): Promise<ConversationIntelligence | null> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _comm_intelligence
      WHERE communication_id = ${esc(communicationId)} AND tenant_id = ${esc(tenantId)}
    `));
    const rows = (result as any).rows ?? result;
    const r = Array.isArray(rows) ? rows[0] : null;
    if (!r) return null;
    return {
      communicationId: r.communication_id,
      tenantId:        r.tenant_id,
      sentiment:       r.sentiment as ConversationSentiment,
      urgency:         r.urgency as ConversationUrgency,
      conversionLikelihood: r.conversion_likelihood as ConversionLikelihood,
      appointmentLikelihood: Number(r.appointment_likelihood),
      escalationIndicators:  r.escalation_indicators ?? [],
      aiSummary:             r.ai_summary || undefined,
      nextStepRecommendation: r.next_step_action || undefined,
      followUpAt:            r.follow_up_at?.toISOString?.() ?? undefined,
      createdAt:             r.analyzed_at?.toISOString?.() ?? undefined,
    };
  } catch { return null; }  // allow-silent-catch: non-fatal, returns safe default
}

// ── Pending follow-ups ────────────────────────────────────────────────────────

export async function getPendingFollowUps(tenantId: string, limit = 30): Promise<ConversationIntelligence[]> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT * FROM _comm_intelligence
      WHERE tenant_id = ${esc(tenantId)}
        AND follow_up_at IS NOT NULL
        AND follow_up_at <= NOW() + INTERVAL '1 hour'
        AND follow_up_at >= NOW() - INTERVAL '24 hours'
      ORDER BY follow_up_at ASC
      LIMIT ${num(limit)}
    `));
    return ((result as any).rows ?? result ?? []).map((r: any): ConversationIntelligence => ({
      communicationId:      r.communication_id,
      tenantId:             r.tenant_id,
      sentiment:            r.sentiment as ConversationSentiment,
      urgency:              r.urgency as ConversationUrgency,
      conversionLikelihood: r.conversion_likelihood as ConversionLikelihood,
      appointmentLikelihood: Number(r.appointment_likelihood),
      escalationIndicators: r.escalation_indicators ?? [],
      aiSummary:            r.ai_summary || undefined,
      nextStepRecommendation: r.next_step_action || undefined,
      followUpAt:           r.follow_up_at?.toISOString?.() ?? undefined,
    }));
  } catch { return []; }  // allow-silent-catch: non-fatal, returns safe default
}

// ── Intelligence stats ────────────────────────────────────────────────────────

export async function getIntelligenceStats(tenantId: string): Promise<{
  totalAnalyzed:   number;
  highUrgency:     number;
  veryLikely:      number;
  escalations:     number;
  pendingFollowUp: number;
}> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN urgency IN ('high','critical') THEN 1 END) AS high_urgency,
        COUNT(CASE WHEN conversion_likelihood = 'very_likely' THEN 1 END) AS very_likely,
        COUNT(CASE WHEN array_length(escalation_indicators, 1) > 0 THEN 1 END) AS escalations,
        COUNT(CASE WHEN follow_up_at IS NOT NULL AND follow_up_at >= NOW() THEN 1 END) AS pending_followup
      FROM _comm_intelligence
      WHERE tenant_id = ${esc(tenantId)}
        AND analyzed_at >= NOW() - INTERVAL '30 days'
    `));
    const rows = (result as any).rows ?? result;
    const r = Array.isArray(rows) ? rows[0] : {};
    return {
      totalAnalyzed:   Number(r?.total ?? 0),
      highUrgency:     Number(r?.high_urgency ?? 0),
      veryLikely:      Number(r?.very_likely ?? 0),
      escalations:     Number(r?.escalations ?? 0),
      pendingFollowUp: Number(r?.pending_followup ?? 0),
    };
  } catch {  // allow-silent-catch: non-fatal, returns safe default
    return { totalAnalyzed: 0, highUrgency: 0, veryLikely: 0, escalations: 0, pendingFollowUp: 0 };
  }
}
