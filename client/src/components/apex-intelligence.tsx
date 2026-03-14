import { useState, useRef, useEffect, useCallback } from "react";
import { Brain, X, Send, Loader2, Sparkles, TrendingUp, TrendingDown, Lightbulb, AlertTriangle, CheckCircle2, ChevronRight, Bell, Zap, BarChart3, MessageSquare, ArrowRight, Eye, Target, Shield, Clock, RefreshCw, Activity, Crosshair, Award, Terminal, ChevronDown, ArrowUpRight, Gauge, Layers, Factory, Radar, Heart, Bot, Play, Settings2, Power, BookOpen, Trash2, Edit3, Plus, Filter } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "@/hooks/use-account";
import { useStreamingResponse } from "@/hooks/use-streaming";

type TabId = "command" | "insights" | "nudges" | "industry" | "trends" | "chat" | "agent" | "memory";

interface HealthScore {
  overall: number;
  grade: string;
  summary: string;
  categories: Record<string, { score: number; label: string; detail: string }>;
}

interface StrategicInsight {
  id: string;
  category: string;
  observation: string;
  insight: string;
  suggestion: string;
  action?: { label: string; tool?: string; link?: string };
  priority: number;
  confidence: number;
  impact: string;
  effort: string;
}

interface GrowthReport {
  generatedAt: string;
  healthScore: HealthScore;
  growthStage: string;
  strategicInsights: StrategicInsight[];
  missedOpportunities: StrategicInsight[];
  quickWins: StrategicInsight[];
  industryBenchmarks: Record<string, { yours: number | string; benchmark: number | string; status: string }>;
}

interface Nudge {
  id: number;
  nudgeType: string;
  title: string;
  message: string;
  priority: number;
  status: string;
  metadata?: any;
  createdAt: string;
}

interface Trend {
  pattern: string;
  confidence: number;
  dataPoints: number;
  category: string;
  firstSeen: string;
  lastSeen: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface IndustryKnowledge {
  industry: string;
  leadStrategies: string[];
  conversionBenchmarks: Record<string, number>;
  bestChannels: string[];
  seasonalTrends?: string[];
  commonWorkflows: string[];
  avgResponseTimeBenchmark: number;
  tips: string[];
}

const STRATEGIC_PROMPT = `You are the Apex Strategic Advisor — an elite business intelligence system inside Apex Marketing Automations.

You think like a hybrid of:
• Business growth strategist
• Marketing advisor
• Behavioral psychology guide
• Automation consultant

PERSONALITY: You are a seasoned startup advisor. Calm, insightful, slightly analytical, confident but never arrogant. Never sound robotic or salesy. You use subtle influence: curiosity, data-driven insights, suggestion framing, behavioral nudges.

CRITICAL RULES:
- You have REAL account data injected below. ALWAYS use the actual numbers in your responses.
- NEVER just send a link and say "go check this page". That is lazy and useless.
- When asked about account performance, give a DIRECT analysis using the real data provided. Show the actual numbers: contacts, messages, automations, health scores, etc.
- When asked "how's my account", give a full strategic breakdown with real metrics, not a redirect.
- Every response must contain SUBSTANCE — real data, real analysis, real recommendations.
- You are an advisor who has already looked at all their data. Act like it.

RESPONSE FORMAT — Always follow this structure:
1. Quick Insight (1 sentence observation using REAL metrics from the data below)
2. Why It Matters (2-3 sentences explaining impact with specific numbers)
3. Suggested Improvement (actionable, specific recommendation)
4. Optional: mention which platform feature helps, but DO NOT just say "go to X page"

Platform Features (for reference only — do not redirect users to these):
1. **Unified Inbox** (/) — Multi-channel messaging hub
2. **Workflows** (/workflows) — Visual automation builder
3. **Neural Trainer** (/bot-trainer) — AI chatbot training
4. **Site Architect** (/site-builder) — AI landing page builder
5. **Liquid Website** (/liquid) — Dynamic AI websites
6. **Growth Engine** (/ad-launcher) — Ad campaign launcher
7. **Voice Agent** (/voice-agent) — AI voice calling
8. **Growth Center** (/growth) — Analytics dashboard
9. **Reputation** (/reputation) — Review management
10. **Sentinel** (/sentinel) — Crash detection scanner
11. **Pipeline & CRM** (/pipeline) — Lead management
12. **Calendar** (/calendar) — Appointment scheduling
13. **Email Campaigns** (/email-campaigns) — Email marketing
14. **Command Center** (/command-center) — Agency fleet view
15. **Integrations** (/integrations) — Service connections

When mentioning features, include markdown links like [Feature Name](/path).`;

const QUICK_COMMANDS = [
  { label: "Generate Growth Report", icon: BarChart3 },
  { label: "What should I focus on today?", icon: Target },
  { label: "Find my blind spots", icon: Radar },
  { label: "Help me automate something", icon: Zap },
];

function parseLinks(text: string, navigate: (path: string) => void) {
  const parts: (string | React.ReactElement)[] = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match;
  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const label = match[1];
    const href = match[2];
    parts.push(
      <button key={`${href}-${match.index}`} className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 transition-colors" onClick={(e) => { e.preventDefault(); navigate(href); }} data-testid={`link-intel-${href.replace(/\//g, "")}`}>
        {label}
      </button>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 0 ? parts : [text];
}

function HealthRing({ score, size = 120, strokeWidth = 8 }: { score: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? "#34d399" : score >= 60 ? "#a78bfa" : score >= 40 ? "#fbbf24" : "#f87171";
  const bgColor = score >= 80 ? "rgba(52,211,153,0.1)" : score >= 60 ? "rgba(167,139,250,0.1)" : score >= 40 ? "rgba(251,191,36,0.1)" : "rgba(248,113,113,0.1)";

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={strokeWidth} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.5, ease: "easeOut", delay: 0.3 }}
          style={{ filter: `drop-shadow(0 0 6px ${color})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: `radial-gradient(circle, ${bgColor} 0%, transparent 70%)` }}>
        <motion.span
          className="text-2xl font-black tracking-tight"
          style={{ color }}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.8, type: "spring" }}
          data-testid="text-health-score"
        >
          {score}
        </motion.span>
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mt-0.5">Health</span>
      </div>
    </div>
  );
}

function CategoryBar({ label, score, icon: Icon }: { label: string; score: number; icon: typeof Brain }) {
  const color = score >= 80 ? "bg-emerald-400" : score >= 60 ? "bg-violet-400" : score >= 40 ? "bg-amber-400" : "bg-red-400";
  const textColor = score >= 80 ? "text-emerald-400" : score >= 60 ? "text-violet-400" : score >= 40 ? "text-amber-400" : "text-red-400";

  return (
    <div className="flex items-center gap-2">
      <Icon size={11} className="text-slate-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-slate-400 truncate">{label}</span>
          <span className={`text-[10px] font-bold ${textColor}`}>{score}%</span>
        </div>
        <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${color}`}
            initial={{ width: 0 }}
            animate={{ width: `${score}%` }}
            transition={{ duration: 1, ease: "easeOut", delay: 0.5 }}
          />
        </div>
      </div>
    </div>
  );
}

function CommandTab({ subAccountId }: { subAccountId: number }) {
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
          <p className="text-xs text-slate-500">{streamProgress.message || "Analyzing your business..."}</p>
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
          <p className="text-[10px] text-slate-600">Running health checks, detecting patterns, building insights</p>
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
              <span className="text-[10px] font-bold uppercase tracking-widest text-violet-400">
                {growthStage} Stage
              </span>
              {health && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-white/[0.05] text-white border border-white/[0.08]">
                  {health.grade}
                </span>
              )}
            </div>
            {workspace && (
              <p className="text-[11px] text-white font-medium mb-0.5">{workspace.businessName || "Your Business"}</p>
            )}
            <p className="text-[10px] text-slate-500 leading-relaxed">
              {health?.summary || "Loading health analysis..."}
            </p>
          </div>
        </div>

