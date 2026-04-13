import { useState } from "react";
import { Brain, Loader2, Activity, Filter, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "@/hooks/use-account";

interface AgentOutcome {
  id: number;
  agentName: string;
  action: string;
  subject: string;
  result: string;
  confidence: number;
  subAccountId: number;
  niche?: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

interface OutcomeSummary {
  total: number;
  byAgent: Record<string, number>;
  avgConfidence: number;
  todayCount: number;
}

const AGENT_COLORS: Record<string, string> = {
  sentinel: "text-amber-400 bg-amber-500/15 border-amber-500/20",
  "crash-ingest": "text-red-400 bg-red-500/15 border-red-500/20",
  layla: "text-pink-400 bg-pink-500/15 border-pink-500/20",
  "task-agent": "text-cyan-400 bg-cyan-500/15 border-cyan-500/20",
};

const AGENT_LABELS: Record<string, string> = {
  sentinel: "Sentinel",
  "crash-ingest": "Crash Ingest",
  layla: "Layla",
  "task-agent": "Task Agent",
};

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? "bg-emerald-400" : pct >= 60 ? "bg-violet-400" : pct >= 40 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-12 h-1 rounded-full bg-white/[0.06] overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${color}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6 }}
        />
      </div>
      <span className="text-sm text-slate-500 tabular-nums">{pct}%</span>
    </div>
  );
}

export function ApexBrainTab({ subAccountId: propSubAccountId }: { subAccountId?: number }) {
  const { activeAccountId } = useAccount();
  const subAccountId = propSubAccountId ?? activeAccountId;
  const [agentFilter, setAgentFilter] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery<{ outcomes: AgentOutcome[]; summary: OutcomeSummary }>({
    queryKey: ["/api/intelligence/apex/outcomes", subAccountId, agentFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (subAccountId) params.set("subAccountId", String(subAccountId));
      if (agentFilter) params.set("agent", agentFilter);
      params.set("limit", "50");
      const res = await fetch(`/api/intelligence/apex/outcomes?${params}`);
      if (!res.ok) return { outcomes: [], summary: { total: 0, byAgent: {}, avgConfidence: 0, todayCount: 0 } };
      return res.json();
    },
    enabled: !!subAccountId,
    refetchInterval: 60_000,
  });

  const outcomes = data?.outcomes ?? [];
  const summary = data?.summary ?? { total: 0, byAgent: {}, avgConfidence: 0, todayCount: 0 };
  const agents = Object.keys(summary.byAgent);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-violet-400" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="panel-apex-brain">
      <div className="px-3 py-2 flex items-center justify-between border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <Activity size={10} className="text-violet-400" />
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Cross-Agent Outcomes</span>
        </div>
        <button
          onClick={() => refetch()}
          className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
          data-testid="button-brain-refresh"
        >
          <RefreshCw size={10} />
        </button>
      </div>

      <div className="px-3 py-2 grid grid-cols-3 gap-1 border-b border-white/[0.04]">
        <div className="text-center">
          <p className="text-sm font-bold text-white" data-testid="text-brain-total">{summary.total}</p>
          <p className="text-sm text-slate-400 uppercase tracking-wider">Total</p>
        </div>
        <div className="text-center">
          <p className="text-sm font-bold text-cyan-400" data-testid="text-brain-today">{summary.todayCount}</p>
          <p className="text-sm text-slate-400 uppercase tracking-wider">Today</p>
        </div>
        <div className="text-center">
          <p className="text-sm font-bold text-violet-400" data-testid="text-brain-confidence">{Math.round(summary.avgConfidence * 100)}%</p>
          <p className="text-sm text-slate-400 uppercase tracking-wider">Avg Conf</p>
        </div>
      </div>

      {agents.length > 0 && (
        <div className="px-3 py-1.5 flex items-center gap-1 border-b border-white/[0.04] overflow-x-auto scrollbar-none">
          <Filter size={11} className="text-slate-400 shrink-0" />
          <button
            onClick={() => setAgentFilter(null)}
            className={`text-sm px-1.5 py-0.5 rounded font-medium transition-colors ${!agentFilter ? "bg-violet-500/20 text-violet-400 border border-violet-500/20" : "text-slate-400 hover:text-slate-400"}`}
            data-testid="button-filter-all"
          >
            All
          </button>
          {agents.map(agent => (
            <button
              key={agent}
              onClick={() => setAgentFilter(agentFilter === agent ? null : agent)}
              className={`text-sm px-1.5 py-0.5 rounded font-medium transition-colors whitespace-nowrap ${agentFilter === agent ? "bg-violet-500/20 text-violet-400 border border-violet-500/20" : "text-slate-400 hover:text-slate-400"}`}
              data-testid={`button-filter-${agent}`}
            >
              {AGENT_LABELS[agent] || agent} ({summary.byAgent[agent]})
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto scrollbar-thin" data-testid="list-brain-outcomes">
        {outcomes.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div className="space-y-2">
              <Brain size={28} className="mx-auto text-slate-500" />
              <p className="text-sm text-slate-400">No outcomes recorded yet</p>
              <p className="text-xs text-slate-500">Outcomes appear as agents detect incidents, ingest crashes, and handle conversations</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.03]">
            {outcomes.map((o) => {
              const colorClass = AGENT_COLORS[o.agentName] || "text-slate-400 bg-slate-500/15 border-slate-500/20";
              return (
                <motion.div
                  key={o.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="px-3 py-2 hover:bg-white/[0.02] transition-colors"
                  data-testid={`outcome-${o.id}`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`text-xs px-1 py-px rounded border font-semibold mt-0.5 shrink-0 ${colorClass}`}>
                      {AGENT_LABELS[o.agentName] || o.agentName}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white font-medium truncate">{o.subject}</p>
                      <p className="text-xs text-slate-400 truncate mt-0.5">{o.result}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-sm text-slate-400">{o.action}</span>
                        {o.niche && (
                          <span className="text-xs text-slate-500">{o.niche}</span>
                        )}
                        <ConfidenceBar value={o.confidence} />
                      </div>
                      <span className="text-sm text-slate-500 mt-0.5 block">
                        {new Date(o.timestamp).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
