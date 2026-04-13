import { useState, useRef, useEffect } from "react";
import { Brain, Zap, Target, Layers, Activity, Crosshair, Heart, ArrowUpRight, Gauge, MessageSquare } from "lucide-react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useStreamingResponse } from "@/hooks/use-streaming";
import { HealthRing, CategoryBar } from "./types";
import type { GrowthReport } from "./types";

export function CommandTab({ subAccountId }: { subAccountId: number }) {
  const [, setLocation] = useLocation();
  const { startStream } = useStreamingResponse();
  const [reportData, setReportData] = useState<GrowthReport | null>(null);
  const [streamProgress, setStreamProgress] = useState<{ message: string; percent: number }>({ message: "", percent: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const lastFetchedAccountRef = useRef<number | null>(null);

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

  useEffect(() => {
    if (!subAccountId || lastFetchedAccountRef.current === subAccountId) return;
    lastFetchedAccountRef.current = subAccountId;
    setReportData(null);
    setStreamProgress({ message: "", percent: 0 });
    setIsLoading(true);

    startStream(`/api/operator/cognitive/growth-report/${subAccountId}/stream`, {}, {
      method: "GET",
      onProgress: (progress) => {
        setStreamProgress({ message: progress.message, percent: progress.percent || 0 });
      },
      onResult: (data) => {
        if (data.section === "healthScore") {
          setReportData(prev => ({ ...prev, healthScore: data.data } as GrowthReport));
        } else if (data.section === "strategicInsights") {
          setReportData(prev => ({ ...prev, strategicInsights: data.data } as GrowthReport));
        } else if (data.section === "missedOpportunities") {
          setReportData(prev => ({ ...prev, missedOpportunities: data.data } as GrowthReport));
        } else if (data.section === "quickWins") {
          setReportData(prev => ({ ...prev, quickWins: data.data } as GrowthReport));
        }
      },
      onDone: (_fullText, rawData) => {
        if (rawData) {
          setReportData(rawData as GrowthReport);
        }
        setIsLoading(false);
      },
      onError: () => {
        setIsLoading(false);
      },
    });
  }, [subAccountId, startStream]);

  if (isLoading && !reportData) {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="command-loading">
        <div className="text-center space-y-3">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            className="w-12 h-12 mx-auto rounded-2xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20 flex items-center justify-center border border-violet-500/20"
          >
            <Brain className="w-6 h-6 text-violet-400" />
          </motion.div>
          <p className="text-sm text-slate-300">{streamProgress.message || "Analyzing your business..."}</p>
          {streamProgress.percent > 0 && (
            <div className="w-48 mx-auto h-1 bg-slate-800 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-violet-500 to-cyan-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${streamProgress.percent}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          )}
          <p className="text-xs text-slate-400">Running health checks, detecting patterns, building insights</p>
        </div>
      </div>
    );
  }

  const health = reportData?.healthScore;
  const growthStage = reportData?.growthStage || "Setup";
  const quickWins = reportData?.quickWins || [];
  const workspace = contextData?.workspace;

  const categoryIcons: Record<string, typeof Brain> = {
    leadCapture: Crosshair,
    communication: MessageSquare,
    automation: Zap,
    integration: Layers,
    funnelCoverage: Activity,
    retention: Heart,
  };

  const categoryLabels: Record<string, string> = {
    leadCapture: "Lead Capture",
    communication: "Communication",
    automation: "Automation",
    integration: "Integrations",
    funnelCoverage: "Funnel Coverage",
    retention: "Retention",
  };

  return (
    <div className="flex-1 overflow-y-auto" data-testid="command-tab">
      <div className="p-4 space-y-4">
        <div className="flex items-start gap-4">
          {health && <HealthRing score={health.overall} size={100} strokeWidth={7} />}
          <div className="flex-1 min-w-0 pt-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold uppercase tracking-widest text-violet-400">
                {growthStage} Stage
              </span>
              {health && (
                <span className="px-2 py-0.5 rounded text-xs font-black bg-white/[0.05] text-white border border-white/[0.08]">
                  {health.grade}
                </span>
              )}
            </div>
            {workspace && (
              <p className="text-sm text-white font-semibold mb-1">{workspace.businessName || "Your Business"}</p>
            )}
            <p className="text-xs text-slate-300 leading-relaxed">
              {health?.summary || "Loading health analysis..."}
            </p>
          </div>
        </div>

        {health && (
          <div className="space-y-2 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">System Health Breakdown</p>
            {Object.entries(health.categories).map(([key, cat]) => (
              <CategoryBar key={key} label={categoryLabels[key] || key} score={cat.score} icon={categoryIcons[key] || Gauge} />
            ))}
          </div>
        )}

        {workspace && (
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Contacts", value: workspace.contactCount || 0, icon: Target },
              { label: "Automations", value: workspace.automationCount || 0, icon: Zap },
              { label: "Integrations", value: workspace.integrationCount || 0, icon: Layers },
            ].map((m) => (
              <div key={m.label} className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.04] text-center">
                <m.icon size={14} className="mx-auto text-slate-400 mb-1" />
                <p className="text-sm font-bold text-white" data-testid={`metric-${m.label.toLowerCase()}`}>{m.value}</p>
                <p className="text-xs text-slate-400">{m.label}</p>
              </div>
            ))}
          </div>
        )}

        {quickWins.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Zap size={14} className="text-amber-400" />
              <p className="text-xs font-bold uppercase tracking-widest text-amber-400">Quick Wins</p>
            </div>
            {quickWins.slice(0, 3).map((win, i) => (
              <motion.div
                key={win.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.8 + i * 0.1 }}
                className="p-3 rounded-xl bg-gradient-to-r from-amber-500/[0.06] to-transparent border border-amber-500/10 cursor-pointer hover:border-amber-500/25 transition-all group"
                onClick={() => win.action?.link && setLocation(win.action.link)}
                data-testid={`quick-win-${i}`}
              >
                <p className="text-sm text-white font-medium mb-0.5">{win.observation}</p>
                <p className="text-xs text-slate-300 leading-relaxed">{win.suggestion}</p>
                {win.action && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-amber-400 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                    {win.action.label}
                    <ArrowUpRight size={12} />
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
