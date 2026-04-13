import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Activity, AlertTriangle, BarChart3, Brain, CheckCircle2,
  Clock, Database, Eye, Filter, Layers, RefreshCw, Search,
  Server, Shield, Wifi, WifiOff, Zap, TrendingUp, Globe,
  MousePointerClick, FileText, Users, Settings, ExternalLink
} from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";

const EVENT_TYPE_COLORS: Record<string, string> = {
  page_view: "#06b6d4",
  scroll_depth: "#8b5cf6",
  click: "#f59e0b",
  cta_click: "#10b981",
  form_start: "#3b82f6",
  form_fill: "#6366f1",
  form_submit: "#22c55e",
  form_abandon: "#ef4444",
  quiz_answer: "#f97316",
  chat_interaction: "#ec4899",
  booking_action: "#14b8a6",
  calendar_selection: "#a855f7",
  funnel_step: "#eab308",
  checkout_step: "#84cc16",
  content_engagement: "#0ea5e9",
  identity_resolved: "#34d399",
  session_start: "#7c3aed",
  session_end: "#9ca3af",
};

function StatusIndicator({ status }: { status: "live" | "degraded" | "offline" | undefined }) {
  if (!status) return null;
  const cfg = {
    live: { color: "bg-emerald-400", label: "LIVE", text: "text-emerald-400" },
    degraded: { color: "bg-amber-400", label: "DEGRADED", text: "text-amber-400" },
    offline: { color: "bg-red-400", label: "OFFLINE", text: "text-red-400" },
  }[status];
  return (
    <div className="flex items-center gap-2">
      <span className="relative flex h-2.5 w-2.5">
        {status === "live" && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${cfg.color} opacity-75`} />}
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${cfg.color}`} />
      </span>
      <span className={`text-xs font-bold tracking-widest ${cfg.text}`}>{cfg.label}</span>
    </div>
  );
}

function LiveEventRow({ event, index }: { event: any; index: number }) {
  const color = EVENT_TYPE_COLORS[event.eventType] || "#9ca3af";
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.02 }}
      className="flex items-center gap-3 py-2 border-b border-white/5 group hover:bg-white/[0.02] transition-colors"
      data-testid={`row-live-event-${event.id}`}
    >
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      <span className="text-[11px] font-mono text-white/40 w-16 flex-shrink-0">
        {new Date(event.createdAt).toLocaleTimeString("en", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </span>
      <span className="text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0" style={{ backgroundColor: color + "20", color }}>
        {event.eventType}
      </span>
      <span className="text-[11px] text-white/50 flex-1 truncate">{event.page || "—"}</span>
      <span className="text-[10px] text-white/20 flex-shrink-0">{event.device || "—"}</span>
      {event.subAccountId && (
        <span className="text-[10px] text-white/20 flex-shrink-0">#{event.subAccountId}</span>
      )}
    </motion.div>
  );
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6 }}
        className="h-full rounded-full"
        style={{ backgroundColor: color }}
      />
    </div>
  );
}

