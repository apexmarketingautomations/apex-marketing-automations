import { Bell, Lightbulb, Eye, Loader2, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Nudge, StrategicInsight } from "./types";

export function NudgesTab({ subAccountId }: { subAccountId: number }) {
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery<{ nudges: Nudge[] }>({
    queryKey: ["/api/operator/cognitive/nudges/pending", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/operator/cognitive/nudges/${subAccountId}/pending`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!subAccountId,
    staleTime: 60000,
  });

  const { data: oppsData } = useQuery<{ opportunities: StrategicInsight[] }>({
    queryKey: ["/api/operator/cognitive/opportunities", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/operator/cognitive/opportunities/${subAccountId}`);
      if (!res.ok) return { opportunities: [] };
      return res.json();
    },
    enabled: !!subAccountId,
    staleTime: 120000,
  });

  const dismissMutation = useMutation({
    mutationFn: async (nudgeId: number) => {
      const res = await fetch(`/api/operator/cognitive/nudges/${nudgeId}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subAccountId }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/operator/cognitive/nudges/pending", subAccountId] }),
  });

  const actMutation = useMutation({
    mutationFn: async (nudgeId: number) => {
      const res = await fetch(`/api/operator/cognitive/nudges/${nudgeId}/act`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subAccountId }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/operator/cognitive/nudges/pending", subAccountId] }),
  });

  const nudges = data?.nudges || [];
  const opportunities = oppsData?.opportunities || [];

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="nudges-loading">
        <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3" data-testid="nudges-tab">
      {nudges.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-1.5">
              <Bell size={11} className="text-violet-400" />
              <p className="text-[9px] font-bold uppercase tracking-widest text-violet-400">{nudges.length} Active Nudge{nudges.length !== 1 ? "s" : ""}</p>
            </div>
            <button onClick={() => refetch()} className="p-1 rounded hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors" data-testid="button-refresh-nudges">
              <RefreshCw size={12} />
            </button>
          </div>
          {nudges.map((nudge, i) => (
            <motion.div
              key={nudge.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06 }}
              className="p-3 rounded-xl bg-gradient-to-r from-violet-500/[0.06] to-cyan-500/[0.04] border border-violet-500/15 hover:border-violet-500/30 transition-all"
              data-testid={`nudge-card-${nudge.id}`}
            >
              <div className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-violet-500/15 flex items-center justify-center shrink-0 mt-0.5 border border-violet-500/20">
                  <Lightbulb size={13} className="text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-white">{nudge.title}</p>
                  <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">{nudge.message}</p>
                  <div className="flex items-center gap-2 mt-2.5">
                    <button
                      onClick={() => actMutation.mutate(nudge.id)}
                      disabled={actMutation.isPending}
                      className="px-2.5 py-1 rounded-md bg-cyan-500/15 border border-cyan-500/30 text-[10px] font-semibold text-cyan-400 hover:bg-cyan-500/25 transition-colors disabled:opacity-50"
                      data-testid={`button-nudge-act-${nudge.id}`}
                    >
                      Take Action
                    </button>
                    <button
                      onClick={() => dismissMutation.mutate(nudge.id)}
                      disabled={dismissMutation.isPending}
                      className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-[10px] text-slate-500 hover:text-slate-300 hover:bg-white/10 transition-colors disabled:opacity-50"
                      data-testid={`button-nudge-dismiss-${nudge.id}`}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {opportunities.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 px-1">
            <Eye size={11} className="text-amber-400" />
            <p className="text-[9px] font-bold uppercase tracking-widest text-amber-400">Missed Opportunities</p>
          </div>
          {opportunities.map((opp, i) => (
            <motion.div
              key={opp.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.06 }}
              className="p-3 rounded-xl bg-amber-500/[0.04] border border-amber-500/10 hover:border-amber-500/20 transition-all"
              data-testid={`opportunity-card-${i}`}
            >
              <p className="text-[11px] text-white font-medium">{opp.observation}</p>
              <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">{opp.insight}</p>
              <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">{opp.suggestion}</p>
            </motion.div>
          ))}
        </div>
      )}

      {nudges.length === 0 && opportunities.length === 0 && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center space-y-3">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-violet-500/10 flex items-center justify-center border border-violet-500/15">
              <Bell className="w-7 h-7 text-violet-400" />
            </div>
            <p className="text-sm font-semibold text-white">All Clear</p>
            <p className="text-xs text-slate-500">No active nudges or missed opportunities detected.</p>
            <button onClick={() => refetch()} className="text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1 mx-auto" data-testid="button-generate-nudges">
              <RefreshCw size={10} />
              Check again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
