import { useQuery } from "@tanstack/react-query";
import { useAccount, getPrimaryAccountId } from "@/hooks/use-account";
import type { SubAccount } from "@shared/schema";
import { Building2, Plus } from "lucide-react";
import { Link } from "wouter";

interface AccountRequiredProps {
  children: React.ReactNode;
}

export function AccountRequired({ children }: AccountRequiredProps) {
  const { activeAccountId, setActiveAccountId } = useAccount();
  const { data: accounts = [], isLoading } = useQuery<SubAccount[]>({ queryKey: ["/api/accounts"] });

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]" data-testid="status-loading-accounts">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-400">Loading accounts...</p>
        </div>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="p-4 md:p-8 flex items-center justify-center min-h-[60vh]" data-testid="status-no-accounts">
        <div className="text-center space-y-6 max-w-md">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 border border-cyan-500/30 flex items-center justify-center mx-auto">
            <Building2 size={32} className="text-cyan-400" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white mb-2">Welcome to Apex</h2>
            <p className="text-slate-400">
              Create your first sub-account to get started. Each account gives you a complete business management suite.
            </p>
          </div>
          <Link href="/onboarding">
            <button
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-700 hover:to-indigo-700 text-white font-bold transition-all shadow-lg shadow-cyan-500/25"
              data-testid="button-create-first-account"
            >
              <Plus size={18} />
              Create Your First Account
            </button>
          </Link>
        </div>
      </div>
    );
  }

  if (!activeAccountId || !accounts.find(a => a.id === activeAccountId)) {
    if (accounts.length > 0 && !activeAccountId) {
      setActiveAccountId(getPrimaryAccountId(accounts)!);
    }
  }

  return <>{children}</>;
}

export function useActiveSubAccountId(): number | null {
  const { activeAccountId } = useAccount();
  const { data: accounts = [] } = useQuery<SubAccount[]>({ queryKey: ["/api/accounts"] });
  const match = accounts.find(a => a.id === activeAccountId);
  if (match) return match.id;
  return getPrimaryAccountId(accounts);
}