export default function ApexCommandCenter() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.isAdmin === "true" || (user as any)?.role === "DEV_ADMIN";
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [activeTab, setActiveTab] = useState<"stream" | "dead_letter" | "routing" | "sources">("stream");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ["/api/apex/capture-health"],
    queryFn: async () => {
      const r = await fetch("/api/apex/capture-health");
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: autoRefresh ? 10000 : false,
    enabled: isAdmin,
  });

  const { data: liveEvents, isLoading: eventsLoading } = useQuery({
    queryKey: ["/api/apex/live-events", eventTypeFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "60" });
      if (eventTypeFilter) params.set("eventType", eventTypeFilter);
      const r = await fetch(`/api/apex/live-events?${params}`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: autoRefresh ? 5000 : false,
    enabled: isAdmin,
  });

  const { data: deadLetter } = useQuery({
    queryKey: ["/api/apex/dead-letter"],
    queryFn: async () => {
      const r = await fetch("/api/apex/dead-letter");
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: isAdmin && activeTab === "dead_letter",
  });

  const { data: routing } = useQuery({
    queryKey: ["/api/apex/account-routing"],
    queryFn: async () => {
      const r = await fetch("/api/apex/account-routing");
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: autoRefresh ? 30000 : false,
    enabled: isAdmin && activeTab === "routing",
  });

  const { data: sources } = useQuery({
    queryKey: ["/api/apex/source-breakdown"],
    queryFn: async () => {
      const r = await fetch("/api/apex/source-breakdown");
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: isAdmin && activeTab === "sources",
  });

  const { data: topPages } = useQuery({
    queryKey: ["/api/apex/top-pages"],
    queryFn: async () => {
      const r = await fetch("/api/apex/top-pages");
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: isAdmin,
  });

  const { data: topCtas } = useQuery({
    queryKey: ["/api/apex/top-ctas"],
    queryFn: async () => {
      const r = await fetch("/api/apex/top-ctas");
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: isAdmin,
  });

  const { data: topForms } = useQuery({
    queryKey: ["/api/apex/top-forms"],
    queryFn: async () => {
      const r = await fetch("/api/apex/top-forms");
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: isAdmin,
  });

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <Card className="glass border-white/10 max-w-md w-full">
          <CardContent className="p-10 text-center">
            <Shield className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Access Restricted</h2>
            <p className="text-sm text-slate-400">Operator access required.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const events = liveEvents?.events || [];
  const deadLetterEvents = deadLetter?.events || [];
  const routingAccounts = routing?.accounts || [];
  const sourceBreakdown = sources?.breakdown || [];
  const pages = topPages?.pages || [];
  const ctas = topCtas?.ctas || [];
  const forms = topForms?.forms || [];
  const maxSourceCount = Math.max(...sourceBreakdown.map((s: any) => Number(s.count)), 1);
  const maxPageCount = Math.max(...pages.map((p: any) => Number(p.count)), 1);

  const TABS = [
    { id: "stream", label: "Live Stream", icon: Activity },
    { id: "dead_letter", label: "Dead Letter", icon: AlertTriangle },
    { id: "routing", label: "Routing", icon: Server },
    { id: "sources", label: "Sources", icon: Globe },
  ] as const;

  return (
    <div className="min-h-screen p-4 md:p-6 space-y-5" style={{ background: "radial-gradient(ellipse at top, #0c1a2e 0%, #050a14 100%)" }}>
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #06b6d4, #4f46e5)", boxShadow: "0 0 30px #06b6d430" }}>
            <Brain className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Apex Intelligence</h1>
            <p className="text-xs text-slate-400 mt-0.5">Data Capture Command Center</p>
          </div>
          <StatusIndicator status={health?.status} />
        </div>
        <div className="flex items-center gap-2">
          <Button
            data-testid="button-toggle-autorefresh"
            size="sm"
            variant="outline"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`border-white/10 text-xs ${autoRefresh ? "text-emerald-400" : "text-white/40"}`}
          >
            {autoRefresh ? <Wifi className="w-3.5 h-3.5 mr-1.5" /> : <WifiOff className="w-3.5 h-3.5 mr-1.5" />}
            {autoRefresh ? "Auto" : "Paused"}
          </Button>
          <Button
            data-testid="button-refresh-all"
            size="sm"
            onClick={() => queryClient.invalidateQueries()}
            className="text-white border-0 text-xs"
            style={{ background: "linear-gradient(to right, #06b6d4, #4f46e5)" }}
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Refresh
          </Button>
          <Link href="/apex-tracking-settings">
            <Button size="sm" variant="outline" className="border-white/10 text-white/50 hover:text-white text-xs">
              <Settings className="w-3.5 h-3.5 mr-1.5" />
              Settings
            </Button>
          </Link>
        </div>
      </motion.div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Events / 5min", value: health?.recentEvents5min ?? "—", icon: Zap, color: "#06b6d4", status: health?.status === "live" },
          { label: "Events / Hour", value: health?.eventsLastHour ?? "—", icon: Activity, color: "#8b5cf6" },
          { label: "Dead Letter", value: health?.deadLetterCount ?? "—", icon: AlertTriangle, color: health?.deadLetterCount > 0 ? "#ef4444" : "#9ca3af" },
          { label: "Connected Sites", value: health?.totalSites ?? "—", icon: Layers, color: "#10b981" },
        ].map((stat, i) => (
          <motion.div key={stat.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Card className="border-white/5" style={{ background: "rgba(255,255,255,0.03)" }}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <stat.icon className="w-4 h-4" style={{ color: stat.color }} />
                  {stat.status && (
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                    </span>
                  )}
                </div>
                <p className="text-2xl font-black text-white">{healthLoading ? "…" : stat.value}</p>
                <p className="text-[10px] text-white/30 mt-0.5">{stat.label}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                data-testid={`tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeTab === tab.id
                    ? "bg-white/10 text-white"
                    : "text-white/40 hover:text-white/60"
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
                {tab.id === "dead_letter" && (health?.deadLetterCount ?? 0) > 0 && (
                  <Badge className="bg-red-500/20 text-red-400 border-0 text-[9px] px-1 py-0 h-3.5">
                    {health.deadLetterCount}
                  </Badge>
                )}
              </button>
            ))}
            {activeTab === "stream" && (
              <div className="ml-auto flex-shrink-0">
                <Input
                  data-testid="input-event-type-filter"
                  placeholder="Filter by type…"
                  value={eventTypeFilter}
                  onChange={(e) => setEventTypeFilter(e.target.value)}
                  className="h-7 text-xs w-36 bg-white/5 border-white/10 text-white placeholder:text-white/20"
                />
              </div>
            )}
          </div>

          <Card className="border-white/5" style={{ background: "rgba(0,0,0,0.5)" }}>
            <CardContent className="p-4">
              {activeTab === "stream" && (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] text-white/30 uppercase tracking-widest font-semibold">Live Event Stream</span>
                    <span className="text-[10px] text-white/20">{events.length} events</span>
                  </div>
                  {eventsLoading ? (
                    <div className="space-y-2">
                      {[...Array(8)].map((_, i) => (
                        <div key={i} className="h-7 bg-white/[0.02] rounded animate-pulse" />
                      ))}
                    </div>
                  ) : events.length === 0 ? (
                    <div className="text-center py-12 text-white/20">
                      <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No events captured yet</p>
                      <p className="text-xs mt-1">Events appear here as visitors interact with your sites</p>
                    </div>
                  ) : (
                    <div className="space-y-0 max-h-80 overflow-y-auto">
                      <AnimatePresence>
                        {events.map((event: any, i: number) => (
                          <LiveEventRow key={event.id} event={event} index={i} />
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </>
              )}

              {activeTab === "dead_letter" && (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] text-white/30 uppercase tracking-widest font-semibold">Failed / Dead-Letter Events</span>
                    <span className="text-[10px] text-white/20">{deadLetterEvents.length} events</span>
                  </div>
                  {deadLetterEvents.length === 0 ? (
                    <div className="text-center py-12 text-white/20">
                      <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-400/40" />
                      <p className="text-sm text-emerald-400/60">No failed events</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {deadLetterEvents.map((ev: any) => (
                        <div key={ev.id} className="p-3 rounded-lg bg-red-500/5 border border-red-500/10" data-testid={`row-dead-letter-${ev.id}`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-red-400 font-medium">Dead Letter #{ev.id}</span>
                            <span className="text-[10px] text-white/20">Retry {ev.retryCount}x</span>
                          </div>
                          <p className="text-[11px] text-white/40 truncate">{ev.errorMessage || "Unknown error"}</p>
                          <div className="flex items-center gap-2 mt-2">
                            {ev.subAccountId && <span className="text-[10px] text-white/20">Account #{ev.subAccountId}</span>}
                            <span className="text-[10px] text-white/20">{new Date(ev.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {activeTab === "routing" && (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] text-white/30 uppercase tracking-widest font-semibold">Account Routing Status (24h)</span>
                  </div>
                  {routingAccounts.length === 0 ? (
                    <div className="text-center py-12 text-white/20">
                      <Server className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No routing data yet</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {routingAccounts.map((acc: any) => (
                        <div key={acc.sub_account_id} className="flex items-center gap-3 py-2 border-b border-white/5" data-testid={`row-routing-${acc.sub_account_id}`}>
                          <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                          <span className="text-[11px] text-white/70 flex-1 truncate">{acc.account_name || `Account #${acc.sub_account_id}`}</span>
                          <span className="text-[10px] text-cyan-400">{acc.event_count} events</span>
                          <span className="text-[10px] text-white/30">{acc.visitor_count} visitors</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {activeTab === "sources" && (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] text-white/30 uppercase tracking-widest font-semibold">Traffic Source Breakdown (7d)</span>
                  </div>
                  {sourceBreakdown.length === 0 ? (
                    <div className="text-center py-12 text-white/20">
                      <Globe className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No source data yet</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {sourceBreakdown.map((src: any) => (
                        <div key={src.utmSource || "direct"} className="flex items-center gap-3" data-testid={`row-source-${src.utmSource || "direct"}`}>
                          <span className="text-[11px] text-white/50 w-20 text-right flex-shrink-0">{src.utmSource || "direct"}</span>
                          <MiniBar value={Number(src.count)} max={maxSourceCount} color="#06b6d4" />
                          <span className="text-[11px] text-white/40 w-10 text-right flex-shrink-0">{src.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-3">
          <Card className="border-white/5" style={{ background: "rgba(0,0,0,0.5)" }}>
            <CardContent className="p-4">
              <h3 className="text-[10px] text-white/30 uppercase tracking-widest font-semibold mb-3 flex items-center gap-2">
                <Eye className="w-3.5 h-3.5" /> Top Pages (7d)
              </h3>
              {pages.length === 0 ? (
                <p className="text-xs text-white/20 text-center py-4">No page data</p>
              ) : (
                <div className="space-y-2">
                  {pages.slice(0, 8).map((page: any, i: number) => (
                    <div key={i} className="flex items-center gap-2" data-testid={`row-top-page-${i}`}>
                      <span className="text-[10px] text-white/20 w-4">{i + 1}</span>
                      <span className="text-[11px] text-white/60 flex-1 truncate" title={page.page || "—"}>
                        {page.page ? page.page.replace(/^https?:\/\/[^/]+/, "") || "/" : "—"}
                      </span>
                      <MiniBar value={Number(page.count)} max={maxPageCount} color="#8b5cf6" />
                      <span className="text-[10px] text-white/30 w-8 text-right">{page.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-white/5" style={{ background: "rgba(0,0,0,0.5)" }}>
            <CardContent className="p-4">
              <h3 className="text-[10px] text-white/30 uppercase tracking-widest font-semibold mb-3 flex items-center gap-2">
                <MousePointerClick className="w-3.5 h-3.5" /> Top CTAs (7d)
              </h3>
              {ctas.length === 0 ? (
                <p className="text-xs text-white/20 text-center py-4">No CTA data</p>
              ) : (
                <div className="space-y-2">
                  {ctas.slice(0, 6).map((cta: any, i: number) => (
                    <div key={i} className="flex items-center gap-2" data-testid={`row-top-cta-${i}`}>
                      <span className="text-[10px] text-white/20 w-4">{i + 1}</span>
                      <span className="text-[11px] text-white/60 flex-1 truncate">{cta.page ? cta.page.replace(/^https?:\/\/[^/]+/, "") || "/" : "—"}</span>
                      <span className="text-[10px] text-emerald-400">{cta.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-white/5" style={{ background: "rgba(0,0,0,0.5)" }}>
            <CardContent className="p-4">
              <h3 className="text-[10px] text-white/30 uppercase tracking-widest font-semibold mb-3 flex items-center gap-2">
                <FileText className="w-3.5 h-3.5" /> Top Forms (7d)
              </h3>
              {forms.length === 0 ? (
                <p className="text-xs text-white/20 text-center py-4">No form data</p>
              ) : (
                <div className="space-y-2">
                  {forms.slice(0, 6).map((form: any, i: number) => {
                    const typeColor = form.eventType === "form_submit" ? "#22c55e" : form.eventType === "form_abandon" ? "#ef4444" : "#3b82f6";
                    return (
                      <div key={i} className="flex items-center gap-2" data-testid={`row-top-form-${i}`}>
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: typeColor }} />
                        <span className="text-[11px] text-white/60 flex-1 truncate">{form.page ? form.page.replace(/^https?:\/\/[^/]+/, "") || "/" : "—"}</span>
                        <span className="text-[10px] font-mono" style={{ color: typeColor }}>{form.count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
