import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

interface IntelligenceCase {
  id: number;
  title: string;               // plain-English headline: "3 FDA recalls — consumer injury exposure"
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
  aiSummary?: string;          // "What happened + why it matters"
  outreachAngle?: string;      // Pitch line for client
  recommendedVertical?: string;
  timeline?: Array<{ date: string; type: string; description: string; caseNumber?: string }>;
  latestSignalAt?: string;
}

interface CaseWithEntity {
  case: IntelligenceCase;
  entity?: {
    id: number;
    canonicalName: string;
    entityType: string;
    county?: string;
    aliases: string[];
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CATEGORY_META: Record<string, {
  emoji: string; bg: string; border: string; color: string;
  urgencyVerb: string;  // what the operator should do immediately
  clientType: string;   // who benefits
}> = {
  recall:   { emoji: "⚠️",  bg: "bg-red-500/8",    border: "border-red-500/20",    color: "text-red-400",    urgencyVerb: "Act within 48h",  clientType: "Personal injury attorneys" },
  osha:     { emoji: "🏭",  bg: "bg-orange-500/8", border: "border-orange-500/20", color: "text-orange-400", urgencyVerb: "Act within 72h",  clientType: "Workers' comp attorneys" },
  arrest:   { emoji: "🚔",  bg: "bg-purple-500/8", border: "border-purple-500/20", color: "text-purple-400", urgencyVerb: "Act within 24h",  clientType: "Criminal defense attorneys" },
  court:    { emoji: "⚖️",  bg: "bg-blue-500/8",   border: "border-blue-500/20",   color: "text-blue-400",   urgencyVerb: "Act within 7 days",clientType: "Family law attorneys" },
  license:  { emoji: "📋",  bg: "bg-amber-500/8",  border: "border-amber-500/20",  color: "text-amber-400",  urgencyVerb: "Monitor",         clientType: "Compliance attorneys" },
  business: { emoji: "🏢",  bg: "bg-teal-500/8",   border: "border-teal-500/20",   color: "text-teal-400",   urgencyVerb: "Act within 14 days",clientType: "Marketing / SaaS" },
  other:    { emoji: "📌",  bg: "bg-slate-500/8",  border: "border-slate-500/10",  color: "text-slate-400",  urgencyVerb: "Review",          clientType: "General" },
};

const VERTICAL_LABEL: Record<string, string> = {
  personal_injury: "Personal Injury",
  criminal:        "Criminal Defense",
  workers_comp:    "Workers' Comp",
  family:          "Family Law",
  traffic:         "Traffic / DUI",
  business:        "Business / Marketing",
};

const STATUS_STAGES = ["open", "reviewing", "actioned", "suppressed"];

// ── Case Drawer ───────────────────────────────────────────────────────────────

function CaseDrawer({ row, onClose }: { row: CaseWithEntity; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const c   = row.case;
  const e   = row.entity;
  const cat = CATEGORY_META[c.category] || CATEGORY_META.other;

  const [notes, setNotes] = useState(c.operatorNotes || "");
  const [aiLoading, setAiLoading] = useState(false);
  const [localSummary, setLocalSummary] = useState(c.aiSummary || "");

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest("PATCH", `/api/cases/${c.id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/cases"] }),
  });

  async function generateDeepAnalysis() {
    setAiLoading(true);
    try {
      const res = await apiRequest("POST", "/api/ai/chat", {
        messages: [
          {
            role: "system",
            content: "You are a concise legal/business intelligence analyst. Write for a sales operator, not a lawyer. Use plain English. Max 3 sentences.",
          },
          {
            role: "user",
            content: `Entity: ${e?.canonicalName}
Category: ${c.category} (${c.signalCount} signals, ${c.incidentWindow})
What happened: ${c.aiSummary || ""}
Recommended for: ${VERTICAL_LABEL[c.recommendedVertical || ""] || c.recommendedVertical}
Timeline: ${(c.timeline || []).slice(0, 3).map(t => `${t.date}: ${t.description}`).join("; ")}

Write 2-3 sentences: (1) what specifically happened, (2) the exact business opportunity, (3) what the operator should say to a client today.`,
          },
        ],
        maxTokens: 180,
        route: "case-deep-analysis",
      });
      const data = await res.json();
      const text = (typeof data?.text === "string" ? data.text : null) || "AI analysis unavailable. Check Provider Config tab.";
      setLocalSummary(text);
      patch.mutate({ aiSummary: text });
    } catch {
      setLocalSummary("AI provider not configured. Go to the AI Providers tab to set up a key.");
    } finally {
      setAiLoading(false);
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
        className="relative z-10 w-full max-w-lg bg-[#0a0c11] border-l border-white/10 overflow-y-auto flex flex-col"
      >
        {/* ── HEADER: The four questions answered immediately ── */}
        <div className={`p-5 border-b border-white/10 ${cat.bg}`}>
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-start gap-3">
              <span className="text-3xl">{cat.emoji}</span>
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">
                  {c.signalCount} signal{c.signalCount !== 1 ? "s" : ""} · {c.incidentWindow} · {e?.county ? `${e.county} County` : "FL"}
                </div>
                <h2 className={`font-black text-lg leading-tight ${cat.color}`}>
                  {e?.canonicalName || "Unknown Entity"}
                </h2>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-500 hover:text-white text-xl flex-shrink-0 mt-1">✕</button>
          </div>

          {/* WHAT HAPPENED */}
          <div className="rounded-xl bg-white/5 border border-white/10 p-3 mb-3">
            <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">What happened</div>
            <p className="text-white text-sm leading-relaxed">{c.title}</p>
          </div>

          {/* WHY IT MATTERS + WHAT TO DO — side by side */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white/5 border border-white/10 p-3">
              <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Who to sell</div>
              <p className={`text-sm font-bold ${cat.color}`}>{cat.clientType}</p>
            </div>
            <div className={`rounded-xl border p-3 ${c.actionable ? `${cat.bg} ${cat.border}` : "bg-white/5 border-white/10"}`}>
              <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Urgency</div>
              <p className={`text-sm font-bold ${c.actionable ? cat.color : "text-slate-400"}`}>{cat.urgencyVerb}</p>
            </div>
          </div>
        </div>

        <div className="flex-1 p-5 space-y-5">
          {/* PITCH LINE — what to say to client */}
          {c.outreachAngle && (
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">What to say to your client</div>
              <div className="rounded-xl bg-green-500/8 border border-green-500/20 p-4">
                <p className="text-green-300 text-sm leading-relaxed italic">"{c.outreachAngle}"</p>
              </div>
            </div>
          )}

          {/* Status pipeline */}
          <div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Your status</div>
            <div className="flex gap-2">
              {STATUS_STAGES.map(s => (
                <button
                  key={s}
                  onClick={() => patch.mutate({ status: s })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all capitalize ${
                    c.status === s
                      ? "bg-violet-500/20 text-violet-300 border-violet-500/40"
                      : "bg-white/5 text-slate-500 border-white/10 hover:border-white/20 hover:text-slate-300"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Recommended vertical */}
          <div className="flex items-center justify-between rounded-xl bg-white/5 border border-white/10 p-4">
            <div>
              <div className="text-xs text-slate-500 mb-0.5">Best client type</div>
              <div className="text-white font-bold">
                {VERTICAL_LABEL[c.recommendedVertical || ""] || c.recommendedVertical || "General"}
              </div>
            </div>
            <div className="text-3xl">{cat.emoji}</div>
          </div>

          {/* Incident timeline */}
          {(c.timeline?.length ?? 0) > 0 && (
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">What happened — timeline</div>
              <div className="space-y-3">
                {(c.timeline || []).slice(0, 8).map((ev, i) => (
                  <div key={i} className="flex gap-3">
                    <div className="text-slate-600 text-xs w-20 flex-shrink-0 font-mono pt-0.5">{ev.date}</div>
                    <div className="flex-1">
                      <div className="text-slate-300 text-sm font-medium capitalize leading-tight">
                        {ev.type.replace(/_/g, " ")}
                      </div>
                      {ev.description && (
                        <div className="text-slate-500 text-xs mt-0.5 leading-relaxed">
                          {ev.description.slice(0, 140)}
                        </div>
                      )}
                      {ev.caseNumber && (
                        <div className="text-slate-600 text-xs mt-0.5">Case #{ev.caseNumber}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Entity aliases */}
          {e?.aliases && e.aliases.length > 1 && (
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Also appears as</div>
              <div className="flex flex-wrap gap-1.5">
                {e.aliases.map((alias, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded bg-white/5 border border-white/10 text-slate-400">{alias}</span>
                ))}
              </div>
            </div>
          )}

          {/* Deep AI analysis */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Deeper AI analysis</div>
              <button
                onClick={generateDeepAnalysis}
                disabled={aiLoading}
                className="text-xs px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400 hover:bg-violet-500/20 transition-all disabled:opacity-50"
              >
                {aiLoading ? "Analysing…" : "Generate ✨"}
              </button>
            </div>
            {localSummary ? (
              <div className="rounded-xl bg-violet-500/5 border border-violet-500/20 p-4 text-sm text-slate-300 leading-relaxed">
                {localSummary}
              </div>
            ) : (
              <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-xs text-slate-600">
                Generate a tailored analysis of what to say, who to call, and why this case matters for your clients.
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Your notes</div>
            <textarea
              value={notes}
              onChange={ev => setNotes(ev.target.value)}
              placeholder="Who did you call? What was the outcome? Follow-up date?"
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

// ── Main Tab ──────────────────────────────────────────────────────────────────

const CATEGORY_FILTERS = [
  { key: "all",     label: "All",              emoji: "" },
  { key: "recall",  label: "Recalls",          emoji: "⚠️" },
  { key: "osha",    label: "OSHA",             emoji: "🏭" },
  { key: "arrest",  label: "Arrests",          emoji: "🚔" },
  { key: "court",   label: "Court Filings",    emoji: "⚖️" },
  { key: "business",label: "New Businesses",   emoji: "🏢" },
];

export function CasesTab({ onBack }: { onBack: () => void }) {
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selected, setSelected] = useState<CaseWithEntity | null>(null);
  const [showAll, setShowAll] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/cases", categoryFilter, showAll],
    queryFn: async () => {
      const params = new URLSearchParams({
        minScore: showAll ? "20" : "30",
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
    queryFn: async () => (await fetch("/api/cases/stats")).json(),
    refetchInterval: 60_000,
  });

  const cases = data?.cases || [];
  const actionable = cases.filter(r => r.case.actionable);
  const monitoring = cases.filter(r => !r.case.actionable);

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button onClick={onBack} className="text-slate-400 hover:text-white transition-colors">← Back</button>
        <div>
          <h1 className="text-3xl font-black text-white tracking-tight">INTELLIGENCE CASES</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Grouped incidents — each case = one company, one opportunity
          </p>
        </div>
        <div className="ml-auto flex items-center gap-6">
          <div className="text-right">
            <div className="text-2xl font-black text-green-400">{stats?.actionable ?? "—"}</div>
            <div className="text-xs text-slate-500">Ready to work</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-black text-slate-400">{stats?.total ?? "—"}</div>
            <div className="text-xs text-slate-500">Total cases</div>
          </div>
        </div>
      </div>

      {/* Category filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        {CATEGORY_FILTERS.map(f => {
          const count = f.key === "all" ? cases.length : cases.filter(r => r.case.category === f.key).length;
          const meta  = CATEGORY_META[f.key] || CATEGORY_META.other;
          return (
            <button
              key={f.key}
              onClick={() => setCategoryFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                categoryFilter === f.key
                  ? f.key === "all" ? "bg-white/10 text-white border-white/20" : `${meta.bg} ${meta.color} ${meta.border}`
                  : "bg-white/5 text-slate-400 border-white/10 hover:border-white/20"
              }`}
            >
              {f.emoji ? `${f.emoji} ` : ""}{f.label} {count > 0 ? `(${count})` : ""}
            </button>
          );
        })}
        <button
          onClick={() => setShowAll(!showAll)}
          className={`ml-auto px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${showAll ? "bg-slate-500/20 text-slate-300 border-slate-500/30" : "bg-white/5 text-slate-500 border-white/10"}`}
        >
          {showAll ? "Showing all" : "Show more"}
        </button>
      </div>

      {/* State: loading / error / empty */}
      {isLoading ? (
        <div className="text-center py-20 text-slate-500">
          <div className="text-4xl mb-4 animate-pulse">🔍</div>
          Loading intelligence cases…
        </div>
      ) : error ? (
        <div className="text-center py-20">
          <div className="text-4xl mb-3">⚠️</div>
          <div className="text-red-400 font-bold">Failed to load cases</div>
          <div className="text-slate-500 text-sm mt-1">Unable to connect to the intelligence engine. Please try again shortly.</div>
        </div>
      ) : cases.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">🔍</div>
          <div className="text-white font-bold text-xl mb-2">No cases yet</div>
          <div className="text-slate-400 text-sm max-w-sm mx-auto">
            The engine groups raw signals into company cases every 30 minutes.
            Once signals are ingesting, cases appear here automatically.
          </div>
          {stats?.lastRunAt && (
            <div className="text-slate-600 text-xs mt-4">
              Last run: {new Date(stats.lastRunAt).toLocaleString()}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── ACTIONABLE CASES — ready to work ── */}
          {actionable.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-xs font-black text-green-400 uppercase tracking-widest">
                  Ready to work — {actionable.length} case{actionable.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="space-y-2">
                {actionable.map(row => <CaseCard key={row.case.id} row={row} onClick={() => setSelected(row)} />)}
              </div>
            </div>
          )}

          {/* ── MONITORING — lower priority ── */}
          {monitoring.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-slate-500" />
                <span className="text-xs font-black text-slate-500 uppercase tracking-widest">
                  Monitoring — {monitoring.length} case{monitoring.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="space-y-2">
                {monitoring.map(row => <CaseCard key={row.case.id} row={row} onClick={() => setSelected(row)} />)}
              </div>
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {selected && <CaseDrawer row={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  );
}

// ── Case Card ─────────────────────────────────────────────────────────────────

function CaseCard({ row, onClick }: { row: CaseWithEntity; onClick: () => void }) {
  const c   = row.case;
  const e   = row.entity;
  const cat = CATEGORY_META[c.category] || CATEGORY_META.other;

  return (
    <div
      onClick={onClick}
      className={`rounded-2xl border p-4 cursor-pointer transition-all hover:scale-[1.003] ${
        c.actionable ? `${cat.bg} ${cat.border}` : "bg-white/4 border-white/8"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl flex-shrink-0 mt-0.5">{cat.emoji}</span>

        <div className="flex-1 min-w-0">
          {/* Company name — the entity, bold and clear */}
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-white font-black text-base">
              {e?.canonicalName || "Unknown"}
            </span>
            {e?.county && (
              <span className="text-xs text-slate-500">{e.county} County</span>
            )}
            {c.actionable && (
              <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 border border-green-500/30">
                ACT NOW
              </span>
            )}
          </div>

          {/* WHAT HAPPENED — the plain-English headline */}
          <p className={`text-sm font-semibold mb-2 ${cat.color}`}>{c.title}</p>

          {/* WHAT TO DO + WHO TO SELL — the two critical operator signals */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>👥 {cat.clientType}</span>
            <span>⏰ {cat.urgencyVerb}</span>
            <span>📊 {c.signalCount} signal{c.signalCount !== 1 ? "s" : ""}</span>
            <span>📅 {c.incidentWindow}</span>
          </div>

          {/* Pitch line preview */}
          {c.outreachAngle && (
            <p className="text-xs text-slate-600 italic mt-2 line-clamp-1">
              "{c.outreachAngle}"
            </p>
          )}
        </div>

        {/* Status dot */}
        <div className="flex-shrink-0">
          {c.status !== "open" && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-white/5 text-slate-500 border border-white/10 capitalize">
              {c.status}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
