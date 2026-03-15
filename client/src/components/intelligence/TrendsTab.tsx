import { Brain, TrendingUp, Loader2, Target, Shield, BarChart3, MessageSquare, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import type { Trend } from "./types";

export function TrendsTab({ subAccountId }: { subAccountId: number }) {
  const { data, isLoading, refetch } = useQuery<{ trends: Trend[] }>({
    queryKey: ["/api/operator/cognitive/trends", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/operator/cognitive/trends/${subAccountId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!subAccountId,
    staleTime: 120000,
  });

  const trends = data?.trends || [];

  const trendIcons: Record<string, typeof Brain> = {
    engagement: TrendingUp,
    conversion: Target,
    system: Shield,
    channel: MessageSquare,
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="trends-loading">
        <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
      </div>
    );
  }

  if (trends.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6" data-testid="trends-empty">
        <div className="text-center space-y-3">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-cyan-500/10 flex items-center justify-center border border-cyan-500/15">
            <BarChart3 className="w-7 h-7 text-cyan-400" />
          </div>
          <p className="text-sm font-semibold text-white">Building Your Baseline</p>
          <p className="text-xs text-slate-500 max-w-[220px]">I need more data to detect patterns. Keep using the platform and I'll surface trends as they emerge.</p>
          <button onClick={() => refetch()} className="text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1 mx-auto" data-testid="button-scan-trends">
            <RefreshCw size={10} />
            Scan now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2" data-testid="trends-list">
      <div className="flex items-center justify-between px-1 mb-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{trends.length} Detected Pattern{trends.length !== 1 ? "s" : ""}</p>
        <button onClick={() => refetch()} className="p-1 rounded hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors" data-testid="button-refresh-trends">
          <RefreshCw size={12} />
        </button>
      </div>
      {trends.map((trend, i) => {
        const TrendIcon = trendIcons[trend.category] || BarChart3;
        const isPositive = /increas|accelerat|growth|improv/i.test(trend.pattern);
        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-white/10 transition-all"
            data-testid={`trend-card-${i}`}
          >
            <div className="flex items-start gap-2.5">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 border ${isPositive ? "bg-emerald-500/10 border-emerald-500/15" : "bg-amber-500/10 border-amber-500/15"}`}>
                <TrendIcon size={13} className={isPositive ? "text-emerald-400" : "text-amber-400"} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-slate-300 leading-relaxed">{trend.pattern}</p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-[9px] text-slate-600 flex items-center gap-1">
                    <Target size={8} />
                    {Math.round(trend.confidence * 100)}% confidence
                  </span>
                  <span className="text-[9px] text-slate-600 flex items-center gap-1">
                    <BarChart3 size={8} />
                    {trend.dataPoints} data points
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
