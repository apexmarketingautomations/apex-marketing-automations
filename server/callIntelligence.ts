import { db } from "./db";
import { vapiCallLogs } from "@shared/schema";
import { eq, isNotNull, sql, desc } from "drizzle-orm";
import { aiChat, isAIConfigured } from "./aiGateway";
import { vapiConfig } from "./routes/helpers";
import { emitCallAnalyzed, emitCallPatternsInjected } from "./intelligence/apexLearningFeed";

const OUTBOUND_SPECIALIST_ID = "e30434f7-e7e0-4be7-8b89-40c384a52b4a";
const AUTO_INJECT_EVERY_N_CALLS = 5;
const DAILY_INJECT_INTERVAL_MS = 24 * 60 * 60 * 1000;
let lastInjectionCallCount = 0;
let dailyTimer: ReturnType<typeof setInterval> | null = null;

export function startAutoLearningLoop(): void {
  if (dailyTimer) return;

  dailyTimer = setInterval(async () => {
    try {
      console.log("[CALL-INTEL] Daily auto-learning cycle starting...");
      const analyzed = await analyzeAllUnprocessed();
      if (analyzed > 0) {
        console.log(`[CALL-INTEL] Daily cycle analyzed ${analyzed} new calls`);
      }
      const result = await injectPatternsIntoAgent(OUTBOUND_SPECIALIST_ID);
      if (result.success) {
        console.log(`[CALL-INTEL] Daily prompt refresh complete`);
      }
    } catch (err: any) {
      console.error("[CALL-INTEL] Daily auto-learning failed:", err?.message);
    }
  }, DAILY_INJECT_INTERVAL_MS);

  console.log("[CALL-INTEL] Auto-learning loop started — daily refresh + every 5 new calls");
}

export async function onCallAnalyzed(): Promise<void> {
  try {
    const totalAnalyzed = await db.select({ count: sql<number>`count(*)` })
      .from(vapiCallLogs)
      .where(isNotNull(vapiCallLogs.analysis));
    const count = Number(totalAnalyzed[0]?.count || 0);

    if (count > 0 && count - lastInjectionCallCount >= AUTO_INJECT_EVERY_N_CALLS) {
      console.log(`[CALL-INTEL] ${AUTO_INJECT_EVERY_N_CALLS} new calls analyzed since last injection (${lastInjectionCallCount} → ${count}), refreshing agent prompt...`);
      const result = await injectPatternsIntoAgent(OUTBOUND_SPECIALIST_ID);
      if (result.success) {
        lastInjectionCallCount = count;
        console.log(`[CALL-INTEL] Auto-injected patterns from ${count} total calls`);
      }
    }
  } catch (err: any) {
    console.error("[CALL-INTEL] Auto-injection check failed:", err?.message);
  }
}

export interface CallAnalysis {
  outcome: "booked" | "rejected" | "maybe" | "timeout" | "no_answer" | "unknown";
  engagement_score: number;
  prospect_type: string;
  prospect_industry: string;
  main_pain_points: string[];
  objections: { objection: string; agent_response: string; effective: boolean }[];
  key_moments: { quote: string; type: "interest_spike" | "interest_drop" | "buying_signal" | "objection" | "close_attempt" }[];
  what_worked: string[];
  what_failed: string[];
  agent_score: number;
  best_line: string;
  conversion_blockers: string[];
}

export interface PatternReport {
  total_calls_analyzed: number;
  conversion_rate: number;
  avg_engagement: number;
  avg_agent_score: number;
  top_objections: { objection: string; count: number; best_response: string; success_rate: number }[];
  best_opening_approaches: { approach: string; avg_engagement: number; count: number }[];
  patterns_by_prospect_type: { type: string; count: number; conversion_rate: number; avg_engagement: number }[];
  what_works_most: { tactic: string; frequency: number }[];
  what_fails_most: { tactic: string; frequency: number }[];
  top_pain_points: { pain: string; count: number }[];
  best_lines: string[];
  generated_at: string;
}

