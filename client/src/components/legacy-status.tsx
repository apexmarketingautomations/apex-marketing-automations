import { useQuery } from "@tanstack/react-query";
import { Shield, AlertTriangle, Crown } from "lucide-react";
import { Link } from "wouter";

export function LegacyStatusBadge() {
  const { data: subscription } = useQuery<any>({
    queryKey: ["/api/subscription"],
  });

  if (!subscription || subscription.planTier === "free") return null;

  const isAtRisk = subscription.paymentStatus === "failed";
  const isRevoked = subscription.paymentStatus === "revoked";
  const isGrandfathered = subscription.isGrandfathered;

  if (isAtRisk) {
    return (
      <div className="mx-2 md:mx-4 mb-2" data-testid="hud-at-risk">
        <div className="border border-red-600 shadow-[0_0_15px_rgba(239,68,68,0.3)] bg-red-950/50 rounded-xl p-3 animate-pulse">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={14} className="text-red-500" />
            <span className="text-[10px] font-black text-red-400 uppercase tracking-widest">Legacy Status at Risk</span>
          </div>
          <p className="text-[11px] text-red-300/80 leading-relaxed">
            Payment failed. Update your card within 72 hours or your grandfathered rate will be permanently revoked.
          </p>
          <Link
            href="/billing"
            className="mt-2 block text-center text-[10px] font-black text-black bg-red-500 hover:bg-red-400 rounded-lg py-1.5 uppercase tracking-widest transition-colors"
            data-testid="link-update-payment"
          >
            Update Payment Now
          </Link>
        </div>
      </div>
    );
  }

  if (isRevoked) {
    return (
      <div className="mx-2 md:mx-4 mb-2" data-testid="hud-revoked">
        <div className="border border-gray-600/50 bg-gray-900/50 rounded-xl p-3">
          <div className="flex items-center gap-2">
            <Shield size={14} className="text-gray-500" />
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Legacy Status Lost</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            Resubscribe at current rates to restore access.
          </p>
        </div>
      </div>
    );
  }

  if (isGrandfathered) {
    return (
      <div className="mx-2 md:mx-4 mb-2" data-testid="hud-legacy-member">
        <div className="border border-cyan-500/30 bg-cyan-950/20 rounded-xl p-2.5 flex items-center gap-2.5 shadow-[0_0_10px_rgba(6,182,212,0.08)]">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center flex-shrink-0">
            <Crown size={14} className="text-white" />
          </div>
          <div className="hidden md:block">
            <p className="text-[10px] font-black text-cyan-400 uppercase tracking-[0.3em] leading-none">Legacy Member</p>
            <p className="text-[9px] text-gray-500 mt-0.5">Grandfathered rate locked for life</p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
