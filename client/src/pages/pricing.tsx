import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Shield, ArrowRight, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";

// Paused for the live event window. Restore to true to resume Blitz pricing.
const BLITZ_ACTIVE = false;

const tiers = [
  {
    id: "starter",
    name: "Starter AI",
    legacyName: "Starter Legacy",
    monthly: 97,
    yearly: 77,
    blitzPrice: 48,
    description: "Complete automation for the solo entrepreneur.",
    features: [
      "1 Master Sub-Account",
      "Unified Cyber-Inbox",
      "Liquid Vibe Site Builder",
      "AI Review Buffer",
      "Basic Workflows (3 active)",
      "Bot Trainer (1 bot)",
      "$10 AI Credits/mo",
    ],
    cta: "Start 30-Day Trial",
    blitzCta: "Claim Legacy Rate",
    glow: "border-white/10",
    gradientBorder: "from-gray-500 to-white",
  },
  {
    id: "pro",
    name: "Pro",
    legacyName: "Pro Legacy",
    monthly: 297,
    yearly: 237,
    blitzPrice: 148,
    description: "Build an empire with unlimited sub-accounts.",
    features: [
      "Unlimited Sub-Accounts",
      "Ghost SDR (Parallel Dialer)",
      "Full Snapshot Marketplace",
      "Snapshot Forking & Cloning",
      "Advanced Vibe Theming",
      "Unlimited Workflows",
      "$25 AI Credits/mo",
      "Affiliate Dashboard",
    ],
    cta: "Go Pro (30 Days Free)",
    blitzCta: "Secure Grandfather Status",
    glow: "border-cyan-500/50 shadow-[0_0_20px_rgba(6,182,212,0.2)]",
    gradientBorder: "from-cyan-500 to-blue-600",
    popular: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    legacyName: "Enterprise Legacy",
    monthly: 497,
    yearly: 397,
    blitzPrice: 248,
    description: "Total White-Label dominance. Zero limits.",
    features: [
      "Full White-Labeling",
      "Your Custom Domain",
      "Marketplace Profit Sharing",
      "Sentinel Global Rules",
      "Bulk Rollback Controls",
      "Agency Command Center",
      "$50 AI Credits/mo",
      "Priority Founder Support",
    ],
    cta: "Activate God Mode",
    blitzCta: "Unlock God Mode",
    glow: "border-purple-500/50 shadow-[0_0_20px_rgba(168,85,247,0.2)]",
    gradientBorder: "from-purple-500 to-red-500",
  },
];