const ANALYSIS_PROMPT = `You are a sales call analyst. Analyze this cold call transcript and return a JSON object with EXACTLY this structure. Be brutally honest.

{
  "outcome": "booked" or "rejected" or "maybe" or "timeout" or "no_answer" or "unknown",
  "engagement_score": 1-10 (1=hung up immediately, 10=enthusiastically booked),
  "prospect_type": one of: "busy", "curious", "skeptical", "hostile", "friendly", "indifferent", "interested", "tire_kicker",
  "prospect_industry": best guess of their industry based on conversation,
  "main_pain_points": ["array of specific pain points they mentioned or revealed"],
  "objections": [{"objection": "what they said", "agent_response": "how the agent responded", "effective": true/false}],
  "key_moments": [{"quote": "exact or paraphrased quote", "type": "interest_spike" or "interest_drop" or "buying_signal" or "objection" or "close_attempt"}],
  "what_worked": ["specific things the agent said or did that moved the conversation forward"],
  "what_failed": ["specific things the agent said or did that stalled or hurt the conversation"],
  "agent_score": 1-10 (1=terrible, 10=masterful closer),
  "best_line": "the single most effective thing the agent said in this call",
  "conversion_blockers": ["specific reasons this call did not convert, if applicable"]
}

Rules:
- If the transcript is empty or too short to analyze, set outcome to "no_answer" and scores to 0.
- Be specific in what_worked and what_failed — quote or paraphrase actual lines.
- For objections, include EVERY objection raised, not just major ones.
- engagement_score should reflect how long they stayed, how much they talked, and whether they asked questions.
- agent_score should reflect how well the agent handled objections, controlled the conversation, and moved toward the close.
- Return ONLY valid JSON, no markdown, no explanation.`;

export async function analyzeCallTranscript(callId: number): Promise<CallAnalysis | null> {
  if (!isAIConfigured()) {
    console.log("[CALL-INTEL] AI unavailable, skipping analysis");
    return null;
  }

  const rows = await db.select().from(vapiCallLogs).where(eq(vapiCallLogs.id, callId)).limit(1);
  if (rows.length === 0) return null;

  const call = rows[0];
  if (!call.transcript || call.transcript.length < 20) {
    const emptyAnalysis: CallAnalysis = {
      outcome: "no_answer", engagement_score: 0, prospect_type: "unknown", prospect_industry: "unknown",
      main_pain_points: [], objections: [], key_moments: [], what_worked: [], what_failed: [],
      agent_score: 0, best_line: "", conversion_blockers: ["No meaningful conversation occurred"],
    };
    await db.update(vapiCallLogs).set({ analysis: emptyAnalysis }).where(eq(vapiCallLogs.id, callId));
    return emptyAnalysis;
  }

  try {
    console.log(`[CALL-INTEL] Sending call ${callId} (${call.transcript.length} chars) to AI gateway...`);
    const callAiResult = await aiChat([
      { role: "system", content: ANALYSIS_PROMPT },
      { role: "user", content: `TRANSCRIPT:\n${call.transcript}\n\nENDED REASON: ${call.endedReason || "unknown"}\nDURATION: ${call.duration || 0} seconds\nSUMMARY: ${call.summary || "none"}` },
    ], { temperature: 0.2, maxTokens: 8192, jsonMode: true, route: "call-intel-analysis" });
    const result = callAiResult.text;

    console.log(`[CALL-INTEL] AI response for call ${callId}: ${result.length} chars`);

    if (!result || result.trim().length === 0) {
      console.error(`[CALL-INTEL] Empty response from AI for call ${callId}`);
      return null;
    }

    let analysis: CallAnalysis;
    const parseJson = (s: string): CallAnalysis => {
      s = s.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      try { return JSON.parse(s); } catch (err) { console.warn("[CALLINTELLIGENCE] caught:", err instanceof Error ? err.message : err); }
      const m = s.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("No JSON object found in response");
      let fixed = m[0]
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/[\x00-\x1f]/g, " ")
        .replace(/(["\w])\s*\n\s*"/g, '$1, "')
        .replace(/"([^"]*)":\s*"([^"]*)"([^,}\]"\s])/g, '"$1": "$2"$3');
      try { return JSON.parse(fixed); } catch (err) { console.warn("[CALLINTELLIGENCE] caught:", err instanceof Error ? err.message : err); }
      fixed = fixed.replace(/:\s*"([^"]*)$/gm, ': "$1"');
      if (!fixed.endsWith("}")) fixed += '"}]}';
      return JSON.parse(fixed);
    };
    try {
      analysis = parseJson(result);
    } catch (parseErr) {
      console.error(`[CALL-INTEL] JSON parse error for call ${callId}: ${parseErr}`);
      console.error(`[CALL-INTEL] Raw response tail (last 300 chars): ${result.slice(-300)}`);
      return null;
    }

    await db.update(vapiCallLogs).set({ analysis }).where(eq(vapiCallLogs.id, callId));
    emitCallAnalyzed(call.subAccountId || 0, callId, analysis.outcome, analysis.engagement_score, analysis.agent_score);
    console.log(`[CALL-INTEL] Analyzed call ${callId}: outcome=${analysis.outcome}, engagement=${analysis.engagement_score}, agent=${analysis.agent_score}`);

    // Report to Apex Intelligence brain (fire-and-forget)
    import("./operator/apexIntelligence").then(({ reportOutcome }) => reportOutcome({
      agentName:    "call-intelligence",
      action:       "call_analyzed",
      subject:      `call-${callId}`,
      result:       `Call analyzed — outcome: ${analysis.outcome}, engagement: ${analysis.engagement_score}/10, agent score: ${analysis.agent_score}/10`,
      confidence:   0.75,
      subAccountId: call.subAccountId || parseInt(process.env.APEX_PARENT_ACCOUNT_ID || "3"),
      metadata: {
        callId,
        outcome:         analysis.outcome,
        engagementScore: analysis.engagement_score,
        agentScore:      analysis.agent_score,
        prospectType:    analysis.prospect_type,
      },
    // allow-silent-catch: fire-and-forget telemetry
    })).catch(() => {});

    return analysis;
  } catch (err) {
    console.error(`[CALL-INTEL] Analysis failed for call ${callId}:`, err?.message ?? err, err?.stack);
    return null;
  }
}

