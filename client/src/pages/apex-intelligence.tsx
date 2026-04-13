import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "@/hooks/use-account";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain, Activity, Zap, Shield, Target, TrendingUp, AlertTriangle, CheckCircle2,
  XCircle, Clock, Globe, MessageSquare, Users, BarChart3, RefreshCw, Loader2,
  ChevronRight, ArrowUpRight, Eye, Lightbulb, Gauge, Server, Radio,
  MousePointerClick, FileText, Mail, CalendarDays, CreditCard, Network, Link2,
  AlertOctagon, Box, Star, Megaphone, GitBranch, Layers, TrendingDown, Award,
  ArrowRight, ArrowUp, ArrowDown, Play, Pause, RotateCcw, ShieldCheck, Info,
  ChevronDown, ChevronUp, Ban
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

type FailedEventsData = {
  failedEvents: OperatorEvent[];
  summary: { total: number; byModule: Record<string, number> };
};

type EntityLinkageData = {
  totalLinks: number;
  byEntityType: { entityType: string; count: number }[];
  recentLinks: { id: number; entityType: string; entityId: string; canonicalId: string; subAccountId: number; createdAt: string }[];
};

type AccountActivity = {
  subAccountId: number;
  eventCount: number;
  lastEvent: string;
  modules: string[];
  accountName: string;
  plan: string;
};

type AutonomyActionType = {
  id: number;
  accountId: number;
  actionType: string;
  actionCategory: string;
  targetModule: string | null;
  targetEntityType: string | null;
  targetEntityId: string | null;
  safetyClass: string;
  confidenceScore: number;
  status: string;
  reason: string | null;
  explanation: string | null;
  preparedPayload: Record<string, unknown> | null;
  executionResult: Record<string, unknown> | null;
  rollbackPayload: Record<string, unknown> | null;
  createdBySystem: boolean;
  dependsOnActionId: number | null;
  createdAt: string;
  updatedAt: string;
  executedAt: string | null;
  resolvedAt: string | null;
};

type AutonomyActionDetail = {
  action: AutonomyActionType;
  dependsOn: AutonomyActionType | null;
  policyRule: {
    id: number;
    actionType: string;
    defaultSafetyClass: string;
    requiresExternalAuth: boolean;
    requiresPayment: boolean;
    isDestructive: boolean;
    isReversible: boolean;
    maxConfidenceForAutoExec: number;
    description: string | null;
    active: boolean;
  } | null;
};

type IntelSummary = {
  events: { last24h: number; last7d: number };
  scores: IntelligenceScore[];
  recommendations: Recommendation[];
  integrationHealth: { total: number; healthy: number; degraded: number; error: number; disconnected: number };
  recentTimeline: TimelineEntry[];
};

type EcosystemSummary = {
  overallHealth: number;
  healthBand: string;
  topOpportunities: Array<{ title: string; priority: string; category: string }>;
  topBlockers: Array<{ title: string; severity: string; category: string }>;
  scoreBreakdown: Array<{ scoreType: string; value: number; band: string }>;
  moduleAdoption: number;
  benchmarkComparison: Array<{ scoreType: string; accountScore: number; platformAvg: number; percentile: string }>;
};

