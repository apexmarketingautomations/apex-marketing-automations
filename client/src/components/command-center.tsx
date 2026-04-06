import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveSubAccountId } from "@/components/account-required";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap, AlertTriangle, TrendingDown, Shield, ChevronRight,
  CheckCircle2, XCircle, Clock, Loader2, ArrowRight,
  Brain, Rocket, Target, RefreshCw, Activity, Eye,
  Settings, AlertCircle, BarChart3
} from "lucide-react";

interface ReadinessCondition {
  id: string;
  label: string;
  met: boolean;
  detail: string;
  fixCommand?: string;
  fixLabel?: string;
}

interface AccountReadiness {
  phase: "not_setup" | "setup_inactive" | "active_measurable";
  phaseLabel: string;
  phaseDetail: string;
  conditions: ReadinessCondition[];
  benchmarkReady: boolean;
  intelligenceReady: boolean;
  metConditions: number;
  totalConditions: number;
}

interface Prediction {
  type: string;
  metric: string;
  title: string;
  detail: string;
  impact: string;
  command: string | null;
  commandLabel: string | null;
  urgency: string;
  timeframe: string;
}

interface Directive {
  id: string;
  severity: string;
  title: string;
  reason: string;
  command: string;
  commandLabel: string;
  impact: string;
}

interface CommandAction {
  step: string;
  status: "done" | "failed" | "skipped";
  detail?: string;
}

interface CommandResult {
  success: boolean;
  command: string;
  actions: CommandAction[];
  summary: string;
}

const phaseConfig = {
  not_setup: {
    icon: Settings,
    color: "text-amber-400",
    border: "border-amber-500/30",
    bg: "bg-amber-500/10",
    gradient: "from-amber-500/20 to-amber-600/5",
  },
  setup_inactive: {
    icon: Clock,
    color: "text-cyan-400",
    border: "border-cyan-500/30",
    bg: "bg-cyan-500/10",
    gradient: "from-cyan-500/20 to-cyan-600/5",
  },
  active_measurable: {
    icon: BarChart3,
    color: "text-green-400",
    border: "border-green-500/30",
    bg: "bg-green-500/10",
    gradient: "from-green-500/20 to-green-600/5",
  },
};

