import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle, Zap, CheckCircle, Clock, XCircle, ChevronRight,
  RefreshCw, Filter, TrendingUp, Target, Loader2, Bell
} from "lucide-react";
import { useAccount } from "@/hooks/use-account";
import { apiRequest } from "@/lib/queryClient";

interface PriorityAction {
  id: string;
  category: string;
  priority: "critical" | "high" | "medium" | "low";
  urgencyScore: number;
  impactScore: number;
  effortScore: number;
  compositeScore: number;
  title: string;
  description: string;
  whyThisMatters: string;
  suggestedAction?: string;
  navigateTo?: string;
  sourceType: string;
  entityType?: string;
  entityId?: string;
  status: "pending" | "dismissed" | "snoozed" | "completed";
  snoozedUntil?: string;
  createdAt: string;
}

const PRIORITY_CONFIG = {
  critical: { color: "text-red-400", bg: "bg-red-500/10 border-red-500/20", dot: "bg-red-400" },
  high: { color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20", dot: "bg-orange-400" },
  medium: { color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/20", dot: "bg-yellow-400" },
  low: { color: "text-slate-400", bg: "bg-slate-500/10 border-slate-500/20", dot: "bg-slate-400" },
};

const CATEGORY_ICONS: Record<string, typeof Bell> = {
  alert: AlertTriangle,
  opportunity: TrendingUp,
  maintenance: Target,
  setup: Zap,
  optimization: CheckCircle,
};

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-sm text-slate-400 w-12 text-right">{label}</span>
      <div className="flex-1 h-1 bg-white/[0.04] rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-sm text-slate-500 tabular-nums w-6">{value}</span>
    </div>
  );
}

