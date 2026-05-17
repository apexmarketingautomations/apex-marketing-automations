import { useActiveSubAccountId } from "@/components/account-required";
import { useQuery } from "@tanstack/react-query";
import { hasFeature } from "@shared/schema";
import type { SubAccount } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { Lock, ArrowUpCircle } from "lucide-react";
import { Link } from "wouter";

interface PlanGateProps {
  feature: string;
  children: React.ReactNode;
  featureLabel?: string;
  pageName?: string;
}

export function PlanGate({ feature, children, featureLabel }: PlanGateProps) {
  const { user } = useAuth();
  const isAdmin = user?.isAdmin === "true" || (user as any)?.role === "DEV_ADMIN";
  const activeId = useActiveSubAccountId();
  const { data: accounts = [] } = useQuery<SubAccount[]>({ queryKey: ["/api/accounts"] });
  const currentAccount = activeId ? accounts.find(a => a.id === activeId) : null;
  const accountPlan = isAdmin ? "enterprise" : (currentAccount?.plan || "starter");

  if (isAdmin) {
    return <>{children}</>;
  }

  if (!activeId) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <p className="text-slate-400" data-testid="text-select-account">Select a sub-account from the sidebar to continue.</p>
        </div>
      </div>
    );
  }

  if (hasFeature(accountPlan, feature)) {
    return <>{children}</>;
  }

  const planName = accountPlan.charAt(0).toUpperCase() + accountPlan.slice(1);
  const displayLabel = featureLabel || feature.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div className="p-4 md:p-8 flex items-center justify-center min-h-[60vh]" data-testid="status-plan-locked">
      <div className="text-center space-y-6 max-w-md">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/30 flex items-center justify-center mx-auto">
          <Lock size={32} className="text-amber-400" />
        </div>
        <div>
          <h2 className="text-2xl font-black text-white mb-2" data-testid="text-locked-title">
            {displayLabel} Requires Upgrade
          </h2>
          <p className="text-slate-400">
            This feature is not included in your current <span className="text-white font-semibold">{planName}</span> plan.
            Upgrade to access {displayLabel.toLowerCase()} and more powerful tools.
          </p>
        </div>
        <Link href="/pricing">
          <button
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white font-bold transition-all shadow-lg shadow-violet-500/25"
            data-testid="button-upgrade-plan"
          >
            <ArrowUpCircle size={18} />
            View Plans & Upgrade
          </button>
        </Link>
        <p className="text-xs text-slate-500">
          Available on Pro and Enterprise plans
        </p>
      </div>
    </div>
  );
}

export function useAccountPlan(): string {
  const activeId = useActiveSubAccountId();
  const { data: accounts = [] } = useQuery<SubAccount[]>({ queryKey: ["/api/accounts"] });
  const currentAccount = activeId ? accounts.find(a => a.id === activeId) : null;
  return currentAccount?.plan || "starter";
}
