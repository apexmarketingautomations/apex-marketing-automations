export interface AgentOutcome {
  agentName: string;
  action: string;
  subject: string;
  result: string;
  confidence: number;
  subAccountId: number;
  niche?: string;
  scope?: "account";
  metadata?: Record<string, any>;
  timestamp?: string;
}

interface StoredOutcome extends AgentOutcome {
  id: number;
  timestamp: string;
}

const ALLOWED_AGENTS = new Set([
  "sentinel", "crash-ingest", "layla", "task-agent", "operator",
  "http-api", "background-worker", "home-service-pipeline",
  // Legal / arrest pipelines
  "arrest-ingest", "jail-booking-pipeline", "legal-pipeline",
  "court-filing-pipeline", "apex-engine",
  // Hillsborough County bulk data pipelines
  "hillsborough-records",   // lis pendens + judgments (Official Records D/P files)
  "hillsborough-filings",   // divorce/custody/probate/criminal (daily court filing CSVs)
  // Bankruptcy
  "courtlistener-pipeline",
  // Home service pipelines
  "home-service-scorer",    // homeServiceLeadScorer.ts
  "home-service-delivery",  // homeServiceLeadDelivery.ts
  // Crash report pipelines
  "crash-report-worker",    // crashReportWorker.ts
  // Skip trace / enrichment
  "retro-skip-trace",       // retroSkipTrace.ts
  // Call & case intelligence
  "call-intelligence",      // callIntelligence.ts
  "case-intelligence",      // caseIntelligence.ts
  "call-request-flow",      // callRequestFlow.ts
  // Meta / social pipelines
  "meta-campaign-sync",     // metaCampaignSync.ts
  // Attorney data
  "apify-attorney-scraper", // apifyAttorneyScraper.ts
  // Comment & content bots
  "reengage-bot",           // services/commentBot/reengageJob.ts
  "comment-bot",            // services/commentBot/commentHandler.ts
  "content-publisher",      // services/contentPlanner/schedulerWorker.ts
  // Intelligence scoring
  "scoring-worker",         // intelligence/worker.ts
  // Repo / platform maintenance loop
  "mega-cycle",             // intelligence/megaCycle*.ts
  // Calendar sync
  "gcal-sync",              // googleCalendarSync.ts
]);
const MAX_BUFFER = 2000;
const MAX_METADATA_KEYS = 10;
const MAX_STRING_LEN = 500;
const DEDUP_WINDOW_MS = 2000;
let nextId = 1;
const outcomeBuffer: StoredOutcome[] = [];
let lastOutcomeKey = "";
let lastOutcomeTs = 0;

/**
 * HONEST REPORTING: log every discarded payload so silent drops are visible
 * in observability. The buffer remains the fast in-memory cache; we mirror
 * accepted outcomes into `universal_events` (eventType="agent.outcome") for
 * durability across restarts.
 */
function logDiscard(reason: string, payload: any): void {
  try {
    const safe = {
      reason,
      agent: typeof payload?.agentName === "string" ? payload.agentName.slice(0, 50) : null,
      action: typeof payload?.action === "string" ? payload.action.slice(0, 50) : null,
      subAccountId: typeof payload?.subAccountId === "number" ? payload.subAccountId : null,
    };
    console.warn(`[APEX-OUTCOME] discarded: ${JSON.stringify(safe)}`);
  } catch (err) { console.warn("[APEXINTELLIGENCE] caught:", err instanceof Error ? err.message : err); }
}

async function persistOutcomeDurably(entry: StoredOutcome): Promise<void> {
  try {
    const { db } = await import("../db");
    const { universalEvents, subAccounts } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    // Validate subAccountId before insert to avoid FK violations
    if (entry.subAccountId) {
      const [acct] = await db.select({ id: subAccounts.id }).from(subAccounts)
        .where(eq(subAccounts.id, entry.subAccountId)).limit(1);
      if (!acct) {
        console.warn(`[APEX-OUTCOME] skipping invalid subAccountId=${entry.subAccountId}`);
        return;
      }
    }
    await db.insert(universalEvents).values({
      eventType: "agent.outcome",
      sourceModule: "apex-intelligence",
      sourceTable: "agent_outcomes_buffer",
      sourceRecordId: String(entry.id),
      subAccountId: entry.subAccountId,
      metadata: {
        agentName: entry.agentName,
        action: entry.action,
        subject: entry.subject,
        result: entry.result,
        confidence: entry.confidence,
        niche: entry.niche,
        ...(entry.metadata || {}),
      },
      occurredAt: new Date(entry.timestamp),
    });
  } catch (err: any) {
    console.warn(`[APEX-OUTCOME] durable persist failed (memory buffer still has it): ${err?.message?.substring(0, 200)}`);
  }
}

