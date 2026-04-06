import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  Brain, RefreshCw, Shield, TrendingUp, AlertTriangle,
  Lightbulb, Eye, Archive, Clock, BarChart3, Zap, Activity,
  Search, Target, Users, MessageSquare, Wand2, ArrowRight,
  FileText, Send, Loader2
} from "lucide-react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";

interface SharedInsight {
  id: number;
  category: string;
  content: string;
  sourceAccountId: number;
  confidenceScore: number;
  decayRate: number;
  occurrenceCount: number;
  lastSeenAt: string;
  isArchived: boolean;
  metadata?: any;
  createdAt: string;
}

const CATEGORY_CONFIG: Record<string, { label: string; icon: any; color: string; bg: string; hex: string }> = {
  customer_objection: { label: "Objections", icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/15", hex: "#fbbf24" },
  competitor_mention: { label: "Competitors", icon: Target, color: "text-red-400", bg: "bg-red-500/15", hex: "#f87171" },
  product_feedback: { label: "Feedback", icon: MessageSquare, color: "text-blue-400", bg: "bg-blue-500/15", hex: "#60a5fa" },
  buying_signal: { label: "Buy Signals", icon: Zap, color: "text-emerald-400", bg: "bg-emerald-500/15", hex: "#34d399" },
  feature_request: { label: "Features", icon: Lightbulb, color: "text-violet-400", bg: "bg-violet-500/15", hex: "#a78bfa" },
  pain_point: { label: "Pain Points", icon: AlertTriangle, color: "text-orange-400", bg: "bg-orange-500/15", hex: "#fb923c" },
  pricing_concern: { label: "Pricing", icon: TrendingUp, color: "text-cyan-400", bg: "bg-cyan-500/15", hex: "#22d3ee" },
  churn_risk: { label: "Churn Risk", icon: Activity, color: "text-red-400", bg: "bg-red-500/15", hex: "#f87171" },
};

const EXEC_STATS = [
  { key: "total", label: "Total Insights", icon: Brain, bg: "bg-cyan-500/15", iconColor: "text-cyan-400" },
  { key: "highConfidence", label: "High Confidence", icon: Zap, bg: "bg-emerald-500/15", iconColor: "text-emerald-400" },
  { key: "avgConfidence", label: "Avg Confidence", icon: BarChart3, bg: "bg-violet-500/15", iconColor: "text-violet-400" },
  { key: "activeAccounts", label: "Active Accounts", icon: Users, bg: "bg-blue-500/15", iconColor: "text-blue-400" },
  { key: "recentCount", label: "Last 7 Days", icon: Clock, bg: "bg-amber-500/15", iconColor: "text-amber-400" },
];

export default function IntelligenceDashboard() {
  const { user } = useAuth();
  const adminSecret = user?.id || "";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [minConfidence, setMinConfidence] = useState(0.3);

  const isAdmin = user?.isAdmin === "true" || (user as any)?.role === "DEV_ADMIN";

  const { data, isLoading } = useQuery<{ insights: SharedInsight[]; stats: any }>({
    queryKey: ["/api/intelligence/insights", categoryFilter, minConfidence],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "200", minConfidence: String(minConfidence) });
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      const r = await fetch(`/api/intelligence/insights?${params}`, {
        headers: { "x-admin-secret": adminSecret },
      });
      if (!r.ok) throw new Error("Access denied or fetch failed");
      return r.json();
    },
    enabled: isAdmin,
  });

  const refreshMut = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/intelligence/insights/refresh", {
        method: "POST",
        headers: { "x-admin-secret": adminSecret, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error("Refresh failed");
      return r.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/intelligence/insights"] });
      toast({
        title: "Intelligence refreshed",
        description: `Processed ${result.accountsProcessed} accounts, ${result.conversationsAnalyzed} conversations`,
      });
    },
    onError: () => toast({ title: "Refresh failed", variant: "destructive" }),
  });

  const cleanupMut = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/intelligence/insights/cleanup", {
        method: "POST",
        headers: { "x-admin-secret": adminSecret },
      });
      if (!r.ok) throw new Error("Cleanup failed");
      return r.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/intelligence/insights"] });
      toast({ title: "Cleanup complete", description: `${result.archivedCount} stale insights archived` });
    },
    onError: () => toast({ title: "Cleanup failed", variant: "destructive" }),
  });

  const insights = data?.insights || [];
  const filtered = insights.filter((i) => {
    if (search && !i.content.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const categoryCounts = useMemo(() => insights.reduce((acc, i) => {
    acc[i.category] = (acc[i.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>), [insights]);

  const execStats: Record<string, string | number> = useMemo(() => {
    const highConfidence = insights.filter((i) => i.confidenceScore >= 0.8).length;
    const avgConfidence = insights.length > 0
      ? `${(insights.reduce((s, i) => s + i.confidenceScore, 0) / insights.length * 100).toFixed(0)}%`
      : "—";
    const activeAccounts = new Set(insights.map((i) => i.sourceAccountId)).size;
    const recentCount = insights.filter((i) => Date.now() - new Date(i.lastSeenAt).getTime() < 7 * 24 * 60 * 60 * 1000).length;
    return { total: insights.length, highConfidence, avgConfidence, activeAccounts, recentCount };
  }, [insights]);

  const topCategories = useMemo(() => {
    const sorted = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
    const max = sorted[0]?.[1] || 1;
    return sorted.map(([cat, count]) => ({ cat, count, pct: (count / max) * 100 }));
  }, [categoryCounts]);

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <Card className="glass border-white/10 max-w-md w-full">
          <CardContent className="p-10 text-center">
            <div className="w-20 h-20 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-6">
              <Shield className="w-9 h-9 text-red-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Access Restricted</h2>
            <p className="text-sm text-slate-200">This dashboard requires administrator privileges.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-8 space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg" style={{ background: `linear-gradient(to bottom right, var(--vibe-glow, #06b6d4), var(--vibe-accent, #4f46e5))` }}>
              <Brain className="w-5 h-5 text-white" />
            </div>
            Intelligence Dashboard
            <Badge className="bg-red-500/20 text-red-400 border-red-500/20 text-[10px] px-2 py-0.5 h-5">
              <Shield className="w-2.5 h-2.5 mr-1" /> Admin
            </Badge>
          </h1>
          <p className="text-slate-200 mt-1 text-sm">Cross-account intelligence, patterns, and strategic insights</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            data-testid="button-cleanup-insights"
            onClick={() => cleanupMut.mutate()}
            disabled={cleanupMut.isPending}
            variant="outline"
            size="sm"
            className="border-white/10 text-white/50 hover:text-white hover:bg-white/5"
          >
            <Archive className="w-3.5 h-3.5 mr-1.5" /> Cleanup
          </Button>
          <Button
            data-testid="button-refresh-insights"
            onClick={() => refreshMut.mutate()}
            disabled={refreshMut.isPending}
            className="text-white border-0 shadow-lg glow-box"
            style={{ background: `linear-gradient(to right, var(--vibe-glow, #06b6d4), var(--vibe-accent, #4f46e5))` }}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${refreshMut.isPending ? "animate-spin" : ""}`} />
            {refreshMut.isPending ? "Analyzing..." : "Refresh Intelligence"}
          </Button>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {EXEC_STATS.map((s, idx) => (
          <motion.div key={s.key} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + idx * 0.04 }}>
            <Card className="bg-black/40 border-white/10 hover:border-white/20 transition-all backdrop-blur-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg ${s.bg} flex items-center justify-center`}>
                  <s.icon className={`w-4.5 h-4.5 ${s.iconColor}`} />
                </div>
                <div>
                  <p className="text-xl font-black text-white">{execStats[s.key]}</p>
                  <p className="text-[11px] text-slate-200">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="bg-black/40 border-white/10 backdrop-blur-sm lg:col-span-2">
          <CardContent className="p-5">
            <h3 className="text-xs font-bold text-white/40 uppercase tracking-wider mb-4">Intelligence Distribution</h3>
            {topCategories.length > 0 ? (
              <div className="space-y-3">
                {topCategories.map(({ cat, count, pct }) => {
                  const cfg = CATEGORY_CONFIG[cat] || { label: cat, hex: "#9ca3af", icon: Lightbulb };
                  return (
                    <button
                      key={cat}
                      data-testid={`button-category-${cat}`}
                      onClick={() => setCategoryFilter(categoryFilter === cat ? "all" : cat)}
                      className={`w-full flex items-center gap-3 group transition-all ${categoryFilter === cat ? "opacity-100" : "opacity-70 hover:opacity-100"}`}
                    >
                      <span className="text-[11px] font-medium text-white/60 w-20 text-right shrink-0">{cfg.label}</span>
                      <div className="flex-1 h-7 bg-white/[0.03] rounded-lg overflow-hidden border border-white/5 relative">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.8, delay: 0.2 }}
                          className="h-full rounded-lg relative"
                          style={{ background: `linear-gradient(to right, ${cfg.hex}30, ${cfg.hex}60)` }}
                        >
                          <div className="absolute inset-0 bg-gradient-to-r from-transparent to-white/10" />
                        </motion.div>
                        {categoryFilter === cat && (
                          <div className="absolute inset-0 rounded-lg" style={{ boxShadow: `inset 0 0 0 1px ${cfg.hex}60` }} />
                        )}
                      </div>
                      <span className="text-xs font-bold text-white/50 w-8 text-right">{count}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-white/20 text-sm">No data available</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-black/40 border-white/10 backdrop-blur-sm">
          <CardContent className="p-5">
            <h3 className="text-xs font-bold text-white/40 uppercase tracking-wider mb-4">Category Breakdown</h3>
            <div className="space-y-2">
              {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => {
                const count = categoryCounts[key] || 0;
                const CIcon = cfg.icon;
                return (
                  <button
                    key={key}
                    data-testid={`button-breakdown-${key}`}
                    onClick={() => setCategoryFilter(categoryFilter === key ? "all" : key)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all border ${
                      categoryFilter === key
                        ? "bg-white/10 border-white/15 text-white"
                        : "bg-white/[0.02] border-white/5 text-white/50 hover:text-white/70 hover:bg-white/[0.04]"
                    }`}
                  >
                    <div className={`w-7 h-7 rounded-lg ${cfg.bg} flex items-center justify-center shrink-0`}>
                      <CIcon className={`w-3.5 h-3.5 ${cfg.color}`} />
                    </div>
                    <span className="text-[11px] font-medium flex-1 text-left truncate">{cfg.label}</span>
                    <span className="text-[10px] text-white/30 bg-white/5 px-1.5 py-0.5 rounded-full">{count}</span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <Input
            data-testid="input-search-insights"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search insights..."
            className="pl-9 bg-white/5 border-white/10 text-white"
          />
        </div>
        <select
          data-testid="select-min-confidence"
          value={minConfidence}
          onChange={(e) => setMinConfidence(parseFloat(e.target.value))}
          className="h-10 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white min-w-[120px]"
        >
          <option value="0.1" className="bg-gray-900">10%+ confidence</option>
          <option value="0.3" className="bg-gray-900">30%+ confidence</option>
          <option value="0.5" className="bg-gray-900">50%+ confidence</option>
          <option value="0.7" className="bg-gray-900">70%+ confidence</option>
          <option value="0.9" className="bg-gray-900">90%+ confidence</option>
        </select>
      </motion.div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i} className="bg-black/40 border-white/10">
              <CardContent className="p-4 flex gap-4 animate-pulse">
                <div className="w-10 h-10 rounded-lg bg-white/5 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-white/5 rounded w-3/4" />
                  <div className="h-3 bg-white/5 rounded w-1/2" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="bg-black/40 border-white/10 border-dashed">
            <CardContent className="p-12 md:p-16 text-center">
              <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6" style={{
                background: `linear-gradient(to bottom right, color-mix(in srgb, var(--vibe-glow, #06b6d4) 15%, transparent), color-mix(in srgb, var(--vibe-accent, #4f46e5) 10%, transparent))`,
                border: `1px solid color-mix(in srgb, var(--vibe-glow, #06b6d4) 20%, transparent)`,
              }}>
                <Brain className="w-9 h-9 opacity-60" style={{ color: "var(--vibe-glow, #06b6d4)" }} />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">No insights yet</h3>
              <p className="text-sm text-slate-200 mb-8 max-w-md mx-auto leading-relaxed">
                Click "Refresh Intelligence" to analyze recent conversations and extract cross-account patterns, objections, and buying signals.
              </p>
              <Button
                data-testid="button-first-refresh"
                onClick={() => refreshMut.mutate()}
                disabled={refreshMut.isPending}
                className="text-white border-0 shadow-lg px-8 py-3 text-base"
                style={{ background: `linear-gradient(to right, var(--vibe-glow, #06b6d4), var(--vibe-accent, #4f46e5))` }}
              >
                <RefreshCw className={`w-5 h-5 mr-2 ${refreshMut.isPending ? "animate-spin" : ""}`} />
                Run First Analysis
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <div className="space-y-2">
          {filtered.map((insight, i) => {
            const cfg = CATEGORY_CONFIG[insight.category] || { label: insight.category, icon: Lightbulb, color: "text-gray-400", bg: "bg-gray-500/15", hex: "#9ca3af" };
            const CfgIcon = cfg.icon;
            const confidence = Math.round(insight.confidenceScore * 100);
            const age = Math.floor((Date.now() - new Date(insight.lastSeenAt).getTime()) / (1000 * 60 * 60 * 24));

            return (
              <motion.div
                key={insight.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.02 }}
              >
                <Card className="bg-black/40 border-white/10 hover:border-white/20 transition-all" data-testid={`card-insight-${insight.id}`}>
                  <CardContent className="p-4 flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-lg ${cfg.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                      <CfgIcon className={`w-4.5 h-4.5 ${cfg.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge className="border-0 text-[10px] px-1.5 py-0 h-4" style={{ background: `${cfg.hex}20`, color: cfg.hex }}>{cfg.label}</Badge>
                        <span className="text-[10px] text-white/20">Account #{insight.sourceAccountId}</span>
                        {age <= 1 && (
                          <Badge className="border-0 text-[9px] px-1.5 py-0 h-3.5" style={{ background: "var(--vibe-glow, #06b6d4)20", color: "var(--vibe-glow, #06b6d4)" }}>NEW</Badge>
                        )}
                      </div>
                      <p className="text-sm text-white/80 leading-relaxed">{insight.content}</p>
                      <div className="flex items-center gap-4 mt-2.5 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <div className="w-20 h-2 rounded-full bg-white/5 overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${confidence}%` }}
                              transition={{ duration: 0.6 }}
                              className="h-full rounded-full"
                              style={{
                                background: confidence >= 80
                                  ? "linear-gradient(to right, #34d399, #06b6d4)"
                                  : confidence >= 50
                                  ? "linear-gradient(to right, #fbbf24, #f59e0b)"
                                  : "linear-gradient(to right, #f87171, #ef4444)"
                              }}
                            />
                          </div>
                          <span className="text-[10px] text-white/30 font-medium">{confidence}%</span>
                        </div>
                        <span className="text-[10px] text-white/20 flex items-center gap-1">
                          <Eye className="w-2.5 h-2.5" /> {insight.occurrenceCount}x seen
                        </span>
                        <span className="text-[10px] text-white/20 flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" /> {age === 0 ? "Today" : `${age}d ago`}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-3 pt-2.5 border-t border-white/5 flex-wrap">
                        {(() => {
                          const actions: { label: string; link: string; icon: any }[] = [];
                          switch (insight.category) {
                            case "customer_objection":
                              actions.push({ label: "Create Response Template", link: "/whatsapp-templates", icon: FileText });
                              actions.push({ label: "Build Follow-up Flow", link: "/workflows", icon: Zap });
                              break;
                            case "competitor_mention":
                              actions.push({ label: "Draft Comparison", link: "/content-planner", icon: FileText });
                              actions.push({ label: "Launch Counter-Campaign", link: "/meta-ads", icon: Target });
                              break;
                            case "buying_signal":
                              actions.push({ label: "Send Offer Now", link: "/inbox", icon: Send });
                              actions.push({ label: "Create Deal", link: "/pipeline", icon: Zap });
                              break;
                            case "feature_request":
                              actions.push({ label: "Log Feedback", link: "/content-planner", icon: FileText });
                              break;
                            case "product_feedback":
                              actions.push({ label: "Review Feedback", link: "/content-planner", icon: FileText });
                              actions.push({ label: "Create Response", link: "/inbox", icon: Send });
                              break;
                            case "pain_point":
                              actions.push({ label: "Create Solution Post", link: "/content-planner", icon: FileText });
                              actions.push({ label: "Build Nurture Sequence", link: "/workflows", icon: Zap });
                              break;
                            case "pricing_concern":
                              actions.push({ label: "Send Pricing Info", link: "/whatsapp-templates", icon: Send });
                              actions.push({ label: "Create Discount Offer", link: "/email-campaigns", icon: FileText });
                              break;
                            case "churn_risk":
                              actions.push({ label: "Send Retention Message", link: "/inbox", icon: Send });
                              actions.push({ label: "Create Save Campaign", link: "/workflows", icon: Zap });
                              break;
                            default:
                              actions.push({ label: "Take Action", link: "/inbox", icon: ArrowRight });
                          }
                          return actions.map((act) => (
                            <Link key={act.label} href={act.link}
                              data-testid={`button-action-${insight.id}-${act.label.replace(/\s+/g, "-").toLowerCase()}`}
                              className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md transition-all border border-white/10 hover:border-white/20 text-white/40 hover:text-white/70 no-underline"
                            >
                              <act.icon className="w-3 h-3" /> {act.label}
                            </Link>
                          ));
                        })()}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}