export function PriorityActionsTab({ subAccountId: propSubAccountId }: { subAccountId?: number }) {
  const { activeAccountId } = useAccount();
  const subAccountId = propSubAccountId ?? activeAccountId;
  const [, setLocation] = useLocation();
  const [filterPriority, setFilterPriority] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: actions = [], isLoading, refetch } = useQuery<PriorityAction[]>({
    queryKey: ["/api/apex/priority-actions", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/apex/priority-actions/${subAccountId}?limit=30`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!subAccountId,
    refetchInterval: 120_000,
  });

  const { data: summary } = useQuery<{ totalPending: number; criticalCount: number; highCount: number }>({
    queryKey: ["/api/apex/priority-actions/summary", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/apex/priority-actions/${subAccountId}/summary`);
      if (!res.ok) return { totalPending: 0, criticalCount: 0, highCount: 0 };
      return res.json();
    },
    enabled: !!subAccountId,
    refetchInterval: 120_000,
  });

  const dismissMutation = useMutation({
    mutationFn: async (actionId: string) => {
      return apiRequest("POST", `/api/apex/priority-actions/${subAccountId}/dismiss`, { actionId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/apex/priority-actions", subAccountId] });
      queryClient.invalidateQueries({ queryKey: ["/api/apex/priority-actions/summary", subAccountId] });
    },
  });

  const snoozeMutation = useMutation({
    mutationFn: async ({ actionId, hours }: { actionId: string; hours: number }) => {
      return apiRequest("POST", `/api/apex/priority-actions/${subAccountId}/snooze`, { actionId, hours });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/apex/priority-actions", subAccountId] });
    },
  });

  const pendingActions = actions.filter(a => a.status === "pending");
  const filtered = filterPriority
    ? pendingActions.filter(a => a.priority === filterPriority)
    : pendingActions;

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-violet-400" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="panel-priority-actions">
      <div className="px-3 py-2 flex items-center justify-between border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <AlertTriangle size={10} className="text-orange-400" />
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Priority Actions</span>
          {(summary?.criticalCount ?? 0) > 0 && (
            <span className="px-1 py-px text-sm bg-red-500/20 text-red-400 rounded font-bold border border-red-500/20">
              {summary?.criticalCount} critical
            </span>
          )}
        </div>
        <button
          onClick={() => refetch()}
          className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
          data-testid="button-priority-refresh"
        >
          <RefreshCw size={10} />
        </button>
      </div>

      <div className="px-3 py-2 grid grid-cols-3 gap-1.5 border-b border-white/[0.04]">
        {[
          { label: "Pending", value: summary?.totalPending ?? 0, color: "text-white" },
          { label: "Critical", value: summary?.criticalCount ?? 0, color: "text-red-400" },
          { label: "High", value: summary?.highCount ?? 0, color: "text-orange-400" },
        ].map(m => (
          <div key={m.label} className="text-center">
            <p className={`text-sm font-bold ${m.color}`} data-testid={`metric-${m.label.toLowerCase()}`}>{m.value}</p>
            <p className="text-sm text-slate-400 uppercase tracking-wider">{m.label}</p>
          </div>
        ))}
      </div>

      <div className="px-3 py-1.5 flex items-center gap-1 border-b border-white/[0.04] overflow-x-auto scrollbar-none">
        <Filter size={11} className="text-slate-400 shrink-0" />
        {[null, "critical", "high", "medium", "low"].map((p) => (
          <button
            key={p ?? "all"}
            onClick={() => setFilterPriority(p)}
            className={`text-sm px-1.5 py-0.5 rounded font-medium transition-colors whitespace-nowrap ${
              filterPriority === p
                ? "bg-violet-500/20 text-violet-400 border border-violet-500/20"
                : "text-slate-400 hover:text-slate-400"
            }`}
            data-testid={`button-filter-${p ?? "all"}`}
          >
            {p ? p.charAt(0).toUpperCase() + p.slice(1) : "All"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin" data-testid="list-priority-actions">
        {filtered.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div className="space-y-2">
              <CheckCircle size={28} className="mx-auto text-emerald-600" />
              <p className="text-sm text-slate-400">No pending actions</p>
              <p className="text-xs text-slate-500">Apex is monitoring your platform for opportunities and issues</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.03]">
            <AnimatePresence>
              {filtered.map((action) => {
                const pCfg = PRIORITY_CONFIG[action.priority] || PRIORITY_CONFIG.medium;
                const Icon = CATEGORY_ICONS[action.category] || Bell;
                const isExpanded = expandedId === action.id;

                return (
                  <motion.div
                    key={action.id}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className={`px-3 py-2 hover:bg-white/[0.02] transition-colors cursor-pointer`}
                    onClick={() => setExpandedId(isExpanded ? null : action.id)}
                    data-testid={`action-${action.id}`}
                  >
                    <div className="flex items-start gap-2">
                      <div className={`w-1 h-1 rounded-full mt-1.5 shrink-0 ${pCfg.dot}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <Icon size={9} className={pCfg.color} />
                          <span className={`text-sm font-semibold uppercase ${pCfg.color}`}>{action.priority}</span>
                          <span className="text-xs text-slate-500">{action.category}</span>
                          <span className="ml-auto text-xs text-slate-500 font-mono">{action.compositeScore}pts</span>
                        </div>
                        <p className="text-xs text-white font-medium leading-tight">{action.title}</p>
                        {!isExpanded && (
                          <p className="text-xs text-slate-500 truncate mt-0.5">{action.description}</p>
                        )}

                        {isExpanded && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="mt-2 space-y-2"
                          >
                            <p className="text-xs text-slate-400 leading-relaxed">{action.description}</p>
                            {action.whyThisMatters && (
                              <p className="text-sm text-violet-400 italic">{action.whyThisMatters}</p>
                            )}
                            <div className="space-y-0.5 py-1">
                              <ScoreBar label="Urgency" value={action.urgencyScore} color="bg-red-400" />
                              <ScoreBar label="Impact" value={action.impactScore} color="bg-violet-400" />
                              <ScoreBar label="Effort" value={100 - action.effortScore} color="bg-emerald-400" />
                            </div>
                            {action.suggestedAction && (
                              <p className="text-sm text-amber-400">→ {action.suggestedAction}</p>
                            )}
                            <div className="flex items-center gap-1.5 pt-1">
                              {action.navigateTo && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setLocation(action.navigateTo!); }}
                                  className="flex items-center gap-1 text-sm px-2 py-1 rounded bg-violet-500/20 text-violet-400 border border-violet-500/20 hover:bg-violet-500/30 transition-colors font-medium"
                                  data-testid={`button-act-${action.id}`}
                                >
                                  Take Action <ChevronRight size={11} />
                                </button>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); snoozeMutation.mutate({ actionId: action.id, hours: 24 }); }}
                                className="flex items-center gap-1 text-sm px-2 py-1 rounded bg-white/5 text-slate-500 hover:text-slate-300 hover:bg-white/10 transition-colors"
                                data-testid={`button-snooze-${action.id}`}
                              >
                                <Clock size={11} /> Snooze 24h
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); dismissMutation.mutate(action.id); }}
                                className="flex items-center gap-1 text-sm px-2 py-1 rounded bg-white/5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                data-testid={`button-dismiss-${action.id}`}
                              >
                                <XCircle size={11} /> Dismiss
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
