import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "@/hooks/use-account";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain, Activity, Zap, Shield, Target, TrendingUp, AlertTriangle, CheckCircle2,
  XCircle, Clock, Globe, MessageSquare, Users, BarChart3, RefreshCw, Loader2,
  ChevronRight, ArrowUpRight, Eye, Lightbulb, Gauge, Server, Radio,
  MousePointerClick, FileText, Mail, CalendarDays, CreditCard
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type IntelligenceScore = {
  id: number;
  accountId: number;
  entityType: string;
  entityId: string;
  scoreType: string;
  scoreValue: number;
  scoreBand: string;
  explanation: string | null;
  inputs: Record<string, unknown> | null;
  calculatedAt: string;
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

type IntegrationHealth = {
  id: number;
  integrationType: string;
  integrationKey: string;
  status: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureReason: string | null;
  healthScore: number | null;
};

type TimelineEntry = {
  id: number;
  title: string;
  description: string | null;
  sourceModule: string;
  severity: string;
  createdAt: string;
};

type UniversalEvent = {
  id: number;
  eventType: string;
  sourceModule: string;
  occurredAt: string;
  metadata: Record<string, unknown> | null;
  contactId: number | null;
  siteId: number | null;
  domainId: number | null;
};

type TopEvent = {
  eventType: string;
  count: number;
};

type IntelSummary = {
  events: { last24h: number; last7d: number };
  scores: IntelligenceScore[];
  recommendations: Recommendation[];
  integrationHealth: { total: number; healthy: number; degraded: number; error: number; disconnected: number };
  recentTimeline: TimelineEntry[];
};

function ScoreGauge({ value, label, band }: { value: number; label: string; band: string }) {
  const color = band === "excellent" ? "text-emerald-400" : band === "high" ? "text-cyan-400" : band === "medium" ? "text-yellow-400" : band === "low" ? "text-orange-400" : "text-red-400";
  const bgColor = band === "excellent" ? "bg-emerald-400" : band === "high" ? "bg-cyan-400" : band === "medium" ? "bg-yellow-400" : band === "low" ? "bg-orange-400" : "bg-red-400";
  return (
    <div className="flex flex-col items-center" data-testid={`gauge-${label.toLowerCase().replace(/\s/g, '-')}`}>
      <div className="relative w-20 h-20">
        <svg className="w-20 h-20 -rotate-90" viewBox="0 0 36 36">
          <path className="text-white/5" strokeDasharray="100, 100" d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3" />
          <path className={color} strokeDasharray={`${value}, 100`} d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-lg font-black ${color}`}>{Math.round(value)}</span>
        </div>
      </div>
      <span className="text-[10px] text-slate-500 mt-1 text-center leading-tight">{label}</span>
      <Badge className={`mt-1 text-[9px] px-1.5 py-0 ${bgColor}/20 ${color} border-0`}>{band}</Badge>
    </div>
  );
}

function EventIcon({ type }: { type: string }) {
  const icons: Record<string, typeof Activity> = {
    form_submit: FileText, form_submitted: FileText,
    message_sent: MessageSquare, message_received: MessageSquare,
    contact_created: Users, lead_created: Users,
    site_created: Globe, site_published: Globe, site_updated: Globe,
    domain_claimed: Globe, domain_verified: CheckCircle2,
    card_scanned: CreditCard, card_opened: CreditCard,
    deal_created: Target, deal_stage_changed: TrendingUp,
    campaign_sent: Mail, calendar_booked: CalendarDays,
    workflow_triggered: Zap, page_view: Eye,
    button_click: MousePointerClick, cta_click: MousePointerClick,
  };
  const Icon = icons[type] || Activity;
  return <Icon size={12} className="text-indigo-400 shrink-0" />;
}

function PriorityBadge({ priority }: { priority: string }) {
  const cls = priority === "critical" ? "bg-red-500/20 text-red-400" : priority === "high" ? "bg-orange-500/20 text-orange-400" : priority === "medium" ? "bg-yellow-500/20 text-yellow-400" : "bg-slate-500/20 text-slate-400";
  return <Badge className={`text-[9px] px-1.5 py-0 border-0 ${cls}`}>{priority}</Badge>;
}

function StatusDot({ status }: { status: string }) {
  const cls = status === "healthy" ? "bg-emerald-400" : status === "degraded" ? "bg-yellow-400" : status === "error" ? "bg-red-400" : "bg-slate-500";
  return <span className={`w-2 h-2 rounded-full inline-block ${cls}`} />;
}

export default function ApexIntelligenceDashboard() {
  const { activeAccountId } = useAccount();
  const subAccountId = activeAccountId || 13;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"overview" | "events" | "scores" | "recommendations" | "health" | "timeline">("overview");

  const { data: summary, isLoading: summaryLoading } = useQuery<IntelSummary>({
    queryKey: ["/api/intelligence/summary", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/intelligence/summary/${subAccountId}`);
      if (!res.ok) throw new Error("Failed to fetch intelligence summary");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: liveEvents = [] } = useQuery<UniversalEvent[]>({
    queryKey: ["/api/intelligence/events/stream", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/intelligence/events/${subAccountId}/stream`);
      if (!res.ok) throw new Error("Failed to fetch events");
      return res.json();
    },
    refetchInterval: 15000,
  });

  const { data: topEvents = [] } = useQuery<TopEvent[]>({
    queryKey: ["/api/intelligence/events/top", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/intelligence/events/${subAccountId}/top`);
      if (!res.ok) throw new Error("Failed to fetch top events");
      return res.json();
    },
  });

  const { data: allScores = [] } = useQuery<IntelligenceScore[]>({
    queryKey: ["/api/intelligence/scores", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/intelligence/scores/${subAccountId}`);
      if (!res.ok) throw new Error("Failed to fetch scores");
      return res.json();
    },
    enabled: activeTab === "scores" || activeTab === "overview",
  });

  const { data: recommendations = [] } = useQuery<Recommendation[]>({
    queryKey: ["/api/intelligence/recommendations", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/intelligence/recommendations/${subAccountId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: healthData = [] } = useQuery<IntegrationHealth[]>({
    queryKey: ["/api/intelligence/health", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/intelligence/health/${subAccountId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: timeline = [] } = useQuery<TimelineEntry[]>({
    queryKey: ["/api/intelligence/timeline", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/intelligence/timeline/${subAccountId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/intelligence/refresh/${subAccountId}`, { method: "POST" });
      if (!res.ok) throw new Error("Refresh failed");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Intelligence Refreshed", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/intelligence"] });
    },
  });

  const dismissMutation = useMutation({
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

  const resolveMutation = useMutation({
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
    },
  });

  const accountScores = (summary?.scores || allScores).filter(s => s.entityType === "account");
  const pendingRecs = recommendations.filter(r => r.status === "pending");

  const tabs = [
    { id: "overview" as const, label: "Overview", icon: Brain },
    { id: "events" as const, label: "Events", icon: Radio },
    { id: "scores" as const, label: "Scores", icon: Gauge },
    { id: "recommendations" as const, label: "Actions", icon: Lightbulb },
    { id: "health" as const, label: "Health", icon: Server },
    { id: "timeline" as const, label: "Timeline", icon: Clock },
  ];

  if (summaryLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0a0a0f]">
        <div className="flex flex-col items-center gap-4">
          <Brain size={48} className="text-indigo-400 animate-pulse" />
          <p className="text-slate-400 text-sm">Loading Apex Intelligence...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-4 md:p-6" data-testid="apex-intelligence-page">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Brain size={20} />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight" data-testid="text-page-title">Apex Intelligence</h1>
              <p className="text-xs text-slate-500">Command Center — Real-time system intelligence</p>
            </div>
          </div>
          <Button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            className="bg-indigo-600 hover:bg-indigo-500"
            data-testid="button-refresh-intelligence"
          >
            {refreshMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            <span className="ml-2">Refresh</span>
          </Button>
        </div>

        <div className="flex gap-1 mb-6 bg-white/[0.03] rounded-lg p-1 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.id ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
              }`}
              data-testid={`tab-${tab.id}`}
            >
              <tab.icon size={14} />
              {tab.label}
              {tab.id === "recommendations" && pendingRecs.length > 0 && (
                <Badge className="bg-red-500/20 text-red-400 border-0 text-[9px] px-1.5">{pendingRecs.length}</Badge>
              )}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === "overview" && (
            <motion.div key="overview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <Card className="bg-white/[0.03] border-white/5 p-4" data-testid="stat-events-24h">
                  <div className="flex items-center gap-2 mb-2">
                    <Activity size={14} className="text-indigo-400" />
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">Events (24h)</span>
                  </div>
                  <p className="text-2xl font-black">{summary?.events.last24h ?? 0}</p>
                </Card>
                <Card className="bg-white/[0.03] border-white/5 p-4" data-testid="stat-events-7d">
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 size={14} className="text-cyan-400" />
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">Events (7d)</span>
                  </div>
                  <p className="text-2xl font-black">{summary?.events.last7d ?? 0}</p>
                </Card>
                <Card className="bg-white/[0.03] border-white/5 p-4" data-testid="stat-integrations">
                  <div className="flex items-center gap-2 mb-2">
                    <Server size={14} className="text-emerald-400" />
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">Integrations</span>
                  </div>
                  <p className="text-2xl font-black">{summary?.integrationHealth.healthy ?? 0}<span className="text-sm text-slate-500">/{summary?.integrationHealth.total ?? 0}</span></p>
                </Card>
                <Card className="bg-white/[0.03] border-white/5 p-4" data-testid="stat-actions">
                  <div className="flex items-center gap-2 mb-2">
                    <Lightbulb size={14} className="text-yellow-400" />
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">Actions Needed</span>
                  </div>
                  <p className="text-2xl font-black">{pendingRecs.length}</p>
                </Card>
              </div>

              {accountScores.length > 0 && (
                <Card className="bg-white/[0.03] border-white/5 p-6 mb-6" data-testid="scores-overview">
                  <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
                    <Gauge size={14} className="text-indigo-400" /> Intelligence Scores
                  </h3>
                  <div className="flex flex-wrap gap-8 justify-center">
                    {accountScores.map(s => (
                      <ScoreGauge key={s.id} value={s.scoreValue} label={s.scoreType.replace(/_/g, ' ').replace(/score$/, '').trim()} band={s.scoreBand} />
                    ))}
                  </div>
                </Card>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <Card className="bg-white/[0.03] border-white/5 p-4" data-testid="live-events-panel">
                  <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
                    <Radio size={14} className="text-green-400" />
                    Live Event Stream
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  </h3>
                  <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                    {liveEvents.slice(0, 20).map(evt => (
                      <div key={evt.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/[0.02] hover:bg-white/[0.05] transition-colors" data-testid={`event-${evt.id}`}>
                        <EventIcon type={evt.eventType} />
                        <span className="text-xs text-white font-medium truncate flex-1">{evt.eventType.replace(/_/g, ' ')}</span>
                        <span className="text-[10px] text-slate-600 shrink-0">{evt.sourceModule}</span>
                        <span className="text-[10px] text-slate-600 shrink-0">{new Date(evt.occurredAt).toLocaleTimeString()}</span>
                      </div>
                    ))}
                    {liveEvents.length === 0 && (
                      <p className="text-xs text-slate-600 text-center py-6">No events recorded yet. Events will appear as users interact with the platform.</p>
                    )}
                  </div>
                </Card>

                <Card className="bg-white/[0.03] border-white/5 p-4" data-testid="top-events-panel">
                  <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
                    <TrendingUp size={14} className="text-cyan-400" /> Top Events (7d)
                  </h3>
                  <div className="space-y-2">
                    {topEvents.map((evt, i) => {
                      const max = topEvents[0]?.count || 1;
                      return (
                        <div key={evt.eventType} className="flex items-center gap-3" data-testid={`top-event-${i}`}>
                          <span className="text-xs text-slate-400 w-32 truncate">{evt.eventType.replace(/_/g, ' ')}</span>
                          <div className="flex-1 h-4 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-indigo-600 to-cyan-500 rounded-full" style={{ width: `${(evt.count / max) * 100}%` }} />
                          </div>
                          <span className="text-xs font-bold text-white w-10 text-right">{evt.count}</span>
                        </div>
                      );
                    })}
                    {topEvents.length === 0 && (
                      <p className="text-xs text-slate-600 text-center py-6">No event data for the last 7 days.</p>
                    )}
                  </div>
                </Card>
              </div>

              {pendingRecs.length > 0 && (
                <Card className="bg-white/[0.03] border-white/5 p-4 mb-6" data-testid="quick-actions-panel">
                  <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
                    <Lightbulb size={14} className="text-yellow-400" /> Recommended Actions
                  </h3>
                  <div className="space-y-2">
                    {pendingRecs.slice(0, 5).map(rec => (
                      <div key={rec.id} className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors" data-testid={`rec-${rec.id}`}>
                        <PriorityBadge priority={rec.priority} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-white truncate">{rec.title}</p>
                          <p className="text-[10px] text-slate-500 truncate">{rec.description}</p>
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" className="h-6 text-[10px] px-2 bg-indigo-600 hover:bg-indigo-500" onClick={() => resolveMutation.mutate(rec.id)} data-testid={`button-resolve-${rec.id}`}>Done</Button>
                          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-slate-500" onClick={() => dismissMutation.mutate(rec.id)} data-testid={`button-dismiss-${rec.id}`}>Dismiss</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              <Card className="bg-white/[0.03] border-white/5 p-4" data-testid="timeline-panel">
                <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
                  <Clock size={14} className="text-purple-400" /> Execution Timeline
                </h3>
                <div className="space-y-2">
                  {(summary?.recentTimeline || timeline).slice(0, 8).map(entry => (
                    <div key={entry.id} className="flex items-start gap-3 px-2 py-2" data-testid={`timeline-${entry.id}`}>
                      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                        entry.severity === "error" ? "bg-red-400" : entry.severity === "warning" ? "bg-yellow-400" : "bg-indigo-400"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-white">{entry.title}</p>
                        {entry.description && <p className="text-[10px] text-slate-500 truncate">{entry.description}</p>}
                      </div>
                      <span className="text-[10px] text-slate-600 shrink-0">{new Date(entry.createdAt).toLocaleTimeString()}</span>
                    </div>
                  ))}
                  {(summary?.recentTimeline || timeline).length === 0 && (
                    <p className="text-xs text-slate-600 text-center py-6">No timeline entries yet.</p>
                  )}
                </div>
              </Card>
            </motion.div>
          )}

          {activeTab === "events" && (
            <motion.div key="events" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Card className="bg-white/[0.03] border-white/5 p-4">
                <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
                  <Radio size={14} className="text-green-400" /> All Events
                </h3>
                <div className="space-y-1">
                  {liveEvents.map(evt => (
                    <div key={evt.id} className="flex items-center gap-3 px-3 py-2 rounded bg-white/[0.02] hover:bg-white/[0.04] transition-colors" data-testid={`event-full-${evt.id}`}>
                      <EventIcon type={evt.eventType} />
                      <span className="text-xs font-mono text-indigo-300 w-40 truncate">{evt.eventType}</span>
                      <span className="text-[10px] text-slate-500 w-24 truncate">{evt.sourceModule}</span>
                      {evt.contactId && <Badge className="text-[9px] bg-cyan-500/10 text-cyan-400 border-0">contact:{evt.contactId}</Badge>}
                      {evt.siteId && <Badge className="text-[9px] bg-purple-500/10 text-purple-400 border-0">site:{evt.siteId}</Badge>}
                      {evt.domainId && <Badge className="text-[9px] bg-green-500/10 text-green-400 border-0">domain:{evt.domainId}</Badge>}
                      <span className="text-[10px] text-slate-600 ml-auto shrink-0">{new Date(evt.occurredAt).toLocaleString()}</span>
                    </div>
                  ))}
                  {liveEvents.length === 0 && <p className="text-xs text-slate-600 text-center py-10">No events recorded yet.</p>}
                </div>
              </Card>
            </motion.div>
          )}

          {activeTab === "scores" && (
            <motion.div key="scores" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {accountScores.length > 0 && (
                <Card className="bg-white/[0.03] border-white/5 p-6 mb-6">
                  <h3 className="text-sm font-bold text-slate-300 mb-4">Account-Level Scores</h3>
                  <div className="flex flex-wrap gap-8 justify-center mb-4">
                    {accountScores.map(s => (
                      <ScoreGauge key={s.id} value={s.scoreValue} label={s.scoreType.replace(/_/g, ' ').replace(/score$/, '').trim()} band={s.scoreBand} />
                    ))}
                  </div>
                  {accountScores.map(s => (
                    <div key={s.id} className="p-3 rounded bg-white/[0.02] mb-2" data-testid={`score-detail-${s.scoreType}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-white">{s.scoreType.replace(/_/g, ' ')}</span>
                        <span className="text-xs text-slate-500">{new Date(s.calculatedAt).toLocaleString()}</span>
                      </div>
                      {s.explanation && <p className="text-[10px] text-slate-400">{s.explanation}</p>}
                    </div>
                  ))}
                </Card>
              )}
              <Card className="bg-white/[0.03] border-white/5 p-6">
                <h3 className="text-sm font-bold text-slate-300 mb-4">All Entity Scores</h3>
                <div className="space-y-2">
                  {allScores.filter(s => s.entityType !== "account").map(s => (
                    <div key={s.id} className="flex items-center gap-3 p-3 rounded bg-white/[0.02]" data-testid={`entity-score-${s.id}`}>
                      <Badge className="text-[9px] bg-white/5 text-slate-400 border-0">{s.entityType}</Badge>
                      <span className="text-xs text-white font-medium flex-1">{s.scoreType.replace(/_/g, ' ')}</span>
                      <div className={`text-xs font-bold ${
                        s.scoreBand === "excellent" ? "text-emerald-400" : s.scoreBand === "high" ? "text-cyan-400" : s.scoreBand === "medium" ? "text-yellow-400" : s.scoreBand === "low" ? "text-orange-400" : "text-red-400"
                      }`}>{Math.round(s.scoreValue)}</div>
                      <Badge className={`text-[9px] border-0 ${
                        s.scoreBand === "excellent" ? "bg-emerald-400/20 text-emerald-400" : s.scoreBand === "high" ? "bg-cyan-400/20 text-cyan-400" : s.scoreBand === "medium" ? "bg-yellow-400/20 text-yellow-400" : s.scoreBand === "low" ? "bg-orange-400/20 text-orange-400" : "bg-red-400/20 text-red-400"
                      }`}>{s.scoreBand}</Badge>
                    </div>
                  ))}
                  {allScores.filter(s => s.entityType !== "account").length === 0 && <p className="text-xs text-slate-600 text-center py-6">No entity scores calculated yet. Click Refresh to compute scores.</p>}
                </div>
              </Card>
            </motion.div>
          )}

          {activeTab === "recommendations" && (
            <motion.div key="recommendations" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Card className="bg-white/[0.03] border-white/5 p-6">
                <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
                  <Lightbulb size={14} className="text-yellow-400" /> Recommendations ({recommendations.length})
                </h3>
                <div className="space-y-3">
                  {recommendations.map(rec => (
                    <div key={rec.id} className={`p-4 rounded-lg border transition-colors ${
                      rec.status === "pending" ? "bg-white/[0.03] border-white/10" : "bg-white/[0.01] border-white/5 opacity-60"
                    }`} data-testid={`recommendation-${rec.id}`}>
                      <div className="flex items-start gap-3">
                        <PriorityBadge priority={rec.priority} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-white">{rec.title}</p>
                          {rec.description && <p className="text-xs text-slate-400 mt-1">{rec.description}</p>}
                          {rec.whyThisExists && <p className="text-[10px] text-indigo-400/60 mt-2 italic">{rec.whyThisExists}</p>}
                          <div className="flex items-center gap-2 mt-2">
                            <Badge className="text-[9px] bg-white/5 text-slate-500 border-0">{rec.entityType}:{rec.entityId}</Badge>
                            <Badge className="text-[9px] bg-white/5 text-slate-500 border-0">{rec.status}</Badge>
                          </div>
                        </div>
                        {rec.status === "pending" && (
                          <div className="flex flex-col gap-1">
                            <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-500" onClick={() => resolveMutation.mutate(rec.id)}>
                              <CheckCircle2 size={12} /> Done
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-500" onClick={() => dismissMutation.mutate(rec.id)}>
                              Dismiss
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {recommendations.length === 0 && <p className="text-xs text-slate-600 text-center py-10">No recommendations yet. Click Refresh to generate recommendations from your data.</p>}
                </div>
              </Card>
            </motion.div>
          )}

          {activeTab === "health" && (
            <motion.div key="health" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Card className="bg-white/[0.03] border-white/5 p-6">
                <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
                  <Server size={14} className="text-emerald-400" /> Integration Health
                </h3>
                <div className="space-y-3">
                  {healthData.map(h => (
                    <div key={h.id} className="flex items-center gap-4 p-4 rounded-lg bg-white/[0.02] border border-white/5" data-testid={`health-${h.id}`}>
                      <StatusDot status={h.status} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-white">{h.integrationType}</p>
                        <p className="text-[10px] text-slate-500">{h.integrationKey}</p>
                      </div>
                      <Badge className={`text-[9px] border-0 ${
                        h.status === "healthy" ? "bg-emerald-400/20 text-emerald-400" : h.status === "degraded" ? "bg-yellow-400/20 text-yellow-400" : "bg-red-400/20 text-red-400"
                      }`}>{h.status}</Badge>
                      {h.healthScore !== null && (
                        <span className={`text-sm font-bold ${(h.healthScore ?? 0) > 70 ? "text-emerald-400" : (h.healthScore ?? 0) > 30 ? "text-yellow-400" : "text-red-400"}`}>{h.healthScore}%</span>
                      )}
                      {h.failureReason && (
                        <span className="text-[10px] text-red-400/60 max-w-[200px] truncate">{h.failureReason}</span>
                      )}
                    </div>
                  ))}
                  {healthData.length === 0 && <p className="text-xs text-slate-600 text-center py-10">No integration health data tracked yet. Health updates appear as integrations are used.</p>}
                </div>
              </Card>
            </motion.div>
          )}

          {activeTab === "timeline" && (
            <motion.div key="timeline" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Card className="bg-white/[0.03] border-white/5 p-6">
                <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
                  <Clock size={14} className="text-purple-400" /> Execution Timeline
                </h3>
                <div className="relative">
                  <div className="absolute left-3 top-0 bottom-0 w-px bg-white/10" />
                  <div className="space-y-4">
                    {timeline.map(entry => (
                      <div key={entry.id} className="flex gap-4 pl-6 relative" data-testid={`timeline-full-${entry.id}`}>
                        <div className={`absolute left-[9px] top-2 w-2.5 h-2.5 rounded-full border-2 border-[#0a0a0f] ${
                          entry.severity === "error" ? "bg-red-400" : entry.severity === "warning" ? "bg-yellow-400" : "bg-indigo-400"
                        }`} />
                        <div className="flex-1 p-3 rounded-lg bg-white/[0.02] border border-white/5">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs font-bold text-white">{entry.title}</p>
                            <span className="text-[10px] text-slate-600">{new Date(entry.createdAt).toLocaleString()}</span>
                          </div>
                          {entry.description && <p className="text-[10px] text-slate-400">{entry.description}</p>}
                          <Badge className="mt-2 text-[9px] bg-white/5 text-slate-500 border-0">{entry.sourceModule}</Badge>
                        </div>
                      </div>
                    ))}
                    {timeline.length === 0 && <p className="text-xs text-slate-600 text-center py-10 pl-6">No timeline entries yet.</p>}
                  </div>
                </div>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
