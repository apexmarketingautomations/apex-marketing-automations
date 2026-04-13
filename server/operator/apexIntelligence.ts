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

const MAX_BUFFER = 2000;
let nextId = 1;
const outcomeBuffer: StoredOutcome[] = [];

export function reportOutcome(payload: AgentOutcome): void {
  const entry: StoredOutcome = {
    ...payload,
    id: nextId++,
    timestamp: payload.timestamp ?? new Date().toISOString(),
    scope: payload.scope ?? "account",
    confidence: Math.max(0, Math.min(1, payload.confidence)),
  };
  outcomeBuffer.push(entry);
  if (outcomeBuffer.length > MAX_BUFFER) {
    outcomeBuffer.splice(0, outcomeBuffer.length - MAX_BUFFER);
  }
}

export function getOutcomes(opts: {
  subAccountId?: number;
  agentName?: string;
  limit?: number;
  since?: string;
}): StoredOutcome[] {
  let results = [...outcomeBuffer];

  if (opts.subAccountId != null) {
    results = results.filter(o => o.subAccountId === opts.subAccountId);
  }
  if (opts.agentName) {
    results = results.filter(o => o.agentName === opts.agentName);
  }
  if (opts.since) {
    const sinceDate = new Date(opts.since).getTime();
    results = results.filter(o => new Date(o.timestamp).getTime() >= sinceDate);
  }

  results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const limit = opts.limit ?? 50;
  return results.slice(0, limit);
}

export function getOutcomeSummary(subAccountId?: number): {
  total: number;
  byAgent: Record<string, number>;
  avgConfidence: number;
  todayCount: number;
} {
  let entries = subAccountId != null
    ? outcomeBuffer.filter(o => o.subAccountId === subAccountId)
    : outcomeBuffer;

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