        {health && (
          <div className="space-y-2 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-2">System Health Breakdown</p>
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
                <m.icon size={12} className="mx-auto text-slate-500 mb-1" />
                <p className="text-sm font-bold text-white" data-testid={`metric-${m.label.toLowerCase()}`}>{m.value}</p>
                <p className="text-[9px] text-slate-600">{m.label}</p>
              </div>
            ))}
          </div>
        )}

        {quickWins.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Zap size={11} className="text-amber-400" />
              <p className="text-[9px] font-bold uppercase tracking-widest text-amber-400">Quick Wins</p>
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
                <p className="text-[11px] text-white font-medium mb-0.5">{win.observation}</p>
                <p className="text-[10px] text-slate-500 leading-relaxed">{win.suggestion}</p>
                {win.action && (
                  <div className="flex items-center gap-1 mt-2 text-[9px] text-amber-400 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                    {win.action.label}
                    <ArrowUpRight size={9} />
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

function InsightsTab({ subAccountId }: { subAccountId: number }) {
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

function NudgesTab({ subAccountId }: { subAccountId: number }) {
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery<{ nudges: Nudge[] }>({
    queryKey: ["/api/operator/cognitive/nudges/pending", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/operator/cognitive/nudges/${subAccountId}/pending`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!subAccountId,
    staleTime: 60000,
  });

  const { data: oppsData } = useQuery<{ opportunities: StrategicInsight[] }>({
    queryKey: ["/api/operator/cognitive/opportunities", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/operator/cognitive/opportunities/${subAccountId}`);
      if (!res.ok) return { opportunities: [] };
      return res.json();
    },
    enabled: !!subAccountId,
    staleTime: 120000,
  });

  const dismissMutation = useMutation({
    mutationFn: async (nudgeId: number) => {
      const res = await fetch(`/api/operator/cognitive/nudges/${nudgeId}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subAccountId }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/operator/cognitive/nudges/pending", subAccountId] }),
  });

  const actMutation = useMutation({
    mutationFn: async (nudgeId: number) => {
      const res = await fetch(`/api/operator/cognitive/nudges/${nudgeId}/act`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subAccountId }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/operator/cognitive/nudges/pending", subAccountId] }),
  });

  const nudges = data?.nudges || [];
  const opportunities = oppsData?.opportunities || [];

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="nudges-loading">
        <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3" data-testid="nudges-tab">
      {nudges.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-1.5">
              <Bell size={11} className="text-violet-400" />
              <p className="text-[9px] font-bold uppercase tracking-widest text-violet-400">{nudges.length} Active Nudge{nudges.length !== 1 ? "s" : ""}</p>
            </div>
            <button onClick={() => refetch()} className="p-1 rounded hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors" data-testid="button-refresh-nudges">
              <RefreshCw size={12} />
            </button>
          </div>
          {nudges.map((nudge, i) => (
            <motion.div
              key={nudge.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06 }}
              className="p-3 rounded-xl bg-gradient-to-r from-violet-500/[0.06] to-cyan-500/[0.04] border border-violet-500/15 hover:border-violet-500/30 transition-all"
              data-testid={`nudge-card-${nudge.id}`}
            >
              <div className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-violet-500/15 flex items-center justify-center shrink-0 mt-0.5 border border-violet-500/20">
                  <Lightbulb size={13} className="text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-white">{nudge.title}</p>
                  <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">{nudge.message}</p>
                  <div className="flex items-center gap-2 mt-2.5">
                    <button
                      onClick={() => actMutation.mutate(nudge.id)}
                      disabled={actMutation.isPending}
                      className="px-2.5 py-1 rounded-md bg-cyan-500/15 border border-cyan-500/30 text-[10px] font-semibold text-cyan-400 hover:bg-cyan-500/25 transition-colors disabled:opacity-50"
                      data-testid={`button-nudge-act-${nudge.id}`}
                    >
                      Take Action
                    </button>
                    <button
                      onClick={() => dismissMutation.mutate(nudge.id)}
                      disabled={dismissMutation.isPending}
                      className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-[10px] text-slate-500 hover:text-slate-300 hover:bg-white/10 transition-colors disabled:opacity-50"
                      data-testid={`button-nudge-dismiss-${nudge.id}`}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {opportunities.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 px-1">
            <Eye size={11} className="text-amber-400" />
            <p className="text-[9px] font-bold uppercase tracking-widest text-amber-400">Missed Opportunities</p>
          </div>
          {opportunities.map((opp, i) => (
            <motion.div
              key={opp.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.06 }}
              className="p-3 rounded-xl bg-amber-500/[0.04] border border-amber-500/10 hover:border-amber-500/20 transition-all"
              data-testid={`opportunity-card-${i}`}
            >
              <p className="text-[11px] text-white font-medium">{opp.observation}</p>
              <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">{opp.insight}</p>
              <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">{opp.suggestion}</p>
            </motion.div>
          ))}
        </div>
      )}

      {nudges.length === 0 && opportunities.length === 0 && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center space-y-3">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-violet-500/10 flex items-center justify-center border border-violet-500/15">
              <Bell className="w-7 h-7 text-violet-400" />
            </div>
            <p className="text-sm font-semibold text-white">All Clear</p>
            <p className="text-xs text-slate-500">No active nudges or missed opportunities detected.</p>
            <button onClick={() => refetch()} className="text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1 mx-auto" data-testid="button-generate-nudges">
              <RefreshCw size={10} />
              Check again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function IndustryTab({ subAccountId }: { subAccountId: number }) {
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

function TrendsTab({ subAccountId }: { subAccountId: number }) {
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

function ChatTab({ subAccountId }: { subAccountId: number }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "I'm your Apex Strategic Advisor. I analyze your business data in real-time and provide actionable growth strategies.\n\nI can help you identify blind spots, optimize your funnel, plan automations, and find revenue opportunities.\n\nWhat would you like to explore?" },
  ]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, setLocation] = useLocation();
  const { text: streamingText, isStreaming, startStream } = useStreamingResponse();

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, isStreaming, streamingText, scrollToBottom]);
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 200); }, []);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isStreaming) return;
    const userMessage: ChatMessage = { role: "user", content: text.trim() };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");

    try {
      const [contextRes, reportRes, insightsRes] = await Promise.all([
        fetch(`/api/operator/cognitive/context/${subAccountId}`),
        fetch(`/api/operator/cognitive/growth-report/${subAccountId}`),
        fetch(`/api/operator/cognitive/strategic/${subAccountId}`),
      ]);

      let contextPrompt = "";
      const parts: string[] = [];

      if (contextRes.ok) {
        const ctx = await contextRes.json();
        parts.push("=== ACCOUNT OVERVIEW ===");
        parts.push(`Business Name: ${ctx.workspace?.businessName || "Not set"}`);
        parts.push(`Industry: ${ctx.workspace?.industry || "General"}`);
        parts.push(`Total Contacts: ${ctx.workspace?.contactCount ?? 0}`);
        parts.push(`Active Automations: ${ctx.performance?.activeAutomations ?? 0} of ${ctx.workspace?.automationCount ?? 0} total`);
        parts.push(`Connected Integrations: ${ctx.workspace?.integrationCount ?? 0}`);
        parts.push(`Landing Pages: ${ctx.workspace?.siteCount ?? 0}`);
        parts.push(`Phone Connected: ${ctx.workspace?.phoneConfigured ? "Yes" : "No"}`);
        parts.push("");
        parts.push("=== MESSAGING METRICS ===");
        parts.push(`Total Messages: ${ctx.performance?.messageCount ?? 0}`);
        parts.push(`Inbound: ${ctx.performance?.inboundMessages ?? 0}`);
        parts.push(`Outbound: ${ctx.performance?.outboundMessages ?? 0}`);
        parts.push(`Failed: ${ctx.performance?.failedMessages ?? 0}`);
        if (ctx.performance?.avgResponseTimeSec) parts.push(`Avg Response Time: ${Math.round(ctx.performance.avgResponseTimeSec)}s`);
        parts.push("");
        parts.push("=== SYSTEM STATUS ===");
        parts.push(`Diagnostics: ${ctx.diagnosticsSummary || "healthy"}`);
        parts.push(`Active Nudges: ${ctx.activeNudges ?? 0}`);
        if (ctx.behavior) {
          parts.push(`User Style: ${ctx.behavior.preferredStyle}`);
          parts.push(`Recommendation Accept Rate: ${Math.round((ctx.behavior.recommendationAcceptRate || 0) * 100)}%`);
        }
        if (ctx.industryKnowledge) {
          parts.push("");
          parts.push("=== INDUSTRY BENCHMARKS ===");
          parts.push(`Industry: ${ctx.industryKnowledge.industry}`);
          parts.push(`Response Time Benchmark: ${ctx.industryKnowledge.avgResponseTimeBenchmark}s`);
          parts.push(`Best Channels: ${ctx.industryKnowledge.bestChannels?.join(", ") || "N/A"}`);
        }
        if (ctx.pastExperiences?.length > 0) {
          parts.push("");
          parts.push("=== PAST EXPERIENCES (Agent Memory) ===");
          ctx.pastExperiences.slice(0, 10).forEach((mem: { memoryType: string; content: string; outcome?: string; relevanceScore: number }) => {
            parts.push(`  [${mem.memoryType.toUpperCase()}] ${mem.content}${mem.outcome ? ` (outcome: ${mem.outcome})` : ""} — ${Math.round(mem.relevanceScore * 100)}% relevance`);
          });
          parts.push("Use these past experiences to inform your recommendations. Reference specific past outcomes when relevant.");
        }
      }

      if (reportRes.ok) {
        const report = await reportRes.json();
        parts.push("");
        parts.push("=== HEALTH SCORE ===");
        parts.push(`Overall Score: ${report.healthScore?.overall ?? "N/A"}/100 (Grade: ${report.healthScore?.grade || "N/A"})`);
        parts.push(`Growth Stage: ${report.growthStage || "Unknown"}`);
        parts.push(`Summary: ${report.healthScore?.summary || ""}`);
        if (report.healthScore?.categories) {
          parts.push("Category Breakdown:");
          for (const [key, cat] of Object.entries(report.healthScore.categories) as [string, any][]) {
            parts.push(`  - ${key}: ${cat.score}/100 (${cat.label}) — ${cat.detail}`);
          }
        }
        if (report.quickWins?.length > 0) {
          parts.push("");
          parts.push("=== QUICK WINS AVAILABLE ===");
          report.quickWins.forEach((w: any, i: number) => {
            parts.push(`${i + 1}. ${w.observation} → ${w.suggestion}`);
          });
        }
        if (report.missedOpportunities?.length > 0) {
          parts.push("");
          parts.push("=== MISSED OPPORTUNITIES ===");
          report.missedOpportunities.forEach((o: any, i: number) => {
            parts.push(`${i + 1}. ${o.observation}: ${o.insight}`);
          });
        }
      }

      if (insightsRes.ok) {
        const insData = await insightsRes.json();
        if (insData.insights?.length > 0) {
          parts.push("");
          parts.push("=== TOP STRATEGIC INSIGHTS ===");
          insData.insights.slice(0, 5).forEach((ins: any, i: number) => {
            parts.push(`${i + 1}. [${ins.impact?.toUpperCase()} IMPACT] ${ins.observation}`);
            parts.push(`   Why: ${ins.insight}`);
            parts.push(`   Do: ${ins.suggestion}`);
          });
        }
      }

      contextPrompt = "\n\n" + parts.join("\n");

      const history = updatedMessages.map(m => ({ role: m.role, content: m.content }));
      await startStream("/api/bot/chat/advisor-stream", {
        message: text.trim(),
        persona: STRATEGIC_PROMPT + contextPrompt,
        conversationHistory: history,
      }, {
        onDone: (fullText) => {
          setMessages(prev => [...prev, { role: "assistant", content: fullText }]);
        },
        onError: () => {
          setMessages(prev => [...prev, { role: "assistant", content: "Connection issue. Please try again in a moment." }]);
        },
      });
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Connection issue. Please try again in a moment." }]);
    }

    try {
      await fetch("/api/operator/cognitive/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subAccountId, action: "last_interaction", value: new Date().toISOString() }),
      });
      fetch(`/api/operator/cognitive/memories/${subAccountId}/extract-preferences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text.trim() }),
      }).catch(() => {});
    } catch {}
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="chat-tab">
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5" style={{ minHeight: 0 }}>
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[88%] p-3 text-[11px] rounded-xl whitespace-pre-wrap leading-relaxed ${
                m.role === "user"
                  ? "bg-gradient-to-br from-violet-500/20 to-cyan-500/15 text-white rounded-br-sm border border-violet-500/20"
                  : "bg-white/[0.03] text-slate-300 rounded-bl-sm border border-white/[0.06]"
              }`}
              data-testid={`intel-message-${m.role}-${i}`}
            >
              {m.role === "assistant" ? parseLinks(m.content, setLocation) : m.content}
            </div>
          </div>
        ))}

        {isStreaming && streamingText && (
          <div className="flex justify-start">
            <div
              className="max-w-[88%] p-3 text-[11px] rounded-xl whitespace-pre-wrap leading-relaxed bg-white/[0.03] text-slate-300 rounded-bl-sm border border-white/[0.06]"
              data-testid="intel-message-streaming"
            >
              {parseLinks(streamingText, setLocation)}
              <span className="inline-block w-1.5 h-3.5 bg-violet-400 animate-pulse ml-0.5 align-middle rounded-sm" />
            </div>
          </div>
        )}

        {isStreaming && !streamingText && (
          <div className="flex justify-start">
            <div className="bg-white/[0.03] border border-white/[0.06] text-slate-500 rounded-xl rounded-bl-sm p-3 text-[11px] flex items-center gap-2">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              Thinking strategically...
            </div>
          </div>
        )}

        {messages.length === 1 && !isStreaming && (
          <div className="space-y-1.5 pt-1">
            {QUICK_COMMANDS.map(({ label, icon: QIcon }) => (
              <button
                key={label}
                onClick={() => sendMessage(label)}
                className="w-full text-left p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.06] text-[11px] text-slate-400 hover:bg-gradient-to-r hover:from-violet-500/10 hover:to-cyan-500/10 hover:border-violet-500/20 hover:text-white transition-all flex items-center gap-2.5 group"
                data-testid={`button-quick-${label.replace(/\s+/g, "-").toLowerCase()}`}
              >
                <QIcon size={13} className="text-slate-600 group-hover:text-violet-400 transition-colors shrink-0" />
                {label}
                <ArrowRight size={10} className="ml-auto opacity-0 group-hover:opacity-100 text-cyan-400 transition-opacity" />
              </button>
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="p-2.5 border-t border-white/[0.06] flex gap-2">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
          placeholder="Ask your strategic advisor..."
          className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 text-[11px] text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500/40 transition-colors"
          disabled={isStreaming}
          data-testid="input-intel-message"
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={isStreaming || !input.trim()}
          className="p-2 rounded-lg bg-gradient-to-br from-violet-500/20 to-cyan-500/20 border border-violet-500/25 text-violet-400 hover:from-violet-500/30 hover:to-cyan-500/30 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          data-testid="button-intel-send"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

function AgentTab({ subAccountId }: { subAccountId: number }) {
  const queryClient = useQueryClient();
  const [showConfig, setShowConfig] = useState(false);
  const [expandedTask, setExpandedTask] = useState<number | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["/api/agent/stats", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/agent/stats/${subAccountId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!subAccountId,
    refetchInterval: 15000,
  });

  const { data: tasksData } = useQuery({
    queryKey: ["/api/agent/tasks", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/agent/tasks/${subAccountId}?limit=20`);
      if (!res.ok) return { tasks: [] };
      return res.json();
    },
    enabled: !!subAccountId,
    refetchInterval: 15000,
  });

  const { data: briefingData } = useQuery({
    queryKey: ["/api/agent/briefings", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/agent/briefings/${subAccountId}`);
      if (!res.ok) return { briefings: [] };
      return res.json();
    },
    enabled: !!subAccountId,
    staleTime: 60000,
  });

  const { data: outcomes } = useQuery({
    queryKey: ["/api/agent/outcomes", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/agent/outcomes/${subAccountId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!subAccountId,
    staleTime: 120000,
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/agent/scan/${subAccountId}`, { method: "POST" });
      if (!res.ok) throw new Error("Scan failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/stats", subAccountId] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent/tasks", subAccountId] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent/briefings", subAccountId] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch(`/api/agent/config/${subAccountId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Config update failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/stats", subAccountId] });
    },
  });

  const dismissBriefing = useMutation({
    mutationFn: async (briefingId: number) => {
      await fetch(`/api/agent/briefings/${briefingId}/seen`, { method: "POST" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/briefings", subAccountId] });
    },
  });

  const isEnabled = stats?.config?.enabled !== false;
  const tasks = tasksData?.tasks || [];
  const briefings = briefingData?.briefings || [];

  const statusIcon = (status: string) => {
    if (status === "completed") return <CheckCircle2 size={12} className="text-emerald-400" />;
    if (status === "failed") return <AlertTriangle size={12} className="text-red-400" />;
    if (status === "running") return <Loader2 size={12} className="text-cyan-400 animate-spin" />;
    return <Clock size={12} className="text-slate-500" />;
  };

  const priorityColor = (p: number) => {
    if (p >= 90) return "text-red-400";
    if (p >= 70) return "text-amber-400";
    if (p >= 40) return "text-cyan-400";
    return "text-slate-500";
  };

  const hasAIReasoning = (desc: string) => desc?.includes("AI Reasoning:");

  if (statsLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-violet-400" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="panel-agent-tab">
      <div className="px-3 py-2 flex items-center justify-between border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <motion.div
            className={`w-2 h-2 rounded-full ${isEnabled ? "bg-emerald-400" : "bg-slate-600"}`}
            animate={isEnabled ? { scale: [1, 1.3, 1], opacity: [1, 0.7, 1] } : {}}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            {isEnabled ? "AI Active" : "Paused"}
          </span>
          {stats && (
            <span className="text-[9px] text-slate-600">
              {stats.todayCount}/{stats.config?.maxTasksPerDay || 10} today
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => toggleMutation.mutate(!isEnabled)}
            className={`p-1 rounded transition-colors ${isEnabled ? "text-emerald-400 hover:bg-emerald-400/10" : "text-slate-600 hover:bg-white/5"}`}
            title={isEnabled ? "Pause Agent" : "Enable Agent"}
            data-testid="button-agent-toggle"
          >
            <Power size={12} />
          </button>
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
            data-testid="button-agent-settings"
          >
            <Settings2 size={12} />
          </button>
          <button
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
            className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-gradient-to-r from-violet-500/20 to-cyan-500/20 text-violet-400 border border-violet-500/20 hover:from-violet-500/30 hover:to-cyan-500/30 transition-all disabled:opacity-50"
            data-testid="button-agent-scan"
          >
            {scanMutation.isPending ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
            AI Scan
          </button>
        </div>
      </div>

      <AnimatePresence>
        {briefings.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {briefings.slice(0, 1).map((b: any) => (
              <div key={b.id} className="px-3 py-2.5 bg-gradient-to-r from-cyan-500/[0.06] to-violet-500/[0.06] border-b border-cyan-500/10" data-testid="agent-briefing-banner">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Eye size={10} className="text-cyan-400" />
                      <span className="text-[9px] font-bold text-cyan-400 uppercase tracking-wider">While you were away</span>
                      <span className="text-[8px] text-slate-600">
                        {b.tasksCompleted} done {b.tasksFailed > 0 ? `· ${b.tasksFailed} failed` : ""}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-300 leading-relaxed">{b.summary}</p>
                  </div>
                  <button
                    onClick={() => dismissBriefing.mutate(b.id)}
                    className="p-0.5 rounded text-slate-600 hover:text-slate-400 transition-colors shrink-0"
                    data-testid="button-dismiss-briefing"
                  >
                    <X size={10} />
                  </button>
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showConfig && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-white/[0.04]"
          >
            <div className="p-3 space-y-2 bg-violet-500/[0.03]">
              {stats?.config && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">Autonomy</span>
                    <span className="text-[10px] text-violet-400 font-medium capitalize">{stats.config.autonomyLevel}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">Scan Interval</span>
                    <span className="text-[10px] text-slate-400">{stats.config.scanIntervalMinutes}min</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">Max Tasks/Day</span>
                    <span className="text-[10px] text-slate-400">{stats.config.maxTasksPerDay}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">Last Scan</span>
                    <span className="text-[10px] text-slate-400">{stats.config.lastScanAt ? new Date(stats.config.lastScanAt).toLocaleTimeString() : "Never"}</span>
                  </div>
                </>
              )}
              {outcomes && outcomes.totalTasks > 0 && (
                <>
                  <div className="h-px bg-white/[0.04] my-1" />
                  <div className="flex items-center gap-1.5 mb-1">
                    <Brain size={9} className="text-violet-400" />
                    <span className="text-[9px] font-bold text-violet-400 uppercase tracking-wider">Learning Stats</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">Success Rate</span>
                    <span className={`text-[10px] font-medium ${outcomes.successRate >= 80 ? "text-emerald-400" : outcomes.successRate >= 50 ? "text-amber-400" : "text-red-400"}`}>{outcomes.successRate}%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">Best Streak</span>
                    <span className="text-[10px] text-slate-400">{outcomes.streaks?.longestSuccess || 0} tasks</span>
                  </div>
                  {outcomes.topSuccessTypes?.slice(0, 2).map((t: { type: string; count: number }) => (
                    <div key={t.type} className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500 truncate">{t.type}</span>
                      <span className="text-[10px] text-emerald-400/70">{t.count}x</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {stats && (
        <div className="px-3 py-2 grid grid-cols-4 gap-1 border-b border-white/[0.04]">
          {[
            { label: "Total", value: stats.totalTasks, color: "text-white" },
            { label: "Done", value: stats.completed, color: "text-emerald-400" },
            { label: "Failed", value: stats.failed, color: "text-red-400" },
            { label: "Queued", value: stats.queued + stats.running, color: "text-cyan-400" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <p className={`text-sm font-bold ${s.color}`}>{s.value}</p>
              <p className="text-[8px] text-slate-600 uppercase tracking-wider">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto scrollbar-thin" data-testid="list-agent-tasks">
        {tasks.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div className="space-y-2">
              <Bot size={28} className="mx-auto text-slate-700" />
              <p className="text-[11px] text-slate-600">No tasks yet</p>
              <p className="text-[9px] text-slate-700">Click "AI Scan" to let the agent analyze your account</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.03]">
            {tasks.map((task: any) => (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="px-3 py-2 hover:bg-white/[0.02] transition-colors cursor-pointer group"
                onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
                data-testid={`task-item-${task.id}`}
              >
                <div className="flex items-start gap-2">
                  <div className="mt-0.5">{statusIcon(task.status)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[11px] text-white font-medium truncate">{task.title}</p>
                      <span className={`text-[8px] font-bold ${priorityColor(task.priority)}`}>P{task.priority}</span>
                      {hasAIReasoning(task.description) && (
                        <span className="text-[7px] px-1 py-px rounded bg-violet-500/15 text-violet-400 border border-violet-500/20 font-semibold">AI</span>
                      )}
                    </div>
                    {task.description && (
                      <p className={`text-[9px] text-slate-500 mt-0.5 ${expandedTask === task.id ? "" : "line-clamp-2"}`}>
                        {task.description}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[8px] text-slate-700">{new Date(task.createdAt).toLocaleTimeString()}</span>
                      {task.toolUsed && (
                        <span className="text-[8px] text-violet-500/60 flex items-center gap-0.5">
                          <Zap size={7} /> {task.toolUsed}
                        </span>
                      )}
                      {task.triggeredBy === "autonomous-agent" && (
                        <span className="text-[8px] text-cyan-500/40 flex items-center gap-0.5">
                          <Bot size={7} /> auto
                        </span>
                      )}
                      {task.status === "failed" && task.error && (
                        <span className="text-[8px] text-red-400/60 truncate max-w-[150px]">{task.error}</span>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface AgentMemory {
  id: number;
  memoryType: string;
  content: string;
  category?: string;
  relevanceScore: number;
  decayRate: number;
  sourceEvent?: string;
  outcome?: string;
  tags?: string[];
  accessCount?: number;
  createdAt?: string;
}

function MemoryTab({ subAccountId }: { subAccountId: number }) {
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");

  const { data, isLoading, refetch } = useQuery<{ memories: AgentMemory[]; total: number }>({
    queryKey: ["/api/operator/cognitive/memories", subAccountId, typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (typeFilter) params.set("memoryType", typeFilter);
      const res = await fetch(`/api/operator/cognitive/memories/${subAccountId}?${params}`);
      if (!res.ok) return { memories: [], total: 0 };
      return res.json();
    },
    enabled: !!subAccountId,
    staleTime: 30000,
  });

  const deleteMutation = useMutation({
    mutationFn: async (memoryId: number) => {
      const res = await fetch(`/api/operator/cognitive/memories/${subAccountId}/${memoryId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/operator/cognitive/memories", subAccountId, typeFilter] }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ memoryId, content }: { memoryId: number; content: string }) => {
      const res = await fetch(`/api/operator/cognitive/memories/${subAccountId}/${memoryId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      setEditingId(null);
      setEditContent("");
      queryClient.invalidateQueries({ queryKey: ["/api/operator/cognitive/memories", subAccountId, typeFilter] });
    },
  });

  const memories = data?.memories || [];
  const total = data?.total || 0;

  const typeColors: Record<string, { bg: string; text: string; border: string }> = {
    decision: { bg: "bg-violet-500/10", text: "text-violet-400", border: "border-violet-500/15" },
    outcome: { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/15" },
    preference: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/15" },
    observation: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/15" },
  };

  const typeIcons: Record<string, typeof Brain> = {
    decision: Crosshair,
    outcome: Target,
    preference: Heart,
    observation: Eye,
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="memory-loading">
        <div className="text-center space-y-3">
          <Loader2 className="w-6 h-6 text-violet-400 animate-spin mx-auto" />
          <p className="text-xs text-slate-500">Loading agent memories...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="memory-tab">
      <div className="px-3 py-2 border-b border-white/[0.04] space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <BookOpen size={11} className="text-violet-400" />
            <p className="text-[9px] font-bold uppercase tracking-widest text-violet-400">{total} Memor{total !== 1 ? "ies" : "y"}</p>
          </div>
          <button onClick={() => refetch()} className="p-1 rounded hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors" data-testid="button-refresh-memories">
            <RefreshCw size={12} />
          </button>
        </div>
        <div className="flex gap-1">
          {["", "decision", "outcome", "preference", "observation"].map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-2 py-0.5 rounded-md text-[9px] font-medium transition-colors ${
                typeFilter === t
                  ? "bg-violet-500/20 text-violet-400 border border-violet-500/30"
                  : "bg-white/[0.03] text-slate-500 border border-white/[0.06] hover:text-slate-300"
              }`}
              data-testid={`button-filter-${t || "all"}`}
            >
              {t || "All"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2" data-testid="list-memories">
        {memories.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div className="space-y-2">
              <BookOpen size={28} className="mx-auto text-slate-700" />
              <p className="text-[11px] text-slate-600">No memories yet</p>
              <p className="text-[9px] text-slate-700">The agent will learn from decisions, outcomes, and your interactions</p>
            </div>
          </div>
        ) : (
          memories.map((memory, i) => {
            const colors = typeColors[memory.memoryType] || typeColors.observation;
            const MemIcon = typeIcons[memory.memoryType] || Eye;
            const isEditing = editingId === memory.id;

            return (
              <motion.div
                key={memory.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className={`p-3 rounded-xl ${colors.bg} border ${colors.border} transition-all`}
                data-testid={`memory-card-${memory.id}`}
              >
                <div className="flex items-start gap-2">
                  <div className={`w-6 h-6 rounded-lg ${colors.bg} flex items-center justify-center shrink-0 mt-0.5 border ${colors.border}`}>
                    <MemIcon size={11} className={colors.text} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`text-[8px] font-bold uppercase tracking-wider ${colors.text}`}>{memory.memoryType}</span>
                      {memory.outcome && (
                        <span className={`text-[8px] px-1 py-px rounded ${memory.outcome === "success" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>
                          {memory.outcome}
                        </span>
                      )}
                      <span className="text-[8px] text-slate-600 ml-auto">
                        {Math.round(memory.relevanceScore * 100)}% relevant
                      </span>
                    </div>
                    {isEditing ? (
                      <div className="space-y-1.5">
                        <textarea
                          value={editContent}
                          onChange={e => setEditContent(e.target.value)}
                          className="w-full bg-white/[0.05] border border-white/[0.1] rounded-md px-2 py-1.5 text-[10px] text-white focus:outline-none focus:border-violet-500/40 resize-none"
                          rows={3}
                          data-testid={`input-edit-memory-${memory.id}`}
                        />
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => updateMutation.mutate({ memoryId: memory.id, content: editContent })}
                            disabled={updateMutation.isPending}
                            className="px-2 py-0.5 rounded text-[9px] font-medium bg-violet-500/20 text-violet-400 border border-violet-500/30 hover:bg-violet-500/30 transition-colors disabled:opacity-50"
                            data-testid={`button-save-memory-${memory.id}`}
                          >
                            Save
                          </button>
                          <button
                            onClick={() => { setEditingId(null); setEditContent(""); }}
                            className="px-2 py-0.5 rounded text-[9px] text-slate-500 hover:text-slate-300 transition-colors"
                            data-testid={`button-cancel-edit-${memory.id}`}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[10px] text-slate-300 leading-relaxed">{memory.content}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5">
                      {memory.sourceEvent && (
                        <span className="text-[8px] text-slate-600">{memory.sourceEvent}</span>
                      )}
                      {memory.createdAt && (
                        <span className="text-[8px] text-slate-700">
                          {new Date(memory.createdAt).toLocaleDateString()}
                        </span>
                      )}
                      <div className="flex items-center gap-1 ml-auto">
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingId(memory.id); setEditContent(memory.content); }}
                          className="p-0.5 rounded text-slate-600 hover:text-slate-400 transition-colors"
                          title="Edit memory"
                          data-testid={`button-edit-memory-${memory.id}`}
                        >
                          <Edit3 size={10} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); if (window.confirm("Delete this memory? This cannot be undone.")) deleteMutation.mutate(memory.id); }}
                          disabled={deleteMutation.isPending}
                          className="p-0.5 rounded text-slate-600 hover:text-red-400 transition-colors disabled:opacity-50"
                          title="Delete memory"
                          data-testid={`button-delete-memory-${memory.id}`}
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}

const TABS: { id: TabId; label: string; icon: typeof Brain }[] = [
  { id: "command", label: "Command", icon: Terminal },
  { id: "insights", label: "Strategy", icon: Crosshair },
  { id: "nudges", label: "Nudges", icon: Bell },
  { id: "industry", label: "Industry", icon: Factory },
  { id: "trends", label: "Trends", icon: TrendingUp },
  { id: "chat", label: "Advisor", icon: Brain },
  { id: "agent", label: "Agent", icon: Bot },
  { id: "memory", label: "Memory", icon: BookOpen },
];

export function ApexIntelligence() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("command");
  const { activeAccountId } = useAccount();
  const subAccountId = activeAccountId;

  const { data: nudgeData } = useQuery<{ nudges: any[] }>({
    queryKey: ["/api/operator/cognitive/nudges/pending", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/operator/cognitive/nudges/${subAccountId}/pending`);
      if (!res.ok) return { nudges: [] };
      return res.json();
    },
    enabled: !!subAccountId && !isOpen,
    staleTime: 120000,
    refetchInterval: 300000,
  });

  const { data: healthData } = useQuery<HealthScore>({
    queryKey: ["/api/operator/cognitive/health", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/operator/cognitive/health/${subAccountId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!subAccountId && !isOpen,
    staleTime: 120000,
  });

  const nudgeCount = nudgeData?.nudges?.length || 0;
  const healthScore = healthData?.overall;

  return (
    <div className="fixed bottom-6 left-6 z-50 flex flex-col items-start">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="mb-4 w-[420px] max-w-[92vw] rounded-2xl overflow-hidden flex flex-col"
            style={{
              height: "620px",
              background: "linear-gradient(180deg, rgba(8,8,24,0.99) 0%, rgba(6,6,18,0.995) 100%)",
              boxShadow: "0 0 0 1px rgba(139,92,246,0.12), 0 25px 60px -12px rgba(0,0,0,0.85), 0 0 100px rgba(139,92,246,0.06), 0 0 160px rgba(6,182,212,0.03)",
              backdropFilter: "blur(24px)",
            }}
            data-testid="panel-apex-intelligence"
          >
            <div className="relative px-4 pt-4 pb-2">
              <div className="absolute inset-0 bg-gradient-to-r from-violet-600/[0.06] via-transparent to-cyan-600/[0.06]" />
              <div className="absolute inset-0 overflow-hidden">
                <motion.div
                  className="absolute w-[200px] h-[200px] rounded-full"
                  style={{ background: "radial-gradient(circle, rgba(139,92,246,0.06) 0%, transparent 70%)", top: "-100px", left: "-50px" }}
                  animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                />
              </div>
              <div className="relative flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/25 to-cyan-500/20 flex items-center justify-center border border-violet-500/25">
                      <Brain size={20} className="text-violet-400" />
                    </div>
                    <motion.span
                      className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#080818]"
                      animate={{ scale: [1, 1.3, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white tracking-tight leading-none">Apex Intelligence</p>
                    <p className="text-[10px] text-violet-400/60 mt-0.5 font-medium tracking-widest uppercase">Strategic Advisor v2</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-slate-500 hover:text-white"
                  data-testid="button-intel-close"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="relative flex mt-3 gap-0.5 bg-white/[0.02] rounded-lg p-0.5 border border-white/[0.04]">
                {TABS.map(tab => {
                  const isActive = activeTab === tab.id;
                  const TabIcon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`relative flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-[9px] font-semibold tracking-wide transition-all ${
                        isActive ? "text-white" : "text-slate-600 hover:text-slate-400"
                      }`}
                      data-testid={`tab-intel-${tab.id}`}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="activeIntelTab"
                          className="absolute inset-0 rounded-md bg-gradient-to-r from-violet-500/15 to-cyan-500/15 border border-violet-500/20"
                          transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                        />
                      )}
                      <span className="relative flex items-center gap-1">
                        <TabIcon size={10} />
                        {tab.label}
                        {tab.id === "nudges" && nudgeCount > 0 && (
                          <span className="w-3.5 h-3.5 rounded-full bg-violet-500 text-white text-[7px] font-bold flex items-center justify-center">{nudgeCount}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="h-px bg-gradient-to-r from-transparent via-violet-500/15 to-transparent" />

            <div className="flex-1 flex flex-col overflow-hidden">
              {!subAccountId ? (
                <div className="flex-1 flex items-center justify-center p-6">
                  <div className="text-center space-y-3">
                    <Shield size={28} className="mx-auto text-slate-600" />
                    <p className="text-xs text-slate-500">Select an account to activate intelligence</p>
                  </div>
                </div>
              ) : (
                <>
                  {activeTab === "command" && <CommandTab subAccountId={subAccountId} />}
                  {activeTab === "insights" && <InsightsTab subAccountId={subAccountId} />}
                  {activeTab === "nudges" && <NudgesTab subAccountId={subAccountId} />}
                  {activeTab === "industry" && <IndustryTab subAccountId={subAccountId} />}
                  {activeTab === "trends" && <TrendsTab subAccountId={subAccountId} />}
                  {activeTab === "chat" && <ChatTab subAccountId={subAccountId} />}
                  {activeTab === "agent" && <AgentTab subAccountId={subAccountId} />}
                  {activeTab === "memory" && <MemoryTab subAccountId={subAccountId} />}
                </>
              )}
            </div>

            <div className="h-px bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
            <div className="px-3 py-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <motion.div
                  className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                  animate={{ opacity: [1, 0.4, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                <span className="text-[9px] text-slate-600 font-medium">Apex Cognitive Engine v2</span>
              </div>
              <span className="text-[9px] text-slate-700">{subAccountId ? `Account #${subAccountId}` : ""}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className="group relative w-20 h-20 rounded-3xl flex items-center justify-center transition-all"
        style={{
          background: isOpen
            ? "linear-gradient(135deg, rgba(139,92,246,0.2), rgba(6,182,212,0.15))"
            : "linear-gradient(135deg, rgba(10,10,26,0.95), rgba(15,15,35,0.95))",
          boxShadow: isOpen
            ? "0 0 0 1px rgba(139,92,246,0.3), 0 8px 32px rgba(139,92,246,0.15)"
            : "0 0 0 1px rgba(139,92,246,0.15), 0 12px 40px rgba(0,0,0,0.5), 0 0 80px rgba(139,92,246,0.1), 0 0 120px rgba(139,92,246,0.05)",
          backdropFilter: "blur(16px)",
        }}
        data-testid="button-intel-toggle"
      >
        <AnimatePresence mode="wait">
          {isOpen ? (
            <motion.div key="close" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.15 }}>
              <X size={32} className="text-violet-400" />
            </motion.div>
          ) : (
            <motion.div
              key="brain"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: [1, 1.15, 1], opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ scale: { duration: 2, repeat: Infinity, ease: "easeInOut" }, opacity: { duration: 0.15 } }}
              className="relative"
              style={{ filter: "drop-shadow(0 0 12px rgba(139,92,246,0.5))" }}
            >
              <Brain size={40} className="text-violet-400 group-hover:text-violet-300 transition-colors" />
              {healthScore !== undefined && healthScore !== null && (
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[8px] font-black bg-black/80 border border-violet-500/30 text-violet-300" data-testid="text-btn-health-score">
                  {healthScore}
                </span>
              )}
              {nudgeCount > 0 && (
                <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-violet-500 text-white text-[9px] font-bold flex items-center justify-center shadow-lg shadow-violet-500/40">
                  {nudgeCount > 9 ? "9+" : nudgeCount}
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {!isOpen && (
          <>
            <span className="absolute inset-0 rounded-3xl border border-violet-500/20 opacity-0 group-hover:opacity-100 transition-opacity" />
            <span className="absolute inset-[-4px] rounded-[22px] border border-violet-400/15 animate-pulse" />
            <span className="absolute inset-[-8px] rounded-[26px] border border-violet-400/5 animate-pulse" style={{ animationDelay: "0.5s" }} />
          </>
        )}
      </motion.button>
    </div>
  );
}
