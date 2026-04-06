import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { useActiveSubAccountId } from "@/components/account-required";
import { Card, CardContent } from "@/components/ui/card";
import { MessageSquare, Users, Kanban, CalendarDays, Mail, Megaphone, Target, Instagram, DollarSign, TrendingUp, Bell, Clock, BarChart3, PieChart, Zap, Eye, Rocket, Shield, Info, CheckCircle2, XCircle, AlertTriangle, ArrowUp, ArrowDown, Minus, Trophy, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { TutorialCenter } from "@/components/tutorial-center";
import { CommandCenter } from "@/components/command-center";
import { TutorialOverlay, useTutorial } from "@/components/tutorial-overlay";
import { DASHBOARD_STEPS } from "@/components/tutorial-steps";
import { useAuth } from "@/hooks/use-auth";
import { SystemPulse } from "@/components/system-pulse";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

interface DashboardMetrics {
  totalMessages: number;
  todayMessages: number;
  totalContacts: number;
  totalDeals: number;
  totalDealValue: number;
  upcomingAppointments: number;
  totalCampaigns: number;
  metaAdCampaigns: number;
  metaLeads: number;
  totalAdSpend: number;
  totalAdLeads: number;
  igConversations: number;
  unreadIgMessages: number;
  unreadNotifications: number;
  recentMessages: any[];
  recentLeads: any[];
}

const metricCards = [
  { key: "totalMessages", label: "Total Messages", icon: MessageSquare, color: "from-cyan-500 to-blue-600", link: "/inbox", bgColor: "bg-cyan-500/20", iconColor: "text-cyan-400" },
  { key: "todayMessages", label: "Messages Today", icon: Clock, color: "from-blue-500 to-indigo-600", link: "/inbox", bgColor: "bg-blue-500/20", iconColor: "text-blue-400" },
  { key: "totalContacts", label: "Contacts", icon: Users, color: "from-green-500 to-emerald-600", link: "/pipeline", bgColor: "bg-green-500/20", iconColor: "text-green-400" },
  { key: "totalDeals", label: "Active Deals", icon: Kanban, color: "from-purple-500 to-violet-600", link: "/pipeline", bgColor: "bg-purple-500/20", iconColor: "text-purple-400" },
  { key: "totalDealValue", label: "Deal Pipeline Value", icon: DollarSign, color: "from-emerald-500 to-teal-600", link: "/pipeline", bgColor: "bg-emerald-500/20", iconColor: "text-emerald-400", isCurrency: true },
  { key: "upcomingAppointments", label: "Upcoming Appointments", icon: CalendarDays, color: "from-amber-500 to-orange-600", link: "/calendar", bgColor: "bg-amber-500/20", iconColor: "text-amber-400" },
  { key: "totalCampaigns", label: "Email Campaigns", icon: Mail, color: "from-pink-500 to-rose-600", link: "/email-campaigns", bgColor: "bg-pink-500/20", iconColor: "text-pink-400" },
  { key: "metaAdCampaigns", label: "Meta Ad Campaigns", icon: Target, color: "from-blue-500 to-indigo-600", link: "/meta-ads", bgColor: "bg-blue-500/20", iconColor: "text-blue-400" },
  { key: "metaLeads", label: "Facebook Leads", icon: Megaphone, color: "from-green-500 to-emerald-600", link: "/meta-leads", bgColor: "bg-green-500/20", iconColor: "text-green-400" },
  { key: "totalAdSpend", label: "Ad Spend", icon: DollarSign, color: "from-red-500 to-rose-600", link: "/meta-ads", bgColor: "bg-red-500/20", iconColor: "text-red-400", isCurrency: true },
  { key: "igConversations", label: "IG Conversations", icon: Instagram, color: "from-pink-500 to-purple-600", link: "/instagram-inbox", bgColor: "bg-pink-500/20", iconColor: "text-pink-400" },
  { key: "unreadNotifications", label: "Unread Alerts", icon: Bell, color: "from-yellow-500 to-amber-600", link: "/", bgColor: "bg-yellow-500/20", iconColor: "text-yellow-400" },
];

export default function DashboardPage() {
  const subAccountId = useActiveSubAccountId();
  const { user } = useAuth();
  const { toast } = useToast();
  const { showTutorial, startTutorial, closeTutorial } = useTutorial("apex_dashboard_tutorial_completed");
  const isAdmin = user?.isAdmin === "true" || (user as any)?.role === "DEV_ADMIN";
  const [executingCmd, setExecutingCmd] = useState<string | null>(null);

  const executeCommand = async (command: string, params?: any) => {
    setExecutingCmd(command);
    try {
      const r = await fetch("/api/command/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-sub-account-id": String(subAccountId) },
        body: JSON.stringify({ command, params, subAccountId }),
      });
      if (r.ok) {
        const result = await r.json();
        const done = result.actions?.filter((a: any) => a.status === "done").length || 0;
        toast({ title: `${done} action${done !== 1 ? "s" : ""} executed`, description: result.summary });
      } else {
        toast({ title: "Action failed", variant: "destructive" });
      }
    } catch {
      toast({ title: "Action failed", variant: "destructive" });
    }
    setExecutingCmd(null);
  };

  const { data: metrics, isLoading } = useQuery<DashboardMetrics>({
    queryKey: ["/api/dashboard", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/${subAccountId}`);
      if (!res.ok) throw new Error(`Dashboard fetch failed: ${res.status}`);
      return res.json();
    },
    refetchInterval: 3_600_000,
    enabled: !!subAccountId,
  });

  const { data: analytics } = useQuery<Record<string, any>>({
    queryKey: ["/api/analytics", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/${subAccountId}`);
      if (!res.ok) throw new Error(`Analytics fetch failed: ${res.status}`);
      return res.json();
    },
    enabled: !!subAccountId,
  });

  const { data: readinessData } = useQuery<{
    phase: "not_setup" | "setup_inactive" | "active_measurable";
    phaseLabel: string;
    benchmarkReady: boolean;
    intelligenceReady: boolean;
  }>({
    queryKey: ["/api/readiness", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/readiness/${subAccountId}`);
      if (!res.ok) return { phase: "not_setup", phaseLabel: "Unknown", benchmarkReady: false, intelligenceReady: false };
      return res.json();
    },
    refetchInterval: 60000,
    enabled: !!subAccountId,
  });

  const { data: benchmarkData } = useQuery<{
    industry: string;
    metrics: Array<{
      key: string;
      label: string;
      yours: string;
      industryAvg: string;
      industryMedian: string;
      industryP75: string;
      status: "above" | "at" | "below";
      percentile: string;
      unit: string;
    }>;
  }>({
    queryKey: ["/api/benchmarks", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/benchmarks/${subAccountId}`);
      if (!res.ok) return { industry: "", metrics: [] };
      return res.json();
    },
    refetchInterval: 3_600_000,
    enabled: !!subAccountId && readinessData?.benchmarkReady === true,
  });

  const { data: serviceStatus } = useQuery<Record<string, { status: string; label: string }>>({
    queryKey: ["/api/service-status"],
    queryFn: async () => {
      const res = await fetch("/api/service-status");
      if (!res.ok) return {};
      return res.json();
    },
    refetchInterval: 3_600_000,
    enabled: !!subAccountId,
  });

  if (!subAccountId) {
    return (
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="p-4 md:p-8 flex items-center justify-center min-h-[70vh]">
        <div className="text-center space-y-8 max-w-lg" data-testid="status-welcome">
          <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 border border-cyan-500/20 flex items-center justify-center mx-auto">
            {isAdmin ? <Shield size={40} className="text-cyan-400" /> : <TrendingUp size={40} className="text-cyan-400" />}
          </div>
          <div>
            <h1 className="text-3xl font-black text-white mb-3">{isAdmin ? "Admin Command Center" : "Welcome to Apex"}</h1>
            <p className="text-slate-200 text-lg">{isAdmin ? "You have full platform access. Create your first client business using God Mode or the onboarding wizard." : "Create your first sub-account to unlock your business dashboard, CRM, AI tools, and more."}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {isAdmin && (
              <Link href="/god-mode">
                <button className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white font-bold transition-all shadow-lg shadow-violet-500/25" data-testid="button-god-mode">
                  <Rocket size={18} />
                  God Mode
                </button>
              </Link>
            )}
            <Link href="/onboarding">
              <button className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-700 hover:to-indigo-700 text-white font-bold transition-all shadow-lg shadow-cyan-500/25" data-testid="button-get-started">
                <Users size={18} />
                Create Sub-Account
              </button>
            </Link>
            {!isAdmin && (
              <Link href="/pricing">
                <button className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-white font-bold transition-all" data-testid="button-view-plans">
                  <DollarSign size={18} />
                  View Plans
                </button>
              </Link>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4">
            {[
              { icon: MessageSquare, label: "Unified Inbox" },
              { icon: Kanban, label: "Pipeline CRM" },
              { icon: Mail, label: "Campaigns" },
              { icon: Target, label: "Ad Launcher" },
            ].map((item) => (
              <div key={item.label} className="p-3 rounded-xl bg-white/5 border border-white/5">
                <item.icon size={20} className="text-slate-400 mb-2 mx-auto" />
                <p className="text-xs text-slate-300 text-center">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-black text-white flex items-center gap-3" data-testid="text-dashboard-title">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `linear-gradient(to bottom right, var(--vibe-glow, #06b6d4), var(--vibe-accent, #4f46e5))` }}>
            <TrendingUp size={20} className="text-white" />
          </div>
          Command Dashboard
        </h1>
        <div className="flex items-center gap-2 mt-1">
          <p className="text-slate-200">Real-time overview of your business operations</p>
          <button onClick={startTutorial} className="flex items-center gap-1 text-xs text-slate-300 hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-white/5" data-testid="button-start-tutorial"><Info size={14} className="mr-1" /> Tutorial</button>
        </div>
      </div>

      {isAdmin && <SystemPulse />}

      {metrics && (() => {
        const alerts: { type: "critical" | "warning" | "opportunity"; message: string; action: string; link: string; icon: any }[] = [];
        if ((metrics.unreadIgMessages ?? 0) > 0)
          alerts.push({ type: "critical", message: `${metrics.unreadIgMessages} unread Instagram messages waiting`, action: "Open Inbox", link: "/inbox", icon: MessageSquare });
        if ((metrics.todayMessages ?? 0) === 0 && (metrics.totalContacts ?? 0) > 0)
          alerts.push({ type: "warning", message: "No messages sent today — your pipeline is silent", action: "Send Message", link: "/inbox", icon: MessageSquare });
        if ((metrics.upcomingAppointments ?? 0) === 0 && (metrics.totalContacts ?? 0) > 5)
          alerts.push({ type: "warning", message: "No upcoming appointments — consider sending booking reminders", action: "View Calendar", link: "/calendar", icon: CalendarDays });
        if ((metrics.totalDeals ?? 0) > 0 && (metrics.totalDealValue ?? 0) === 0)
          alerts.push({ type: "warning", message: "Active deals have $0 value — update deal amounts for accurate forecasting", action: "Open Pipeline", link: "/pipeline", icon: Kanban });
        if ((metrics.totalAdSpend ?? 0) > 0 && (metrics.totalAdLeads ?? 0) === 0)
          alerts.push({ type: "critical", message: `$${metrics.totalAdSpend.toLocaleString()} ad spend with 0 leads — check your ad targeting`, action: "Check Ads", link: "/meta-ads", icon: Target });
        if ((metrics.totalCampaigns ?? 0) === 0)
          alerts.push({ type: "opportunity", message: "No email campaigns running — launch one to re-engage contacts", action: "Create Campaign", link: "/email-campaigns", icon: Mail });
        if ((metrics.metaAdCampaigns ?? 0) === 0 && (metrics.totalContacts ?? 0) > 10)
          alerts.push({ type: "opportunity", message: "No Meta ad campaigns — you have contacts but aren't scaling with ads", action: "Launch Ads", link: "/meta-ads", icon: Target });

        if (alerts.length === 0) return null;
        return (
          <Card className="bg-black/40 border-white/10" data-testid="card-smart-alerts">
            <CardContent className="p-4">
              <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                <Zap size={16} className="text-amber-400" />
                Action Required
                <span className="text-[10px] text-white/30 bg-white/5 px-2 py-0.5 rounded-full ml-1">{alerts.length}</span>
              </h3>
              <div className="space-y-2">
                {alerts.map((alert, i) => (
                  <Link key={i} href={alert.link}>
                    <div className={`flex items-center gap-3 p-3 rounded-xl transition-all cursor-pointer group border ${
                      alert.type === "critical" ? "bg-red-500/5 border-red-500/10 hover:border-red-500/30" :
                      alert.type === "warning" ? "bg-amber-500/5 border-amber-500/10 hover:border-amber-500/30" :
                      "bg-cyan-500/5 border-cyan-500/10 hover:border-cyan-500/30"
                    }`} data-testid={`alert-${i}`}>
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        alert.type === "critical" ? "bg-red-500/15" : alert.type === "warning" ? "bg-amber-500/15" : "bg-cyan-500/15"
                      }`}>
                        <alert.icon size={14} className={
                          alert.type === "critical" ? "text-red-400" : alert.type === "warning" ? "text-amber-400" : "text-cyan-400"
                        } />
                      </div>
                      <p className="text-sm text-white/70 flex-1">{alert.message}</p>
                      <span className="text-[11px] font-medium text-white/40 group-hover:text-white/70 transition-colors shrink-0 flex items-center gap-1">
                        {alert.action} <ArrowUp size={10} className="rotate-45" />
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {serviceStatus && Object.keys(serviceStatus).length > 0 && (
        <Card className="bg-black/40 border-white/10" data-testid="card-service-status">
          <CardContent className="p-4">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <Zap size={16} className="text-cyan-400" />
              Service Status
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
              {Object.entries(serviceStatus).map(([key, svc]) => (
                <div key={key} className="flex items-center gap-2 p-2 rounded-lg bg-white/5" data-testid={`status-service-${key}`}>
                  {svc.status === "connected_verified" ? (
                    <CheckCircle2 size={14} className="text-green-400 shrink-0" />
                  ) : svc.status === "configured" ? (
                    <CheckCircle2 size={14} className="text-cyan-400 shrink-0" />
                  ) : svc.status === "stored_unverified" ? (
                    <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                  ) : (
                    <XCircle size={14} className="text-red-400 shrink-0" />
                  )}
                  <span className="text-xs text-slate-300 truncate">{svc.label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <CommandCenter />

      <TutorialCenter />

      {isLoading ? (
        <div className="text-center py-20 text-slate-200">Loading dashboard...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
          {metricCards.map((card, idx) => {
            const value = metrics?.[card.key as keyof DashboardMetrics] ?? 0;
            const displayValue = card.isCurrency ? `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : Number(value).toLocaleString();
            return (
              <motion.div key={card.key} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
                <Link href={card.link}>
                  <Card className="bg-black/40 border-white/10 hover:border-white/20 transition-all cursor-pointer group" data-testid={`card-metric-${card.key}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div className={`w-10 h-10 rounded-lg ${card.bgColor} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                          <card.icon size={20} className={card.iconColor} />
                        </div>
                      </div>
                      <p className="text-2xl font-black text-white">{displayValue}</p>
                      <p className="text-xs text-slate-200 mt-1">{card.label}</p>
                    </CardContent>
                  </Card>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}

      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-black/40 border border-white/10 rounded-xl p-5">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <MessageSquare size={18} className="text-cyan-400" /> Recent Messages
            </h2>
            {(!metrics.recentMessages || metrics.recentMessages.length === 0) ? (
              <p className="text-slate-300 text-sm">No messages today</p>
            ) : (
              <div className="space-y-3">
                {metrics.recentMessages.map((msg: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 bg-white/5 rounded-lg p-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${msg.direction === "inbound" ? "bg-cyan-500/20 text-cyan-400" : "bg-indigo-500/20 text-indigo-400"}`}>
                      {msg.direction === "inbound" ? "IN" : "OUT"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-white text-sm truncate">{msg.body}</p>
                      <p className="text-slate-300 text-xs">{msg.contactPhone} · {msg.channel}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-black/40 border border-white/10 rounded-xl p-5">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Megaphone size={18} className="text-green-400" /> Recent Leads
            </h2>
            {(!metrics.recentLeads || metrics.recentLeads.length === 0) ? (
              <p className="text-slate-300 text-sm">No recent leads</p>
            ) : (
              <div className="space-y-3">
                {metrics.recentLeads.map((lead: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 bg-white/5 rounded-lg p-3">
                    <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 font-bold text-xs">
                      {(lead.name || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-white text-sm">{lead.name}</p>
                      <p className="text-slate-300 text-xs">{lead.email || lead.phone || "No contact info"}</p>
                    </div>
                    {lead.syncedToCrm && (
                      <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded">In CRM</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {benchmarkData && benchmarkData.metrics && benchmarkData.metrics.length > 0 && (
        <div className="space-y-4" data-testid="section-benchmarks">
          <h2 className="text-2xl font-black text-white flex items-center gap-3" data-testid="text-benchmarks-title">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-gradient-to-br from-amber-500 to-orange-600">
              <Trophy size={18} className="text-white" />
            </div>
            How You Compare
          </h2>
          <p className="text-slate-300 text-sm">Your key metrics vs. anonymized industry benchmarks from businesses like yours on Apex</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {benchmarkData.metrics.map((metric) => {
              const recommendations: Record<string, { text: string; command: string; impact: string }> = {
                response_time: { text: "Enable auto-reply now", command: "fix-response-rate", impact: "+35% response rate" },
                conversion_rate: { text: "Deploy nurture sequence", command: "activate-nurture", impact: "Automate follow-ups" },
                messages_per_contact: { text: "Fix response rate", command: "fix-response-rate", impact: "Increase engagement" },
                contacts_per_month: { text: "Launch lead gen system", command: "launch-lead-gen", impact: "Restart lead flow" },
                deals_per_contact: { text: "Optimize pipeline", command: "optimize-pipeline", impact: "Fix deal tracking" },
                deal_close_rate: { text: "Optimize pipeline", command: "optimize-pipeline", impact: "Improve close rate" },
              };
              const rec = metric.status === "below" ? recommendations[metric.key] : null;
              return (
              <Card key={metric.key} className="bg-black/40 border-white/10" data-testid={`benchmark-${metric.key}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold text-slate-200">{metric.label}</span>
                    <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${
                      metric.status === "above"
                        ? "bg-green-500/20 text-green-400"
                        : metric.status === "at"
                        ? "bg-amber-500/20 text-amber-400"
                        : "bg-red-500/20 text-red-400"
                    }`} data-testid={`benchmark-status-${metric.key}`}>
                      {metric.status === "above" ? <ArrowUp size={12} /> : metric.status === "at" ? <Minus size={12} /> : <ArrowDown size={12} />}
                      {metric.percentile}
                    </span>
                  </div>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-2xl font-black text-white">{metric.yours}</p>
                      <p className="text-xs text-slate-400 mt-1">Your value</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-slate-300">{metric.industryAvg}</p>
                      <p className="text-xs text-slate-400 mt-1">Industry Avg</p>
                    </div>
                  </div>
                  <div className="mt-3 h-2 bg-white/5 rounded-full overflow-hidden">
                    {(() => {
                      const yourNum = parseFloat(metric.yours.replace(/[^0-9.]/g, '')) || 0;
                      const avgNum = parseFloat(metric.industryAvg.replace(/[^0-9.]/g, '')) || 1;
                      const pct = Math.min(100, Math.round((yourNum / Math.max(avgNum, 1)) * 50));
                      return (
                        <div
                          className={`h-full rounded-full transition-all ${
                            metric.status === "above" ? "bg-green-500" : metric.status === "at" ? "bg-amber-500" : "bg-red-500"
                          }`}
                          style={{ width: `${Math.max(5, pct)}%` }}
                        />
                      );
                    })()}
                  </div>
                  {rec && (
                    <button
                      onClick={() => executeCommand(rec.command)}
                      disabled={executingCmd !== null}
                      className="mt-3 w-full flex items-center gap-2 p-2 rounded-lg bg-red-500/5 border border-red-500/10 hover:border-red-500/25 transition-all cursor-pointer group text-left disabled:opacity-50"
                      data-testid={`benchmark-action-${metric.key}`}
                    >
                      {executingCmd === rec.command ? (
                        <Loader2 size={12} className="text-red-400 shrink-0 animate-spin" />
                      ) : (
                        <Zap size={12} className="text-red-400 shrink-0" />
                      )}
                      <span className="text-[11px] text-red-300/80 flex-1">{rec.text}</span>
                      <span className="text-[9px] text-green-400/50 shrink-0">{rec.impact}</span>
                    </button>
                  )}
                </CardContent>
              </Card>
              );
            })}
          </div>
        </div>
      )}

      {analytics && (
        <div className="space-y-6" data-testid="section-performance-analytics">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-black text-white flex items-center gap-3" data-testid="text-analytics-title">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `linear-gradient(to bottom right, var(--vibe-glow, #06b6d4), var(--vibe-accent, #4f46e5))` }}>
                <BarChart3 size={18} className="text-white" />
              </div>
              Performance Analytics
            </h2>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <div className="bg-black/40 border border-white/10 rounded-xl p-3 md:p-4" data-testid="stat-conversion-rate">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                  <PieChart size={16} className="text-cyan-400" />
                </div>
              </div>
              <p className="text-2xl font-black text-white">{analytics.overview?.conversionRate ?? 0}%</p>
              <p className="text-xs text-slate-200 mt-1">Conversion Rate</p>
            </div>
            <div className="bg-black/40 border border-white/10 rounded-xl p-4" data-testid="stat-avg-response-time">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                  <Zap size={16} className="text-indigo-400" />
                </div>
              </div>
              <p className="text-2xl font-black text-white">{analytics.overview?.avgResponseTime ?? "N/A"}</p>
              <p className="text-xs text-slate-200 mt-1">Avg Response Time</p>
            </div>
            <div className="bg-black/40 border border-white/10 rounded-xl p-4" data-testid="stat-total-leads">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center">
                  <Users size={16} className="text-green-400" />
                </div>
              </div>
              <p className="text-2xl font-black text-white">{(analytics.overview?.totalLeads ?? 0).toLocaleString()}</p>
              <p className="text-xs text-slate-200 mt-1">Total Leads</p>
            </div>
            <div className="bg-black/40 border border-white/10 rounded-xl p-4" data-testid="stat-total-messages">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                  <MessageSquare size={16} className="text-purple-400" />
                </div>
              </div>
              <p className="text-2xl font-black text-white">{(analytics.overview?.totalMessages ?? analytics.totalMessages ?? 0).toLocaleString()}</p>
              <p className="text-xs text-slate-200 mt-1">Total Messages</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-black/40 border border-white/10 rounded-xl p-5" data-testid="chart-leads-over-time">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <TrendingUp size={18} className="text-cyan-400" />
                Leads Over Time
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={analytics.charts?.dailyLeads ?? []}>
                    <defs>
                      <linearGradient id="leadGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#64748b", fontSize: 12 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ backgroundColor: "#171717", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fff" }} />
                    <Area type="monotone" dataKey="count" stroke="#06b6d4" strokeWidth={2} fill="url(#leadGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-black/40 border border-white/10 rounded-xl p-5" data-testid="chart-messages-activity">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <MessageSquare size={18} className="text-indigo-400" />
                Messages Activity
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.charts?.dailyMessages ?? []}>
                    <defs>
                      <linearGradient id="messageGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0.3} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#64748b", fontSize: 12 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ backgroundColor: "#171717", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fff" }} />
                    <Bar dataKey="count" fill="url(#messageGradient)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-black/40 border border-white/10 rounded-xl p-5" data-testid="section-pipeline-overview">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Kanban size={18} className="text-purple-400" />
                Pipeline Overview
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/5 rounded-lg p-3" data-testid="stat-open-deals">
                  <p className="text-xl font-black text-white">{analytics.pipeline?.openDeals ?? 0}</p>
                  <p className="text-xs text-slate-200">Open Deals</p>
                </div>
                <div className="bg-white/5 rounded-lg p-3" data-testid="stat-won-deals">
                  <p className="text-xl font-black text-green-400">{analytics.pipeline?.wonDeals ?? 0}</p>
                  <p className="text-xs text-slate-200">Won Deals</p>
                </div>
                <div className="bg-white/5 rounded-lg p-3" data-testid="stat-lost-deals">
                  <p className="text-xl font-black text-red-400">{analytics.pipeline?.lostDeals ?? 0}</p>
                  <p className="text-xs text-slate-200">Lost Deals</p>
                </div>
                <div className="bg-white/5 rounded-lg p-3" data-testid="stat-pipeline-value">
                  <p className="text-xl font-black text-emerald-400">${(analytics.pipeline?.pipelineValue ?? 0).toLocaleString()}</p>
                  <p className="text-xs text-slate-200">Pipeline Value</p>
                </div>
              </div>
            </div>

            <div className="bg-black/40 border border-white/10 rounded-xl p-5" data-testid="section-ad-performance">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Target size={18} className="text-pink-400" />
                Ad Performance
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/5 rounded-lg p-3" data-testid="stat-ad-spend">
                  <p className="text-xl font-black text-white">${(analytics.adPerformance?.adSpend ?? 0).toLocaleString()}</p>
                  <p className="text-xs text-slate-200">Ad Spend</p>
                </div>
                <div className="bg-white/5 rounded-lg p-3" data-testid="stat-cost-per-lead">
                  <p className="text-xl font-black text-cyan-400">${(analytics.adPerformance?.costPerLead ?? 0).toFixed(2)}</p>
                  <p className="text-xs text-slate-200">Cost Per Lead</p>
                </div>
                <div className="bg-white/5 rounded-lg p-3" data-testid="stat-ctr">
                  <p className="text-xl font-black text-indigo-400">{(analytics.adPerformance?.ctr ?? 0).toFixed(2)}%</p>
                  <p className="text-xs text-slate-200">CTR</p>
                </div>
                <div className="bg-white/5 rounded-lg p-3" data-testid="stat-total-impressions">
                  <p className="text-xl font-black text-amber-400">{(analytics.adPerformance?.totalImpressions ?? 0).toLocaleString()}</p>
                  <p className="text-xs text-slate-200">Total Impressions</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {showTutorial && <TutorialOverlay steps={DASHBOARD_STEPS} storageKey="apex_dashboard_tutorial_completed" onClose={closeTutorial} accentColor="cyan" finishLabel="Let's Go" />}
    </motion.div>
  );
}
