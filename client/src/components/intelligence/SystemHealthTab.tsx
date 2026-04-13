import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Activity, Database, Cpu, Globe, Zap, RefreshCw,
  CheckCircle, AlertTriangle, XCircle, Loader2, Clock
} from "lucide-react";

interface ServiceHealth {
  component: string;
  status: "healthy" | "degraded" | "critical" | "unknown";
  avgLatencyMs?: number;
  errorCount?: number;
  detail?: string;
  lastActivityAt?: string;
}

interface ExecutionInsight {
  step: string;
  avgLatencyMs: number;
  p95LatencyMs: number;
  errorRate: number;
  count: number;
  status: "fast" | "normal" | "slow" | "failing";
}

interface SystemHealthReport {
  overallStatus: "healthy" | "degraded" | "critical";
  overallScore: number;
  businessHealth: {
    activeAccounts: number;
    accountsWithIssues: number;
    totalWorkflows: number;
    activeWorkflows: number;
    campaignsSent: number;
  };
  serviceHealth: ServiceHealth[];
  executionInsights: ExecutionInsight[];
  recommendations: string[];
  generatedAt: string;
}

const STATUS_CONFIG = {
  healthy: { icon: CheckCircle, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "Healthy" },
  degraded: { icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10", label: "Degraded" },
  critical: { icon: XCircle, color: "text-red-400", bg: "bg-red-500/10", label: "Critical" },
  unknown: { icon: Clock, color: "text-slate-400", bg: "bg-slate-500/10", label: "Unknown" },
};

const EXECUTION_STATUS_COLORS = {
  fast: "text-emerald-400",
  normal: "text-slate-400",
  slow: "text-amber-400",
  failing: "text-red-400",
};

const COMPONENT_ICONS: Record<string, typeof Activity> = {
  "Database": Database,
  "AI Gateway": Cpu,
  "Integration Layer": Globe,
  "Workflow Engine": Zap,
};

export function SystemHealthTab() {
  const { data, isLoading, refetch, dataUpdatedAt } = useQuery<SystemHealthReport>({
    queryKey: ["/api/apex/system-health"],
    queryFn: async () => {
      const res = await fetch("/api/apex/system-health");
      if (!res.ok) throw new Error("Failed to fetch system health");
      return res.json();
    },
    refetchInterval: 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-violet-400" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div className="space-y-2">
          <Activity size={24} className="mx-auto text-slate-500" />
          <p className="text-sm text-slate-400">System health unavailable</p>
        </div>
      </div>
    );
  }

  const overallCfg = STATUS_CONFIG[data.overallStatus] || STATUS_CONFIG.unknown;
  const OverallIcon = overallCfg.icon;

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin" data-testid="panel-system-health">
      <div className="px-3 py-2 flex items-center justify-between border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <Activity size={10} className="text-cyan-400" />
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">System Health</span>
        </div>
        <button
          onClick={() => refetch()}
          className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
          data-testid="button-syshealth-refresh"
        >
          <RefreshCw size={10} />
        </button>
      </div>

      <div className="p-3 space-y-3">
        <div className={`p-3 rounded-xl border flex items-center gap-3 ${overallCfg.bg} border-white/[0.06]`}>
          <OverallIcon size={18} className={overallCfg.color} />
          <div>
            <p className={`text-sm font-bold ${overallCfg.color}`}>{overallCfg.label}</p>
            <p className="text-xs text-slate-500">Platform health score: {data.overallScore}/100</p>
          </div>
          <div className="ml-auto text-right">
            <div className="w-10 h-10 rounded-full border-2 border-white/[0.08] flex items-center justify-center">
              <span className={`text-sm font-black ${overallCfg.color}`}>{data.overallScore}</span>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Services</p>
          {data.serviceHealth.map((service) => {
            const cfg = STATUS_CONFIG[service.status] || STATUS_CONFIG.unknown;
            const StatusIcon = cfg.icon;
            const CompIcon = COMPONENT_ICONS[service.component] || Activity;
            return (
              <motion.div
                key={service.component}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]"
                data-testid={`service-${service.component.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <CompIcon size={10} className="text-slate-500 shrink-0" />
                <span className="text-xs text-slate-300 flex-1">{service.component}</span>
                {service.avgLatencyMs && (
                  <span className="text-sm text-slate-400 font-mono">{service.avgLatencyMs}ms</span>
                )}
                <div className="flex items-center gap-1">
                  <StatusIcon size={9} className={cfg.color} />
                  <span className={`text-sm font-medium ${cfg.color}`}>{cfg.label}</span>
                </div>
              </motion.div>
            );
          })}
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {[
            { label: "Accounts", value: data.businessHealth.activeAccounts, icon: Activity },
            { label: "Workflows", value: data.businessHealth.activeWorkflows, icon: Zap },
            { label: "Campaigns", value: data.businessHealth.campaignsSent, icon: Globe },
          ].map(m => (
            <div key={m.label} className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.04] text-center">
              <m.icon size={10} className="mx-auto text-slate-500 mb-1" />
              <p className="text-sm font-bold text-white">{m.value}</p>
              <p className="text-sm text-slate-400">{m.label}</p>
            </div>
          ))}
        </div>

        {data.executionInsights.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Execution Timing</p>
            {data.executionInsights.slice(0, 5).map((insight) => {
              const statusColor = EXECUTION_STATUS_COLORS[insight.status] || "text-slate-400";
              return (
                <div
                  key={insight.step}
                  className="flex items-center gap-2 p-1.5 rounded bg-white/[0.02] border border-white/[0.03]"
                  data-testid={`exec-step-${insight.step}`}
                >
                  <span className="text-sm text-slate-400 flex-1 truncate">{insight.step}</span>
                  <span className="text-xs text-slate-400 font-mono">{insight.count} runs</span>
                  <span className={`text-sm font-medium ${statusColor}`}>{insight.avgLatencyMs}ms</span>
                  <span className={`text-xs ${statusColor} uppercase`}>{insight.status}</span>
                </div>
              );
            })}
          </div>
        )}

        {data.recommendations.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-widest text-amber-500">Recommendations</p>
            {data.recommendations.map((rec, i) => (
              <div key={i} className="flex items-start gap-1.5 p-2 rounded bg-amber-500/[0.05] border border-amber-500/10">
                <AlertTriangle size={9} className="text-amber-400 mt-0.5 shrink-0" />
                <p className="text-xs text-slate-400">{rec}</p>
              </div>
            ))}
          </div>
        )}

        {dataUpdatedAt && (
          <p className="text-xs text-slate-500 text-center">
            Last checked: {new Date(dataUpdatedAt).toLocaleTimeString()}
          </p>
        )}
      </div>
    </div>
  );
}
