import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

interface IntelligenceCase {
  id: number;
  caseKey: string;
  title: string;
  category: string;
  incidentWindow: string;
  signalCount: number;
  compositeScore: number;
  opportunityScore: number;
  urgencyScore: number;
  financialScore: number;
  outreachViability: number;
  consumerImpact: number;
  legalSeverity: number;
  localRelevance: number;
  actionable: boolean;
  status: string;
  operatorNotes?: string;
  aiSummary?: string;
  outreachAngle?: string;
  recommendedVertical?: string;
  timeline?: Array<{ date: string; type: string; description: string; caseNumber?: string }>;
  latestSignalAt?: string;
  affectedProducts?: string[];
}

interface CaseWithEntity {
  case: IntelligenceCase;
  entity?: { id: number; canonicalName: string; entityType: string; county?: string; aliases: string[] };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<string, { emoji: string; label: string; color: string; bg: string; border: string }> = {
  recall:   { emoji: "⚠️",  label: "Recall",         color: "text-red-400",    bg: "bg-red-500/10",    border: "border-red-500/20" },
  osha:     { emoji: "🏭",  label: "OSHA",           color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20" },
  arrest:   { emoji: "🚔",  label: "Arrest",         color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20" },
  court:    { emoji: "⚖️",  label: "Court Filing",   color: "text-blue-400",   bg: "bg-blue-500/10",   border: "border-blue-500/20" },
  license:  { emoji: "📋",  label: "License",        color: "text-amber-400",  bg: "bg-amber-500/10",  border: "border-amber-500/20" },
  business: { emoji: "🏢",  label: "Business",       color: "text-teal-400",   bg: "bg-teal-500/10",   border: "border-teal-500/20" },
  other:    { emoji: "📌",  label: "Other",          color: "text-slate-400",  bg: "bg-slate-500/10",  border: "border-slate-500/20" },
};

const STATUS_STAGES = ["open", "reviewing", "actioned", "suppressed"];

function scoreBar(value: number, color = "bg-violet-500") {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-white/10 rounded-full h-1">
        <div className={`h-1 rounded-full ${color}`} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className="text-xs text-slate-400 w-6 text-right">{value}</span>
    </div>
  );
}

// ── Case Drawer ────────────────────────────────────────────────────────────────

function CaseDrawer({ row, onClose }: { row: CaseWithEntity; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const c = row.case;
  const e = row.entity;
  const cat = CATEGORY_CONFIG[c.category] || CATEGORY_CONFIG.other;
  const [notes, setNotes] = useState(c.operatorNotes || "");
  const [generating, setGenerating] = useState(false);
  const [localSummary, setLocalSummary] = useState(c.aiSummary || "");

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest("PATCH", `/api/cases/${c.id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/cases"] }),
  });

  async function generateSummary() {
    setGenerating(true);
    try {
      const prompt = `Summarise this intelligence case and give one specific outreach angle for a law firm or marketer:
Entity: ${e?.canonicalName || c.title}
Category: ${c.category}
Signal count: ${c.signalCount} over ${c.incidentWindow}
Opportunity score: ${c.opportunityScore}/100
Financial exposure: ${c.financialScore}/100
Consumer impact: ${c.consumerImpact}/100
Legal severity: ${c.legalSeverity}/100
Timeline: ${JSON.stringify((c.timeline || []).slice(0, 3))}
Reply in 2-3 sentences max.`;

      const res = await apiRequest("POST", "/api/ai/chat", {
        messages: [
          { role: "system", content: "You are a concise legal/marketing intelligence analyst." },
          { role: "user", content: prompt },
        ],
        maxTokens: 150,
        route: "case-summary",
      });
      const summary = res.text || "AI summary unavailable.";
      setLocalSummary(summary);
      patch.mutate({ aiSummary: summary });
    } catch {
      setLocalSummary("AI provider not available. Check Provider Config tab.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 280 }}
        className="relative z-10 w-full max-w-lg bg-[#0d0f14] border-l border-white/10 overflow-y-auto flex flex-col"
      >
        {/* Header */}
        <div className={`p-5 border-b border-white/10 ${cat.bg}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="text-3xl mt-0.5">{cat.emoji}</span>
              <div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-0.5">
                  {cat.label} · {c.incidentWindow} · {c.signalCount} signal{c.signalCount !== 1 ? "s" : ""}
                </div>
                <h2 className="text-white font-black text-lg leading-tight">{e?.canonicalName || c.title}</h2>
                {e?.aliases && e.aliases.length > 1 && (
                  <div className="text-xs text-slate-500 mt-0.5">
                    Also known as: {e.aliases.filter((a, i) => i > 0).slice(0, 3).join(", ")}
                  </div>
                )}
              </div>
            </div>
            <button onClick={onClose} className="text-slate-500 hover:text-white text-xl flex-shrink-0">✕</button>
          </div>

          {/* Composite score bar */}
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 bg-white/10 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${c.compositeScore >= 70 ? "bg-green-400" : c.compositeScore >= 45 ? "bg-amber-400" : "bg-red-400"}`}
                style={{ width: `${c.compositeScore}%` }}
              />
            </div>
            <span className="text-sm font-black text-white">{c.compositeScore}/100</span>
            {c.actionable && (
              <span className="text-xs font-black px-2 py-0.5 rounded bg-green-500/20 text-green-400 border border-green-500/30">ACTIONABLE</span>
            )}
          </div>
        </div>

        <div className="flex-1 p-5 space-y-5">
          {/* Stage */}
          <div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Case Status</div>
            <div className="flex gap-2">
              {STATUS_STAGES.map(s => (
                <button
                  key={s}
                  onClick={() => patch.mutate({ status: s })}
                  className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all capitalize ${
                    c.status === s
                      ? "bg-violet-500/20 text-violet-300 border-violet-500/30"
                      : "bg-white/5 text-slate-500 border-white/10 hover:border-white/20"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Opportunity scorecard */}
          <div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Opportunity Scores</div>
            <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-2.5">
              {[
                { label: "Financial Exposure",  val: c.financialScore,    color: "bg-green-500" },
                { label: "Urgency",             val: c.urgencyScore,      color: "bg-red-400" },
                { label: "Outreach Viability",  val: c.outreachViability, color: "bg-blue-400" },
                { label: "Consumer Impact",     val: c.consumerImpact,    color: "bg-amber-400" },
                { label: "Legal Severity",      val: c.legalSeverity,     color: "bg-purple-400" },
                { label: "Local Relevance",     val: c.localRelevance,    color: "bg-teal-400" },
              ].map(({ label, val, color }) => (
                <div key={label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-400">{label}</span>
                  </div>
                  {scoreBar(val, color)}
                </div>
              ))}
            </div>
          </div>

          {/* Entity profile */}
          <div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Entity Profile</div>
            <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-sm space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Type</span>
                <span className="text-slate-300 capitalize">{e?.entityType || "company"}</span>
              </div>
              {e?.county && (
                <div className="flex justify-between">
                  <span className="text-slate-500">County</span>
                  <span className="text-slate-300">{e.county}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">Recommended Vertical</span>
                <span className="text-slate-300 capitalize">{c.recommendedVertical?.replace("_", " ") || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Incident Window</span>
                <span className="text-slate-300">{c.incidentWindow}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Signals Grouped</span>
                <span className="text-white font-bold">{c.signalCount}</span>
              </div>
            </div>
          </div>

          {/* Timeline */}
          {(c.timeline?.length ?? 0) > 0 && (
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Incident Timeline</div>
              <div className="space-y-2">
                {(c.timeline || []).slice(0, 6).map((ev, i) => (
                  <div key={i} className="flex gap-3 text-sm">
                    <div className="text-slate-600 text-xs w-20 flex-shrink-0 pt-0.5">{ev.date}</div>
                    <div>
                      <div className="text-slate-400 font-medium capitalize">{ev.type.replace(/_/g, " ")}</div>
                      {ev.description && <div className="text-slate-500 text-xs">{ev.description.slice(0, 120)}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Summary */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">AI Analysis</div>
              <button
                onClick={generateSummary}
                disabled={generating}
                className="text-xs px-3 py-1 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400 hover:bg-violet-500/20 transition-all disabled:opacity-50"
              >
                {generating ? "Analysing…" : "Generate ✨"}
              </button>
            </div>
            {localSummary ? (
              <div className="rounded-xl bg-violet-500/5 border border-violet-500/20 p-3 text-sm text-slate-300 leading-relaxed">
                {localSummary}
              </div>
            ) : (
              <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-xs text-slate-600">
                Click Generate to get AI-powered outreach analysis for this case.
              </div>
            )}
          </div>

          {/* Operator Notes */}
          <div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Operator Notes</div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add notes, context, or follow-up actions..."
              rows={3}
              className="w-full rounded-xl bg-white/5 border border-white/10 focus:border-violet-500/50 outline-none px-3 py-2 text-sm text-white placeholder:text-slate-600 resize-none"
            />
            <button
              onClick={() => { patch.mutate({ operatorNotes: notes }); toast({ title: "Notes saved" }); }}
              className="mt-2 w-full py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-slate-300 transition-all"
            >
              Save Notes
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── Main Cases Tab ────────────────────────────────────────────────────────────

export function CasesTab({ onBack }: { onBack: () => void }) {
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [minScore, setMinScore] = useState(35);
  const [selected, setSelected] = useState<CaseWithEntity | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/cases", categoryFilter, minScore],
    queryFn: async () => {
      const params = new URLSearchParams({
        minScore: String(minScore),
        limit: "100",
        ...(categoryFilter !== "all" ? { category: categoryFilter } : {}),
      });
      const res = await fetch(`/api/cases?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<{ cases: CaseWithEntity[]; total: number }>;
    },
    refetchInterval: 120_000,
  });

  const { data: stats } = useQuery({
    queryKey: ["/api/cases/stats"],
    queryFn: async () => {
      const res = await fetch("/api/cases/stats");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const cases = data?.cases || [];

  const categoryCounts = Object.keys(CATEGORY_CONFIG).reduce((acc, cat) => {
    acc[cat] = cases.filter(r => r.case.category === cat).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button onClick={onBack} className="text-slate-400 hover:text-white transition-colors">← Back</button>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-500 flex items-center justify-center text-2xl">
            🔍
          </div>
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight">CASE INTELLIGENCE</h1>
            <p className="text-slate-400 text-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
              Entity-resolved, grouped intelligence cases
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <div className="text-right">
            <div className="text-2xl font-black text-white">{stats?.actionable ?? "—"}</div>
            <div className="text-xs text-slate-500 uppercase tracking-widest">Actionable</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-black text-white">{stats?.total ?? "—"}</div>
            <div className="text-xs text-slate-500 uppercase tracking-widest">Total Cases</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Category filter */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setCategoryFilter("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${categoryFilter === "all" ? "bg-white/10 text-white border-white/20" : "bg-white/5 text-slate-400 border-white/10 hover:border-white/20"}`}
          >
            All ({cases.length})
          </button>
          {Object.entries(CATEGORY_CONFIG).map(([cat, cfg]) => {
            const count = categoryCounts[cat] || 0;
            if (!count && categoryFilter !== cat) return null;
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${categoryFilter === cat ? `${cfg.bg} ${cfg.color} ${cfg.border}` : "bg-white/5 text-slate-400 border-white/10 hover:border-white/20"}`}
              >
                {cfg.emoji} {cfg.label} ({count})
              </button>
            );
          })}
        </div>

        {/* Score threshold */}
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-400">
          <span>Min score</span>
          {[25, 35, 50, 65].map(s => (
            <button
              key={s}
              onClick={() => setMinScore(s)}
              className={`px-2 py-1 rounded border transition-all ${minScore === s ? "bg-violet-500/20 text-violet-300 border-violet-500/30" : "bg-white/5 border-white/10 hover:border-white/20"}`}
            >
              {s}+
            </button>
          ))}
        </div>
      </div>

      {/* Case list */}
      {isLoading ? (
        <div className="text-center py-20 text-slate-500">
          <div className="animate-spin text-4xl mb-4">🔍</div>
          Loading intelligence cases…
        </div>
      ) : error ? (
        <div className="text-center py-20">
          <div className="text-4xl mb-3">⚠️</div>
          <div className="text-red-400 font-bold">Failed to load cases</div>
          <div className="text-slate-500 text-sm mt-1">{String(error)}</div>
        </div>
      ) : cases.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">🔍</div>
          <div className="text-white font-bold text-xl mb-2">No cases yet</div>
          <div className="text-slate-500 text-sm max-w-sm mx-auto">
            The Case Intelligence Engine groups raw signals into entities and cases every 30 minutes.
            If signals are ingesting, cases will appear here after the first cycle.
          </div>
          {stats?.lastRunAt && (
            <div className="text-slate-600 text-xs mt-4">Last run: {new Date(stats.lastRunAt).toLocaleString()}</div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {cases.map(row => {
            const c   = row.case;
            const e   = row.entity;
            const cat = CATEGORY_CONFIG[c.category] || CATEGORY_CONFIG.other;

            return (
              <div
                key={c.id}
                onClick={() => setSelected(row)}
                className={`rounded-2xl border p-4 cursor-pointer transition-all hover:scale-[1.003] ${c.actionable ? `${cat.bg} ${cat.border}` : "bg-white/5 border-white/10"}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="text-2xl flex-shrink-0">{cat.emoji}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-xs font-bold ${cat.color}`}>{cat.label}</span>
                        <span className="text-xs text-slate-500">·</span>
                        <span className="text-xs text-slate-500">{c.incidentWindow}</span>
                        <span className="text-xs text-slate-500">·</span>
                        <span className="text-xs text-slate-500">{c.signalCount} signal{c.signalCount !== 1 ? "s" : ""}</span>
                        {c.actionable && (
                          <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 border border-green-500/30">
                            ACTIONABLE
                          </span>
                        )}
                        {e?.county && <span className="text-xs text-slate-600">{e.county} County</span>}
                      </div>
                      <div className="text-white font-bold text-sm truncate">
                        {e?.canonicalName || c.title}
                      </div>
                      {c.recommendedVertical && (
                        <div className="text-slate-500 text-xs mt-0.5 capitalize">
                          → {c.recommendedVertical.replace("_", " ")}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Score badge */}
                  <div className="flex-shrink-0 flex flex-col items-end gap-1">
                    <div className={`text-sm font-black px-2.5 py-1 rounded-lg ${c.compositeScore >= 70 ? "bg-green-500/15 text-green-400" : c.compositeScore >= 45 ? "bg-amber-500/15 text-amber-400" : "bg-white/10 text-slate-400"}`}>
                      {c.compositeScore}
                    </div>
                    <div className="text-[10px] text-slate-600">score</div>
                  </div>
                </div>

                {/* Mini score strip */}
                <div className="mt-3 flex gap-3 text-[10px] text-slate-600">
                  <span>💰 {c.financialScore}</span>
                  <span>⚡ {c.urgencyScore}</span>
                  <span>📞 {c.outreachViability}</span>
                  <span>👥 {c.consumerImpact}</span>
                  <span>⚖️ {c.legalSeverity}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Drawer */}
      <AnimatePresence>
        {selected && <CaseDrawer row={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  );
}