type NetworkIntelligence = {
  benchmarks: Array<{ scoreType: string; platformAvg: number; platformMedian: number; topQuartile: number; sampleSize: number }>;
  patterns: Array<{ patternType: string; title: string; description: string; frequency: number; affectedAccounts: number; severity: string }>;
  generatedAt: string;
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

function MiniScoreBar({ value, band, label }: { value: number; band: string; label: string }) {
  const barColor = band === "excellent" ? "bg-emerald-400" : band === "high" ? "bg-cyan-400" : band === "medium" ? "bg-yellow-400" : band === "low" ? "bg-orange-400" : "bg-red-400";
  const textColor = band === "excellent" ? "text-emerald-400" : band === "high" ? "text-cyan-400" : band === "medium" ? "text-yellow-400" : band === "low" ? "text-orange-400" : "text-red-400";
  return (
    <div className="flex items-center gap-3 py-1.5" data-testid={`score-bar-${label.replace(/\s/g, '-').toLowerCase()}`}>
      <span className="text-xs text-slate-400 w-40 truncate">{label}</span>
      <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
        <div className={`h-full ${barColor} rounded-full transition-all duration-700`} style={{ width: `${value}%` }} />
      </div>
      <span className={`text-xs font-bold w-8 text-right ${textColor}`}>{value}</span>
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

function HealthRing({ value, size = 80 }: { value: number; size?: number }) {
  const color = value >= 80 ? "#34d399" : value >= 60 ? "#22d3ee" : value >= 40 ? "#facc15" : value >= 20 ? "#fb923c" : "#f87171";
  const label = value >= 80 ? "Excellent" : value >= 60 ? "Good" : value >= 40 ? "Fair" : value >= 20 ? "Poor" : "Critical";
  return (
    <div className="flex flex-col items-center gap-2" data-testid="ecosystem-health-ring">
      <div className="relative" style={{ width: size, height: size }}>
        <svg className="-rotate-90" width={size} height={size} viewBox="0 0 36 36">
          <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3" />
          <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${value}, 100`} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-black" style={{ color }}>{value}</span>
          <span className="text-[9px] text-slate-500 leading-none">/ 100</span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-xs font-bold" style={{ color }}>{label}</p>
        <p className="text-[10px] text-slate-500">Ecosystem Health</p>
      </div>
    </div>
  );
}

function formatScoreLabel(scoreType: string) {
  return scoreType.replace(/_score$/, "").replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

const SCORE_ICONS: Record<string, typeof Activity> = {
  account_maturity_score: Layers,
  launch_readiness_score: Zap,
  workflow_effectiveness_score: GitBranch,
  campaign_effectiveness_score: Megaphone,
  pipeline_health_score: Target,
  messaging_performance_score: MessageSquare,
  reputation_health_score: Star,
  calendar_conversion_score: CalendarDays,
  digital_card_effectiveness_score: CreditCard,
  ad_to_lead_quality_score: TrendingUp,
  module_adoption_score: Layers,
  integration_health_score: Server,
};

export default function ApexIntelligenceDashboard() {
  const { activeAccountId } = useAccount();
  const subAccountId = activeAccountId || 13;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"ecosystem" | "scores" | "opportunities" | "events" | "health" | "network" | "timeline" | "operator" | "autonomy">("ecosystem");
  const [ecosystemFilter, setEcosystemFilter] = useState("");
  const [autonomyStatusFilter, setAutonomyStatusFilter] = useState<string>("");
  const [selectedActionId, setSelectedActionId] = useState<number | null>(null);

  const { data: summary, isLoading: summaryLoading } = useQuery<IntelSummary>({
    queryKey: ["/api/intelligence/summary", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/intelligence/summary/${subAccountId}`);
      if (!res.ok) throw new Error("Failed to fetch intelligence summary");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: ecosystem, isLoading: ecosystemLoading } = useQuery<EcosystemSummary>({
    queryKey: ["/api/intelligence/ecosystem", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/intelligence/ecosystem/${subAccountId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: networkIntel } = useQuery<NetworkIntelligence>({
    queryKey: ["/api/intelligence/network-patterns"],
    queryFn: async () => {
      const res = await fetch("/api/intelligence/network-patterns");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: activeTab === "network",
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
    enabled: activeTab === "events",
  });

  const { data: allScores = [] } = useQuery<IntelligenceScore[]>({
    queryKey: ["/api/intelligence/scores", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/intelligence/scores/${subAccountId}`);
      if (!res.ok) throw new Error("Failed to fetch scores");
      return res.json();
    },
    enabled: activeTab === "scores" || activeTab === "ecosystem",
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
    enabled: activeTab === "health" || activeTab === "ecosystem",
  });

  const { data: timeline = [] } = useQuery<TimelineEntry[]>({
    queryKey: ["/api/intelligence/timeline", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/intelligence/timeline/${subAccountId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: activeTab === "timeline",
  });

  const { data: operatorEvents = [] } = useQuery<OperatorEvent[]>({
    queryKey: ["/api/operator/events-stream"],
    queryFn: async () => {
      const res = await fetch("/api/operator/events-stream");
      if (!res.ok) return [];
      return res.json();
    },
    enabled: activeTab === "operator",
    refetchInterval: activeTab === "operator" ? 20000 : false,
  });

  const { data: moduleHealth } = useQuery<ModuleHealthData>({
    queryKey: ["/api/operator/module-health"],
    queryFn: async () => {
      const res = await fetch("/api/operator/module-health");
      if (!res.ok) return { moduleActivity: {}, integrationHealth: {} };
      return res.json();
    },
    enabled: activeTab === "operator",
  });

  const { data: failedEventsData } = useQuery<FailedEventsData>({
    queryKey: ["/api/operator/failed-events"],
    queryFn: async () => {
      const res = await fetch("/api/operator/failed-events");
      if (!res.ok) return { failedEvents: [], summary: { total: 0, byModule: {} } };
      return res.json();
    },
    enabled: activeTab === "operator",
  });

  const { data: linkageData } = useQuery<EntityLinkageData>({
    queryKey: ["/api/operator/entity-linkage-health"],
    queryFn: async () => {
      const res = await fetch("/api/operator/entity-linkage-health");
      if (!res.ok) return { totalLinks: 0, byEntityType: [], recentLinks: [] };
      return res.json();
    },
    enabled: activeTab === "operator",
  });

  const { data: accountActivity = [] } = useQuery<AccountActivity[]>({
    queryKey: ["/api/operator/account-activity"],
    queryFn: async () => {
      const res = await fetch("/api/operator/account-activity");
      if (!res.ok) return [];
      return res.json();
    },
    enabled: activeTab === "operator",
  });

  const { data: autonomyActions = [], isLoading: autonomyLoading, isError: autonomyError, refetch: refetchAutonomy } = useQuery<AutonomyActionType[]>({
    queryKey: ["/api/autonomy/actions", subAccountId, autonomyStatusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (autonomyStatusFilter) params.set("status", autonomyStatusFilter);
      params.set("limit", "100");
      const res = await fetch(`/api/autonomy/actions/${subAccountId}?${params}`);
      if (!res.ok) throw new Error("Failed to fetch autonomy actions");
      return res.json();
    },
    enabled: activeTab === "autonomy",
    refetchInterval: activeTab === "autonomy" ? 15000 : false,
  });

  const { data: actionDetail, isLoading: detailLoading, isError: detailError, refetch: refetchDetail } = useQuery<AutonomyActionDetail>({
    queryKey: ["/api/autonomy/actions/detail", selectedActionId],
    queryFn: async () => {
      const res = await fetch(`/api/autonomy/actions/${selectedActionId}/detail`);
      if (!res.ok) throw new Error("Failed to fetch action detail");
      return res.json();
    },
    enabled: !!selectedActionId && activeTab === "autonomy",
  });

  const autonomyMutation = useMutation({
    mutationFn: async ({ actionId, operation }: { actionId: number; operation: string }) => {
      const res = await fetch(`/api/autonomy/actions/${actionId}/${operation}`, { method: "POST" });
      if (!res.ok) throw new Error(`Failed to ${operation} action`);
      return res.json();
    },
    onSuccess: (_, vars) => {
      toast({ title: `Action ${vars.operation}d`, description: `Action #${vars.actionId} has been ${vars.operation}d.` });
      queryClient.invalidateQueries({ queryKey: ["/api/autonomy/actions"] });
      if (selectedActionId === vars.actionId) {
        queryClient.invalidateQueries({ queryKey: ["/api/autonomy/actions/detail", vars.actionId] });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
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

  const accountScores = allScores.filter(s => s.entityType === "account");
  const pendingRecs = recommendations.filter(r => r.status === "pending");
  const criticalRecs = pendingRecs.filter(r => r.priority === "critical");

  const tabs = [
    { id: "ecosystem" as const, label: "Ecosystem", icon: Brain },
    { id: "scores" as const, label: "Scores", icon: Gauge },
    { id: "opportunities" as const, label: "Opportunities", icon: Lightbulb },
    { id: "events" as const, label: "Events", icon: Radio },
    { id: "health" as const, label: "Health", icon: Server },
    { id: "network" as const, label: "Network", icon: Network },
    { id: "timeline" as const, label: "Timeline", icon: Clock },
    { id: "operator" as const, label: "Operator", icon: Box },
    { id: "autonomy" as const, label: "Autonomy", icon: ShieldCheck },
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
              <p className="text-xs text-slate-500">Full Ecosystem Intelligence — Level 2</p>
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
              {tab.id === "opportunities" && pendingRecs.length > 0 && (
                <Badge className="bg-red-500/20 text-red-400 border-0 text-[9px] px-1.5">{pendingRecs.length}</Badge>
              )}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === "ecosystem" && (
            <motion.div key="ecosystem" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
                  <p className="text-2xl font-black">
                    {summary?.integrationHealth.healthy ?? 0}
                    <span className="text-sm text-slate-500">/{summary?.integrationHealth.total ?? 0}</span>
                  </p>
                </Card>
                <Card className="bg-white/[0.03] border-white/5 p-4" data-testid="stat-critical-actions">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle size={14} className="text-red-400" />
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">Critical Actions</span>
                  </div>
                  <p className="text-2xl font-black text-red-400">{criticalRecs.length}</p>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card className="bg-white/[0.03] border-white/5 p-6 flex flex-col items-center justify-center" data-testid="ecosystem-health-panel">
                  {ecosystemLoading ? (
                    <Loader2 size={24} className="animate-spin text-indigo-400" />
                  ) : ecosystem ? (
                    <>
                      <HealthRing value={ecosystem.overallHealth} size={120} />
                      <div className="mt-4 w-full">
                        <div className="flex items-center justify-between text-xs mb-2">
                          <span className="text-slate-400">Module Adoption</span>
                          <span className="text-white font-bold">{ecosystem.moduleAdoption}/100</span>
                        </div>
                        <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full" style={{ width: `${ecosystem.moduleAdoption}%` }} />
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-slate-500 text-center">Click Refresh to compute ecosystem health</p>
                  )}
                </Card>

                <Card className="bg-white/[0.03] border-white/5 p-6" data-testid="blockers-panel">
                  <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
                    <XCircle size={14} className="text-red-400" /> Top Blockers
                  </h3>
                  {ecosystem?.topBlockers && ecosystem.topBlockers.length > 0 ? (
                    <div className="space-y-2">
                      {ecosystem.topBlockers.map((blocker, i) => (
                        <div key={i} className="flex items-start gap-2 p-2 rounded bg-red-500/5 border border-red-500/10" data-testid={`blocker-${i}`}>
                          <AlertTriangle size={12} className={`mt-0.5 shrink-0 ${blocker.severity === "critical" ? "text-red-400" : "text-orange-400"}`} />
                          <p className="text-xs text-slate-300 leading-tight">{blocker.title}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-24 gap-2">
                      <CheckCircle2 size={20} className="text-emerald-400" />
                      <p className="text-xs text-slate-500">No critical blockers</p>
                    </div>
                  )}
                </Card>

                <Card className="bg-white/[0.03] border-white/5 p-6" data-testid="opportunities-panel">
                  <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
                    <ArrowUpRight size={14} className="text-emerald-400" /> Top Opportunities
                  </h3>
                  {ecosystem?.topOpportunities && ecosystem.topOpportunities.length > 0 ? (
                    <div className="space-y-2">
                      {ecosystem.topOpportunities.map((opp, i) => (
                        <div key={i} className="flex items-start gap-2 p-2 rounded bg-emerald-500/5 border border-emerald-500/10" data-testid={`opportunity-${i}`}>
                          <ArrowUpRight size={12} className="mt-0.5 shrink-0 text-emerald-400" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-slate-300 leading-tight truncate">{opp.title}</p>
                            <PriorityBadge priority={opp.priority} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-24 gap-2">
                      <Award size={20} className="text-yellow-400" />
                      <p className="text-xs text-slate-500">Refresh to see opportunities</p>
                    </div>
                  )}
                </Card>
              </div>

              <Card className="bg-white/[0.03] border-white/5 p-6" data-testid="score-breakdown-panel">
                <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
                  <Gauge size={14} className="text-indigo-400" /> All Intelligence Scores
                </h3>
                {accountScores.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                    {accountScores.map(s => (
                      <MiniScoreBar
                        key={s.id}
                        value={Math.round(s.scoreValue)}
                        band={s.scoreBand}
                        label={formatScoreLabel(s.scoreType)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-600 text-center py-6">No scores computed yet. Click Refresh to run all scoring algorithms.</p>
                )}
              </Card>

              {accountScores.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="score-gauges-panel">
                  {accountScores.slice(0, 8).map(s => {
                    const Icon = SCORE_ICONS[s.scoreType] || Activity;
                    const bandColor = s.scoreBand === "excellent" ? "border-emerald-500/20 bg-emerald-500/5" : s.scoreBand === "high" ? "border-cyan-500/20 bg-cyan-500/5" : s.scoreBand === "medium" ? "border-yellow-500/20 bg-yellow-500/5" : s.scoreBand === "low" ? "border-orange-500/20 bg-orange-500/5" : "border-red-500/20 bg-red-500/5";
                    const iconColor = s.scoreBand === "excellent" ? "text-emerald-400" : s.scoreBand === "high" ? "text-cyan-400" : s.scoreBand === "medium" ? "text-yellow-400" : s.scoreBand === "low" ? "text-orange-400" : "text-red-400";
                    return (
                      <Card key={s.id} className={`border p-4 ${bandColor}`} data-testid={`score-card-${s.scoreType}`}>
                        <div className="flex items-center gap-2 mb-3">
                          <Icon size={14} className={iconColor} />
                          <span className="text-[10px] text-slate-400 truncate">{formatScoreLabel(s.scoreType)}</span>
                        </div>
                        <div className="flex items-end justify-between">
                          <span className={`text-2xl font-black ${iconColor}`}>{Math.round(s.scoreValue)}</span>
                          <Badge className={`text-[9px] border-0 ${iconColor} bg-white/5`}>{s.scoreBand}</Badge>
                        </div>
                        {s.explanation && (
                          <p className="text-[9px] text-slate-600 mt-2 leading-tight line-clamp-2">{s.explanation}</p>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}

          {activeTab === "scores" && (
            <motion.div key="scores" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              {accountScores.length > 0 && (
                <Card className="bg-white/[0.03] border-white/5 p-6">
                  <h3 className="text-sm font-bold text-slate-300 mb-4">Account-Level Scores — All Dimensions</h3>
                  <div className="flex flex-wrap gap-8 justify-center mb-6">
                    {accountScores.map(s => (
                      <ScoreGauge key={s.id} value={s.scoreValue} label={formatScoreLabel(s.scoreType)} band={s.scoreBand} />
                    ))}
                  </div>
                  <div className="space-y-2">
                    {accountScores.map(s => (
                      <div key={s.id} className="p-3 rounded bg-white/[0.02]" data-testid={`score-detail-${s.scoreType}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-white flex items-center gap-2">
                            {(() => { const Icon = SCORE_ICONS[s.scoreType] || Activity; return <Icon size={12} className="text-indigo-400" />; })()}
                            {formatScoreLabel(s.scoreType)}
                          </span>
                          <div className="flex items-center gap-2">
                            <PriorityBadge priority={s.scoreBand === "critical" ? "critical" : s.scoreBand === "low" ? "high" : s.scoreBand === "medium" ? "medium" : "low"} />
                            <span className="text-xs text-slate-500">{new Date(s.calculatedAt).toLocaleString()}</span>
                          </div>
                        </div>
                        {s.explanation && <p className="text-[10px] text-slate-400">{s.explanation}</p>}
                      </div>
                    ))}
                  </div>
                </Card>
              )}
              <Card className="bg-white/[0.03] border-white/5 p-6">
                <h3 className="text-sm font-bold text-slate-300 mb-4">Entity-Level Scores</h3>
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
                  {allScores.filter(s => s.entityType !== "account").length === 0 && (
                    <p className="text-xs text-slate-600 text-center py-6">No entity scores yet. Click Refresh to compute scores for your sites, domains, and contacts.</p>
                  )}
                </div>
              </Card>

              {ecosystem?.benchmarkComparison && ecosystem.benchmarkComparison.length > 0 && (
                <Card className="bg-white/[0.03] border-white/5 p-6" data-testid="benchmark-panel">
                  <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
                    <BarChart3 size={14} className="text-cyan-400" /> Benchmark Comparison vs Platform Average
                  </h3>
                  <div className="space-y-3">
                    {ecosystem.benchmarkComparison.map(b => {
                      const diff = b.accountScore - b.platformAvg;
                      return (
                        <div key={b.scoreType} className="flex items-center gap-4 p-3 rounded bg-white/[0.02]" data-testid={`benchmark-${b.scoreType}`}>
                          <span className="text-xs text-slate-400 w-44 truncate">{formatScoreLabel(b.scoreType)}</span>
                          <div className="flex-1">
                            <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                              <span>You: {b.accountScore}</span>
                              <span>Platform avg: {b.platformAvg}</span>
                            </div>
                            <div className="h-2 bg-white/5 rounded-full relative overflow-hidden">
                              <div className="h-full bg-slate-600 rounded-full" style={{ width: `${b.platformAvg}%` }} />
                              <div className={`absolute top-0 h-full rounded-full ${diff >= 0 ? "bg-emerald-500" : "bg-red-500"}`}
                                style={{ width: `${b.accountScore}%`, opacity: 0.6 }} />
                            </div>
                          </div>
                          <div className="flex items-center gap-1 w-24 justify-end">
                            {diff > 0 ? <ArrowUp size={10} className="text-emerald-400" /> : diff < 0 ? <ArrowDown size={10} className="text-red-400" /> : null}
                            <span className={`text-[10px] font-bold ${diff > 0 ? "text-emerald-400" : diff < 0 ? "text-red-400" : "text-slate-400"}`}>{b.percentile}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}
            </motion.div>
          )}

          {activeTab === "opportunities" && (
            <motion.div key="opportunities" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
                  <Lightbulb size={14} className="text-yellow-400" />
                  Recommendations & Opportunities
                  <Badge className="bg-yellow-500/10 text-yellow-400 border-0">{pendingRecs.length} pending</Badge>
                </h3>
                <div className="flex gap-2">
                  {["critical", "high", "medium", "low"].map(p => (
                    <Badge key={p} className={`text-[9px] px-2 py-1 border-0 cursor-pointer ${
                      p === "critical" ? "bg-red-500/20 text-red-400" : p === "high" ? "bg-orange-500/20 text-orange-400" : p === "medium" ? "bg-yellow-500/20 text-yellow-400" : "bg-slate-500/20 text-slate-400"
                    }`}>
                      {pendingRecs.filter(r => r.priority === p).length} {p}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {["critical", "high", "medium", "low"].map(priority => {
                  const recs = pendingRecs.filter(r => r.priority === priority);
                  if (recs.length === 0) return null;
                  return (
                    <div key={priority}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`h-px flex-1 ${priority === "critical" ? "bg-red-500/30" : priority === "high" ? "bg-orange-500/30" : priority === "medium" ? "bg-yellow-500/30" : "bg-slate-500/30"}`} />
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${priority === "critical" ? "text-red-400" : priority === "high" ? "text-orange-400" : priority === "medium" ? "text-yellow-400" : "text-slate-400"}`}>{priority}</span>
                        <div className={`h-px flex-1 ${priority === "critical" ? "bg-red-500/30" : priority === "high" ? "bg-orange-500/30" : priority === "medium" ? "bg-yellow-500/30" : "bg-slate-500/30"}`} />
                      </div>
                      {recs.map(rec => (
                        <div key={rec.id} className={`p-4 rounded-lg border mb-2 ${
                          priority === "critical" ? "border-red-500/20 bg-red-500/5" : priority === "high" ? "border-orange-500/20 bg-orange-500/5" : "border-white/10 bg-white/[0.03]"
                        }`} data-testid={`recommendation-${rec.id}`}>
                          <div className="flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <PriorityBadge priority={rec.priority} />
                                <Badge className="text-[9px] bg-white/5 text-slate-500 border-0">{rec.entityType}</Badge>
                              </div>
                              <p className="text-sm font-bold text-white">{rec.title}</p>
                              {rec.description && <p className="text-xs text-slate-400 mt-1">{rec.description}</p>}
                              {rec.whyThisExists && (
                                <div className="flex items-start gap-1 mt-2">
                                  <Eye size={10} className="text-indigo-400/60 mt-0.5 shrink-0" />
                                  <p className="text-[10px] text-indigo-400/60 italic">{rec.whyThisExists}</p>
                                </div>
                              )}
                              {rec.recommendedAction?.target && (
                                <a href={rec.recommendedAction.target} className="mt-2 inline-flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300">
                                  <ArrowRight size={10} /> Go to {rec.recommendedAction.target}
                                </a>
                              )}
                            </div>
                            <div className="flex flex-col gap-1 shrink-0">
                              <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-500" onClick={() => resolveMutation.mutate(rec.id)} data-testid={`button-resolve-${rec.id}`}>
                                <CheckCircle2 size={12} className="mr-1" /> Done
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-500" onClick={() => dismissMutation.mutate(rec.id)} data-testid={`button-dismiss-${rec.id}`}>
                                Dismiss
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
                {pendingRecs.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 gap-4">
                    <CheckCircle2 size={32} className="text-emerald-400" />
                    <p className="text-sm text-slate-400">No pending recommendations</p>
                    <p className="text-xs text-slate-600">Click Refresh to analyze your data and generate recommendations</p>
                  </div>
                )}
              </div>

              {recommendations.filter(r => r.status !== "pending").length > 0 && (
                <div className="mt-6">
                  <h4 className="text-xs text-slate-500 mb-3">Resolved / Dismissed</h4>
                  <div className="space-y-2 opacity-50">
                    {recommendations.filter(r => r.status !== "pending").map(rec => (
                      <div key={rec.id} className="flex items-center gap-3 p-3 rounded bg-white/[0.02] border border-white/5" data-testid={`resolved-rec-${rec.id}`}>
                        {rec.status === "resolved" ? <CheckCircle2 size={12} className="text-emerald-400" /> : <XCircle size={12} className="text-slate-500" />}
                        <span className="text-xs text-slate-400 flex-1">{rec.title}</span>
                        <Badge className="text-[9px] bg-white/5 text-slate-500 border-0">{rec.status}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === "events" && (
            <motion.div key="events" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="bg-white/[0.03] border-white/5 p-4" data-testid="live-events-panel">
                  <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
                    <Radio size={14} className="text-green-400" />
                    Live Event Stream
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  </h3>
                  <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                    {liveEvents.slice(0, 30).map(evt => (
                      <div key={evt.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/[0.02] hover:bg-white/[0.05] transition-colors" data-testid={`event-${evt.id}`}>
                        <EventIcon type={evt.eventType} />
                        <span className="text-xs text-white font-medium truncate flex-1">{evt.eventType.replace(/_/g, ' ')}</span>
                        <span className="text-[10px] text-slate-600 shrink-0">{evt.sourceModule}</span>
                        <span className="text-[10px] text-slate-600 shrink-0">{new Date(evt.occurredAt).toLocaleTimeString()}</span>
                      </div>
                    ))}
                    {liveEvents.length === 0 && (
                      <p className="text-xs text-slate-600 text-center py-8">No events yet. Events appear as users interact with the platform.</p>
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
                          <span className="text-xs text-slate-400 w-36 truncate">{evt.eventType.replace(/_/g, ' ')}</span>
                          <div className="flex-1 h-4 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-indigo-600 to-cyan-500 rounded-full" style={{ width: `${(evt.count / max) * 100}%` }} />
                          </div>
                          <span className="text-xs font-bold text-white w-10 text-right">{evt.count}</span>
                        </div>
                      );
                    })}
                    {topEvents.length === 0 && (
                      <p className="text-xs text-slate-600 text-center py-8">No event data for the last 7 days.</p>
                    )}
                  </div>
                </Card>
              </div>
            </motion.div>
          )}

          {activeTab === "health" && (
            <motion.div key="health" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-2">
                {["healthy", "degraded", "error", "disconnected"].map(status => {
                  const count = healthData.filter(h => h.status === status).length;
                  const icon = status === "healthy" ? CheckCircle2 : status === "degraded" ? AlertTriangle : XCircle;
                  const color = status === "healthy" ? "text-emerald-400" : status === "degraded" ? "text-yellow-400" : "text-red-400";
                  const Icon = icon;
                  return (
                    <Card key={status} className="bg-white/[0.03] border-white/5 p-4" data-testid={`health-stat-${status}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <Icon size={12} className={color} />
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider">{status}</span>
                      </div>
                      <p className={`text-2xl font-black ${color}`}>{count}</p>
                    </Card>
                  );
                })}
              </div>

              <Card className="bg-white/[0.03] border-white/5 p-6" data-testid="health-panel">
                <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
                  <Server size={14} className="text-emerald-400" /> Integration Health Details
                </h3>
                <div className="space-y-3">
                  {healthData.map(h => (
                    <div key={h.id} className="flex items-center gap-4 p-4 rounded-lg bg-white/[0.02] border border-white/5" data-testid={`health-${h.id}`}>
                      <StatusDot status={h.status} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-white">{h.integrationType}</p>
                        <p className="text-[10px] text-slate-500">{h.integrationKey}</p>
                        {h.lastSuccessAt && <p className="text-[10px] text-slate-600">Last success: {new Date(h.lastSuccessAt).toLocaleString()}</p>}
                        {h.lastFailureAt && <p className="text-[10px] text-red-400/60">Last failure: {new Date(h.lastFailureAt).toLocaleString()}</p>}
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
                  {healthData.length === 0 && <p className="text-xs text-slate-600 text-center py-10">No integration health data tracked yet.</p>}
                </div>
              </Card>
            </motion.div>
          )}

          {activeTab === "network" && (
            <motion.div key="network" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="flex items-start gap-3 p-4 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                <Network size={16} className="text-indigo-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-white">Network Intelligence</p>
                  <p className="text-xs text-slate-400">Cross-account patterns and platform-wide benchmarks. Data is aggregated and anonymized — no individual account data is exposed.</p>
                </div>
              </div>

              {networkIntel ? (
                <>
                  {networkIntel.benchmarks.length > 0 && (
                    <Card className="bg-white/[0.03] border-white/5 p-6" data-testid="network-benchmarks">
                      <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
                        <BarChart3 size={14} className="text-cyan-400" /> Platform Benchmarks ({networkIntel.benchmarks[0]?.sampleSize ?? 0}+ accounts)
                      </h3>
                      <div className="space-y-4">
                        {networkIntel.benchmarks.map(b => (
                          <div key={b.scoreType} className="space-y-1" data-testid={`benchmark-row-${b.scoreType}`}>
                            <div className="flex justify-between text-xs">
                              <span className="text-slate-400">{formatScoreLabel(b.scoreType)}</span>
                              <span className="text-slate-500 text-[10px]">{b.sampleSize} accounts</span>
                            </div>
                            <div className="relative h-5 bg-white/5 rounded-full overflow-hidden">
                              <div className="h-full bg-slate-700 rounded-full" style={{ width: `${b.platformMedian}%` }} />
                              <div className="absolute top-0 h-full bg-cyan-500/40 rounded-full" style={{ width: `${b.topQuartile}%` }} />
                              <div className="absolute left-1/2 top-1/2 -translate-y-1/2 flex items-center gap-4 text-[9px]">
                                <span className="text-slate-400">Avg: {b.platformAvg}</span>
                                <span className="text-cyan-400">Top 25%: {b.topQuartile}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}

                  {networkIntel.patterns.length > 0 && (
                    <Card className="bg-white/[0.03] border-white/5 p-6" data-testid="network-patterns">
                      <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
                        <AlertTriangle size={14} className="text-yellow-400" /> Platform-Wide Patterns
                      </h3>
                      <div className="space-y-3">
                        {networkIntel.patterns.map((p, i) => (
                          <div key={i} className={`p-4 rounded-lg border ${
                            p.severity === "critical" ? "border-red-500/20 bg-red-500/5" : p.severity === "warning" ? "border-yellow-500/20 bg-yellow-500/5" : "border-white/10 bg-white/[0.02]"
                          }`} data-testid={`pattern-${i}`}>
                            <div className="flex items-start gap-3">
                              <AlertTriangle size={14} className={p.severity === "critical" ? "text-red-400" : p.severity === "warning" ? "text-yellow-400" : "text-blue-400"} />
                              <div className="flex-1">
                                <p className="text-sm font-bold text-white">{p.title}</p>
                                <p className="text-xs text-slate-400 mt-1">{p.description}</p>
                                <div className="flex items-center gap-3 mt-2">
                                  <Badge className="text-[9px] bg-white/5 text-slate-500 border-0">{p.affectedAccounts} accounts affected</Badge>
                                  <Badge className="text-[9px] bg-white/5 text-slate-500 border-0">{p.frequency} total occurrences</Badge>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}

                  {networkIntel.benchmarks.length === 0 && networkIntel.patterns.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 gap-4">
                      <Network size={32} className="text-slate-600" />
                      <p className="text-sm text-slate-400">Not enough data for network patterns yet</p>
                      <p className="text-xs text-slate-600">Network intelligence requires multiple accounts with scored data</p>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-center py-16">
                  <Loader2 size={24} className="animate-spin text-indigo-400" />
                </div>
              )}
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
                        <div className="flex-1 min-w-0 pb-4">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs font-bold text-white">{entry.title}</p>
                            <span className="text-[10px] text-slate-600 shrink-0">{new Date(entry.createdAt).toLocaleString()}</span>
                          </div>
                          {entry.description && <p className="text-[10px] text-slate-500">{entry.description}</p>}
                          <Badge className="mt-1 text-[9px] bg-white/5 text-slate-500 border-0">{entry.sourceModule}</Badge>
                        </div>
                      </div>
                    ))}
                    {timeline.length === 0 && (
                      <p className="text-xs text-slate-600 text-center py-10">No timeline entries yet.</p>
                    )}
                  </div>
                </div>
              </Card>
            </motion.div>
          )}
          {activeTab === "operator" && (
            <motion.div key="operator" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} data-testid="operator-panel">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <Card className="bg-white/[0.03] border-white/5 p-4" data-testid="stat-total-events">
                  <div className="flex items-center gap-2 mb-2"><Radio size={14} className="text-green-400" /><span className="text-[10px] text-slate-500 uppercase tracking-wider">Cross-Account Events (24h)</span></div>
                  <p className="text-2xl font-black">{operatorEvents.length}</p>
                </Card>
                <Card className="bg-white/[0.03] border-white/5 p-4" data-testid="stat-failed-events">
                  <div className="flex items-center gap-2 mb-2"><AlertOctagon size={14} className="text-red-400" /><span className="text-[10px] text-slate-500 uppercase tracking-wider">Failed Events (7d)</span></div>
                  <p className="text-2xl font-black text-red-400">{failedEventsData?.summary.total ?? 0}</p>
                </Card>
                <Card className="bg-white/[0.03] border-white/5 p-4" data-testid="stat-active-accounts">
                  <div className="flex items-center gap-2 mb-2"><Users size={14} className="text-cyan-400" /><span className="text-[10px] text-slate-500 uppercase tracking-wider">Active Accounts (7d)</span></div>
                  <p className="text-2xl font-black">{accountActivity.length}</p>
                </Card>
                <Card className="bg-white/[0.03] border-white/5 p-4" data-testid="stat-identity-links">
                  <div className="flex items-center gap-2 mb-2"><Link2 size={14} className="text-purple-400" /><span className="text-[10px] text-slate-500 uppercase tracking-wider">Identity Links</span></div>
                  <p className="text-2xl font-black">{linkageData?.totalLinks ?? 0}</p>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <Card className="bg-white/[0.03] border-white/5 p-4" data-testid="module-activity-panel">
                  <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
                    <Box size={14} className="text-indigo-400" /> Module Activity (24h)
                  </h3>
                  <div className="space-y-2">
                    {Object.entries(moduleHealth?.moduleActivity || {}).sort((a, b) => b[1].events24h - a[1].events24h).map(([mod, data]) => (
                      <div key={mod} className="flex items-center gap-3" data-testid={`module-row-${mod}`}>
                        <span className="text-xs text-white w-32 truncate font-medium">{mod}</span>
                        <div className="flex-1 h-3 bg-white/5 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-indigo-600 to-cyan-500 rounded-full" style={{ width: `${Math.min(100, (data.events24h / Math.max(...Object.values(moduleHealth?.moduleActivity || { x: { events24h: 1, lastSeen: null } }).map(d => d.events24h))) * 100)}%` }} />
                        </div>
                        <span className="text-xs font-bold text-white w-10 text-right">{data.events24h}</span>
                        {data.lastSeen && <span className="text-[10px] text-slate-600 w-24 text-right shrink-0">{new Date(data.lastSeen).toLocaleTimeString()}</span>}
                      </div>
                    ))}
                    {Object.keys(moduleHealth?.moduleActivity || {}).length === 0 && <p className="text-xs text-slate-600 text-center py-4">No module activity in the last 24h.</p>}
                  </div>
                </Card>

                <Card className="bg-white/[0.03] border-white/5 p-4" data-testid="account-activity-panel">
                  <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
                    <Users size={14} className="text-cyan-400" /> Top Accounts by Activity (7d)
                  </h3>
                  <div className="space-y-2">
                    {accountActivity.slice(0, 10).map(acc => (
                      <div key={acc.subAccountId} className="flex items-center gap-3 p-2 rounded bg-white/[0.02]" data-testid={`account-activity-${acc.subAccountId}`}>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-white truncate">{acc.accountName}</p>
                          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                            {(acc.modules || []).slice(0, 4).map(m => <Badge key={m} className="text-[9px] bg-white/5 text-slate-500 border-0 px-1">{m}</Badge>)}
                          </div>
                        </div>
                        <Badge className={`text-[9px] border-0 ${acc.plan === "enterprise" ? "bg-purple-500/20 text-purple-400" : acc.plan === "pro" ? "bg-cyan-500/20 text-cyan-400" : "bg-white/5 text-slate-500"}`}>{acc.plan}</Badge>
                        <span className="text-xs font-bold text-indigo-400 w-10 text-right">{acc.eventCount}</span>
                      </div>
                    ))}
                    {accountActivity.length === 0 && <p className="text-xs text-slate-600 text-center py-4">No account activity in the last 7 days.</p>}
                  </div>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <Card className="bg-white/[0.03] border-white/5 p-4" data-testid="failed-events-panel">
                  <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
                    <AlertOctagon size={14} className="text-red-400" /> Failed Events (7d)
                    {(failedEventsData?.summary.total ?? 0) > 0 && <Badge className="bg-red-500/20 text-red-400 border-0 text-[9px] px-1.5">{failedEventsData?.summary.total}</Badge>}
                  </h3>
                  {Object.keys(failedEventsData?.summary.byModule || {}).length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {Object.entries(failedEventsData?.summary.byModule || {}).map(([mod, count]) => (
                        <Badge key={mod} className="text-[9px] bg-red-500/10 text-red-400 border-0">{mod}: {count}</Badge>
                      ))}
                    </div>
                  )}
                  <div className="space-y-1.5 max-h-[240px] overflow-y-auto">
                    {(failedEventsData?.failedEvents || []).slice(0, 20).map(evt => (
                      <div key={evt.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-red-500/[0.05]" data-testid={`failed-evt-${evt.id}`}>
                        <XCircle size={10} className="text-red-400 shrink-0" />
                        <span className="text-xs font-mono text-red-300 truncate flex-1">{evt.eventType}</span>
                        <span className="text-[10px] text-slate-600 shrink-0">{evt.sourceModule}</span>
                        <span className="text-[10px] text-slate-600 shrink-0">{new Date(evt.occurredAt).toLocaleDateString()}</span>
                      </div>
                    ))}
                    {(failedEventsData?.failedEvents || []).length === 0 && <p className="text-xs text-slate-600 text-center py-4">No failures in the last 7 days.</p>}
                  </div>
                </Card>

                <Card className="bg-white/[0.03] border-white/5 p-4" data-testid="entity-linkage-panel">
                  <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
                    <Link2 size={14} className="text-purple-400" /> Entity Identity Linkage
                  </h3>
                  {(linkageData?.byEntityType || []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {(linkageData?.byEntityType || []).map(item => (
                        <Badge key={item.entityType} className="text-[9px] bg-purple-500/10 text-purple-400 border-0">{item.entityType}: {item.count}</Badge>
                      ))}
                    </div>
                  )}
                  <div className="space-y-1.5 max-h-[240px] overflow-y-auto">
                    {(linkageData?.recentLinks || []).slice(0, 20).map(link => (
                      <div key={link.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/[0.02]" data-testid={`link-${link.id}`}>
                        <Badge className="text-[9px] bg-purple-500/10 text-purple-400 border-0 shrink-0">{link.entityType}</Badge>
                        <span className="text-xs text-slate-300 truncate flex-1 font-mono">{link.entityId}</span>
                        <ChevronRight size={10} className="text-slate-600 shrink-0" />
                        <span className="text-xs text-indigo-400 truncate max-w-[100px] font-mono">{link.canonicalId}</span>
                      </div>
                    ))}
                    {(linkageData?.recentLinks || []).length === 0 && <p className="text-xs text-slate-600 text-center py-4">No identity links created yet.</p>}
                  </div>
                </Card>
              </div>

              <Card className="bg-white/[0.03] border-white/5 p-4" data-testid="cross-account-stream-panel">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
                    <Radio size={14} className="text-green-400" />
                    Cross-Account Event Stream (24h)
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  </h3>
                  <Input
                    placeholder="Filter by module or type..."
                    value={ecosystemFilter}
                    onChange={e => setEcosystemFilter(e.target.value)}
                    className="h-7 w-48 text-xs bg-white/5 border-white/10 text-white placeholder:text-slate-600"
                    data-testid="input-ecosystem-filter"
                  />
                </div>
                <div className="space-y-1 max-h-[360px] overflow-y-auto">
                  {operatorEvents
                    .filter(e => !ecosystemFilter || e.eventType.includes(ecosystemFilter) || e.sourceModule.includes(ecosystemFilter))
                    .slice(0, 100)
                    .map(evt => (
                      <div key={evt.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/[0.02] hover:bg-white/[0.04] transition-colors" data-testid={`operator-evt-${evt.id}`}>
                        <EventIcon type={evt.eventType} />
                        <span className="text-xs font-mono text-indigo-300 w-44 truncate">{evt.eventType}</span>
                        <Badge className="text-[9px] bg-white/5 text-slate-400 border-0 shrink-0">{evt.sourceModule}</Badge>
                        <span className="text-[10px] text-slate-500 shrink-0">acct:{evt.subAccountId}</span>
                        <span className="text-[10px] text-slate-600 ml-auto shrink-0">{new Date(evt.occurredAt).toLocaleString()}</span>
                      </div>
                    ))}
                  {operatorEvents.filter(e => !ecosystemFilter || e.eventType.includes(ecosystemFilter) || e.sourceModule.includes(ecosystemFilter)).length === 0 && (
                    <p className="text-xs text-slate-600 text-center py-6">No events match the current filter.</p>
                  )}
                </div>
              </Card>
            </motion.div>
          )}

          {activeTab === "autonomy" && (
            <motion.div key="autonomy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {[
                  { label: "Total Actions", value: autonomyActions.length, icon: ShieldCheck, color: "text-indigo-400", bg: "bg-indigo-500/10" },
                  { label: "Pending Review", value: autonomyActions.filter(a => a.status === "proposed").length, icon: Clock, color: "text-yellow-400", bg: "bg-yellow-500/10" },
                  { label: "Executing", value: autonomyActions.filter(a => a.status === "executing").length, icon: Play, color: "text-cyan-400", bg: "bg-cyan-500/10" },
                  { label: "Completed", value: autonomyActions.filter(a => a.status === "completed").length, icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10" },
                  { label: "Failed / Blocked", value: autonomyActions.filter(a => a.status === "failed" || a.status === "blocked").length, icon: XCircle, color: "text-red-400", bg: "bg-red-500/10" },
                ].map((stat) => (
                  <Card key={stat.label} className="bg-white/[0.03] border-white/5 p-4" data-testid={`autonomy-stat-${stat.label.toLowerCase().replace(/[\s\/]/g, '-')}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <stat.icon size={14} className={stat.color} />
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider">{stat.label}</span>
                    </div>
                    <p className={`text-2xl font-black ${stat.color}`}>{stat.value}</p>
                  </Card>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-4">
                  <Card className="bg-white/[0.03] border-white/5 p-4" data-testid="autonomy-queue-panel">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <ShieldCheck size={14} className="text-indigo-400" />
                        Autonomy Queue
                      </h3>
                      <div className="flex items-center gap-2">
                        <select
                          data-testid="select-autonomy-status-filter"
                          value={autonomyStatusFilter}
                          onChange={(e) => setAutonomyStatusFilter(e.target.value)}
                          className="h-7 text-[10px] rounded-md border border-white/10 bg-white/5 text-white px-2"
                        >
                          <option value="" className="bg-gray-900">All Statuses</option>
                          <option value="proposed" className="bg-gray-900">Proposed</option>
                          <option value="approved" className="bg-gray-900">Approved</option>
                          <option value="executing" className="bg-gray-900">Executing</option>
                          <option value="completed" className="bg-gray-900">Completed</option>
                          <option value="failed" className="bg-gray-900">Failed</option>
                          <option value="blocked" className="bg-gray-900">Blocked</option>
                          <option value="pending_auth" className="bg-gray-900">Pending Auth</option>
                          <option value="resumed" className="bg-gray-900">Resumed</option>
                          <option value="rolled_back" className="bg-gray-900">Rolled Back</option>
                        </select>
                        <button
                          data-testid="button-refresh-autonomy"
                          onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/autonomy/actions"] })}
                          className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-colors"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {autonomyLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
                      </div>
                    ) : autonomyError ? (
                      <div className="text-center py-12" data-testid="autonomy-error-state">
                        <AlertTriangle className="w-10 h-10 mx-auto text-red-400 mb-3" />
                        <p className="text-sm text-red-400 font-medium">Failed to load autonomy actions</p>
                        <p className="text-[10px] text-slate-600 mt-1">There was an error fetching the action queue. Please try again.</p>
                        <Button
                          size="sm"
                          className="mt-3 h-7 text-[10px] bg-indigo-600 hover:bg-indigo-500"
                          onClick={() => refetchAutonomy()}
                          data-testid="button-retry-autonomy-fetch"
                        >
                          <RotateCcw size={10} className="mr-1" /> Retry
                        </Button>
                      </div>
                    ) : autonomyActions.length === 0 ? (
                      <div className="text-center py-12" data-testid="autonomy-empty-state">
                        <ShieldCheck className="w-10 h-10 mx-auto text-slate-700 mb-3" />
                        <p className="text-sm text-slate-500 font-medium">No autonomous actions yet</p>
                        <p className="text-[10px] text-slate-600 mt-1">Apex will create actions here as it detects opportunities and events.</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-[520px] overflow-y-auto scrollbar-thin" data-testid="autonomy-actions-list">
                        {autonomyActions.map((action) => {
                          const statusColors: Record<string, string> = {
                            proposed: "bg-yellow-500/20 text-yellow-400",
                            approved: "bg-cyan-500/20 text-cyan-400",
                            executing: "bg-blue-500/20 text-blue-400",
                            completed: "bg-emerald-500/20 text-emerald-400",
                            failed: "bg-red-500/20 text-red-400",
                            blocked: "bg-red-500/20 text-red-400",
                            pending_auth: "bg-orange-500/20 text-orange-400",
                            resumed: "bg-cyan-500/20 text-cyan-400",
                            rolled_back: "bg-slate-500/20 text-slate-400",
                          };
                          const safetyColors: Record<string, string> = {
                            auto_execute: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
                            auto_prepare: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
                            require_review: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
                            blocked: "bg-red-500/15 text-red-400 border-red-500/20",
                          };
                          const isSelected = selectedActionId === action.id;
                          return (
                            <motion.div
                              key={action.id}
                              initial={{ opacity: 0, x: -8 }}
                              animate={{ opacity: 1, x: 0 }}
                              className={`px-3 py-2.5 rounded-lg cursor-pointer transition-all ${
                                isSelected ? "bg-indigo-500/10 border border-indigo-500/30" : "bg-white/[0.02] hover:bg-white/[0.04] border border-transparent"
                              }`}
                              onClick={() => setSelectedActionId(isSelected ? null : action.id)}
                              data-testid={`autonomy-action-${action.id}`}
                            >
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-mono text-white font-medium">{action.actionType}</span>
                                <Badge className={`text-[9px] px-1.5 py-0 border-0 ${statusColors[action.status] || "bg-slate-500/20 text-slate-400"}`}>
                                  {action.status.replace(/_/g, " ")}
                                </Badge>
                                <Badge className={`text-[9px] px-1.5 py-0 border ${safetyColors[action.safetyClass] || "bg-slate-500/15 text-slate-400 border-slate-500/20"}`}>
                                  {action.safetyClass.replace(/_/g, " ")}
                                </Badge>
                                {action.targetModule && (
                                  <Badge className="text-[9px] bg-white/5 text-slate-400 border-0 px-1.5 py-0">{action.targetModule}</Badge>
                                )}
                                <span className="text-[9px] text-slate-600 ml-auto shrink-0">{new Date(action.createdAt).toLocaleString()}</span>
                              </div>
                              <div className="flex items-center gap-3 mt-1.5">
                                <div className="flex items-center gap-1">
                                  <span className="text-[10px] text-slate-500">Confidence:</span>
                                  <div className="w-16 h-1.5 bg-white/5 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${action.confidenceScore >= 0.8 ? "bg-emerald-400" : action.confidenceScore >= 0.5 ? "bg-yellow-400" : "bg-red-400"}`}
                                      style={{ width: `${action.confidenceScore * 100}%` }}
                                    />
                                  </div>
                                  <span className={`text-[10px] font-bold ${action.confidenceScore >= 0.8 ? "text-emerald-400" : action.confidenceScore >= 0.5 ? "text-yellow-400" : "text-red-400"}`}>
                                    {Math.round(action.confidenceScore * 100)}%
                                  </span>
                                </div>
                                <span className="text-[10px] text-slate-600">{action.actionCategory}</span>
                                {action.dependsOnActionId && (
                                  <span className="text-[10px] text-purple-400 flex items-center gap-0.5">
                                    <GitBranch size={9} /> dep:{action.dependsOnActionId}
                                  </span>
                                )}
                              </div>
                              {action.reason && (
                                <p className="text-[10px] text-slate-500 mt-1 line-clamp-1">{action.reason}</p>
                              )}

                              {isSelected && (
                                <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-2 flex-wrap" data-testid={`autonomy-controls-${action.id}`}>
                                  {(action.status === "proposed" || action.status === "pending_auth") && (
                                    <>
                                      <Button
                                        size="sm"
                                        className="h-7 text-[10px] bg-emerald-600 hover:bg-emerald-500"
                                        onClick={(e) => { e.stopPropagation(); autonomyMutation.mutate({ actionId: action.id, operation: "approve" }); }}
                                        disabled={autonomyMutation.isPending}
                                        data-testid={`button-approve-${action.id}`}
                                      >
                                        <CheckCircle2 size={10} className="mr-1" /> Approve
                                      </Button>
                                      <Button
                                        size="sm"
                                        className="h-7 text-[10px] bg-red-600 hover:bg-red-500"
                                        onClick={(e) => { e.stopPropagation(); autonomyMutation.mutate({ actionId: action.id, operation: "reject" }); }}
                                        disabled={autonomyMutation.isPending}
                                        data-testid={`button-reject-${action.id}`}
                                      >
                                        <Ban size={10} className="mr-1" /> Reject
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-[10px] border-white/10 text-slate-400 hover:text-white"
                                        onClick={(e) => { e.stopPropagation(); autonomyMutation.mutate({ actionId: action.id, operation: "snooze" }); }}
                                        disabled={autonomyMutation.isPending}
                                        data-testid={`button-snooze-${action.id}`}
                                      >
                                        <Pause size={10} className="mr-1" /> Snooze
                                      </Button>
                                    </>
                                  )}
                                  {action.status === "blocked" && (
                                    <Button
                                      size="sm"
                                      className="h-7 text-[10px] bg-purple-600 hover:bg-purple-500"
                                      onClick={(e) => { e.stopPropagation(); autonomyMutation.mutate({ actionId: action.id, operation: "approve" }); }}
                                      disabled={autonomyMutation.isPending}
                                      data-testid={`button-force-run-${action.id}`}
                                    >
                                      <Play size={10} className="mr-1" /> Force Run
                                    </Button>
                                  )}
                                  {action.status === "failed" && (
                                    <Button
                                      size="sm"
                                      className="h-7 text-[10px] bg-cyan-600 hover:bg-cyan-500"
                                      onClick={(e) => { e.stopPropagation(); autonomyMutation.mutate({ actionId: action.id, operation: "retry" }); }}
                                      disabled={autonomyMutation.isPending}
                                      data-testid={`button-retry-${action.id}`}
                                    >
                                      <RotateCcw size={10} className="mr-1" /> Retry
                                    </Button>
                                  )}
                                  {(action.status === "completed" || action.status === "rolled_back" || action.status === "blocked") && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-[10px] border-white/10 text-slate-400 hover:text-white"
                                      onClick={(e) => { e.stopPropagation(); toast({ title: "Acknowledged", description: `Action #${action.id} acknowledged.` }); setSelectedActionId(null); }}
                                      data-testid={`button-acknowledge-${action.id}`}
                                    >
                                      <CheckCircle2 size={10} className="mr-1" /> Acknowledge
                                    </Button>
                                  )}
                                  {action.status === "completed" && action.rollbackPayload && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-[10px] border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
                                      onClick={(e) => { e.stopPropagation(); autonomyMutation.mutate({ actionId: action.id, operation: "rollback" }); }}
                                      disabled={autonomyMutation.isPending}
                                      data-testid={`button-rollback-${action.id}`}
                                    >
                                      <RotateCcw size={10} className="mr-1" /> Rollback
                                    </Button>
                                  )}
                                </div>
                              )}
                            </motion.div>
                          );
                        })}
                      </div>
                    )}
                  </Card>
                </div>

                <div className="space-y-4">
                  {selectedActionId ? (
                    <Card className="bg-white/[0.03] border-white/5 p-4" data-testid="autonomy-detail-panel">
                      <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
                        <Info size={14} className="text-indigo-400" />
                        Action Detail
                      </h3>
                      {detailLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
                        </div>
                      ) : detailError ? (
                        <div className="text-center py-8" data-testid="autonomy-detail-error">
                          <AlertTriangle className="w-8 h-8 mx-auto text-red-400 mb-2" />
                          <p className="text-xs text-red-400 font-medium">Failed to load action details</p>
                          <Button
                            size="sm"
                            className="mt-2 h-7 text-[10px] bg-indigo-600 hover:bg-indigo-500"
                            onClick={() => refetchDetail()}
                            data-testid="button-retry-detail-fetch"
                          >
                            <RotateCcw size={10} className="mr-1" /> Retry
                          </Button>
                        </div>
                      ) : !actionDetail ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div>
                            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Action Type</p>
                            <p className="text-xs text-white font-mono font-medium" data-testid="detail-action-type">{actionDetail.action.actionType}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Category</p>
                            <p className="text-xs text-slate-300" data-testid="detail-category">{actionDetail.action.actionCategory}</p>
                          </div>
                          {actionDetail.action.targetModule && (
                            <div>
                              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Target</p>
                              <p className="text-xs text-slate-300" data-testid="detail-target">
                                {actionDetail.action.targetModule}
                                {actionDetail.action.targetEntityType && ` → ${actionDetail.action.targetEntityType}`}
                                {actionDetail.action.targetEntityId && ` #${actionDetail.action.targetEntityId}`}
                              </p>
                            </div>
                          )}

                          <div data-testid="trust-indicator-panel">
                            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Trust Layer</p>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] text-slate-400">Confidence</span>
                                <div className="flex items-center gap-2">
                                  <div className="w-20 h-2 bg-white/5 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${actionDetail.action.confidenceScore >= 0.8 ? "bg-emerald-400" : actionDetail.action.confidenceScore >= 0.5 ? "bg-yellow-400" : "bg-red-400"}`}
                                      style={{ width: `${actionDetail.action.confidenceScore * 100}%` }}
                                    />
                                  </div>
                                  <span className="text-[10px] font-bold text-white">{Math.round(actionDetail.action.confidenceScore * 100)}%</span>
                                </div>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] text-slate-400">Safety Class</span>
                                <Badge className={`text-[9px] border ${
                                  actionDetail.action.safetyClass === "auto_execute" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" :
                                  actionDetail.action.safetyClass === "auto_prepare" ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/20" :
                                  actionDetail.action.safetyClass === "require_review" ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/20" :
                                  "bg-red-500/15 text-red-400 border-red-500/20"
                                }`} data-testid="detail-safety-class">
                                  {actionDetail.action.safetyClass.replace(/_/g, " ")}
                                </Badge>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] text-slate-400">Risk Level</span>
                                <span className={`text-[10px] font-bold ${
                                  actionDetail.action.safetyClass === "blocked" ? "text-red-400" :
                                  actionDetail.action.safetyClass === "require_review" ? "text-yellow-400" :
                                  actionDetail.action.safetyClass === "auto_prepare" ? "text-cyan-400" :
                                  "text-emerald-400"
                                }`} data-testid="detail-risk-level">
                                  {actionDetail.action.safetyClass === "blocked" ? "Critical" :
                                   actionDetail.action.safetyClass === "require_review" ? "High" :
                                   actionDetail.action.safetyClass === "auto_prepare" ? "Medium" : "Low"}
                                </span>
                              </div>
                            </div>
                          </div>

                          {actionDetail.action.explanation && (
                            <div>
                              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Safety Explanation</p>
                              <p className="text-[10px] text-slate-400 bg-white/[0.02] rounded p-2 leading-relaxed" data-testid="detail-explanation">{actionDetail.action.explanation}</p>
                            </div>
                          )}
                          {actionDetail.action.reason && (
                            <div>
                              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Reason</p>
                              <p className="text-[10px] text-slate-400 bg-white/[0.02] rounded p-2 leading-relaxed" data-testid="detail-reason">{actionDetail.action.reason}</p>
                            </div>
                          )}

                          {actionDetail.policyRule && (
                            <div>
                              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Policy Rule</p>
                              <div className="bg-white/[0.02] rounded p-2 space-y-1" data-testid="detail-policy-rule">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-slate-400">Default Safety</span>
                                  <span className="text-[10px] text-white">{actionDetail.policyRule.defaultSafetyClass.replace(/_/g, " ")}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-slate-400">Destructive</span>
                                  <span className={`text-[10px] ${actionDetail.policyRule.isDestructive ? "text-red-400" : "text-slate-500"}`}>
                                    {actionDetail.policyRule.isDestructive ? "Yes" : "No"}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-slate-400">Reversible</span>
                                  <span className={`text-[10px] ${actionDetail.policyRule.isReversible ? "text-emerald-400" : "text-orange-400"}`}>
                                    {actionDetail.policyRule.isReversible ? "Yes" : "No"}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-slate-400">Auto-Exec Threshold</span>
                                  <span className="text-[10px] text-white">{Math.round(actionDetail.policyRule.maxConfidenceForAutoExec * 100)}%</span>
                                </div>
                              </div>
                            </div>
                          )}

                          {actionDetail.dependsOn && (
                            <div>
                              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Depends On</p>
                              <div
                                className="bg-white/[0.02] rounded p-2 cursor-pointer hover:bg-white/[0.04] transition-colors"
                                onClick={() => setSelectedActionId(actionDetail.dependsOn!.id)}
                                data-testid="detail-depends-on"
                              >
                                <div className="flex items-center gap-2">
                                  <GitBranch size={10} className="text-purple-400" />
                                  <span className="text-[10px] text-white font-mono">#{actionDetail.dependsOn.id} {actionDetail.dependsOn.actionType}</span>
                                  <Badge className="text-[9px] bg-white/5 border-0 text-slate-400">{actionDetail.dependsOn.status}</Badge>
                                </div>
                              </div>
                            </div>
                          )}

                          {actionDetail.action.executionResult && (
                            <div>
                              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Execution Result</p>
                              <pre className="text-[10px] text-slate-400 bg-white/[0.02] rounded p-2 overflow-x-auto max-h-32 overflow-y-auto" data-testid="detail-execution-result">
                                {JSON.stringify(actionDetail.action.executionResult, null, 2)}
                              </pre>
                            </div>
                          )}

                          <div className="pt-2 border-t border-white/5">
                            <div className="grid grid-cols-2 gap-2 text-[10px]">
                              <div>
                                <span className="text-slate-500">Created</span>
                                <p className="text-slate-300">{new Date(actionDetail.action.createdAt).toLocaleString()}</p>
                              </div>
                              <div>
                                <span className="text-slate-500">Updated</span>
                                <p className="text-slate-300">{new Date(actionDetail.action.updatedAt).toLocaleString()}</p>
                              </div>
                              {actionDetail.action.executedAt && (
                                <div>
                                  <span className="text-slate-500">Executed</span>
                                  <p className="text-slate-300">{new Date(actionDetail.action.executedAt).toLocaleString()}</p>
                                </div>
                              )}
                              {actionDetail.action.resolvedAt && (
                                <div>
                                  <span className="text-slate-500">Resolved</span>
                                  <p className="text-slate-300">{new Date(actionDetail.action.resolvedAt).toLocaleString()}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </Card>
                  ) : (
                    <Card className="bg-white/[0.03] border-white/5 p-4" data-testid="autonomy-detail-empty">
                      <div className="text-center py-8">
                        <Eye className="w-8 h-8 mx-auto text-slate-700 mb-3" />
                        <p className="text-xs text-slate-500">Select an action to view details</p>
                        <p className="text-[10px] text-slate-600 mt-1">Click any action in the queue to see its full detail, trust indicators, and controls.</p>
                      </div>
                    </Card>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
