import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Building2, Users, DollarSign, Activity, Shield, BarChart3, Zap,
  AlertTriangle, CheckCircle2, XCircle, RefreshCw, Layers, Globe,
  Brain, Phone, Mail, Clock, TrendingUp, Server, Lock,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlatformHealthSnapshot {
  generatedAt: string;
  platform: {
    totalAccounts: number;
    activeAccounts: number;
    suspendedAccounts: number;
    quotaAlertsCount: number;
  };
  aiMetrics: {
    tokensToday: number;
    estimatedCostToday: number;
    smsToday: number;
    voiceMinToday: number;
  };
  billing: {
    totalMonthlySpend: number;
    projectedMonthly: number;
    topAccountsBySpend: { subAccountId: number; spend: number }[];
  };
  pipeline: {
    totalContactsAllAccounts: number;
    leadsLast24h: number;
    skipTraceRunsToday: number;
    batchDataLastRun: { ranAt: string | null; count: number; error: string | null };
  };
  roi: {
    totalAccounts: number;
    totalLeads: number;
    totalConversions: number;
    totalHoursSaved: number;
    totalMissedCallRecovery: number;
    totalRevenueImpact: number;
  };
  recentAuditEvents: { eventType: string; actor: string; createdAt: string }[];
}

interface TenantQuota {
  subAccountId: number;
  planTier: string;
  suspended: boolean;
  usedAiTokens: number;
  monthlyAiTokens: number;
  usedSms: number;
  monthlySms: number;
  periodStart: string | null;
  periodEnd: string | null;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = "cyan",
  alert = false,
}: {
  icon: any;
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  alert?: boolean;
}) {
  const colors: Record<string, string> = {
    cyan:   "from-cyan-500/20 to-cyan-600/5 border-cyan-500/30",
    purple: "from-purple-500/20 to-purple-600/5 border-purple-500/30",
    green:  "from-green-500/20 to-green-600/5 border-green-500/30",
    yellow: "from-yellow-500/20 to-yellow-600/5 border-yellow-500/30",
    red:    "from-red-500/20 to-red-600/5 border-red-500/30",
    blue:   "from-blue-500/20 to-blue-600/5 border-blue-500/30",
  };
  const iconColors: Record<string, string> = {
    cyan: "text-cyan-400", purple: "text-purple-400", green: "text-green-400",
    yellow: "text-yellow-400", red: "text-red-400", blue: "text-blue-400",
  };

  return (
    <div className={`rounded-xl border bg-gradient-to-br p-4 ${colors[color] || colors.cyan} ${alert ? "ring-1 ring-red-500/40" : ""}`}>
      <div className="flex items-start justify-between mb-2">
        <Icon className={`h-5 w-5 ${iconColors[color] || iconColors.cyan}`} />
        {alert && <AlertTriangle className="h-4 w-4 text-red-400 animate-pulse" />}
      </div>
      <div className="text-2xl font-bold text-white mt-1">{value}</div>
      <div className="text-xs text-gray-400 mt-0.5">{label}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

function SectionHeader({ icon: Icon, title }: { icon: any; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon className="h-4 w-4 text-cyan-400" />
      <h2 className="text-sm font-semibold text-cyan-300 uppercase tracking-wider">{title}</h2>
    </div>
  );
}

function QuotaBar({ used, limit, label }: { used: number; limit: number; label: string }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const color = pct > 85 ? "bg-red-500" : pct > 65 ? "bg-yellow-500" : "bg-cyan-500";

  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>{label}</span>
        <span>{limit === 0 ? "∞" : `${used.toLocaleString()} / ${limit.toLocaleString()}`}</span>
      </div>
      {limit > 0 && (
        <div className="h-1.5 rounded-full bg-gray-700">
          <div className={`h-1.5 rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

// ─── Tenant Management Panel ──────────────────────────────────────────────────

function TenantManagementPanel() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [planInput, setPlanInput]   = useState("starter");
  const qc = useQueryClient();

  const { data: tenants = [] } = useQuery<TenantQuota[]>({
    queryKey: ["/api/enterprise/tenants"],
    refetchInterval: 30_000,
  });

  const changePlan = useMutation({
    mutationFn: ({ id, planTier }: { id: number; planTier: string }) =>
      apiRequest("POST", `/api/enterprise/tenants/${id}/plan`, { planTier }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/enterprise/tenants"] }),
  });

  const suspend = useMutation({
    mutationFn: ({ id, suspended }: { id: number; suspended: boolean }) =>
      apiRequest("POST", `/api/enterprise/tenants/${id}/suspend`, { suspended, reason: suspended ? "Admin action" : "" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/enterprise/tenants"] }),
  });

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-5">
      <SectionHeader icon={Building2} title="Tenant Management" />
      <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
        {tenants.length === 0 && <p className="text-gray-500 text-sm">No quota records yet. Accounts provision on first usage.</p>}
        {tenants.map(t => (
          <div key={t.subAccountId}
               className={`rounded-lg border p-3 cursor-pointer transition-colors ${selectedId === t.subAccountId ? "border-cyan-500 bg-cyan-500/10" : "border-gray-700 hover:border-gray-600"}`}
               onClick={() => setSelectedId(selectedId === t.subAccountId ? null : t.subAccountId)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {t.suspended
                  ? <XCircle className="h-4 w-4 text-red-400" />
                  : <CheckCircle2 className="h-4 w-4 text-green-400" />}
                <span className="text-sm font-medium text-white">Account #{t.subAccountId}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">{t.planTier}</span>
              </div>
              <div className="text-xs text-gray-500">
                {t.usedAiTokens?.toLocaleString()} / {t.monthlyAiTokens === 0 ? "∞" : t.monthlyAiTokens?.toLocaleString()} tokens
              </div>
            </div>

            {selectedId === t.subAccountId && (
              <div className="mt-3 pt-3 border-t border-gray-700 space-y-2">
                <QuotaBar used={t.usedAiTokens || 0} limit={t.monthlyAiTokens || 0} label="AI Tokens" />
                <QuotaBar used={t.usedSms || 0}      limit={t.monthlySms || 0}      label="SMS" />
                <div className="flex items-center gap-2 mt-3">
                  <select
                    className="text-xs rounded px-2 py-1 bg-gray-700 border border-gray-600 text-white"
                    value={planInput}
                    onChange={e => setPlanInput(e.target.value)}
                  >
                    {["starter", "pro", "enterprise"].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <button
                    onClick={() => changePlan.mutate({ id: t.subAccountId, planTier: planInput })}
                    className="text-xs px-2 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white"
                  >Set Plan</button>
                  <button
                    onClick={() => suspend.mutate({ id: t.subAccountId, suspended: !t.suspended })}
                    className={`text-xs px-2 py-1 rounded ${t.suspended ? "bg-green-700 hover:bg-green-600" : "bg-red-700 hover:bg-red-600"} text-white`}
                  >{t.suspended ? "Unsuspend" : "Suspend"}</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Audit Feed ───────────────────────────────────────────────────────────────

function AuditFeed({ events }: { events: { eventType: string; actor: string; createdAt: string }[] }) {
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-5">
      <SectionHeader icon={Shield} title="Recent Audit Events" />
      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        {events.length === 0 && <p className="text-gray-500 text-sm">No events yet.</p>}
        {events.map((e, i) => (
          <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-gray-700/50">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-500 shrink-0" />
              <span className="text-gray-300 font-mono">{e.eventType}</span>
            </div>
            <div className="flex items-center gap-3 text-gray-500">
              <span>{e.actor}</span>
              <span>{new Date(e.createdAt).toLocaleTimeString()}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EnterpriseControlCenter() {
  const { user } = useAuth();
  const qc       = useQueryClient();

  const { data: snap, isLoading, dataUpdatedAt } = useQuery<PlatformHealthSnapshot>({
    queryKey: ["/api/enterprise/dashboard"],
    refetchInterval: 60_000,
  });

  if (!user) return null;

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "—";

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6 space-y-8">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Layers className="h-6 w-6 text-cyan-400" />
            Enterprise Control Center
          </h1>
          <p className="text-sm text-gray-400 mt-1">Platform health, billing, tenants, ROI & RBAC — unified</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">Last updated: {lastUpdated}</span>
          <button
            onClick={() => qc.invalidateQueries({ queryKey: ["/api/enterprise/dashboard"] })}
            className="p-2 rounded-lg border border-gray-700 hover:border-cyan-500 text-gray-400 hover:text-cyan-400 transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {isLoading && !snap && (
        <div className="text-center py-20 text-gray-400">Loading platform snapshot...</div>
      )}

      {snap && (
        <>
          {/* ── Platform Health ── */}
          <section>
            <SectionHeader icon={Server} title="Platform Health" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard icon={Building2}   label="Total Accounts"     value={snap.platform.totalAccounts}     color="cyan" />
              <StatCard icon={CheckCircle2} label="Active Accounts"   value={snap.platform.activeAccounts}    color="green" />
              <StatCard icon={XCircle}     label="Suspended"          value={snap.platform.suspendedAccounts}  color="red"    alert={snap.platform.suspendedAccounts > 0} />
              <StatCard icon={AlertTriangle} label="Quota Alerts"     value={snap.platform.quotaAlertsCount}   color="yellow" alert={snap.platform.quotaAlertsCount > 0} />
            </div>
          </section>

          {/* ── AI & Comms Metrics ── */}
          <section>
            <SectionHeader icon={Brain} title="AI & Communications Today" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard icon={Zap}    label="AI Tokens Today"   value={snap.aiMetrics.tokensToday.toLocaleString()}  color="purple" />
              <StatCard icon={DollarSign} label="AI Spend Today" value={`$${snap.aiMetrics.estimatedCostToday.toFixed(4)}`} color="purple" />
              <StatCard icon={Phone}  label="SMS Today"         value={snap.aiMetrics.smsToday.toLocaleString()}      color="blue" />
              <StatCard icon={Clock}  label="Voice Min Today"   value={snap.aiMetrics.voiceMinToday.toFixed(1)}       color="blue" />
            </div>
          </section>

          {/* ── Billing ── */}
          <section>
            <SectionHeader icon={DollarSign} title="Billing Overview" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard icon={DollarSign}  label="Month-to-Date Spend"  value={`$${snap.billing.totalMonthlySpend.toFixed(2)}`}  color="green" />
              <StatCard icon={TrendingUp}  label="Projected Month-End"  value={`$${snap.billing.projectedMonthly.toFixed(2)}`}   color="yellow" />
              <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <BarChart3 className="h-4 w-4 text-green-400" />
                  <span className="text-xs text-gray-400 uppercase tracking-wide">Top Accounts by Spend</span>
                </div>
                {snap.billing.topAccountsBySpend.length === 0
                  ? <p className="text-gray-500 text-sm">No spend data yet</p>
                  : snap.billing.topAccountsBySpend.map(a => (
                    <div key={a.subAccountId} className="flex justify-between text-xs py-1 border-b border-gray-700/50 last:border-0">
                      <span className="text-gray-300">Account #{a.subAccountId}</span>
                      <span className="text-green-400 font-mono">${a.spend.toFixed(4)}</span>
                    </div>
                  ))}
              </div>
            </div>
          </section>

          {/* ── Pipeline ── */}
          <section>
            <SectionHeader icon={Activity} title="Pipeline & Enrichment" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard icon={Users}   label="Total Contacts"      value={snap.pipeline.totalContactsAllAccounts.toLocaleString()} color="cyan" />
              <StatCard icon={Users}   label="New Leads (24h)"     value={snap.pipeline.leadsLast24h.toLocaleString()}            color="blue" />
              <StatCard icon={Zap}     label="Skip-Trace Today"    value={snap.pipeline.skipTraceRunsToday}                        color="purple" />
              <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4">
                <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">BatchData Last Run</div>
                {snap.pipeline.batchDataLastRun.ranAt
                  ? <>
                      <div className="text-sm text-white font-mono">{new Date(snap.pipeline.batchDataLastRun.ranAt).toLocaleString()}</div>
                      <div className="text-xs text-gray-400 mt-1">{snap.pipeline.batchDataLastRun.count} contacts</div>
                      {snap.pipeline.batchDataLastRun.error && <div className="text-xs text-red-400 mt-1">{snap.pipeline.batchDataLastRun.error}</div>}
                    </>
                  : <div className="text-gray-500 text-sm">No runs recorded</div>
                }
              </div>
            </div>
          </section>

          {/* ── ROI ── */}
          <section>
            <SectionHeader icon={TrendingUp} title="Platform ROI Impact" />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <StatCard icon={Users}       label="Total Leads"          value={snap.roi.totalLeads.toLocaleString()}                   color="cyan" />
              <StatCard icon={CheckCircle2} label="Conversions"         value={snap.roi.totalConversions.toLocaleString()}             color="green" />
              <StatCard icon={Clock}       label="Hours Saved (All)"    value={`${snap.roi.totalHoursSaved.toFixed(0)}h`}              color="purple" />
              <StatCard icon={Phone}       label="Missed Call Recovery" value={`$${snap.roi.totalMissedCallRecovery.toFixed(0)}`}      color="blue" />
              <StatCard icon={DollarSign}  label="Revenue Impact"       value={`$${snap.roi.totalRevenueImpact.toFixed(0)}`}          color="green" />
              <StatCard icon={Building2}   label="Accounts w/ ROI Data" value={snap.roi.totalAccounts}                                color="cyan" />
            </div>
          </section>

          {/* ── Tenant Management + Audit ── */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TenantManagementPanel />
            <AuditFeed events={snap.recentAuditEvents} />
          </section>

          {/* ── Quick Links ── */}
          <section>
            <SectionHeader icon={Globe} title="Quick Admin Actions" />
            <div className="flex flex-wrap gap-3">
              {[
                { label: "Audit Log",       href: "/api/enterprise/audit",          icon: Shield },
                { label: "Hierarchy Tree",  href: "/api/enterprise/hierarchy",       icon: Layers },
                { label: "RBAC Roles",      href: "/api/enterprise/roles",           icon: Lock },
                { label: "Billing Report",  href: "/api/enterprise/billing/report",  icon: DollarSign },
                { label: "White-Label",     href: "/api/enterprise/white-label",     icon: Globe },
              ].map(({ label, href, icon: Icon }) => (
                <a key={label} href={href} target="_blank" rel="noreferrer"
                   className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-700 hover:border-cyan-500 text-sm text-gray-300 hover:text-white transition-colors">
                  <Icon className="h-4 w-4 text-cyan-400" />
                  {label}
                </a>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