function truncStr(s: string, max = MAX_STRING_LEN): string {
  return typeof s === "string" ? s.slice(0, max) : "";
}

function sanitizeMetadata(meta: Record<string, any> | undefined): Record<string, any> | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const keys = Object.keys(meta).slice(0, MAX_METADATA_KEYS);
  const out: Record<string, any> = {};
  for (const k of keys) {
    const v = meta[k];
    if (typeof v === "string") out[k] = v.slice(0, MAX_STRING_LEN);
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
  }
  return out;
}

export function reportOutcome(payload: AgentOutcome): void {
  if (!payload) {
    logDiscard("null_payload", payload);
    return;
  }
  if (typeof payload.agentName !== "string" || !payload.agentName) {
    logDiscard("invalid_agentName", payload);
    return;
  }
  if (typeof payload.action !== "string" || !payload.action) {
    logDiscard("invalid_action", payload);
    return;
  }
  if (typeof payload.subject !== "string" || !payload.subject) {
    logDiscard("invalid_subject", payload);
    return;
  }
  if (typeof payload.result !== "string" || !payload.result) {
    logDiscard("invalid_result", payload);
    return;
  }
  if (typeof payload.confidence !== "number" || isNaN(payload.confidence)) {
    logDiscard("invalid_confidence", payload);
    return;
  }
  if (typeof payload.subAccountId !== "number" || !Number.isInteger(payload.subAccountId) || payload.subAccountId <= 0) {
    logDiscard("invalid_subAccountId", payload);
    return;
  }
  if (!ALLOWED_AGENTS.has(payload.agentName)) {
    logDiscard(`unauthorized_agent:${payload.agentName}`, payload);
    return;
  }

  const entityId = payload.metadata?.incidentId ?? payload.metadata?.reportId ?? payload.metadata?.conversationId ?? "";
  const dedupKey = `${payload.agentName}:${payload.action}:${payload.subject}:${payload.subAccountId}:${entityId}`;
  const now = Date.now();
  if (dedupKey === lastOutcomeKey && now - lastOutcomeTs < DEDUP_WINDOW_MS) {
    return; // intentional dedupe — not a discard
  }
  lastOutcomeKey = dedupKey;
  lastOutcomeTs = now;

  const entry: StoredOutcome = {
    agentName: truncStr(payload.agentName, 50),
    action: truncStr(payload.action, 100),
    subject: truncStr(payload.subject, 200),
    result: truncStr(payload.result, MAX_STRING_LEN),
    confidence: Math.max(0, Math.min(1, payload.confidence)),
    subAccountId: payload.subAccountId,
    niche: payload.niche ? truncStr(payload.niche, 50) : undefined,
    scope: "account",
    metadata: sanitizeMetadata(payload.metadata),
    id: nextId++,
    timestamp: payload.timestamp ?? new Date().toISOString(),
  };

  outcomeBuffer.push(entry);
  if (outcomeBuffer.length > MAX_BUFFER) {
    outcomeBuffer.splice(0, outcomeBuffer.length - MAX_BUFFER);
  }

  // Mirror to durable storage (fire-and-forget — DB failure does not block reporting).
  persistOutcomeDurably(entry).catch((err) => console.warn("[APEXINTELLIGENCE] promise rejected:", err instanceof Error ? err.message : err));
}

export function getOutcomes(opts: {
  subAccountId: number;
  agentName?: string;
  limit?: number;
  since?: string;
}): StoredOutcome[] {
  let results = outcomeBuffer.filter(o => o.subAccountId === opts.subAccountId);

  if (opts.agentName) {
    results = results.filter(o => o.agentName === opts.agentName);
  }
  if (opts.since) {
    const sinceDate = new Date(opts.since).getTime();
    if (!isNaN(sinceDate)) {
      results = results.filter(o => new Date(o.timestamp).getTime() >= sinceDate);
    }
  }

  results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  return results.slice(0, limit);
}

export function getOutcomeSummary(subAccountId: number): {
  total: number;
  byAgent: Record<string, number>;
  avgConfidence: number;
  todayCount: number;
} {
  const entries = outcomeBuffer.filter(o => o.subAccountId === subAccountId);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  const byAgent: Record<string, number> = {};
  let totalConf = 0;
  let todayCount = 0;

  for (const e of entries) {
    byAgent[e.agentName] = (byAgent[e.agentName] || 0) + 1;
    totalConf += e.confidence;
    if (new Date(e.timestamp).getTime() >= todayMs) todayCount++;
  }

  return {
    total: entries.length,
    byAgent,
    avgConfidence: entries.length > 0 ? Math.round((totalConf / entries.length) * 100) / 100 : 0,
    todayCount,
  };
}
