import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useAccount } from "@/hooks/use-account";
import {
  Brain, RefreshCw, Shield, Activity, Radio, Server,
  Lightbulb, Clock, BarChart3, Zap, AlertTriangle,
  Users, Link2, AlertOctagon, CheckCircle2, XCircle,
  Box, Network, TrendingUp, ArrowUpRight, Eye, Target
} from "lucide-react";

type OperatorEvent = {
  id: number;
  eventType: string;
  sourceModule: string;
  subAccountId: number;
  occurredAt: string;
  metadata: Record<string, unknown> | null;
};

type ModuleHealthData = {
  moduleActivity: Record<string, { events24h: number; lastSeen: string | null }>;
  integrationHealth: Record<string, { healthy: number; degraded: number; error: number; disconnected: number }>;
};

type Recommendation = {
  id: number;
  accountId: number;
  entityType: string;
  entityId: string;
  recommendationType: string;
  priority: string;
  status: string;
  title: string;
  description: string | null;
  whyThisExists: string | null;
  recommendedAction: { action?: string; target?: string } | null;
  createdAt: string;
};

type EntityLinkageData = {
  totalLinks: number;
  byEntityType: { entityType: string; count: number }[];
  recentLinks: {
    id: number;
    entityType: string;
    entityId: string;
    canonicalId: string;
    subAccountId: number;
    createdAt: string;
  }[];
};

type AccountActivity = {
  subAccountId: number;
  eventCount: number;
  lastEvent: string;
  modules: string[];
  accountName: string;
  plan: string;
};

type FailedEventsData = {
  failedEvents: OperatorEvent[];
  summary: { total: number; byModule: Record<string, number> };
};

type IntelSummary = {
  events: { last24h: number; last7d: number };
  scores: any[];
  recommendations: Recommendation[];
  integrationHealth: { total: number; healthy: number; degraded: number; error: number; disconnected: number };
  recentTimeline: any[];
};

const KNOWN_MODULES = [
  "crm", "messaging", "campaigns", "voice", "sites", "forms",
  "calendar", "workflows", "reviews", "content", "sentinel",
  "meta", "analytics", "intel", "cards", "webhooks",
];

function PriorityBadge({ priority }: { priority: string }) {
  const cls =
    priority === "critical"
      ? "bg-red-500/20 text-red-400 border-red-500/20"
      : priority === "high"
      ? "bg-orange-500/20 text-orange-400 border-orange-500/20"
      : priority === "medium"
      ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/20"
      : "bg-slate-500/20 text-slate-400 border-slate-500/20";
  return (
    <Badge className={`text-[9px] px-1.5 py-0 border ${cls}`}>{priority}</Badge>
  );
}

function StatusDot({ status }: { status: string }) {
  const cls =
    status === "healthy"
      ? "bg-emerald-400"
      : status === "degraded"
      ? "bg-yellow-400"
      : status === "error"
      ? "bg-red-400"
      : "bg-slate-500";
  return <span className={`w-2 h-2 rounded-full inline-block ${cls}`} />;
}

