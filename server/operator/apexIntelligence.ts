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

const ALLOWED_AGENTS = new Set(["sentinel", "crash-ingest", "layla", "task-agent", "operator", "http-api", "background-worker"]);
const MAX_BUFFER = 2000;
const MAX_METADATA_KEYS = 10;
const MAX_STRING_LEN = 500;
const DEDUP_WINDOW_MS = 2000;
let nextId = 1;
const outcomeBuffer: StoredOutcome[] = [];
let lastOutcomeKey = "";
let lastOutcomeTs = 0;

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
  if (
    !payload ||
    typeof payload.agentName !== "string" || !payload.agentName ||
    typeof payload.action !== "string" || !payload.action ||
    typeof payload.subject !== "string" || !payload.subject ||
    typeof payload.result !== "string" || !payload.result ||
    typeof payload.confidence !== "number" || isNaN(payload.confidence) ||
    typeof payload.subAccountId !== "number" || !Number.isInteger(payload.subAccountId) || payload.subAccountId <= 0
  ) {
    return;
  }

  if (!ALLOWED_AGENTS.has(payload.agentName)) {
    return;
  }

  const entityId = payload.metadata?.incidentId ?? payload.metadata?.reportId ?? payload.metadata?.conversationId ?? "";
  const dedupKey = `${payload.agentName}:${payload.action}:${payload.subject}:${payload.subAccountId}:${entityId}`;
  const now = Date.now();
  if (dedupKey === lastOutcomeKey && now - lastOutcomeTs < DEDUP_WINDOW_MS) {
    return;
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