export async function analyzeAllUnprocessed(): Promise<number> {
  const unprocessed = await db.select({ id: vapiCallLogs.id })
    .from(vapiCallLogs)
    .where(sql`${vapiCallLogs.analysis} IS NULL AND ${vapiCallLogs.transcript} IS NOT NULL AND length(${vapiCallLogs.transcript}) > 20`);

  let analyzed = 0;
  for (const row of unprocessed) {
    const result = await analyzeCallTranscript(row.id);
    if (result) analyzed++;
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log(`[CALL-INTEL] Batch analysis complete: ${analyzed}/${unprocessed.length} calls processed`);
  return analyzed;
}

export async function generatePatternReport(): Promise<PatternReport> {
  const allCalls = await db.select().from(vapiCallLogs)
    .where(isNotNull(vapiCallLogs.analysis));

  if (allCalls.length === 0) {
    return {
      total_calls_analyzed: 0, conversion_rate: 0, avg_engagement: 0, avg_agent_score: 0,
      top_objections: [], best_opening_approaches: [], patterns_by_prospect_type: [],
      what_works_most: [], what_fails_most: [], top_pain_points: [], best_lines: [],
      generated_at: new Date().toISOString(),
    };
  }

  const analyses = allCalls
    .map(c => c.analysis as CallAnalysis | null)
    .filter((a): a is CallAnalysis => a !== null && a.outcome !== "no_answer");

  if (analyses.length === 0) {
    return {
      total_calls_analyzed: 0, conversion_rate: 0, avg_engagement: 0, avg_agent_score: 0,
      top_objections: [], best_opening_approaches: [], patterns_by_prospect_type: [],
      what_works_most: [], what_fails_most: [], top_pain_points: [], best_lines: [],
      generated_at: new Date().toISOString(),
    };
  }

  const booked = analyses.filter(a => a.outcome === "booked").length;
  const conversionRate = analyses.length > 0 ? Math.round((booked / analyses.length) * 100) : 0;
  const avgEngagement = Math.round((analyses.reduce((s, a) => s + a.engagement_score, 0) / analyses.length) * 10) / 10;
  const avgAgentScore = Math.round((analyses.reduce((s, a) => s + a.agent_score, 0) / analyses.length) * 10) / 10;

  const objectionMap = new Map<string, { count: number; responses: { response: string; effective: boolean }[] }>();
  for (const a of analyses) {
    for (const obj of a.objections) {
      const key = obj.objection.toLowerCase().substring(0, 80);
      const entry = objectionMap.get(key) || { count: 0, responses: [] };
      entry.count++;
      entry.responses.push({ response: obj.agent_response, effective: obj.effective });
      objectionMap.set(key, entry);
    }
  }

  const topObjections = Array.from(objectionMap.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([objection, data]) => {
      const effective = data.responses.filter(r => r.effective);
      const bestResponse = effective.length > 0 ? effective[0].response : data.responses[0]?.response || "";
      const successRate = data.responses.length > 0 ? Math.round((effective.length / data.responses.length) * 100) : 0;
      return { objection, count: data.count, best_response: bestResponse, success_rate: successRate };
    });

  const prospectTypeMap = new Map<string, { count: number; booked: number; engagements: number[] }>();
  for (const a of analyses) {
    const t = a.prospect_type;
    const entry = prospectTypeMap.get(t) || { count: 0, booked: 0, engagements: [] };
    entry.count++;
    if (a.outcome === "booked") entry.booked++;
    entry.engagements.push(a.engagement_score);
    prospectTypeMap.set(t, entry);
  }

  const patternsByType = Array.from(prospectTypeMap.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .map(([type, data]) => ({
      type, count: data.count,
      conversion_rate: Math.round((data.booked / data.count) * 100),
      avg_engagement: Math.round((data.engagements.reduce((s, e) => s + e, 0) / data.engagements.length) * 10) / 10,
    }));

  const worksFreq = new Map<string, number>();
  const failsFreq = new Map<string, number>();
  const painFreq = new Map<string, number>();

  for (const a of analyses) {
    for (const w of a.what_worked) { worksFreq.set(w, (worksFreq.get(w) || 0) + 1); }
    for (const f of a.what_failed) { failsFreq.set(f, (failsFreq.get(f) || 0) + 1); }
    for (const p of a.main_pain_points) { painFreq.set(p, (painFreq.get(p) || 0) + 1); }
  }

  const whatWorksMost = Array.from(worksFreq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tactic, frequency]) => ({ tactic, frequency }));
  const whatFailsMost = Array.from(failsFreq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tactic, frequency]) => ({ tactic, frequency }));
  const topPainPoints = Array.from(painFreq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([pain, count]) => ({ pain, count }));

  const bestLines = analyses
    .filter(a => a.engagement_score >= 7 && a.best_line)
    .sort((a, b) => b.engagement_score - a.engagement_score)
    .slice(0, 10)
    .map(a => a.best_line);

  const highEngagement = analyses.filter(a => a.engagement_score >= 7);
  const openingApproaches: { approach: string; avg_engagement: number; count: number }[] = [];
  if (highEngagement.length > 0) {
    const keyMomentApproaches = new Map<string, number[]>();
    for (const a of analyses) {
      const firstMoment = a.key_moments.find(m => m.type === "interest_spike");
      if (firstMoment) {
        const key = firstMoment.quote.substring(0, 100);
        const scores = keyMomentApproaches.get(key) || [];
        scores.push(a.engagement_score);
        keyMomentApproaches.set(key, scores);
      }
    }
    for (const [approach, scores] of keyMomentApproaches) {
      openingApproaches.push({
        approach,
        avg_engagement: Math.round((scores.reduce((s, e) => s + e, 0) / scores.length) * 10) / 10,
        count: scores.length,
      });
    }
    openingApproaches.sort((a, b) => b.avg_engagement - a.avg_engagement);
  }

  return {
    total_calls_analyzed: analyses.length,
    conversion_rate: conversionRate,
    avg_engagement: avgEngagement,
    avg_agent_score: avgAgentScore,
    top_objections: topObjections,
    best_opening_approaches: openingApproaches.slice(0, 5),
    patterns_by_prospect_type: patternsByType,
    what_works_most: whatWorksMost,
    what_fails_most: whatFailsMost,
    top_pain_points: topPainPoints,
    best_lines: bestLines,
    generated_at: new Date().toISOString(),
  };
}