function ModulePill({
  module: mod,
  active,
  events,
  lastSeen,
}: {
  module: string;
  active: boolean;
  events: number;
  lastSeen: string | null;
}) {
  const age = lastSeen
    ? Math.floor((Date.now() - new Date(lastSeen).getTime()) / 60000)
    : null;
  return (
    <div
      className={`flex flex-col gap-1 p-2.5 rounded-xl border transition-all ${
        active
          ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-300"
          : "bg-white/[0.02] border-white/5 text-slate-600"
      }`}
      data-testid={`module-pill-${mod}`}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            active ? "bg-emerald-400 animate-pulse" : "bg-slate-700"
          }`}
        />
        <span className="text-[10px] font-semibold truncate">{mod}</span>
      </div>
      {active && (
        <div className="text-[9px] text-slate-500">
          {events} evt{events !== 1 ? "s" : ""}
          {age !== null ? ` · ${age < 60 ? `${age}m ago` : `${Math.floor(age / 60)}h ago`}` : ""}
        </div>
      )}
    </div>
  );
}

export default function IntelligenceDashboard() {
  const { user } = useAuth();
  const { activeAccountId } = useAccount();
  const subAccountId = activeAccountId;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<
    "stream" | "module-health" | "recommendations" | "coverage" | "linkage" | "accounts"
  >("stream");
  const [eventFilter, setEventFilter] = useState("");
  const [liveEvents, setLiveEvents] = useState<OperatorEvent[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isAdmin = user?.isAdmin === "true" || (user as any)?.role === "DEV_ADMIN";

  const { data: summary } = useQuery<IntelSummary>({
    queryKey: ["/api/intelligence/summary", subAccountId],
    queryFn: async () => {
      if (!subAccountId) return null as any;
      const res = await fetch(`/api/intelligence/summary/${subAccountId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!subAccountId,
    refetchInterval: 30000,
  });

  const { data: operatorEvents = [], isLoading: eventsLoading, refetch: refetchEvents } = useQuery<OperatorEvent[]>({
    queryKey: ["/api/operator/events-stream", eventFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "100" });
      if (eventFilter) params.set("module", eventFilter);
      const res = await fetch(`/api/operator/events-stream?${params}`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 15000,
  });

  const { data: moduleHealth, isLoading: moduleLoading, refetch: refetchModules } = useQuery<ModuleHealthData>({
    queryKey: ["/api/operator/module-health"],
    queryFn: async () => {
      const res = await fetch("/api/operator/module-health");
      if (!res.ok) return { moduleActivity: {}, integrationHealth: {} };
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: recommendations = [], isLoading: recsLoading, refetch: refetchRecs } = useQuery<Recommendation[]>({
    queryKey: ["/api/intelligence/recommendations", subAccountId],
    queryFn: async () => {
      if (!subAccountId) return [];
      const res = await fetch(`/api/intelligence/recommendations/${subAccountId}?limit=50`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!subAccountId,
    refetchInterval: 60000,
  });

  const { data: linkageData, isLoading: linkageLoading, refetch: refetchLinkage } = useQuery<EntityLinkageData>({
    queryKey: ["/api/operator/entity-linkage-health"],
    queryFn: async () => {
      const res = await fetch("/api/operator/entity-linkage-health");
      if (!res.ok) return { totalLinks: 0, byEntityType: [], recentLinks: [] };
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: failedEvents, isLoading: failedLoading } = useQuery<FailedEventsData>({
    queryKey: ["/api/operator/failed-events"],
    queryFn: async () => {
      const res = await fetch("/api/operator/failed-events");
      if (!res.ok) return { failedEvents: [], summary: { total: 0, byModule: {} } };
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: accountActivity = [], isLoading: accountsLoading, refetch: refetchAccounts } = useQuery<AccountActivity[]>({
    queryKey: ["/api/operator/account-activity"],
    queryFn: async () => {
      const res = await fetch("/api/operator/account-activity");
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 60000,
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      if (!subAccountId) return;
      const res = await fetch(`/api/intelligence/refresh/${subAccountId}`, { method: "POST" });
      if (!res.ok) throw new Error("Refresh failed");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Intelligence Refreshed", description: data?.message });
      queryClient.invalidateQueries({ queryKey: ["/api/intelligence"] });
      queryClient.invalidateQueries({ queryKey: ["/api/operator"] });
    },
    onError: () => toast({ title: "Refresh failed", variant: "destructive" }),
  });

  const resolveRec = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/intelligence/recommendations/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "resolved" }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/intelligence/recommendations"] });
      toast({ title: "Recommendation resolved" });
    },
  });

  const dismissRec = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/intelligence/recommendations/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "dismissed" }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/intelligence/recommendations"] });
    },
  });

  useEffect(() => {
    setLiveEvents(operatorEvents.slice(0, 100));
  }, [operatorEvents]);

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <Card className="bg-black/40 border-white/10 max-w-md w-full">
          <CardContent className="p-10 text-center">
            <div className="w-20 h-20 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-6">
              <Shield className="w-9 h-9 text-red-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Access Restricted</h2>
            <p className="text-sm text-slate-400">This dashboard requires administrator privileges.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const pendingRecs = recommendations.filter((r) => r.status === "pending");
  const moduleMap = moduleHealth?.moduleActivity || {};
  const activeModules = Object.keys(moduleMap).filter((m) => moduleMap[m].events24h > 0);
  const integMap = moduleHealth?.integrationHealth || {};

  const TABS = [
    { id: "stream" as const, label: "Live Stream", icon: Radio },
    { id: "module-health" as const, label: "Module Health", icon: Server },
    { id: "recommendations" as const, label: `Actions${pendingRecs.length ? ` (${pendingRecs.length})` : ""}`, icon: Lightbulb },
    { id: "coverage" as const, label: "Coverage", icon: Box },
    { id: "linkage" as const, label: "Entity Linkage", icon: Link2 },
    { id: "accounts" as const, label: "Accounts", icon: Users },
  ];

  return (
    <div className="min-h-screen p-4 md:p-6 space-y-5" data-testid="apex-operator-dashboard">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row md:items-center justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-3" data-testid="text-dashboard-title">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg">
              <Brain className="w-5 h-5 text-white" />
            </div>
            Apex Operator Dashboard
            <Badge className="bg-red-500/20 text-red-400 border-red-500/20 text-[10px] px-2 py-0.5 h-5">
              <Shield className="w-2.5 h-2.5 mr-1" /> Admin
            </Badge>
          </h1>
          <p className="text-slate-400 mt-1 text-sm">Real-time system intelligence, module coverage, and action queue</p>
        </div>
        <Button
          data-testid="button-refresh-intelligence"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          className="bg-indigo-600 hover:bg-indigo-500 text-white border-0"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
          {refreshMutation.isPending ? "Refreshing..." : "Refresh Intelligence"}
        </Button>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid grid-cols-2 md:grid-cols-5 gap-3"
      >
        {[
          { label: "Events (24h)", value: summary?.events.last24h ?? liveEvents.length, icon: Activity, color: "text-indigo-400", bg: "bg-indigo-500/10" },
          { label: "Events (7d)", value: summary?.events.last7d ?? 0, icon: BarChart3, color: "text-cyan-400", bg: "bg-cyan-500/10" },
          { label: "Active Modules", value: activeModules.length, icon: Box, color: "text-emerald-400", bg: "bg-emerald-500/10" },
          { label: "Actions Needed", value: pendingRecs.length, icon: Lightbulb, color: "text-yellow-400", bg: "bg-yellow-500/10" },
          { label: "Failed Events (7d)", value: failedEvents?.summary.total ?? 0, icon: AlertOctagon, color: "text-red-400", bg: "bg-red-500/10" },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 + i * 0.04 }}
          >
            <Card className="bg-black/40 border-white/10 hover:border-white/20 transition-all">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-lg ${stat.bg} flex items-center justify-center shrink-0`}>
                  <stat.icon className={`w-4 h-4 ${stat.color}`} />
                </div>
                <div>
                  <p className="text-xl font-black text-white" data-testid={`stat-${stat.label.toLowerCase().replace(/[\s()\/]/g, "-")}`}>{stat.value}</p>
                  <p className="text-[10px] text-slate-500">{stat.label}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      <div className="flex gap-1 bg-white/[0.03] rounded-xl p-1 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            data-testid={`tab-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? "bg-indigo-600 text-white"
                : "text-slate-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === "stream" && (
          <motion.div key="stream" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Card className="bg-black/40 border-white/10" data-testid="panel-live-stream">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Radio className="w-4 h-4 text-green-400" />
                    Live Event Stream
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  </h3>
                  <div className="flex items-center gap-2">
                    <select
                      data-testid="select-event-module-filter"
                      value={eventFilter}
                      onChange={(e) => setEventFilter(e.target.value)}
                      className="h-7 text-[10px] rounded-md border border-white/10 bg-white/5 text-white px-2"
                    >
                      <option value="" className="bg-gray-900">All Modules</option>
                      {Object.keys(moduleMap).map((m) => (
                        <option key={m} value={m} className="bg-gray-900">{m}</option>
                      ))}
                    </select>
                    <button
                      data-testid="button-refresh-stream"
                      onClick={() => refetchEvents()}
                      className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {eventsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <RefreshCw className="w-5 h-5 animate-spin text-indigo-400" />
                  </div>
                ) : liveEvents.length === 0 ? (
                  <div className="text-center py-12">
                    <Radio className="w-8 h-8 mx-auto text-slate-700 mb-3" />
                    <p className="text-sm text-slate-600">No events in the last 24 hours.</p>
                    <p className="text-[10px] text-slate-700 mt-1">Events appear as users interact with the platform.</p>
                  </div>
                ) : (
                  <div className="space-y-1 max-h-[520px] overflow-y-auto scrollbar-thin" data-testid="list-live-events">
                    {liveEvents.map((evt) => {
                      const metaKeys = Object.keys(evt.metadata || {}).filter(k => k !== "raw");
                      return (
                        <motion.div
                          key={evt.id}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="flex items-start gap-3 px-3 py-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
                          data-testid={`event-row-${evt.id}`}
                        >
                          <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0 animate-pulse" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[10px] font-mono text-indigo-300 font-medium">{evt.eventType}</span>
                              <Badge className="text-[9px] bg-white/5 border border-white/10 text-slate-400 px-1.5 py-0">
                                {evt.sourceModule}
                              </Badge>
                              <Badge className="text-[9px] bg-cyan-500/10 border-cyan-500/20 text-cyan-400 px-1.5 py-0">
                                acct:{evt.subAccountId}
                              </Badge>
                              {metaKeys.slice(0, 2).map(k => (
                                <Badge key={k} className="text-[9px] bg-violet-500/10 border-violet-500/20 text-violet-400 px-1.5 py-0">
                                  {k}:{String(evt.metadata![k]).slice(0, 12)}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <span className="text-[9px] text-slate-600 shrink-0 tabular-nums">
                            {new Date(evt.occurredAt).toLocaleTimeString()}
                          </span>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {activeTab === "module-health" && (
          <motion.div key="module-health" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="bg-black/40 border-white/10" data-testid="panel-module-activity">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Activity className="w-4 h-4 text-indigo-400" /> Module Activity (24h)
                    </h3>
                    <button
                      data-testid="button-refresh-modules"
                      onClick={() => refetchModules()}
                      className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {moduleLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                    </div>
                  ) : Object.keys(moduleMap).length === 0 ? (
                    <p className="text-xs text-slate-600 text-center py-8">No module activity in the last 24h.</p>
                  ) : (
                    <div className="space-y-2" data-testid="list-module-activity">
                      {Object.entries(moduleMap)
                        .sort((a, b) => b[1].events24h - a[1].events24h)
                        .map(([mod, data]) => {
                          const max = Math.max(...Object.values(moduleMap).map((d) => d.events24h), 1);
                          const pct = Math.round((data.events24h / max) * 100);
                          const age = data.lastSeen
                            ? Math.floor((Date.now() - new Date(data.lastSeen).getTime()) / 60000)
                            : null;
                          return (
                            <div key={mod} className="flex items-center gap-3" data-testid={`module-activity-${mod}`}>
                              <div className="flex items-center gap-1.5 w-28 shrink-0">
                                <StatusDot status={data.events24h > 0 ? "healthy" : "disconnected"} />
                                <span className="text-[10px] text-white font-medium truncate">{mod}</span>
                              </div>
                              <div className="flex-1 h-4 bg-white/5 rounded-full overflow-hidden">
                                <motion.div
                                  className="h-full bg-gradient-to-r from-indigo-600 to-cyan-500 rounded-full"
                                  initial={{ width: 0 }}
                                  animate={{ width: `${pct}%` }}
                                  transition={{ duration: 0.6 }}
                                />
                              </div>
                              <span className="text-xs font-bold text-white w-10 text-right tabular-nums">{data.events24h}</span>
                              {age !== null && (
                                <span className="text-[9px] text-slate-600 w-16 text-right tabular-nums shrink-0">
                                  {age < 60 ? `${age}m ago` : `${Math.floor(age / 60)}h ago`}
                                </span>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-black/40 border-white/10" data-testid="panel-integration-health">
                <CardContent className="p-4">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
                    <Server className="w-4 h-4 text-emerald-400" /> Integration Health
                  </h3>
                  {Object.keys(integMap).length === 0 ? (
                    <p className="text-xs text-slate-600 text-center py-8">No integration health data tracked yet.</p>
                  ) : (
                    <div className="space-y-2" data-testid="list-integration-health">
                      {Object.entries(integMap).map(([type, counts]) => {
                        const total = counts.healthy + counts.degraded + counts.error + counts.disconnected;
                        const healthPct = total > 0 ? Math.round((counts.healthy / total) * 100) : 0;
                        return (
                          <div
                            key={type}
                            className="flex items-center gap-3 p-2.5 rounded-lg bg-white/[0.02] border border-white/5"
                            data-testid={`integration-health-${type}`}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-white truncate">{type}</p>
                              <div className="flex items-center gap-1.5 mt-1">
                                {counts.healthy > 0 && (
                                  <span className="text-[9px] text-emerald-400">{counts.healthy} healthy</span>
                                )}
                                {counts.degraded > 0 && (
                                  <span className="text-[9px] text-yellow-400">{counts.degraded} degraded</span>
                                )}
                                {counts.error > 0 && (
                                  <span className="text-[9px] text-red-400">{counts.error} error</span>
                                )}
                                {counts.disconnected > 0 && (
                                  <span className="text-[9px] text-slate-500">{counts.disconnected} disconnected</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span
                                className={`text-sm font-bold ${
                                  healthPct >= 80 ? "text-emerald-400" : healthPct >= 50 ? "text-yellow-400" : "text-red-400"
                                }`}
                              >
                                {healthPct}%
                              </span>
                              <StatusDot
                                status={
                                  healthPct >= 80 ? "healthy" : healthPct >= 50 ? "degraded" : "error"
                                }
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {failedEvents && failedEvents.summary.total > 0 && (
                    <div className="mt-4 pt-4 border-t border-white/[0.06]">
                      <div className="flex items-center gap-2 mb-3">
                        <AlertOctagon className="w-3.5 h-3.5 text-red-400" />
                        <p className="text-[10px] font-bold text-red-400 uppercase tracking-wider">
                          Failed Events (7d) — {failedEvents.summary.total} total
                        </p>
                      </div>
                      <div className="space-y-1">
                        {Object.entries(failedEvents.summary.byModule)
                          .sort((a, b) => b[1] - a[1])
                          .map(([mod, count]) => (
                            <div key={mod} className="flex items-center justify-between" data-testid={`failed-module-${mod}`}>
                              <span className="text-[10px] text-slate-400">{mod}</span>
                              <span className="text-[10px] text-red-400 font-bold">{count}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </motion.div>
        )}

        {activeTab === "recommendations" && (
          <motion.div key="recommendations" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Card className="bg-black/40 border-white/10" data-testid="panel-recommendations">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-yellow-400" />
                    Recommendation Queue
                    {pendingRecs.length > 0 && (
                      <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/20 text-[9px]">
                        {pendingRecs.length} pending
                      </Badge>
                    )}
                  </h3>
                  <button
                    data-testid="button-refresh-recs"
                    onClick={() => refetchRecs()}
                    className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>

                {recsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <RefreshCw className="w-5 h-5 animate-spin text-indigo-400" />
                  </div>
                ) : recommendations.length === 0 ? (
                  <div className="text-center py-12">
                    <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-400 mb-3" />
                    <p className="text-sm text-slate-300">No recommendations</p>
                    <p className="text-[10px] text-slate-600 mt-1">Click Refresh Intelligence to generate recommendations from your data.</p>
                  </div>
                ) : (
                  <div className="space-y-3" data-testid="list-recommendations">
                    {recommendations.map((rec) => (
                      <div
                        key={rec.id}
                        className={`p-4 rounded-xl border transition-all ${
                          rec.status === "pending"
                            ? "bg-white/[0.03] border-white/10 hover:border-white/20"
                            : "bg-white/[0.01] border-white/5 opacity-50"
                        }`}
                        data-testid={`recommendation-${rec.id}`}
                      >
                        <div className="flex items-start gap-3">
                          <PriorityBadge priority={rec.priority} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-white">{rec.title}</p>
                            {rec.description && (
                              <p className="text-xs text-slate-400 mt-1 leading-relaxed">{rec.description}</p>
                            )}
                            {rec.whyThisExists && (
                              <p className="text-[10px] text-indigo-400/60 mt-2 italic">{rec.whyThisExists}</p>
                            )}
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              <Badge className="text-[9px] bg-white/5 border-white/10 text-slate-500 px-1.5 py-0">
                                {rec.entityType}:{rec.entityId}
                              </Badge>
                              <Badge className="text-[9px] bg-white/5 border-white/10 text-slate-500 px-1.5 py-0">
                                {rec.recommendationType}
                              </Badge>
                              <span className="text-[9px] text-slate-600">
                                {new Date(rec.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                          {rec.status === "pending" && (
                            <div className="flex flex-col gap-1 shrink-0">
                              <Button
                                size="sm"
                                className="h-7 text-[10px] bg-emerald-600 hover:bg-emerald-500 px-2"
                                onClick={() => resolveRec.mutate(rec.id)}
                                disabled={resolveRec.isPending}
                                data-testid={`button-resolve-${rec.id}`}
                              >
                                <CheckCircle2 className="w-3 h-3 mr-1" /> Accept
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-[10px] text-slate-500 px-2"
                                onClick={() => dismissRec.mutate(rec.id)}
                                disabled={dismissRec.isPending}
                                data-testid={`button-dismiss-${rec.id}`}
                              >
                                <XCircle className="w-3 h-3 mr-1" /> Dismiss
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {activeTab === "coverage" && (
          <motion.div key="coverage" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="space-y-4">
              <Card className="bg-black/40 border-white/10" data-testid="panel-module-coverage">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Box className="w-4 h-4 text-indigo-400" /> Module Coverage Matrix
                    </h3>
                    <div className="flex items-center gap-3 text-[10px] text-slate-500">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-400" /> Active
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-slate-700" /> Silent
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2" data-testid="grid-module-coverage">
                    {KNOWN_MODULES.map((mod) => {
                      const data = moduleMap[mod];
                      const isActive = !!data && data.events24h > 0;
                      return (
                        <ModulePill
                          key={mod}
                          module={mod}
                          active={isActive}
                          events={data?.events24h ?? 0}
                          lastSeen={data?.lastSeen ?? null}
                        />
                      );
                    })}
                    {Object.keys(moduleMap)
                      .filter((m) => !KNOWN_MODULES.includes(m))
                      .map((mod) => {
                        const data = moduleMap[mod];
                        const isActive = data.events24h > 0;
                        return (
                          <ModulePill
                            key={mod}
                            module={mod}
                            active={isActive}
                            events={data.events24h}
                            lastSeen={data.lastSeen}
                          />
                        );
                      })}
                  </div>

                  <div className="mt-4 pt-4 border-t border-white/[0.06] flex items-center gap-4 text-xs text-slate-500">
                    <span>
                      <span className="text-emerald-400 font-bold">{activeModules.length}</span> active
                    </span>
                    <span>
                      <span className="text-slate-400 font-bold">{KNOWN_MODULES.length - activeModules.filter(m => KNOWN_MODULES.includes(m)).length}</span> silent
                    </span>
                    <span>
                      <span className="text-indigo-400 font-bold">{Object.keys(moduleMap).length}</span> total tracked
                    </span>
                  </div>
                </CardContent>
              </Card>

              {failedEvents && failedEvents.failedEvents.length > 0 && (
                <Card className="bg-black/40 border-red-500/10" data-testid="panel-failed-events">
                  <CardContent className="p-4">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      Failed Events (7d)
                      <Badge className="bg-red-500/20 text-red-400 border-red-500/20 text-[9px]">
                        {failedEvents.summary.total}
                      </Badge>
                    </h3>
                    <div className="space-y-1.5 max-h-64 overflow-y-auto" data-testid="list-failed-events">
                      {failedEvents.failedEvents.slice(0, 30).map((evt) => (
                        <div
                          key={evt.id}
                          className="flex items-center gap-3 px-3 py-2 rounded-lg bg-red-500/[0.04] border border-red-500/10"
                          data-testid={`failed-event-${evt.id}`}
                        >
                          <AlertOctagon className="w-3 h-3 text-red-400 shrink-0" />
                          <span className="text-[10px] font-mono text-red-300 truncate flex-1">{evt.eventType}</span>
                          <Badge className="text-[9px] bg-white/5 border-white/10 text-slate-400 px-1.5">
                            {evt.sourceModule}
                          </Badge>
                          <span className="text-[9px] text-slate-600 shrink-0">
                            {new Date(evt.occurredAt).toLocaleDateString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </motion.div>
        )}

        {activeTab === "linkage" && (
          <motion.div key="linkage" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="bg-black/40 border-white/10" data-testid="panel-linkage-summary">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Link2 className="w-4 h-4 text-purple-400" /> Entity Linkage Health
                    </h3>
                    <button
                      data-testid="button-refresh-linkage"
                      onClick={() => refetchLinkage()}
                      className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {linkageLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-center">
                          <p className="text-2xl font-black text-white" data-testid="text-total-links">
                            {linkageData?.totalLinks ?? 0}
                          </p>
                          <p className="text-[10px] text-slate-500 mt-0.5">Total Identity Links</p>
                        </div>
                        <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-center">
                          <p className="text-2xl font-black text-white" data-testid="text-entity-types">
                            {linkageData?.byEntityType.length ?? 0}
                          </p>
                          <p className="text-[10px] text-slate-500 mt-0.5">Entity Types</p>
                        </div>
                      </div>

                      <div className="space-y-2" data-testid="list-entity-types">
                        {(linkageData?.byEntityType ?? []).map((et) => (
                          <div
                            key={et.entityType}
                            className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] border border-white/5"
                            data-testid={`entity-type-${et.entityType}`}
                          >
                            <span className="text-xs text-white font-medium capitalize">{et.entityType}</span>
                            <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/20 text-[9px]">
                              {et.count}
                            </Badge>
                          </div>
                        ))}
                        {(linkageData?.byEntityType ?? []).length === 0 && (
                          <p className="text-xs text-slate-600 text-center py-6">No entity links recorded yet.</p>
                        )}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-black/40 border-white/10" data-testid="panel-recent-links">
                <CardContent className="p-4">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
                    <Eye className="w-4 h-4 text-cyan-400" /> Recent Identity Links
                  </h3>
                  <div className="space-y-1.5 max-h-[380px] overflow-y-auto" data-testid="list-recent-links">
                    {(linkageData?.recentLinks ?? []).map((link) => (
                      <div
                        key={link.id}
                        className="p-2.5 rounded-lg bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all"
                        data-testid={`link-row-${link.id}`}
                      >
                        <div className="flex items-center gap-2">
                          <Badge className="text-[9px] bg-purple-500/10 border-purple-500/20 text-purple-400 px-1.5 shrink-0">
                            {link.entityType}
                          </Badge>
                          <span className="text-[10px] text-white font-medium truncate flex-1">{link.entityId}</span>
                          <ArrowUpRight className="w-3 h-3 text-slate-600 shrink-0" />
                          <span className="text-[10px] text-cyan-400 truncate max-w-[100px]">{link.canonicalId}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge className="text-[9px] bg-cyan-500/10 border-cyan-500/20 text-cyan-400 px-1.5">
                            acct:{link.subAccountId}
                          </Badge>
                          <span className="text-[9px] text-slate-600">
                            {new Date(link.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    ))}
                    {(linkageData?.recentLinks ?? []).length === 0 && (
                      <p className="text-xs text-slate-600 text-center py-8">No entity links recorded yet.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </motion.div>
        )}

        {activeTab === "accounts" && (
          <motion.div key="accounts" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Card className="bg-black/40 border-white/10" data-testid="panel-account-activity">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Users className="w-4 h-4 text-cyan-400" />
                    Account Activity (7d)
                    <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/20 text-[9px]">
                      {accountActivity.length} active
                    </Badge>
                  </h3>
                  <button
                    data-testid="button-refresh-accounts"
                    onClick={() => refetchAccounts()}
                    className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>

                {accountsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <RefreshCw className="w-5 h-5 animate-spin text-indigo-400" />
                  </div>
                ) : accountActivity.length === 0 ? (
                  <div className="text-center py-12">
                    <Users className="w-8 h-8 mx-auto text-slate-700 mb-3" />
                    <p className="text-sm text-slate-600">No account activity in the last 7 days.</p>
                  </div>
                ) : (
                  <div className="space-y-2" data-testid="list-account-activity">
                    {accountActivity.map((acct, i) => {
                      const max = accountActivity[0]?.eventCount || 1;
                      const pct = Math.round((acct.eventCount / max) * 100);
                      const age = acct.lastEvent
                        ? Math.floor((Date.now() - new Date(acct.lastEvent).getTime()) / 3600000)
                        : null;
                      return (
                        <motion.div
                          key={acct.subAccountId}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.02 }}
                          className="p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all"
                          data-testid={`account-row-${acct.subAccountId}`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center shrink-0">
                              <span className="text-[10px] font-bold text-indigo-400">#{acct.subAccountId}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-xs font-medium text-white truncate">{acct.accountName}</p>
                                {acct.plan && acct.plan !== "unknown" && (
                                  <Badge className="text-[9px] bg-white/5 border-white/10 text-slate-400 px-1.5 py-0 shrink-0">
                                    {acct.plan}
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden max-w-[120px]">
                                  <div
                                    className="h-full bg-gradient-to-r from-indigo-600 to-cyan-500 rounded-full"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-[10px] font-bold text-white tabular-nums">
                                  {acct.eventCount} events
                                </span>
                                {age !== null && (
                                  <span className="text-[9px] text-slate-600">
                                    {age < 1 ? "< 1h ago" : `${age}h ago`}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1 justify-end max-w-[100px]">
                              {(acct.modules || []).slice(0, 3).map((m) => (
                                <Badge
                                  key={m}
                                  className="text-[8px] bg-indigo-500/10 border-indigo-500/20 text-indigo-400 px-1 py-0"
                                >
                                  {m}
                                </Badge>
                              ))}
                              {(acct.modules || []).length > 3 && (
                                <Badge className="text-[8px] bg-white/5 border-white/10 text-slate-500 px-1 py-0">
                                  +{acct.modules.length - 3}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
