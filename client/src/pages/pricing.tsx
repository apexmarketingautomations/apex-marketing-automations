import { useState } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Check, Zap, Crown, Rocket, Shield, Star, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const tiers = [
  {
    id: "starter",
    name: "Starter AI",
    price: 97,
    badge: "Perfect Start",
    color: "from-blue-500 to-cyan-500",
    borderColor: "border-blue-500/30",
    glowColor: "shadow-blue-500/20",
    icon: Zap,
    description: "Perfect for single business owners getting started with AI automation.",
    features: [
      "1 Sub-Account",
      "Unified Inbox (SMS, Email)",
      "AI Site Builder",
      "Basic Workflows (3 active)",
      "Bot Trainer (1 bot)",
      "$10 AI Credits/mo",
      "Community Support",
    ],
    limits: { subAccounts: 1, workflows: 3, bots: 1 },
  },
  {
    id: "agency_pro",
    name: "Agency Pro",
    price: 297,
    badge: "Most Popular",
    color: "from-purple-500 to-pink-500",
    borderColor: "border-purple-500/30",
    glowColor: "shadow-purple-500/20",
    icon: Crown,
    featured: true,
    description: "Unlimited sub-accounts and AI Voice Agents for growing agencies.",
    features: [
      "Unlimited Sub-Accounts",
      "AI Voice Agents + Power Dialer",
      "Snapshot System + Versioning",
      "Unlimited Workflows",
      "Unlimited Bot Training",
      "$25 AI Credits/mo",
      "Affiliate Dashboard",
      "Priority Support",
    ],
    limits: { subAccounts: -1, workflows: -1, bots: -1 },
  },
  {
    id: "god_mode",
    name: "God Mode",
    price: 497,
    badge: "Founder Edition",
    color: "from-amber-500 to-orange-500",
    borderColor: "border-amber-500/30",
    glowColor: "shadow-amber-500/20",
    icon: Rocket,
    description: "White-labeling, Snapshot Marketplace, and the full empire-building toolkit.",
    features: [
      "Everything in Agency Pro",
      "White-Label Branding",
      "Snapshot Marketplace Access",
      "God Mode One-Click Deploy",
      "Bulk Rollback (100+ accounts)",
      "$50 AI Credits/mo",
      "Agency Command Center",
      "Custom Domain Mapping",
      "Dedicated Founder Support",
    ],
    limits: { subAccounts: -1, workflows: -1, bots: -1 },
  },
];

export default function Pricing() {
  const { toast } = useToast();

  const { data: subscription } = useQuery<any>({
    queryKey: ["/api/subscription"],
  });

  const checkoutMutation = useMutation({
    mutationFn: async (tier: string) => {
      const res = await apiRequest("POST", "/api/subscription/checkout", { tier });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: () => {
      toast({ title: "Checkout failed", description: "Could not create checkout session. Please try again.", variant: "destructive" });
    },
  });

  const currentTier = subscription?.planTier || "free";

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-bold uppercase tracking-widest mb-4">
          <Star size={12} /> 60-Day Founders Launch
        </div>
        <h1 className="text-4xl md:text-5xl font-black text-white mb-4" data-testid="text-pricing-title">
          Choose Your <span className="bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">Power Level</span>
        </h1>
        <p className="text-slate-400 text-lg max-w-2xl mx-auto">
          60 days for the price of 30. Plus $50 in AI credits to get you through the setup phase.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        {tiers.map((tier, i) => (
          <motion.div
            key={tier.id}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className={`relative rounded-2xl border ${tier.borderColor} bg-black/40 backdrop-blur-md p-6 flex flex-col ${tier.featured ? `ring-2 ring-purple-500/50 ${tier.glowColor} shadow-2xl scale-[1.02]` : ""}`}
            data-testid={`card-tier-${tier.id}`}
          >
            {tier.featured && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-bold uppercase tracking-widest">
                {tier.badge}
              </div>
            )}

            <div className="flex items-center gap-3 mb-4 mt-2">
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${tier.color} flex items-center justify-center`}>
                <tier.icon size={20} className="text-white" />
              </div>
              <div>
                <h3 className="text-white font-bold text-lg">{tier.name}</h3>
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{tier.badge}</p>
              </div>
            </div>

            <div className="mb-4">
              <span className="text-4xl font-black text-white">${tier.price}</span>
              <span className="text-slate-400 text-sm">/mo</span>
            </div>

            <p className="text-slate-400 text-sm mb-6">{tier.description}</p>

            <div className="space-y-3 flex-1 mb-6">
              {tier.features.map((feature) => (
                <div key={feature} className="flex items-start gap-2">
                  <Check size={16} className={`mt-0.5 flex-shrink-0 ${tier.featured ? "text-purple-400" : "text-cyan-400"}`} />
                  <span className="text-sm text-slate-300">{feature}</span>
                </div>
              ))}
            </div>

            <button
              onClick={() => checkoutMutation.mutate(tier.id)}
              disabled={checkoutMutation.isPending || currentTier === tier.id}
              className={`w-full py-3 rounded-xl font-bold text-sm uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
                currentTier === tier.id
                  ? "bg-green-500/20 text-green-400 border border-green-500/30 cursor-default"
                  : tier.featured
                    ? `bg-gradient-to-r ${tier.color} text-white hover:opacity-90`
                    : "bg-white/10 text-white border border-white/10 hover:bg-white/20"
              }`}
              data-testid={`button-subscribe-${tier.id}`}
            >
              {currentTier === tier.id ? (
                <>
                  <Shield size={16} /> Current Plan
                </>
              ) : (
                <>
                  {checkoutMutation.isPending ? "Processing..." : "Start 60-Day Trial"}
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </motion.div>
        ))}
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="text-center">
        <div className="inline-flex flex-col items-center gap-2 px-8 py-4 rounded-2xl bg-white/5 border border-white/10">
          <p className="text-white font-bold">The 60-Day Founders Launch Deal</p>
          <p className="text-slate-400 text-sm max-w-lg">
            Every plan includes 60 days for the price of 30 + $50 in AI credits.
            No risk — cancel anytime within your trial.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