export async function generatePromptEnrichment(report: PatternReport): Promise<string> {
  if (report.total_calls_analyzed === 0) return "";

  let enrichment = `\n\nCALL INTELLIGENCE — LEARNED FROM ${report.total_calls_analyzed} REAL CALLS:\n`;
  enrichment += `Current conversion rate: ${report.conversion_rate}%. Average engagement: ${report.avg_engagement}/10.\n`;

  if (report.top_objections.length > 0) {
    enrichment += `\nTOP OBJECTIONS AND PROVEN RESPONSES:\n`;
    for (const obj of report.top_objections.slice(0, 5)) {
      enrichment += `- When they say "${obj.objection}" (comes up ${obj.count} times, ${obj.success_rate}% overcome rate):\n`;
      enrichment += `  Best response: "${obj.best_response}"\n`;
    }
  }

  if (report.best_lines.length > 0) {
    enrichment += `\nLINES THAT ACTUALLY WORK (from high-engagement calls):\n`;
    for (const line of report.best_lines.slice(0, 5)) {
      enrichment += `- "${line}"\n`;
    }
  }

  if (report.what_works_most.length > 0) {
    enrichment += `\nTACTICS THAT CONSISTENTLY WORK:\n`;
    for (const w of report.what_works_most.slice(0, 5)) {
      enrichment += `- ${w.tactic} (worked ${w.frequency} times)\n`;
    }
  }

  if (report.what_fails_most.length > 0) {
    enrichment += `\nAVOID THESE — THEY CONSISTENTLY FAIL:\n`;
    for (const f of report.what_fails_most.slice(0, 5)) {
      enrichment += `- ${f.tactic} (failed ${f.frequency} times)\n`;
    }
  }

  if (report.top_pain_points.length > 0) {
    enrichment += `\nMOST COMMON PAIN POINTS (hit these early):\n`;
    for (const p of report.top_pain_points.slice(0, 5)) {
      enrichment += `- ${p.pain} (mentioned ${p.count} times)\n`;
    }
  }

  if (report.patterns_by_prospect_type.length > 0) {
    enrichment += `\nWHAT WORKS BY PROSPECT TYPE:\n`;
    for (const pt of report.patterns_by_prospect_type) {
      enrichment += `- ${pt.type}: ${pt.count} calls, ${pt.conversion_rate}% conversion, avg engagement ${pt.avg_engagement}/10\n`;
    }
  }

  return enrichment;
}

