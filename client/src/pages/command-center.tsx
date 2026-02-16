import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Shield, TrendingUp, Users, MessageSquare, GitFork, Zap, Star, DollarSign, Activity, BarChart3 } from "lucide-react";

export default function CommandCenter() {
  const { data: metrics, isLoading } = useQuery<any>({
    queryKey: ["/api/command-center"],
  });

  if (isLoading) {
    return (
      <div className="p-6 md:p-10 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 bg-white/5 rounded-2xl animate-pulse border border-white/10" />
          ))}
        </div>
      </div>
    );
  }

  const topPerformers = [...(metrics?.accounts || [])]
    .sort((a: any, b: any) => b.revenue - a.revenue)
    .slice(0, 5);

  const atRisk = (metrics?.accounts || []).filter((a: any) => a.avgRating > 0 && a.avgRating < 3);

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
            <Shield size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-white" data-testid="text-command-center-title">Agency Command Center</h1>
            <p className="text-slate-400 text-sm">Fleet health, revenue, and global metrics at a glance</p>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="bg-black/40 backdrop-blur-md border border-cyan-500/30 p-5 rounded-2xl shadow-[0_0_15px_rgba(0,243,255,0.1)]"
          data-testid="card-total-revenue"
        >
          <div className="flex items-center gap-2 mb-2">
            <DollarSign size={14} className="text-cyan-400" />
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Portfolio MRR</p>
          </div>
          <p className="text-3xl font-black text-white">${metrics?.totalRevenue?.toFixed(2) || "0.00"}</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-black/40 backdrop-blur-md border border-purple-500/30 p-5 rounded-2xl"
          data-testid="card-total-accounts"
        >
          <div className="flex items-center gap-2 mb-2">
            <Users size={14} className="text-purple-400" />
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Sub-Accounts</p>
          </div>
          <p className="text-3xl font-black text-white">{metrics?.totalAccounts || 0}</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="bg-black/40 backdrop-blur-md border border-green-500/30 p-5 rounded-2xl"
          data-testid="card-total-leads"
        >
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={14} className="text-green-400" />
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Total Leads</p>
          </div>
          <p className="text-3xl font-black text-white">{metrics?.totalLeads || 0}</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="bg-black/40 backdrop-blur-md border border-amber-500/30 p-5 rounded-2xl"
          data-testid="card-total-messages"
        >
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare size={14} className="text-amber-400" />
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Messages</p>
          </div>
          <p className="text-3xl font-black text-white">{metrics?.totalMessages || 0}</p>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
          className="bg-black/40 backdrop-blur-md border border-white/10 p-5 rounded-2xl flex items-center gap-4"
        >
          <div className="w-12 h-12 rounded-xl bg-indigo-500/20 flex items-center justify-center">
            <Zap size={20} className="text-indigo-400" />
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Active Workflows</p>
            <p className="text-2xl font-black text-white">{metrics?.totalWorkflows || 0}</p>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="bg-black/40 backdrop-blur-md border border-white/10 p-5 rounded-2xl flex items-center gap-4"
        >
          <div className="w-12 h-12 rounded-xl bg-cyan-500/20 flex items-center justify-center">
            <Activity size={20} className="text-cyan-400" />
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Plan Tier</p>
            <p className="text-2xl font-black text-white capitalize">{metrics?.planTier?.replace("_", " ") || "Free"}</p>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
          className="bg-black/40 backdrop-blur-md border border-white/10 p-5 rounded-2xl flex items-center gap-4"
        >
          <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
            <BarChart3 size={20} className="text-green-400" />
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">AI Credits</p>
            <p className="text-2xl font-black text-white">${(metrics?.aiCredits || 0).toFixed(2)}</p>
          </div>
        </motion.div>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-6 mb-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
          className="min-w-[320px] bg-black/40 backdrop-blur-md border-t-2 border-cyan-500 p-5 rounded-b-xl flex-1"
        >
          <h3 className="text-cyan-400 font-black uppercase tracking-widest text-sm mb-4 flex items-center gap-2">
            <TrendingUp size={14} /> Phase 1: Neural Intake
          </h3>
          {(metrics?.accounts || []).slice(0, 5).map((account: any) => (
            <div key={account.id} className="bg-white/5 p-3 rounded-lg mb-2 border border-white/10 hover:border-cyan-500/50 transition-all">
              <p className="text-white font-bold text-sm">{account.name}</p>
              <p className="text-xs text-gray-400">{account.newLeads} new leads detected</p>
              <div className="w-full bg-gray-800 h-1 mt-2 rounded-full overflow-hidden">
                <div className="bg-cyan-500 h-full rounded-full" style={{ width: `${Math.min(100, (account.newLeads / Math.max(1, metrics?.totalLeads || 1)) * 300)}%` }} />
              </div>
            </div>
          ))}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}
          className="min-w-[320px] bg-black/40 backdrop-blur-md border-t-2 border-purple-500 p-5 rounded-b-xl flex-1"
        >
          <h3 className="text-purple-400 font-black uppercase tracking-widest text-sm mb-4 flex items-center gap-2">
            <Zap size={14} /> Phase 2: Active Workflows
          </h3>
          {(metrics?.accounts || []).filter((a: any) => a.workflowCount > 0).slice(0, 5).map((account: any) => (
            <div key={account.id} className="bg-white/5 p-3 rounded-lg mb-2 border border-white/10 hover:border-purple-500/50 transition-all">
              <p className="text-white font-bold text-sm">{account.name}</p>
              <p className="text-xs text-gray-400">{account.workflowCount} active workflows</p>
              <p className="text-xs text-purple-400 mt-1">{account.messageCount} messages processed</p>
            </div>
          ))}
          {(metrics?.accounts || []).filter((a: any) => a.workflowCount > 0).length === 0 && (
            <p className="text-slate-600 text-sm text-center py-4">No active workflows yet</p>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
          className="min-w-[320px] bg-black/40 backdrop-blur-md border-t-2 border-green-500 p-5 rounded-b-xl flex-1"
        >
          <h3 className="text-green-400 font-black uppercase tracking-widest text-sm mb-4 flex items-center gap-2">
            <DollarSign size={14} /> Phase 3: Revenue Capture
          </h3>
          {topPerformers.map((account: any) => (
            <div key={account.id} className="bg-white/5 p-3 rounded-lg mb-2 border border-white/10 hover:border-green-500/50 transition-all">
              <div className="flex items-center justify-between">
                <p className="text-white font-bold text-sm">{account.name}</p>
                <p className="text-green-400 font-bold text-sm">${account.revenue.toFixed(2)}</p>
              </div>
              <p className="text-xs text-gray-400">{account.reviewCount} reviews ({account.avgRating} avg)</p>
            </div>
          ))}
          {topPerformers.length === 0 && (
            <p className="text-slate-600 text-sm text-center py-4">No revenue data yet</p>
          )}
        </motion.div>
      </div>

      {atRisk.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55 }}
          className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6"
        >
          <h3 className="text-red-400 font-bold mb-3 flex items-center gap-2">
            <Shield size={16} /> Accounts At Risk
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {atRisk.map((account: any) => (
              <div key={account.id} className="flex items-center justify-between p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                <div>
                  <p className="text-white font-bold text-sm">{account.name}</p>
                  <p className="text-xs text-red-400">Avg Rating: {account.avgRating}/5</p>
                </div>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star key={s} size={12} className={s <= account.avgRating ? "text-amber-400 fill-amber-400" : "text-slate-700"} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