export default function Pricing() {
  const [isYearly, setIsYearly] = useState(false);
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();

  const { data: subscription } = useQuery<any>({
    queryKey: ["/api/subscription"],
    enabled: isAuthenticated,
  });

  const checkoutMutation = useMutation({
    mutationFn: async ({ tier, interval }: { tier: string; interval: string }) => {
      if (!isAuthenticated) {
        window.location.href = "/login";
        return;
      }
      const res = await apiRequest("POST", "/api/subscription/checkout", { tier, interval, isBlitz: BLITZ_ACTIVE });
      return res.json();
    },
    onSuccess: (data) => {
      if (data?.url) window.location.href = data.url;
    },
    onError: () => {
      toast({ title: "Checkout failed", description: "Could not create checkout session.", variant: "destructive" });
    },
  });

  const currentTier = subscription?.planTier || "free";

  const getDisplayPrice = (tier: typeof tiers[0]) => {
    if (BLITZ_ACTIVE) return tier.blitzPrice;
    return isYearly ? tier.yearly : tier.monthly;
  };

  const getOriginalPrice = (tier: typeof tiers[0]) => {
    if (BLITZ_ACTIVE) return isYearly ? tier.yearly : tier.monthly;
    return null;
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: isAuthenticated ? "transparent" : "#030014" }}>
      {!isAuthenticated && (
        <>
          <div className="fixed inset-0 bg-grid z-0 pointer-events-none" />
          <nav className="sticky top-0 z-50 bg-black/60 backdrop-blur-xl border-b border-white/5">
            <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
              <Link href="/" className="flex items-center gap-3">
                <img src="/apex-logo.png" alt="Apex" className="w-8 h-8" />
                <span className="font-black text-white tracking-tight hidden sm:block">APEX <span className="text-indigo-400 font-light text-xs">MARKETING AUTOMATIONS</span></span>
              </Link>
              <a href="/login" className="px-5 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-bold rounded-lg" data-testid="button-pricing-login">Sign In</a>
            </div>
          </nav>
        </>
      )}
    <div className="p-6 md:p-10 max-w-7xl mx-auto relative z-10">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-16">
        {BLITZ_ACTIVE && (
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="inline-block px-4 py-1 rounded-full border border-red-500/50 bg-red-500/10 text-red-500 text-[10px] font-black uppercase tracking-[0.4em] mb-6 animate-pulse"
            data-testid="badge-blitz-active"
          >
            Live Event: 30-Day Launch Blitz
          </motion.div>
        )}

        <h1 className="text-5xl md:text-7xl font-black uppercase tracking-tighter mb-4 leading-none" data-testid="text-pricing-title">
          {BLITZ_ACTIVE ? (
            <>
              Grandfathered <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-purple-500 to-red-500">
                For Life.
              </span>
            </>
          ) : (
            <>
              Choose Your <span className="text-cyan-400">Level of Power</span>
            </>
          )}
        </h1>
        <p className="text-gray-400 text-lg max-w-2xl mx-auto mb-8">
          {BLITZ_ACTIVE
            ? <>The 30-day window is open. Secure <span className="text-white font-bold">50% off all tiers</span> forever. If you stay active, your price never changes. Ever.</>
            : "Lock in our 30-Day Founder's Deal. Full access to every tier with no risk."}
        </p>

        {!BLITZ_ACTIVE && (
          <div className="flex items-center justify-center gap-4">
            <span className={`text-sm transition-colors ${!isYearly ? "text-white" : "text-gray-500"}`}>Monthly</span>
            <button
              onClick={() => setIsYearly(!isYearly)}
              className="w-14 h-7 bg-white/10 rounded-full relative p-1 transition-all"
              data-testid="button-billing-toggle"
            >
              <motion.div
                layout
                className="w-5 h-5 bg-cyan-500 rounded-full shadow-[0_0_10px_#22d3ee]"
                animate={{ x: isYearly ? 28 : 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              />
            </button>
            <span className={`text-sm transition-colors ${isYearly ? "text-white" : "text-gray-500"}`}>
              Yearly <span className="text-green-400 text-xs font-bold ml-1">(Save 20%)</span>
            </span>
          </div>
        )}
      </motion.div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
        {tiers.map((tier, i) => {
          const displayPrice = getDisplayPrice(tier);
          const originalPrice = getOriginalPrice(tier);
          const isCurrentPlan = currentTier === tier.id;

          return (
            <motion.div
              key={tier.id}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              data-testid={`card-tier-${tier.id}`}
            >
              {BLITZ_ACTIVE ? (
                <div className={`relative group p-[1px] rounded-3xl bg-gradient-to-b ${tier.gradientBorder} transition-all duration-500 hover:scale-[1.02]`}>
                  <div className="bg-[#080808] rounded-[23px] p-8 h-full flex flex-col relative overflow-hidden">
                    <div className={`absolute -top-24 -right-24 w-48 h-48 bg-gradient-to-br ${tier.gradientBorder} opacity-10 blur-3xl group-hover:opacity-20 transition-opacity`} />

                    {tier.popular && (
                      <span className="absolute top-4 right-4 bg-cyan-500 text-black text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest">
                        Most Popular
                      </span>
                    )}

                    <h3 className="text-sm font-black text-gray-500 uppercase tracking-[0.3em] mb-2">
                      {BLITZ_ACTIVE ? tier.legacyName : tier.name}
                    </h3>
                    <div className="flex items-baseline gap-3 mb-4">
                      <span className="text-5xl font-black text-white">${displayPrice}</span>
                      {originalPrice && (
                        <span className="text-gray-500 line-through text-xl">${originalPrice}</span>
                      )}
                      <span className="text-cyan-500 font-mono text-xs">/mo</span>
                    </div>

                    <p className="text-gray-400 text-sm mb-8 leading-relaxed">{tier.description}</p>

                    <ul className="space-y-4 mb-10 flex-grow">
                      {tier.features.map((f) => (
                        <li key={f} className="flex items-start gap-3 text-sm text-gray-300">
                          <span className="text-cyan-400 mt-1">&#9657;</span> {f}
                        </li>
                      ))}
                    </ul>

                    <button
                      onClick={() => checkoutMutation.mutate({ tier: tier.id, interval: isYearly ? "yearly" : "monthly" })}
                      disabled={checkoutMutation.isPending || isCurrentPlan}
                      className={`w-full py-4 rounded-xl font-black uppercase tracking-widest transition-all shadow-lg ${
                        isCurrentPlan
                          ? "bg-green-500/20 text-green-400 border border-green-500/30 cursor-default"
                          : tier.popular
                            ? "bg-white text-black hover:bg-cyan-400"
                            : "bg-transparent border border-white/20 text-white hover:bg-white/5"
                      }`}
                      data-testid={`button-subscribe-${tier.id}`}
                    >
                      {isCurrentPlan ? (
                        <span className="flex items-center justify-center gap-2"><Shield size={16} /> Current Plan</span>
                      ) : checkoutMutation.isPending ? "Processing..." : (BLITZ_ACTIVE ? tier.blitzCta : tier.cta)}
                    </button>
                    <p className="text-[9px] text-center text-gray-600 mt-4 uppercase tracking-widest">
                      Usage billed at wholesale + standard markup
                    </p>
                  </div>
                </div>
              ) : (
                <div className={`relative bg-white/5 backdrop-blur-xl border ${tier.glow} rounded-3xl p-8 flex flex-col h-full`}>
                  {tier.popular && (
                    <span className="absolute -top-4 left-1/2 -translate-x-1/2 bg-cyan-500 text-black text-[10px] font-black px-4 py-1 rounded-full uppercase tracking-widest">
                      Most Popular
                    </span>
                  )}

                  <h3 className="text-2xl font-bold mb-2 uppercase tracking-tight">{tier.name}</h3>
                  <p className="text-gray-400 text-sm mb-6 h-12">{tier.description}</p>

                  <div className="mb-8">
                    <span className="text-5xl font-black">${displayPrice}</span>
                    <span className="text-gray-500 ml-2">/mo</span>
                    {isYearly && (
                      <p className="text-cyan-400 text-xs mt-2 font-mono">Billed annually (${tier.yearly * 12}/yr)</p>
                    )}
                  </div>

                  <ul className="space-y-4 mb-8 flex-grow text-sm text-gray-300">
                    {tier.features.map((f) => (
                      <li key={f} className="flex items-center gap-2">
                        <span className="text-cyan-500">&#10004;</span> {f}
                      </li>
                    ))}
                  </ul>

                  <button
                    onClick={() => checkoutMutation.mutate({ tier: tier.id, interval: isYearly ? "yearly" : "monthly" })}
                    disabled={checkoutMutation.isPending || isCurrentPlan}
                    className={`w-full py-4 rounded-xl font-black uppercase tracking-widest transition-all ${
                      isCurrentPlan
                        ? "bg-green-500/20 text-green-400 border border-green-500/30 cursor-default"
                        : tier.popular
                          ? "bg-cyan-500 text-black hover:bg-cyan-400"
                          : "bg-white/10 text-white hover:bg-white/20 border border-white/10"
                    }`}
                    data-testid={`button-subscribe-${tier.id}`}
                  >
                    {isCurrentPlan ? (
                      <span className="flex items-center justify-center gap-2"><Shield size={16} /> Current Plan</span>
                    ) : checkoutMutation.isPending ? "Processing..." : tier.cta}
                  </button>
                  <p className="text-[10px] text-center text-gray-600 mt-4 uppercase font-bold tracking-widest">
                    Includes $50 AI Launch Credit
                  </p>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {BLITZ_ACTIVE ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="flex flex-col items-center">
          <div className="w-full max-w-md bg-white/5 h-1 rounded-full overflow-hidden mb-4">
            <motion.div
              className="bg-gradient-to-r from-cyan-500 to-purple-600 h-full"
              initial={{ width: 0 }}
              animate={{ width: "88%" }}
              transition={{ duration: 1.5, ease: "easeOut" }}
            />
          </div>
          <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest" data-testid="text-founder-slots">
            Limited Founders Slots: 12 / 100 Remaining
          </p>
        </motion.div>
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="text-center border-t border-white/5 pt-10">
          <p className="text-gray-500 text-xs font-mono uppercase tracking-[0.5em]" data-testid="text-founder-status">
            Current Global Status: 4/5 Founder Spots Remaining
          </p>
        </motion.div>
      )}
    </div>
    </div>
  );
}