export async function injectPatternsIntoAgent(assistantId: string): Promise<{ success: boolean; promptPreview: string }> {
  if (!vapiConfig.isConfigured) {
    return { success: false, promptPreview: "Vapi not configured" };
  }

  const resp = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
    headers: vapiConfig.privateHeaders(),
  });
  if (!resp.ok) {
    return { success: false, promptPreview: "Failed to fetch assistant" };
  }

  const assistant: any = await resp.json();
  const currentPrompt: string = assistant.model?.messages?.[0]?.content || "";

  const basePrompt = currentPrompt.replace(/\n\nCALL INTELLIGENCE — LEARNED FROM[\s\S]*$/, "").trimEnd();

  const report = await generatePatternReport();
  const enrichment = await generatePromptEnrichment(report);

  if (!enrichment) {
    return { success: false, promptPreview: "No analyzed calls to learn from yet" };
  }

  const newPrompt = basePrompt + enrichment;

  const updateResp = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
    method: "PATCH",
    headers: vapiConfig.privateHeaders(),
    body: JSON.stringify({
      model: {
        ...assistant.model,
        messages: [{ role: "system", content: newPrompt }],
      },
    }),
  });

  if (!updateResp.ok) {
    return { success: false, promptPreview: "Failed to update assistant prompt" };
  }

  emitCallPatternsInjected(report.total_calls_analyzed, report.conversion_rate, report.avg_engagement);
  console.log(`[CALL-INTEL] Injected patterns from ${report.total_calls_analyzed} calls into assistant ${assistantId}`);
  return { success: true, promptPreview: newPrompt.slice(-1500) };
}
