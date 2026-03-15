import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Database, Shield, CreditCard, Brain, RefreshCw, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface PulseCheck {
  name: string;
  status: "healthy" | "degraded" | "down";
  message: string;
  latencyMs?: number;
}

interface PulseData {
  status: "healthy" | "degraded" | "critical";
  timestamp: string;
  checks: PulseCheck[];
}

const SYSTEM_ICONS: Record<string, any> = {
  Database: Database,
  Sentinel: Shield,
  Billing: CreditCard,
  "AI Engine": Brain,
};

const STATUS_COLORS: Record<string, { glow: string; bg: string; text: string; border: string; ring: string }> = {
  healthy: {
    glow: "shadow-[0_0_15px_rgba(0,255,200,0.5)]",
    bg: "bg-emerald-500",
    text: "text-emerald-400",
    border: "border-emerald-500/30",
    ring: "ring-emerald-500/20",
  },
  degraded: {
    glow: "shadow-[0_0_15px_rgba(255,200,0,0.5)]",
    bg: "bg-amber-500",
    text: "text-amber-400",
    border: "border-amber-500/30",
    ring: "ring-amber-500/20",
  },
  down: {
    glow: "shadow-[0_0_15px_rgba(255,50,50,0.6)]",
    bg: "bg-red-500",
    text: "text-red-400",
    border: "border-red-500/30",
    ring: "ring-red-500/20",
  },
};

export function SystemPulse() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const { data: pulse, isLoading, isError } = useQuery<PulseData>({
    queryKey: ["/api/admin/pulse"],
    queryFn: async () => {
      const res = await fetch("/api/admin/pulse");
      if (!res.ok) throw new Error("Pulse check failed");
      return res.json();
    },
    refetchInterval: 60000,
    retry: 1,
  });

  const rebootMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/reboot", { method: "POST" });
      if (!res.ok) throw new Error("Reboot failed");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Services Rebooted", description: data.actions?.join(", ") || "All systems refreshed" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pulse"] });
    },
    onError: () => {
      toast({ title: "Reboot Failed", description: "Could not restart services", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="bg-black/60 border border-white/10 rounded-2xl p-4" data-testid="widget-pulse-loading">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-slate-600 animate-pulse" />
          <span className="text-slate-500 text-sm">Checking system health...</span>
        </div>
      </div>
    );
  }

  if (isError || !pulse) {
    return null;
  }

  const overallColors = pulse?.status === "healthy" ? STATUS_COLORS.healthy : pulse?.status === "critical" ? STATUS_COLORS.down : STATUS_COLORS.degraded;
  const healthyCount = pulse?.checks.filter(c => c.status === "healthy").length ?? 0;
  const totalCount = pulse?.checks.length ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-black/60 border ${overallColors.border} rounded-2xl overflow-hidden ring-1 ${overallColors.ring}`}
      data-testid="widget-system-pulse"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
        data-testid="button-toggle-pulse"
      >
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {pulse?.checks.map((check) => {
              const colors = STATUS_COLORS[check.status];
              return (
                <div key={check.name} className="relative group" data-testid={`pulse-light-${check.name.toLowerCase().replace(/\s/g, "-")}`}>
                  <div className={`w-3 h-3 rounded-full ${colors.bg} ${colors.glow} transition-all`} />
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-black/90 text-xs text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap border border-white/10 z-10">
                    {check.name}
                  </div>
                </div>
              );
            })}
          </div>
          <div>
            <span className="text-white font-bold text-sm">System Pulse</span>
            <span className={`ml-2 text-xs ${overallColors.text}`}>
              {healthyCount}/{totalCount} systems online
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); rebootMutation.mutate(); }}
            disabled={rebootMutation.isPending}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-slate-300 hover:text-white transition-all border border-white/10"
            data-testid="button-reboot-services"
          >
            <RefreshCw size={12} className={rebootMutation.isPending ? "animate-spin" : ""} />
            Reboot
          </button>
          {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="section-pulse-details">
              {pulse?.checks.map((check) => {
                const Icon = SYSTEM_ICONS[check.name] || AlertTriangle;
                const colors = STATUS_COLORS[check.status];
                return (
                  <div
                    key={check.name}
                    className={`rounded-xl border ${colors.border} bg-black/40 p-3 ring-1 ${colors.ring}`}
                    data-testid={`pulse-card-${check.name.toLowerCase().replace(/\s/g, "-")}`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center`}>
                        <Icon size={16} className={colors.text} />
                      </div>
                      <div className={`w-2 h-2 rounded-full ${colors.bg} ${colors.glow}`} />
                    </div>
                    <p className="text-white text-sm font-bold">{check.name}</p>
                    <p className={`text-xs ${colors.text} mt-0.5`}>
                      {check.status === "healthy" ? "Online" : check.status === "degraded" ? "Warning" : "Offline"}
                    </p>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">{check.message}</p>
                    {check.latencyMs !== undefined && (
                      <p className="text-xs text-slate-600 mt-1">{check.latencyMs}ms</p>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="px-4 pb-3 flex items-center justify-between">
              <p className="text-xs text-slate-600">
                Last checked: {pulse?.timestamp ? new Date(pulse.timestamp).toLocaleTimeString() : "—"}
              </p>
              <p className="text-xs text-slate-600">Auto-refresh: 60s</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
