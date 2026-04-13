import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  BookOpen, TrendingUp, Zap, Target, Users, RefreshCw,
  ChevronRight, Loader2, Layers, ArrowUpRight
} from "lucide-react";
import { useAccount } from "@/hooks/use-account";

interface PlaybookPattern {
  id: string;
  title: string;
  description: string;
  modulesCombination: string[];
  performanceMultiplier: number;
  accountCount: number;
  confidence: number;
  category: "conversion" | "engagement" | "revenue" | "automation";
  recommendedFor: string[];
}

interface PlaybookResponse {
  patterns: PlaybookPattern[];
  missingModules: string[];
  topRecommendation: string;
}

const CATEGORY_CONFIG = {
  conversion: { color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", icon: TrendingUp },
  engagement: { color: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/20", icon: Users },
  revenue: { color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20", icon: Target },
  automation: { color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20", icon: Zap },
};

const MODULE_LINKS: Record<string, string> = {
  workflows: "/workflows",
  ai_workflows: "/workflows",
  email_campaigns: "/email-campaigns",
  campaigns: "/email-campaigns",
  digital_cards: "/digital-cards",
  pipeline: "/pipeline",
  reputation: "/reputation",
  "email campaigns": "/email-campaigns",
  "digital cards": "/digital-cards",
};

export function PlaybookTab({ subAccountId: propSubAccountId }: { subAccountId?: number }) {
  const { activeAccountId } = useAccount();
  const subAccountId = propSubAccountId ?? activeAccountId;
  const [, setLocation] = useLocation();

  const { data, isLoading, refetch } = useQuery<PlaybookResponse>({
    queryKey: ["/api/apex/playbooks", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/apex/playbooks/${subAccountId}`);
      if (!res.ok) return { patterns: [], missingModules: [], topRecommendation: "" };
      return res.json();
    },
    enabled: !!subAccountId,
    refetchInterval: 300_000,
  });

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-violet-400" />
      </div>
    );
  }

  const patterns = data?.patterns ?? [];
  const missingModules = data?.missingModules ?? [];
  const topRec = data?.topRecommendation ?? "";

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin" data-testid="panel-playbooks">
      <div className="px-3 py-2 flex items-center justify-between border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <BookOpen size={10} className="text-violet-400" />
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Playbooks</span>
        </div>
        <button
          onClick={() => refetch()}
          className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
          data-testid="button-playbook-refresh"
        >
          <RefreshCw size={10} />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {topRec && (
          <div className="p-3 rounded-xl bg-violet-500/[0.07] border border-violet-500/15">
            <div className="flex items-start gap-2">
              <Layers size={11} className="text-violet-400 mt-0.5 shrink-0" />
              <p className="text-[10px] text-slate-300 leading-relaxed">{topRec}</p>
            </div>
          </div>
        )}

        {missingModules.length > 0 && (
          <div className="space-y-1">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Unlock More Power</p>
            <div className="flex flex-wrap gap-1">
              {missingModules.map(module => (
                <button
                  key={module}
                  onClick={() => {
                    const link = MODULE_LINKS[module];
                    if (link) setLocation(link);
                  }}
                  className="flex items-center gap-1 text-[8px] px-2 py-1 rounded border border-violet-500/20 text-violet-400 bg-violet-500/10 hover:bg-violet-500/20 transition-colors"
                  data-testid={`module-unlock-${module.replace(/\s+/g, "-")}`}
                >
                  <Zap size={7} />
                  {module}
                  <ArrowUpRight size={7} />
                </button>
              ))}
            </div>
          </div>
        )}

        {patterns.length === 0 ? (
          <div className="text-center py-8 space-y-2">
            <BookOpen size={28} className="mx-auto text-slate-700" />
            <p className="text-[11px] text-slate-600">All high-value playbooks active</p>
            <p className="text-[9px] text-slate-700">Your account is using the optimal module combinations</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Recommended Playbooks</p>
            {patterns.map((pattern, i) => {
              const catCfg = CATEGORY_CONFIG[pattern.category] || CATEGORY_CONFIG.conversion;
              const PatternIcon = catCfg.icon;
              const mult = pattern.performanceMultiplier;
              const multDisplay = mult >= 2 ? `${mult.toFixed(1)}x` : `+${Math.round((mult - 1) * 100)}%`;

              return (
                <motion.div
                  key={pattern.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className={`p-3 rounded-xl border ${catCfg.bg} cursor-default`}
                  data-testid={`playbook-${pattern.id}`}
                >
                  <div className="flex items-start gap-2">
                    <PatternIcon size={12} className={catCfg.color} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <p className="text-[11px] text-white font-semibold">{pattern.title}</p>
                        <span className={`text-[8px] font-bold px-1 py-px rounded ${catCfg.color} bg-white/5`}>
                          {multDisplay}
                        </span>
                      </div>
                      <p className="text-[9px] text-slate-400 leading-relaxed mb-2">{pattern.description}</p>

                      <div className="flex flex-wrap gap-1 mb-2">
                        {pattern.modulesCombination.map(mod => (
                          <span
                            key={mod}
                            className="text-[7px] px-1.5 py-px rounded bg-white/5 text-slate-500 border border-white/[0.06]"
                          >
                            {mod.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1 bg-white/[0.04] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${catCfg.color.replace("text-", "bg-")}`}
                            style={{ width: `${Math.round(pattern.confidence * 100)}%` }}
                          />
                        </div>
                        <span className="text-[7px] text-slate-600">{Math.round(pattern.confidence * 100)}% confidence</span>
                        <span className="text-[7px] text-slate-700">{pattern.accountCount} accounts</span>
                      </div>

                      <div className="flex flex-wrap gap-1 mt-2">
                        {pattern.modulesCombination.map(mod => {
                          const link = MODULE_LINKS[mod];
                          if (!link) return null;
                          return (
                            <button
                              key={mod}
                              onClick={() => setLocation(link)}
                              className="flex items-center gap-0.5 text-[7px] text-slate-500 hover:text-violet-400 transition-colors"
                              data-testid={`playbook-nav-${mod}`}
                            >
                              Go to {mod.replace(/_/g, " ")} <ChevronRight size={7} />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
