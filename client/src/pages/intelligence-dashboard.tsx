import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  Brain, Sparkles, RefreshCw, Shield, TrendingUp, AlertTriangle,
  Lightbulb, Eye, Archive, Clock, BarChart3, Zap, Activity,
  ChevronDown, Filter, Search, Target, Users, MessageSquare
} from "lucide-react";
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

const CATEGORY_CONFIG: Record<string, { label: string; icon: any; color: string; bg: string }> = {
  customer_objection: { label: "Objections", icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/15" },
  competitor_mention: { label: "Competitors", icon: Target, color: "text-red-400", bg: "bg-red-500/15" },
  product_feedback: { label: "Feedback", icon: MessageSquare, color: "text-blue-400", bg: "bg-blue-500/15" },
  buying_signal: { label: "Buy Signals", icon: Zap, color: "text-emerald-400", bg: "bg-emerald-500/15" },
  feature_request: { label: "Features", icon: Lightbulb, color: "text-violet-400", bg: "bg-violet-500/15" },
  pain_point: { label: "Pain Points", icon: AlertTriangle, color: "text-orange-400", bg: "bg-orange-500/15" },
  pricing_concern: { label: "Pricing", icon: TrendingUp, color: "text-cyan-400", bg: "bg-cyan-500/15" },
  churn_risk: { label: "Churn Risk", icon: Activity, color: "text-red-400", bg: "bg-red-500/15" },
};

export default function IntelligenceDashboard() {
  const { user } = useAuth();
  const adminSecret = user?.id || "";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [minConfidence, setMinConfidence] = useState(0.3);

  const isAdmin = user?.isAdmin === "true" || (user as any)?.role === "DEV_ADMIN";

  const { data, isLoading, refetch } = useQuery<{ insights: SharedInsight[]; stats: any }>({
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
    onError: () => {
      toast({ title: "Refresh failed", variant: "destructive" });
    },
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
  });

  const insights = data?.insights || [];
  const filtered = insights.filter((i) => {
    if (search && !i.content.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const categoryCounts = insights.reduce((acc, i) => {
    acc[i.category] = (acc[i.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const avgConfidence = insights.length > 0
    ? (insights.reduce((s, i) => s + i.confidenceScore, 0) / insights.length * 100).toFixed(0)
    : "0";

  const uniqueAccounts = new Set(insights.map((i) => i.sourceAccountId)).size;
  const highConfidence = insights.filter((i) => i.confidenceScore >= 0.8).length;
  const recentCount = insights.filter((i) => {
    const d = new Date(i.lastSeenAt);
    return Date.now() - d.getTime() < 7 * 24 * 60 * 60 * 1000;
  }).length;

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <Card className="bg-black/50 border-white/10 max-w-md w-full">
          <CardContent className="p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-red-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Access Restricted</h2>
            <p className="text-sm text-white/40">This dashboard requires administrator privileges.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-8 space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Brain className="w-5 h-5 text-white" />
            </div>
            Intelligence Dashboard
            <Badge className="bg-red-500/20 text-red-400 border-red-500/20 text-[10px] px-2 py-0.5 h-5">
              <Shield className="w-2.5 h-2.5 mr-1" /> Admin
            </Badge>
          </h1>
          <p className="text-white/40 mt-1 text-sm">Cross-account intelligence, patterns, and strategic insights</p>
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
            className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white border-0 shadow-lg shadow-cyan-500/20"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${refreshMut.isPending ? "animate-spin" : ""}`} />
            {refreshMut.isPending ? "Analyzing..." : "Refresh Intelligence"}
          </Button>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total Insights", value: insights.length, icon: Brain, color: "cyan" },
          { label: "High Confidence", value: highConfidence, icon: Zap, color: "emerald" },
          { label: "Avg Confidence", value: `${avgConfidence}%`, icon: BarChart3, color: "violet" },
          { label: "Active Accounts", value: uniqueAccounts, icon: Users, color: "blue" },
          { label: "Last 7 Days", value: recentCount, icon: Clock, color: "amber" },
        ].map((s, i) => (
          <Card key={s.label} className="bg-black/40 border-white/5 backdrop-blur-sm hover:border-white/10 transition-all">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg bg-${s.color}-500/15 flex items-center justify-center`}>
                <s.icon className={`w-4 h-4 text-${s.color}-400`} />
              </div>
              <div>
                <div className="text-xl font-bold text-white">{s.value}</div>
                <div className="text-[11px] text-white/40">{s.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </motion.div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
        <Card className="bg-black/30 border-white/5">
          <CardContent className="p-4">
            <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3">Intelligence by Category</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => {
                const count = categoryCounts[key] || 0;
                const CIcon = cfg.icon;
                return (
                  <button
                    key={key}
                    data-testid={`button-category-${key}`}
                    onClick={() => setCategoryFilter(categoryFilter === key ? "all" : key)}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-all border ${
                      categoryFilter === key
                        ? "bg-white/10 border-white/15 text-white"
                        : "bg-white/3 border-white/5 text-white/50 hover:text-white/70 hover:bg-white/5"
                    }`}
                  >
                    <div className={`w-7 h-7 rounded-md ${cfg.bg} flex items-center justify-center`}>
                      <CIcon className={`w-3.5 h-3.5 ${cfg.color}`} />
                    </div>
                    <div className="text-left flex-1 min-w-0">
                      <div className="text-[11px] font-medium truncate">{cfg.label}</div>
                      <div className="text-[10px] text-white/30">{count} insights</div>
                    </div>
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
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/30">Min Confidence:</span>
          <select
            data-testid="select-min-confidence"
            value={minConfidence}
            onChange={(e) => setMinConfidence(parseFloat(e.target.value))}
            className="h-10 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white min-w-[100px]"
          >
            <option value="0.1" className="bg-gray-900">10%+</option>
            <option value="0.3" className="bg-gray-900">30%+</option>
            <option value="0.5" className="bg-gray-900">50%+</option>
            <option value="0.7" className="bg-gray-900">70%+</option>
            <option value="0.9" className="bg-gray-900">90%+</option>
          </select>
        </div>
      </motion.div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i} className="bg-black/30 border-white/5 animate-pulse">
              <CardContent className="p-4 flex gap-4">
                <div className="w-10 h-10 rounded-lg bg-white/5" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-white/5 rounded w-3/4" />
                  <div className="h-3 bg-white/5 rounded w-1/2" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="bg-black/30 border-white/5 border-dashed">
          <CardContent className="p-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/10 to-blue-500/10 flex items-center justify-center mx-auto mb-4">
              <Brain className="w-8 h-8 text-cyan-400/50" />
            </div>
            <h3 className="text-lg font-semibold text-white/80 mb-2">No insights yet</h3>
            <p className="text-sm text-white/40 mb-6 max-w-md mx-auto">
              Click "Refresh Intelligence" to analyze recent conversations and extract cross-account patterns.
            </p>
            <Button
              data-testid="button-first-refresh"
              onClick={() => refreshMut.mutate()}
              disabled={refreshMut.isPending}
              className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white border-0"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${refreshMut.isPending ? "animate-spin" : ""}`} />
              Run First Analysis
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((insight, i) => {
            const cfg = CATEGORY_CONFIG[insight.category] || { label: insight.category, icon: Lightbulb, color: "text-gray-400", bg: "bg-gray-500/15" };
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
                <Card className="bg-black/40 border-white/5 hover:border-white/10 transition-all" data-testid={`card-insight-${insight.id}`}>
                  <CardContent className="p-4 flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-lg ${cfg.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                      <CfgIcon className={`w-4.5 h-4.5 ${cfg.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={`${cfg.bg} ${cfg.color} border-0 text-[10px] px-1.5 py-0 h-4`}>{cfg.label}</Badge>
                        <span className="text-[10px] text-white/20">Account #{insight.sourceAccountId}</span>
                        {age <= 1 && (
                          <Badge className="bg-cyan-500/15 text-cyan-400 border-0 text-[9px] px-1 py-0 h-3.5">NEW</Badge>
                        )}
                      </div>
                      <p className="text-sm text-white/80 leading-relaxed">{insight.content}</p>
                      <div className="flex items-center gap-4 mt-2">
                        <div className="flex items-center gap-1.5">
                          <div className="w-16 h-1.5 rounded-full bg-white/5 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                confidence >= 80 ? "bg-emerald-500" : confidence >= 50 ? "bg-amber-500" : "bg-red-500"
                              }`}
                              style={{ width: `${confidence}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-white/30">{confidence}%</span>
                        </div>
                        <span className="text-[10px] text-white/20 flex items-center gap-1">
                          <Eye className="w-2.5 h-2.5" /> {insight.occurrenceCount}x seen
                        </span>
                        <span className="text-[10px] text-white/20 flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" /> {age === 0 ? "Today" : `${age}d ago`}
                        </span>
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