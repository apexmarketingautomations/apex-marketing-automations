import { useState } from "react";
import { Brain, Sparkles, TrendingUp, Loader2, CheckCircle2, Zap, Eye, Activity, Heart, Shield, RefreshCw, ChevronDown, ArrowUpRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { StrategicInsight } from "./types";

export function InsightsTab({ subAccountId }: { subAccountId: number }) {
  const [, setLocation] = useLocation();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery<{ insights: StrategicInsight[] }>({
    queryKey: ["/api/operator/cognitive/strategic", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/operator/cognitive/strategic/${subAccountId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!subAccountId,
    staleTime: 120000,
  });

  const insights = data?.insights || [];

  const impactConfig: Record<string, { color: string; bg: string; border: string }> = {
    high: { color: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/15" },
    medium: { color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/15" },
    low: { color: "text-slate-400", bg: "bg-slate-500/10", border: "border-slate-500/15" },
  };

  const categoryIcons: Record<string, typeof Brain> = {
    growth: TrendingUp,
    automation: Zap,
    funnel: Activity,
    retention: Heart,
    marketing: Sparkles,
    system: Shield,
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="insights-loading">
        <div className="text-center space-y-3">
          <Loader2 className="w-6 h-6 text-violet-400 animate-spin mx-auto" />
          <p className="text-xs text-slate-500">Analyzing growth opportunities...</p>
        </div>
      </div>
    );
  }

  if (insights.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6" data-testid="insights-empty">
        <div className="text-center space-y-3">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/15">
            <CheckCircle2 className="w-7 h-7 text-emerald-400" />
          </div>
          <p className="text-sm font-semibold text-white">Systems Optimized</p>
          <p className="text-xs text-slate-500 max-w-[220px]">No critical insights right now. Your setup is performing well.</p>
          <button onClick={() => refetch()} className="text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1 mx-auto mt-2" data-testid="button-refresh-insights">
            <RefreshCw size={10} />
            Scan again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2" data-testid="insights-list">
      <div className="flex items-center justify-between px-1 mb-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{insights.length} Strategic Insight{insights.length !== 1 ? "s" : ""}</p>
        <button onClick={() => refetch()} className="p-1 rounded hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors" data-testid="button-refresh-insights">
          <RefreshCw size={12} />
        </button>
      </div>

      {insights.map((insight, i) => {
        const impact = impactConfig[insight.impact] || impactConfig.low;
        const CatIcon = categoryIcons[insight.category] || Eye;
        const isExpanded = expandedId === insight.id;

        return (
          <motion.div
            key={insight.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className={`group rounded-xl border ${impact.border} ${impact.bg} backdrop-blur-sm transition-all cursor-pointer overflow-hidden`}
            onClick={() => setExpandedId(isExpanded ? null : insight.id)}
            data-testid={`insight-card-${i}`}
          >
            <div className="p-3">
              <div className="flex items-start gap-2.5">
                <div className={`w-7 h-7 rounded-lg ${impact.bg} flex items-center justify-center shrink-0 mt-0.5 border ${impact.border}`}>
                  <CatIcon size={13} className={impact.color} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[9px] font-bold uppercase tracking-wider ${impact.color}`}>{insight.impact} impact</span>
                    <span className="text-[9px] text-slate-600">•</span>
                    <span className="text-[9px] text-slate-600 capitalize">{insight.effort?.replace("-", " ")}</span>
                  </div>
                  <p className="text-[11px] text-white font-medium leading-relaxed">{insight.observation}</p>
                  <ChevronDown size={10} className={`text-slate-600 mt-1 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                </div>
              </div>
            </div>

            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-3 pb-3 space-y-2 border-t border-white/[0.04] pt-2">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1">Why This Matters</p>
                      <p className="text-[10px] text-slate-400 leading-relaxed">{insight.insight}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1">Recommendation</p>
                      <p className="text-[10px] text-slate-300 leading-relaxed">{insight.suggestion}</p>
                    </div>
                    {insight.action && (
                      <button
                        onClick={(e) => { e.stopPropagation(); if (insight.action?.link) setLocation(insight.action.link); }}
                        className="w-full mt-1 px-3 py-2 rounded-lg bg-gradient-to-r from-violet-500/15 to-cyan-500/15 border border-violet-500/20 text-[10px] font-semibold text-white hover:from-violet-500/25 hover:to-cyan-500/25 transition-all flex items-center justify-center gap-1.5"
                        data-testid={`button-insight-action-${i}`}
                      >
                        {insight.action.label}
                        <ArrowUpRight size={10} />
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}
