import { useState } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Users, DollarSign, Link2, Copy, TrendingUp, Clock, CheckCircle2, ArrowUpRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Affiliate() {
  const { toast } = useToast();

  const { data: affiliate, isLoading } = useQuery<any>({
    queryKey: ["/api/affiliate"],
  });

  const copyLink = () => {
    const link = `${window.location.origin}/join?ref=${affiliate?.affiliateCode || ""}`;
    navigator.clipboard.writeText(link);
    toast({ title: "Copied!", description: "Your referral link has been copied to clipboard." });
  };

  if (isLoading) {
    return (
      <div className="p-6 md:p-10 max-w-6xl mx-auto">
        <div className="h-96 bg-white/5 rounded-2xl animate-pulse" />
      </div>
    );
  }

  const commissionTiers = [
    { range: "0-10 referrals", rate: "30%", active: (affiliate?.referralCount || 0) <= 10 },
    { range: "11-50 referrals", rate: "40%", active: (affiliate?.referralCount || 0) > 10 && (affiliate?.referralCount || 0) <= 50 },
    { range: "50+ referrals", rate: "50%", active: (affiliate?.referralCount || 0) > 50 },
  ];

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
            <Users size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-white" data-testid="text-affiliate-title">Affiliate Dashboard</h1>
            <p className="text-slate-400 text-sm">Earn recurring commissions by sharing Apex</p>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="bg-black/40 backdrop-blur-md border border-cyan-500/30 p-6 rounded-2xl shadow-[0_0_15px_rgba(0,243,255,0.1)]"
          data-testid="card-monthly-commissions"
        >
          <p className="text-gray-400 text-sm uppercase font-bold tracking-widest">Monthly Commissions</p>
          <p className="text-4xl font-black text-white mt-2">
            ${(affiliate?.monthlyCommissions || 0).toFixed(2)}
            <span className="text-cyan-400 text-lg">/mo</span>
          </p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-black/40 backdrop-blur-md border border-purple-500/30 p-6 rounded-2xl"
          data-testid="card-referral-count"
        >
          <p className="text-gray-400 text-sm uppercase font-bold tracking-widest">Active Referrals</p>
          <p className="text-4xl font-black text-white mt-2">{affiliate?.referralCount || 0}</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="bg-black/40 backdrop-blur-md border border-green-500/30 p-6 rounded-2xl"
          data-testid="card-total-earned"
        >
          <p className="text-gray-400 text-sm uppercase font-bold tracking-widest">Total Earned</p>
          <p className="text-4xl font-black text-white mt-2">${(affiliate?.totalEarned || 0).toFixed(2)}</p>
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="bg-black/40 backdrop-blur-md border border-white/10 p-6 rounded-2xl mb-8"
      >
        <p className="text-gray-400 text-sm mb-2 font-bold uppercase tracking-widest">Your Unique Invite Link</p>
        <div className="flex gap-2">
          <input
            readOnly
            value={`${window.location.origin}/join?ref=${affiliate?.affiliateCode || ""}`}
            className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-cyan-300 font-mono text-sm"
            data-testid="input-referral-link"
          />
          <button
            onClick={copyLink}
            className="bg-cyan-500 text-black font-bold px-6 rounded-lg flex items-center gap-2 hover:bg-cyan-400 transition-colors"
            data-testid="button-copy-link"
          >
            <Copy size={16} /> COPY
          </button>
        </div>
        <p className="text-xs text-slate-600 mt-2">Code: {affiliate?.affiliateCode}</p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
          className="bg-black/40 backdrop-blur-md border border-white/10 p-6 rounded-2xl"
        >
          <h3 className="text-white font-bold mb-4 flex items-center gap-2">
            <TrendingUp size={16} className="text-cyan-400" /> Commission Tiers
          </h3>
          <div className="space-y-3">
            {commissionTiers.map((tier) => (
              <div key={tier.range} className={`flex items-center justify-between p-3 rounded-lg border ${tier.active ? "border-cyan-500/30 bg-cyan-500/10" : "border-white/5 bg-white/5"}`}>
                <span className="text-sm text-slate-300">{tier.range}</span>
                <span className={`font-bold ${tier.active ? "text-cyan-400" : "text-slate-500"}`}>{tier.rate}</span>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="bg-black/40 backdrop-blur-md border border-white/10 p-6 rounded-2xl"
        >
          <h3 className="text-white font-bold mb-4 flex items-center gap-2">
            <DollarSign size={16} className="text-green-400" /> Recent Commissions
          </h3>
          {!affiliate?.commissions?.length ? (
            <p className="text-slate-500 text-sm text-center py-8">No commissions yet. Share your link to get started!</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {affiliate.commissions.slice(0, 10).map((c: any) => (
                <div key={c.id} className="flex items-center justify-between p-2 rounded-lg bg-white/5">
                  <div className="flex items-center gap-2">
                    {c.status === "paid" ? <CheckCircle2 size={14} className="text-green-400" /> : <Clock size={14} className="text-amber-400" />}
                    <span className="text-sm text-slate-300">{c.note || "Commission"}</span>
                  </div>
                  <span className="text-green-400 font-bold text-sm">${c.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}
        className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-2xl p-6"
      >
        <h3 className="text-white font-bold text-lg mb-2">How It Works</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-bold flex-shrink-0">1</div>
            <div>
              <p className="text-white font-bold">Share Your Link</p>
              <p className="text-slate-400">Post your unique link on social media, YouTube, or send it directly.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-bold flex-shrink-0">2</div>
            <div>
              <p className="text-white font-bold">They Subscribe</p>
              <p className="text-slate-400">When someone signs up through your link, you get credited automatically.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-bold flex-shrink-0">3</div>
            <div>
              <p className="text-white font-bold">Earn Recurring</p>
              <p className="text-slate-400">Get up to 50% recurring commissions every month they stay subscribed.</p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
