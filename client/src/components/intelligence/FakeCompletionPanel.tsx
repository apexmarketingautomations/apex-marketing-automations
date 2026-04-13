import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck, AlertTriangle, XCircle, RefreshCw,
  CheckCircle, Loader2, Info
} from "lucide-react";
import { useAccount } from "@/hooks/use-account";

interface FakeCompletionAlert {
  id: string;
  category: "integration" | "site" | "workflow" | "domain" | "campaign";
  entityId: string | number;
  entityName: string;
  issue: string;
  detail: string;
  severity: "critical" | "warning" | "info";
  claimedState: string;
  actualState: string;
  suggestedFix?: string;
  detectedAt: string;
}

interface FakeCompletionReport {
  accountId: number;
  alerts: FakeCompletionAlert[];
  totalAlerts: number;
  criticalCount: number;
  warningCount: number;
  checkedAt: string;
}

const SEVERITY_CONFIG = {
  critical: { icon: XCircle, color: "text-red-400", bg: "bg-red-500/[0.07] border-red-500/20" },
  warning: { icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/[0.07] border-amber-500/20" },
  info: { icon: Info, color: "text-blue-400", bg: "bg-blue-500/[0.07] border-blue-500/20" },
};

const CATEGORY_LABELS: Record<string, string> = {
  integration: "Integration",
  site: "Site",
  workflow: "Workflow",
  domain: "Domain",
  campaign: "Campaign",
};

export function FakeCompletionPanel({ subAccountId: propSubAccountId }: { subAccountId?: number }) {
  const { activeAccountId } = useAccount();
  const subAccountId = propSubAccountId ?? activeAccountId;

  const { data, isLoading, refetch, isFetching } = useQuery<FakeCompletionReport>({
    queryKey: ["/api/apex/fake-completion", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/apex/fake-completion/${subAccountId}`);
      if (!res.ok) throw new Error("Failed to check platform integrity");
      return res.json();
    },
    enabled: !!subAccountId,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <Loader2 size={20} className="animate-spin text-violet-400 mx-auto" />
          <p className="text-xs text-slate-500">Running platform integrity checks...</p>
        </div>
      </div>
    );
  }

  const criticalCount = data?.criticalCount ?? 0;
  const warningCount = data?.warningCount ?? 0;
  const totalAlerts = data?.totalAlerts ?? 0;
  const alerts = data?.alerts ?? [];

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="panel-fake-completion">
      <div className="px-3 py-2 flex items-center justify-between border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <ShieldCheck size={10} className="text-cyan-400" />
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Platform Integrity</span>
          {criticalCount > 0 && (
            <span className="px-1 py-px text-xs bg-red-500/20 text-red-400 rounded font-bold border border-red-500/20">
              {criticalCount} critical
            </span>
          )}
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors disabled:opacity-50"
          data-testid="button-integrity-refresh"
        >
          <RefreshCw size={10} className={isFetching ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="px-3 py-2 grid grid-cols-3 gap-1.5 border-b border-white/[0.04]">
        <div className="text-center">
          <p className={`text-sm font-bold ${totalAlerts === 0 ? "text-emerald-400" : "text-white"}`}>{totalAlerts}</p>
          <p className="text-sm text-slate-400 uppercase tracking-wider">Total</p>
        </div>
        <div className="text-center">
          <p className={`text-sm font-bold ${criticalCount > 0 ? "text-red-400" : "text-slate-500"}`}>{criticalCount}</p>
          <p className="text-sm text-slate-400 uppercase tracking-wider">Critical</p>
        </div>
        <div className="text-center">
          <p className={`text-sm font-bold ${warningCount > 0 ? "text-amber-400" : "text-slate-500"}`}>{warningCount}</p>
          <p className="text-sm text-slate-400 uppercase tracking-wider">Warnings</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-2">
        {totalAlerts === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-8 text-center space-y-2">
            <CheckCircle size={28} className="text-emerald-500 mx-auto" />
            <p className="text-sm text-slate-400 font-medium">All systems verified</p>
            <p className="text-xs text-slate-400">No false completion states detected</p>
            {data?.checkedAt && (
              <p className="text-sm text-slate-500">
                Checked {new Date(data.checkedAt).toLocaleTimeString()}
              </p>
            )}
          </div>
        ) : (
          <AnimatePresence>
            {alerts.map((alert, i) => {
              const cfg = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.info;
              const AlertIcon = cfg.icon;
              return (
                <motion.div
                  key={alert.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className={`p-3 rounded-xl border ${cfg.bg}`}
                  data-testid={`integrity-alert-${alert.category}-${alert.entityId}`}
                >
                  <div className="flex items-start gap-2">
                    <AlertIcon size={11} className={`${cfg.color} mt-0.5 shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={`text-sm font-semibold uppercase ${cfg.color}`}>{alert.severity}</span>
                        <span className="text-xs text-slate-400 border border-white/[0.06] px-1 rounded">
                          {CATEGORY_LABELS[alert.category] || alert.category}
                        </span>
                      </div>
                      <p className="text-xs text-white font-medium mb-0.5">{alert.entityName}</p>
                      <p className="text-xs text-slate-400 mb-1">{alert.issue}</p>
                      <p className="text-sm text-slate-500 leading-relaxed">{alert.detail}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs text-slate-400 line-through">{alert.claimedState}</span>
                        <span className="text-xs text-slate-400">→</span>
                        <span className={`text-xs font-medium ${cfg.color}`}>{alert.actualState}</span>
                      </div>
                      {alert.suggestedFix && (
                        <p className="text-sm text-violet-400 mt-1">✦ {alert.suggestedFix}</p>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
