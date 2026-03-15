import { Loader2, Zap, Factory } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { IndustryKnowledge, GrowthReport } from "./types";

export function IndustryTab({ subAccountId }: { subAccountId: number }) {
  const { data: contextData } = useQuery({
    queryKey: ["/api/operator/cognitive/context", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/operator/cognitive/context/${subAccountId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!subAccountId,
    staleTime: 120000,
  });

  const industry = contextData?.workspace?.industry || "General";

  const { data: industryData, isLoading } = useQuery<IndustryKnowledge>({
    queryKey: ["/api/operator/cognitive/industry", industry],
    queryFn: async () => {
      const res = await fetch(`/api/operator/cognitive/industry/${encodeURIComponent(industry)}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!industry,
    staleTime: 300000,
  });

  const { data: benchmarkData } = useQuery<GrowthReport>({
    queryKey: ["/api/operator/cognitive/growth-report", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/operator/cognitive/growth-report/${subAccountId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!subAccountId,
    staleTime: 120000,
  });

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="industry-loading">
        <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
      </div>
    );
  }

  if (!industryData) {
    return (
      <div className="flex-1 flex items-center justify-center p-6" data-testid="industry-empty">
        <p className="text-xs text-slate-500">No industry data available</p>
      </div>
    );
  }

  const benchmarks = benchmarkData?.industryBenchmarks || {};

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3" data-testid="industry-tab">
      <div className="p-3 rounded-xl bg-gradient-to-r from-violet-500/[0.06] to-cyan-500/[0.04] border border-violet-500/15">
        <div className="flex items-center gap-2 mb-2">
          <Factory size={14} className="text-violet-400" />
          <p className="text-xs font-semibold text-white">{industryData.industry} Intelligence</p>
        </div>
        <p className="text-[10px] text-slate-400 leading-relaxed">
          Response time benchmark: <span className="text-white font-medium">{industryData.avgResponseTimeBenchmark}s</span>
        </p>
      </div>

      {Object.keys(benchmarks).length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 px-1">Your Performance vs Benchmarks</p>
          {Object.entries(benchmarks).map(([key, bm]) => (
            <div key={key} className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <span className="text-[10px] text-slate-400 capitalize">{key.replace(/_/g, " ")}</span>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-white font-medium">{String(bm.yours)}</span>
                <span className="text-[9px] text-slate-600">vs</span>
                <span className="text-[10px] text-slate-400">{String(bm.benchmark)}</span>
                <span className={`w-2 h-2 rounded-full ${bm.status === "above" ? "bg-emerald-400" : bm.status === "at" ? "bg-amber-400" : "bg-red-400"}`} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 px-1">Top Channels</p>
        <div className="flex flex-wrap gap-1.5 px-1">
          {industryData.bestChannels.map((ch) => (
            <span key={ch} className="px-2 py-1 rounded-md bg-cyan-500/10 border border-cyan-500/15 text-[10px] text-cyan-400 font-medium">{ch}</span>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 px-1">Lead Strategies</p>
        {industryData.leadStrategies.map((strategy, i) => (
          <div key={i} className="flex items-start gap-2 px-1">
            <div className="w-1 h-1 rounded-full bg-violet-400 mt-1.5 shrink-0" />
            <p className="text-[10px] text-slate-400 leading-relaxed">{strategy}</p>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 px-1">Recommended Workflows</p>
        {industryData.commonWorkflows.map((wf, i) => (
          <div key={i} className="flex items-center gap-2 px-1">
            <Zap size={10} className="text-amber-400 shrink-0" />
            <p className="text-[10px] text-slate-400">{wf}</p>
          </div>
        ))}
      </div>

      {industryData.tips.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 px-1">Pro Tips</p>
          {industryData.tips.map((tip, i) => (
            <div key={i} className="p-2.5 rounded-lg bg-emerald-500/[0.04] border border-emerald-500/10">
              <p className="text-[10px] text-slate-300 leading-relaxed">{tip}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
