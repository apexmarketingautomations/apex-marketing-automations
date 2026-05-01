/**
 * LegalLeadsTab.tsx
 * Live legal signal feed — arrests, court filings, OSHA, recalls, DV injunctions
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAccount } from "@/hooks/use-account";
import { Scale, AlertTriangle, Clock, MapPin, User, FileText, Shield, Gavel, Car, Heart, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LegalLead {
  id: number;
  legalVertical: string;
  signalType: string;
  county: string;
  subjectName?: string;
  subjectAddress?: string;
  chargeDescription?: string;
  caseNumber?: string;
  urgency: string;
  score: number;
  status: string;
  createdAt: string;
  detectedAt: string;
}

const VERTICAL_CONFIG: Record<string, { label: string; icon: any; color: string; bg: string; border: string }> = {
  criminal:         { label: "Criminal Defense", icon: Shield,    color: "text-red-400",    bg: "bg-red-500/10",    border: "border-red-500/20" },
  traffic:          { label: "Traffic / DUI",    icon: Car,       color: "text-amber-400",  bg: "bg-amber-500/10",  border: "border-amber-500/20" },
  family:           { label: "Family Law",       icon: Heart,     color: "text-pink-400",   bg: "bg-pink-500/10",   border: "border-pink-500/20" },
  personal_injury:  { label: "Personal Injury",  icon: AlertTriangle, color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20" },
  workers_comp:     { label: "Workers Comp",     icon: Briefcase, color: "text-blue-400",   bg: "bg-blue-500/10",   border: "border-blue-500/20" },
};

const URGENCY_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  critical: { label: "CRITICAL",  color: "text-red-400",    dot: "bg-red-400" },
  high:     { label: "HIGH",      color: "text-orange-400", dot: "bg-orange-400" },
  medium:   { label: "MEDIUM",    color: "text-amber-400",  dot: "bg-amber-400" },
  low:      { label: "LOW",       color: "text-slate-400",  dot: "bg-slate-400" },
};

const SIGNAL_LABELS: Record<string, string> = {
  arrest:              "Arrest",
  dui_arrest:          "DUI Arrest",
  court_filing:        "Court Filing",
  divorce_filing:      "Divorce Filing",
  custody_filing:      "Custody Filing",
  domestic_violence:   "DV Injunction",
  probate_filing:      "Probate Filing",
  osha_incident:       "OSHA Incident",
  dhsmv_suspension:    "License Suspension",
  fda_recall:          "FDA Recall",
  cpsc_recall:         "CPSC Recall",
  civil_filing:        "Civil Filing",
  injunction:          "Injunction",
};

interface Props { onBack: () => void; }

export function LegalLeadsTab({ onBack }: Props) {
  const { currentAccount } = useAccount();
  const [filter, setFilter] = useState<string>("all");
  const [selected, setSelected] = useState<LegalLead | null>(null);

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["/api/legal-leads", currentAccount?.id],
    queryFn: () => apiRequest("GET", `/api/legal-leads?subAccountId=${currentAccount?.id}&limit=100`),
    refetchInterval: 30000,
    enabled: !!currentAccount?.id,
  });

  const filtered = filter === "all" ? leads : leads.filter((l: LegalLead) => l.legalVertical === filter);
  const counts = leads.reduce((acc: Record<string, number>, l: LegalLead) => {
    acc[l.legalVertical] = (acc[l.legalVertical] ?? 0) + 1;
    return acc;
  }, {});

  if (selected) {
    const cfg = VERTICAL_CONFIG[selected.legalVertical] ?? VERTICAL_CONFIG.criminal;
    const urg = URGENCY_CONFIG[selected.urgency] ?? URGENCY_CONFIG.medium;
    const Icon = cfg.icon;
    return (
      <div className="p-6 md:p-10 max-w-4xl mx-auto">
        <button onClick={() => setSelected(null)} className="flex items-center gap-2 text-slate-400 hover:text-white text-sm mb-6 transition-colors">
          ← Back to Legal Signals
        </button>
        <div className={`rounded-2xl border ${cfg.border} ${cfg.bg} p-6 mb-6`}>
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-xl ${cfg.bg} border ${cfg.border}`}>
                <Icon size={20} className={cfg.color} />
              </div>
              <div>
                <div className={`text-xs font-bold ${cfg.color} uppercase tracking-widest`}>{cfg.label}</div>
                <div className="text-white font-bold text-lg">{SIGNAL_LABELS[selected.signalType] ?? selected.signalType}</div>
              </div>
            </div>
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${cfg.bg} border ${cfg.border}`}>
              <div className={`w-2 h-2 rounded-full ${urg.dot} animate-pulse`} />
              <span className={`text-xs font-bold ${urg.color}`}>{urg.label}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {selected.subjectName && (
              <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                <div className="text-xs text-slate-500 uppercase tracking-widest mb-1">Subject</div>
                <div className="text-white font-bold flex items-center gap-2">
                  <User size={14} className="text-slate-400" /> {selected.subjectName}
                </div>
              </div>
            )}
            {selected.county && (
              <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                <div className="text-xs text-slate-500 uppercase tracking-widest mb-1">County</div>
                <div className="text-white font-bold flex items-center gap-2">
                  <MapPin size={14} className="text-slate-400" /> {selected.county}
                </div>
              </div>
            )}
            {selected.caseNumber && (
              <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                <div className="text-xs text-slate-500 uppercase tracking-widest mb-1">Case #</div>
                <div className="text-white font-bold flex items-center gap-2">
                  <FileText size={14} className="text-slate-400" /> {selected.caseNumber}
                </div>
              </div>
            )}
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <div className="text-xs text-slate-500 uppercase tracking-widest mb-1">Lead Score</div>
              <div className="text-white font-bold">{selected.score}/100</div>
            </div>
          </div>

          {selected.chargeDescription && (
            <div className="mt-4 bg-white/5 rounded-xl p-4 border border-white/10">
              <div className="text-xs text-slate-500 uppercase tracking-widest mb-2">Details</div>
              <p className="text-slate-300 text-sm leading-relaxed">{selected.chargeDescription}</p>
            </div>
          )}

          <div className="mt-4 flex gap-3">
            <Button className="flex-1 bg-white/10 hover:bg-white/15 text-white border border-white/20">
              📞 Contact Attorney
            </Button>
            <Button className="flex-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30">
              ✓ Mark Claimed
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Scale size={22} className="text-purple-400" />
            <h1 className="text-2xl font-bold text-white">Legal Signal Feed</h1>
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-emerald-400 font-bold">LIVE</span>
            </div>
          </div>
          <p className="text-slate-500 text-sm">Arrests · Court filings · OSHA · Recalls · DV injunctions — 12 FL counties</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-white">{leads.length}</div>
          <div className="text-xs text-slate-500">Active Signals</div>
        </div>
      </div>

      {/* Vertical filter pills */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <button
          onClick={() => setFilter("all")}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${filter === "all" ? "bg-white/10 text-white border-white/20" : "text-slate-500 border-white/5 hover:border-white/10"}`}
        >
          All ({leads.length})
        </button>
        {Object.entries(VERTICAL_CONFIG).map(([key, cfg]) => {
          const count = counts[key] ?? 0;
          if (count === 0) return null;
          const Icon = cfg.icon;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                filter === key ? `${cfg.bg} ${cfg.color} ${cfg.border}` : "text-slate-500 border-white/5 hover:border-white/10"
              }`}
            >
              <Icon size={12} /> {cfg.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Lead cards */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-slate-500">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
            Scanning legal feeds...
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <Scale size={40} className="mx-auto text-slate-700 mb-3" />
          <p className="text-slate-500 text-sm">No legal signals yet — pipeline runs every 15 minutes</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((lead: LegalLead) => {
            const cfg = VERTICAL_CONFIG[lead.legalVertical] ?? VERTICAL_CONFIG.criminal;
            const urg = URGENCY_CONFIG[lead.urgency] ?? URGENCY_CONFIG.medium;
            const Icon = cfg.icon;
            return (
              <button
                key={lead.id}
                onClick={() => setSelected(lead)}
                className={`w-full text-left p-4 rounded-xl border ${cfg.border} ${cfg.bg} hover:brightness-110 transition-all`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={`flex-shrink-0 p-2 rounded-lg ${cfg.bg} border ${cfg.border}`}>
                      <Icon size={16} className={cfg.color} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-xs font-bold ${cfg.color} uppercase tracking-wide`}>{cfg.label}</span>
                        <span className="text-slate-600 text-xs">·</span>
                        <span className="text-slate-400 text-xs">{SIGNAL_LABELS[lead.signalType] ?? lead.signalType}</span>
                      </div>
                      {lead.subjectName && (
                        <div className="text-white font-bold text-sm truncate">{lead.subjectName}</div>
                      )}
                      {lead.chargeDescription && (
                        <div className="text-slate-500 text-xs truncate mt-0.5">{lead.chargeDescription.slice(0, 80)}</div>
                      )}
                      <div className="flex items-center gap-3 mt-1.5">
                        {lead.county && (
                          <span className="flex items-center gap-1 text-xs text-slate-500">
                            <MapPin size={10} /> {lead.county}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-xs text-slate-500">
                          <Clock size={10} /> {new Date(lead.detectedAt).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border ${cfg.border}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${urg.dot}`} />
                      <span className={urg.color}>{urg.label}</span>
                    </div>
                    <div className="text-xs text-slate-500">Score: <span className="text-white font-bold">{lead.score}</span></div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function DistributionTab({ onBack }: { onBack: () => void }) {
  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <span className="text-2xl">📡</span>
        <div>
          <h1 className="text-2xl font-bold text-white">Lead Distribution</h1>
          <p className="text-slate-500 text-sm">Configure which leads go to which accounts automatically</p>
        </div>
      </div>

      <div className="grid gap-4">
        {/* Crash Leads */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span>🚨</span>
              <span className="text-white font-bold">Crash / PI Leads</span>
              <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full">ACTIVE</span>
            </div>
          </div>
          <div className="text-sm text-slate-400">→ Crash Connect / Giovanni (Account #14)</div>
          <div className="text-xs text-slate-600 mt-1">Florida statewide · 30+ counties · 5min polling · 15min rate limit</div>
        </div>

        {/* Home Service Leads */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span>🏠</span>
              <span className="text-white font-bold">Home & Property Leads</span>
              <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full">ACTIVE</span>
            </div>
          </div>
          <div className="text-sm text-slate-400">→ Roof 2 Roots — Christopher L & S.A (Account #22)</div>
          <div className="text-xs text-slate-600 mt-1">Lee · Collier · Charlotte · Sarasota · + 11 more FL counties · 30min polling</div>
          <div className="text-xs text-slate-600">Roofing · HVAC · Pool · Solar · Lawn · Pest · Cleaning · Hair Salons · Auto Detailing</div>
        </div>

        {/* Legal Leads */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span>⚖️</span>
              <span className="text-white font-bold">Legal Signals</span>
              <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full">ACTIVE</span>
            </div>
          </div>
          <div className="text-sm text-slate-400">→ Registered attorneys by vertical</div>
          <div className="text-xs text-slate-600 mt-1">12 FL counties · 15min polling</div>
          <div className="text-xs text-slate-600">Criminal · DUI/Traffic · Family Law · Personal Injury · Workers Comp</div>
          <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
            <p className="text-amber-400 text-xs font-bold">⚡ No attorneys registered yet</p>
            <p className="text-amber-400/70 text-xs mt-0.5">Add attorney accounts to start routing legal leads automatically</p>
          </div>
        </div>

        {/* Add new routing rule */}
        <button className="w-full p-4 rounded-2xl border border-dashed border-white/10 text-slate-500 hover:border-white/20 hover:text-slate-400 transition-all text-sm flex items-center justify-center gap-2">
          + Add Distribution Rule
        </button>
      </div>
    </div>
  );
}