export function CommandCenter() {
  const subAccountId = useActiveSubAccountId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [executingCommand, setExecutingCommand] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<CommandResult | null>(null);
  const [showResult, setShowResult] = useState(false);

  const { data: readinessData } = useQuery<AccountReadiness>({
    queryKey: ["/api/readiness", subAccountId],
    queryFn: async () => {
      const r = await fetch(`/api/readiness/${subAccountId}`);
      if (!r.ok) throw new Error("Failed to load readiness");
      return r.json();
    },
    enabled: !!subAccountId,
    refetchInterval: 60000,
  });

  const isReady = readinessData?.phase === "active_measurable";

  const { data: predictions } = useQuery<{ predictions: Prediction[] }>({
    queryKey: ["/api/command/predictions", subAccountId],
    queryFn: async () => {
      const r = await fetch(`/api/command/predictions/${subAccountId}`);
      if (!r.ok) throw new Error("Failed to load predictions");
      return r.json();
    },
    enabled: !!subAccountId && isReady,
    refetchInterval: 120000,
  });

  const { data: directives } = useQuery<{ directives: Directive[] }>({
    queryKey: ["/api/command/directives", subAccountId],
    queryFn: async () => {
      const r = await fetch(`/api/command/directives/${subAccountId}`);
      if (!r.ok) throw new Error("Failed to load directives");
      return r.json();
    },
    enabled: !!subAccountId && isReady,
    refetchInterval: 120000,
  });

  const executeMut = useMutation({
    mutationFn: async ({ command, params }: { command: string; params?: any }) => {
      setExecutingCommand(command);
      const r = await fetch("/api/command/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-sub-account-id": String(subAccountId) },
        body: JSON.stringify({ command, params, subAccountId }),
      });
      if (!r.ok) throw new Error("Command execution failed");
      return r.json() as Promise<CommandResult>;
    },
    onSuccess: (result) => {
      setLastResult(result);
      setShowResult(true);
      setExecutingCommand(null);
      const done = result.actions.filter(a => a.status === "done").length;
      toast({
        title: result.success ? `${done} action${done !== 1 ? "s" : ""} completed` : "Some actions failed",
        description: result.summary,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/command/predictions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/command/directives"] });
      queryClient.invalidateQueries({ queryKey: ["/api/readiness"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    },
    onError: () => {
      setExecutingCommand(null);
      toast({ title: "Command failed", variant: "destructive" });
    },
  });

  const urgencyConfig: Record<string, { icon: any; color: string; border: string; bg: string }> = {
    critical: { icon: AlertTriangle, color: "text-red-400", border: "border-red-500/30", bg: "bg-red-500/10" },
    warning: { icon: TrendingDown, color: "text-amber-400", border: "border-amber-500/20", bg: "bg-amber-500/10" },
    opportunity: { icon: Target, color: "text-cyan-400", border: "border-cyan-500/20", bg: "bg-cyan-500/10" },
    info: { icon: Shield, color: "text-green-400", border: "border-green-500/20", bg: "bg-green-500/10" },
    positive: { icon: CheckCircle2, color: "text-green-400", border: "border-green-500/20", bg: "bg-green-500/10" },
  };

  const predictionList = predictions?.predictions || [];
  const directiveList = directives?.directives || [];
  const hasCritical = predictionList.some(p => p.urgency === "critical") || directiveList.some(d => d.severity === "critical");

  if (!subAccountId) return null;

  return (
    <div className="space-y-6" data-testid="section-command-center">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center relative" style={{
            background: `linear-gradient(135deg, var(--vibe-glow, #06b6d4), var(--vibe-accent, #4f46e5))`,
          }}>
            <Brain className="w-5 h-5 text-white" />
            {isReady && hasCritical && (
              <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-red-500 animate-pulse" />
            )}
          </div>
          <div>
            <h2 className="text-xl font-black text-white" data-testid="text-command-center-title">Command Center</h2>
            <p className="text-xs text-white/40">
              {isReady ? "AI-powered decisions and instant execution" : readinessData?.phaseLabel || "Loading..."}
            </p>
          </div>
        </div>
        {isReady && (
          <button
            data-testid="button-optimize-all"
            onClick={() => executeMut.mutate({ command: "system-optimize" })}
            disabled={executeMut.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold text-white transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
            style={{
              background: `linear-gradient(135deg, var(--vibe-glow, #06b6d4), var(--vibe-accent, #4f46e5))`,
              boxShadow: `0 4px 20px color-mix(in srgb, var(--vibe-glow, #06b6d4) 30%, transparent)`,
            }}
          >
            {executingCommand === "system-optimize" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Rocket className="w-4 h-4" />
            )}
            Optimize All Systems
          </button>
        )}
      </div>

      {readinessData && !isReady && (
        <ReadinessPanel readiness={readinessData} onExecute={(cmd) => executeMut.mutate({ command: cmd })} executingCommand={executingCommand} isPending={executeMut.isPending} />
      )}

      {isReady && directiveList.length > 0 && (
        <div className="space-y-2" data-testid="section-directives">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-4 h-4" style={{ color: "var(--vibe-glow, #06b6d4)" }} />
            <span className="text-xs font-bold text-white/50 uppercase tracking-wider">Directives — Act Now</span>
          </div>
          {directiveList.map((directive, i) => {
            const cfg = urgencyConfig[directive.severity] || urgencyConfig.info;
            const UrgIcon = cfg.icon;
            const isExecuting = executingCommand === directive.command;

            return (
              <motion.div
                key={directive.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className={`glass ${cfg.border} border rounded-xl p-4 group`}
                data-testid={`directive-${directive.id}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg ${cfg.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                    <UrgIcon className={`w-4 h-4 ${cfg.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white leading-snug">{directive.title}</p>
                    <p className="text-xs text-white/40 mt-1">{directive.reason}</p>
                  </div>
                  <button
                    data-testid={`button-directive-${directive.id}`}
                    onClick={() => executeMut.mutate({ command: directive.command })}
                    disabled={executeMut.isPending}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
                    style={{
                      background: `linear-gradient(135deg, var(--vibe-glow, #06b6d4), var(--vibe-accent, #4f46e5))`,
                    }}
                  >
                    {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                    {directive.commandLabel}
                  </button>
                </div>
                {directive.impact && (
                  <div className="mt-2 ml-11 flex items-center gap-1.5">
                    <Activity className="w-3 h-3 text-green-400/60" />
                    <span className="text-[10px] text-green-400/60 font-medium">{directive.impact}</span>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {isReady && predictionList.length > 0 && predictionList[0].type !== "positive" && (
        <div className="space-y-2" data-testid="section-predictions">
          <div className="flex items-center gap-2 mb-1">
            <Eye className="w-4 h-4" style={{ color: "var(--vibe-accent, #4f46e5)" }} />
            <span className="text-xs font-bold text-white/50 uppercase tracking-wider">Predictive Intelligence</span>
          </div>
          {predictionList.filter(p => p.type !== "positive").map((prediction, i) => {
            const cfg = urgencyConfig[prediction.urgency] || urgencyConfig.warning;
            const PredIcon = cfg.icon;
            const isExecuting = executingCommand === prediction.command;

            return (
              <motion.div
                key={prediction.metric}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className={`${cfg.border} border rounded-xl p-4 bg-black/30`}
                data-testid={`prediction-${prediction.metric}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg ${cfg.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                    <PredIcon className={`w-4 h-4 ${cfg.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-semibold text-white">{prediction.title}</p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-white/30 font-medium">{prediction.timeframe}</span>
                    </div>
                    <p className="text-xs text-white/40">{prediction.detail}</p>
                    <p className="text-xs text-white/30 mt-1 italic">{prediction.impact}</p>
                  </div>
                  {prediction.command && (
                    <button
                      data-testid={`button-prediction-${prediction.metric}`}
                      onClick={() => executeMut.mutate({ command: prediction.command! })}
                      disabled={executeMut.isPending}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white/80 hover:text-white transition-all border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10"
                    >
                      {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                      {prediction.commandLabel}
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {showResult && lastResult && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="glass border border-white/10 rounded-xl p-5"
            data-testid="section-command-result"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {lastResult.success ? (
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-400" />
                )}
                <span className="text-sm font-bold text-white">{lastResult.summary}</span>
              </div>
              <button
                onClick={() => setShowResult(false)}
                className="text-xs text-white/30 hover:text-white/60 transition-colors"
                data-testid="button-dismiss-result"
              >
                Dismiss
              </button>
            </div>
            <div className="space-y-1.5">
              {lastResult.actions.map((action, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  {action.status === "done" ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
                  ) : action.status === "skipped" ? (
                    <Clock className="w-3.5 h-3.5 text-white/20 shrink-0" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                  )}
                  <span className={action.status === "done" ? "text-white/70" : action.status === "skipped" ? "text-white/30" : "text-red-300/60"}>
                    {action.step}
                  </span>
                  {action.detail && (
                    <span className="text-white/20 ml-auto">{action.detail}</span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ReadinessPanel({ readiness, onExecute, executingCommand, isPending }: {
  readiness: AccountReadiness;
  onExecute: (cmd: string) => void;
  executingCommand: string | null;
  isPending: boolean;
}) {
  const cfg = phaseConfig[readiness.phase];
  const PhaseIcon = cfg.icon;
  const progress = Math.round((readiness.metConditions / readiness.totalConditions) * 100);

  return (
    <div className={`rounded-xl border ${cfg.border} bg-gradient-to-br ${cfg.gradient} p-5`} data-testid="section-readiness">
      <div className="flex items-start gap-4 mb-4">
        <div className={`w-10 h-10 rounded-xl ${cfg.bg} flex items-center justify-center shrink-0`}>
          <PhaseIcon className={`w-5 h-5 ${cfg.color}`} />
        </div>
        <div className="flex-1">
          <h3 className={`text-sm font-bold ${cfg.color}`} data-testid="text-readiness-phase">{readiness.phaseLabel}</h3>
          <p className="text-xs text-white/50 mt-1">{readiness.phaseDetail}</p>
        </div>
        <div className="text-right shrink-0">
          <span className="text-2xl font-black text-white" data-testid="text-readiness-progress">{progress}%</span>
          <p className="text-[10px] text-white/30">readiness</p>
        </div>
      </div>

      <div className="w-full h-1.5 rounded-full bg-white/5 mb-4 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, var(--vibe-glow, #06b6d4), var(--vibe-accent, #4f46e5))` }}
        />
      </div>

      <div className="space-y-2">
        {readiness.conditions.map((condition) => (
          <div key={condition.id} className="flex items-center gap-3" data-testid={`readiness-${condition.id}`}>
            {condition.met ? (
              <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-white/20 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <span className={`text-xs font-medium ${condition.met ? "text-white/60" : "text-white/40"}`}>
                {condition.label}
              </span>
              <span className="text-[10px] text-white/20 ml-2">{condition.detail}</span>
            </div>
            {!condition.met && condition.fixCommand && condition.fixLabel && (
              <button
                data-testid={`button-fix-${condition.id}`}
                onClick={() => onExecute(condition.fixCommand!)}
                disabled={isPending}
                className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
                style={{
                  background: `linear-gradient(135deg, var(--vibe-glow, #06b6d4), var(--vibe-accent, #4f46e5))`,
                  color: "white",
                }}
              >
                {executingCommand === condition.fixCommand ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Zap className="w-3 h-3" />
                )}
                {condition.fixLabel}
              </button>
            )}
          </div>
        ))}
      </div>

      {readiness.phase === "setup_inactive" && (
        <div className="mt-4 p-3 rounded-lg bg-cyan-500/5 border border-cyan-500/10">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-cyan-400/60" />
            <p className="text-[11px] text-cyan-300/60">
              Benchmarks will activate once enough real messages are processed. Send messages through your connected channel to start building performance data.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
