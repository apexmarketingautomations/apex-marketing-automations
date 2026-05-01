import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { apiRequest } from "@/lib/queryClient";
import { useAccount } from "@/hooks/use-account";
import { useToast } from "@/hooks/use-toast";
import {
  Scale, Shield, Users, Car, AlertTriangle, ChevronRight, ChevronLeft,
  Phone, MapPin, Clock, Send, Eye, Target, CheckCircle2, Gavel,
  Heart, FileText, Siren, Building, RefreshCw, Filter, Search,
  ArrowRight, Zap, TrendingUp, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ── Types ────────────────────────────────────────────────────────────────────

type LegalSignalType =
  | "dui_arrest" | "arrest_record" | "divorce_filing"
  | "domestic_violence_injunction" | "custody_modification" | "probate_filing"
  | "osha_incident" | "fda_recall" | "cpsc_recall"
  | "license_suspension" | "traffic_violation"
  | "new_business_filing" | "salon_license";

type LegalCategory = "criminal" | "family" | "traffic" | "personal_injury" | "business";

interface LegalSignal {
  id: number;
  signalType: LegalSignalType;
  county: string;
  address?: string;
  ownerName?: string;
  ownerPhone?: string;
  description: string;
  urgency: "critical" | "high" | "medium" | "low";
  serviceCategories: string[];
  detectedAt: string;
  status: string;
  score?: number;
  smsSent?: boolean;
  actionStatus?: string;
}

interface DistributionRule {
  id: number;
  name: string;
  signalTypes: string[];
  targetAccountId: number;
  targetAccountName: string;
  targetPhone: string;
  active: boolean;
  leadsDelivered: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LEGAL_CATEGORIES: { key: LegalCategory; label: string; icon: any; color: string; desc: string; signals: LegalSignalType[] }[] = [
  {
    key: "criminal",
    label: "Criminal Defense",
    icon: Shield,
    color: "text-red-400",
    desc: "Arrests, DUI, felonies",
    signals: ["dui_arrest", "arrest_record"],
  },
  {
    key: "family",
    label: "Family Law",
    icon: Users,
    color: "text-pink-400",
    desc: "Divorce, custody, injunctions",
    signals: ["divorce_filing", "domestic_violence_injunction", "custody_modification", "probate_filing"],
  },
  {
    key: "traffic",
    label: "Traffic Law",
    icon: Car,
    color: "text-amber-400",
    desc: "Suspensions, DUI, violations",
    signals: ["license_suspension", "traffic_violation"],
  },
  {
    key: "personal_injury",
    label: "Personal Injury",
    icon: Heart,
    color: "text-orange-400",
    desc: "OSHA incidents, recalls, slip & fall",
    signals: ["osha_incident", "fda_recall", "cpsc_recall"],
  },
  {
    key: "business",
    label: "Business Signals",
    icon: Building,
    color: "text-cyan-400",
    desc: "New licenses, salon openings",
    signals: ["new_business_filing", "salon_license"],
  },
];

const URGENCY_CONFIG = {
  critical: { bg: "bg-red-500/20", text: "text-red-400", border: "border-red-500/30", label: "CRITICAL" },
  high:     { bg: "bg-orange-500/20", text: "text-orange-400", border: "border-orange-500/30", label: "HIGH" },
  medium:   { bg: "bg-amber-500/20", text: "text-amber-400", border: "border-amber-500/30", label: "MEDIUM" },
  low:      { bg: "bg-slate-500/20", text: "text-slate-400", border: "border-slate-500/30", label: "LOW" },
};

const SIGNAL_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  dui_arrest:                     { label: "DUI Arrest",             icon: Car,       color: "text-red-400" },
  arrest_record:                  { label: "Criminal Arrest",         icon: Shield,    color: "text-red-400" },
  divorce_filing:                 { label: "Divorce Filing",          icon: Scale,     color: "text-pink-400" },
  domestic_violence_injunction:   { label: "DV Injunction",           icon: AlertTriangle, color: "text-red-400" },
  custody_modification:           { label: "Custody Case",            icon: Users,     color: "text-pink-400" },
  probate_filing:                 { label: "Probate Filing",          icon: FileText,  color: "text-purple-400" },
  osha_incident:                  { label: "OSHA Incident",           icon: AlertTriangle, color: "text-orange-400" },
  fda_recall:                     { label: "FDA Recall",              icon: AlertTriangle, color: "text-orange-400" },
  cpsc_recall:                    { label: "CPSC Recall",             icon: AlertTriangle, color: "text-amber-400" },
  license_suspension:             { label: "License Suspension",      icon: Car,       color: "text-amber-400" },
  traffic_violation:              { label: "Traffic Violation",       icon: Car,       color: "text-amber-400" },
  new_business_filing:            { label: "New Business",            icon: Building,  color: "text-cyan-400" },
  salon_license:                  { label: "Salon License",           icon: Building,  color: "text-cyan-400" },
};

// ── LegalSignalCard ───────────────────────────────────────────────────────────

function LegalSignalCard({ signal, onClick }: { signal: LegalSignal; onClick: () => void }) {
  const urgency = URGENCY_CONFIG[signal.urgency] || URGENCY_CONFIG.medium;
  const meta = SIGNAL_LABELS[signal.signalType] || { label: signal.signalType, icon: Scale, color: "text-slate-400" };
  const MetaIcon = meta.icon;
  const timeAgo = (() => {
    const diff = Date.now() - new Date(signal.detectedAt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + "m ago";
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    return Math.floor(hrs / 24) + "d ago";
  })();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className={`border rounded-xl p-4 cursor-pointer hover:bg-white/[0.03] transition-all ${urgency.border} bg-white/[0.02]`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${urgency.bg}`}>
            <MetaIcon size={14} className={meta.color} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${urgency.bg} ${urgency.text}`}>
                {urgency.label}
              </span>
              <span className={`text-[10px] font-bold ${meta.color}`}>{meta.label}</span>
            </div>
            <p className="text-white text-sm font-semibold truncate">{signal.description}</p>
            <div className="flex items-center gap-3 mt-1">
              {signal.county && (
                <span className="flex items-center gap-1 text-[11px] text-slate-500">
                  <MapPin size={9} /> {signal.county} County
                </span>
              )}
              {signal.ownerName && (
                <span className="flex items-center gap-1 text-[11px] text-slate-400 font-medium">
                  {signal.ownerName}
                </span>
              )}
              <span className="flex items-center gap-1 text-[11px] text-slate-600">
                <Clock size={9} /> {timeAgo}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {signal.smsSent && (
            <span className="text-[8px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded font-bold">SMS SENT</span>
          )}
          {signal.ownerPhone && (
            <span className="text-[9px] text-emerald-400 font-bold">📞 HAS PHONE</span>
          )}
          <ChevronRight size={14} className="text-slate-600 mt-1" />
        </div>
      </div>
    </motion.div>
  );
}

// ── LegalSignalDetail ─────────────────────────────────────────────────────────

function LegalSignalDetail({ signal, onBack }: { signal: LegalSignal; onBack: () => void }) {
  const { activeAccountId } = useAccount();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const urgency = URGENCY_CONFIG[signal.urgency] || URGENCY_CONFIG.medium;
  const meta = SIGNAL_LABELS[signal.signalType] || { label: signal.signalType, icon: Scale, color: "text-slate-400" };
  const MetaIcon = meta.icon;

  const smsMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/sentinel/home-service/sms", {
        incidentId: signal.id,
        subAccountId: activeAccountId,
      });
    },
    onSuccess: () => {
      toast({ title: "SMS sent", description: "Alert delivered to registered attorneys" });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/legal-signals"] });
    },
    onError: () => toast({ title: "SMS failed", variant: "destructive" }),
  });

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="h-full">
      <button onClick={onBack} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm mb-5 transition-colors">
        <ChevronLeft size={14} /> Back to signals
      </button>

      <div className="space-y-4">
        {/* Header */}
        <div className={`rounded-2xl p-5 border ${urgency.border} ${urgency.bg}`}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-black/30 flex items-center justify-center">
              <MetaIcon size={18} className={meta.color} />
            </div>
            <div>
              <p className={`text-[10px] font-black tracking-widest ${urgency.text}`}>{urgency.label} PRIORITY</p>
              <p className="text-white font-bold text-base">{meta.label}</p>
            </div>
          </div>
          <p className="text-white/80 text-sm leading-relaxed">{signal.description}</p>
        </div>

        {/* Contact Info */}
        {(signal.ownerName || signal.ownerPhone || signal.address) && (
          <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-5">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Contact Information</h3>
            <div className="space-y-2">
              {signal.ownerName && (
                <div className="flex items-center gap-2">
                  <Users size={13} className="text-slate-500" />
                  <span className="text-white text-sm font-medium">{signal.ownerName}</span>
                </div>
              )}
              {signal.ownerPhone && (
                <div className="flex items-center gap-2">
                  <Phone size={13} className="text-emerald-400" />
                  <span className="text-emerald-300 text-sm font-bold">{signal.ownerPhone}</span>
                </div>
              )}
              {signal.address && (
                <div className="flex items-center gap-2">
                  <MapPin size={13} className="text-slate-500" />
                  <span className="text-slate-300 text-sm">{signal.address}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Scale size={13} className="text-slate-500" />
                <span className="text-slate-400 text-sm">{signal.county} County, FL</span>
              </div>
            </div>
          </div>
        )}

        {/* Categories */}
        <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-5">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Practice Areas</h3>
          <div className="flex flex-wrap gap-2">
            {signal.serviceCategories.map(cat => (
              <span key={cat} className="px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-500/20">
                {cat.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
              </span>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            onClick={() => smsMutation.mutate()}
            disabled={signal.smsSent || smsMutation.isPending}
            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white"
          >
            <Send size={13} className="mr-1.5" />
            {smsMutation.isPending ? "Sending..." : signal.smsSent ? "SMS Sent ✓" : "Alert Attorneys"}
          </Button>
        </div>

        <div className="text-center text-xs text-slate-600">
          Detected {new Date(signal.detectedAt).toLocaleString()}
        </div>
      </div>
    </motion.div>
  );
}

// ── LegalLeadsTab (main export) ───────────────────────────────────────────────

export function LegalLeadsTab({ onBack }: { onBack: () => void }) {
  const { activeAccountId } = useAccount();
  const [activeCategory, setActiveCategory] = useState<LegalCategory | "all">("all");
  const [selectedSignal, setSelectedSignal] = useState<LegalSignal | null>(null);
  const [search, setSearch] = useState("");

  const { data: signalsData, isLoading, refetch } = useQuery({
    queryKey: ["/api/sentinel/legal-signals", activeAccountId, activeCategory],
    queryFn: () => apiRequest("GET",
      `/api/sentinel/legal-signals?subAccountId=${activeAccountId}&category=${activeCategory}&limit=50`
    ),
    refetchInterval: 60000,
    enabled: !!activeAccountId,
  });

  const signals: LegalSignal[] = signalsData?.signals || signalsData || [];

  const filtered = signals.filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.description.toLowerCase().includes(q) ||
      s.county.toLowerCase().includes(q) ||
      (s.ownerName || "").toLowerCase().includes(q) ||
      s.signalType.includes(q)
    );
  });

  const counts = {
    all: signals.length,
    criminal: signals.filter(s => ["dui_arrest", "arrest_record"].includes(s.signalType)).length,
    family: signals.filter(s => ["divorce_filing", "domestic_violence_injunction", "custody_modification", "probate_filing"].includes(s.signalType)).length,
    traffic: signals.filter(s => ["license_suspension", "traffic_violation"].includes(s.signalType)).length,
    personal_injury: signals.filter(s => ["osha_incident", "fda_recall", "cpsc_recall"].includes(s.signalType)).length,
    business: signals.filter(s => ["new_business_filing", "salon_license"].includes(s.signalType)).length,
  };

  if (selectedSignal) {
    return (
      <div className="p-6 md:p-10 max-w-2xl mx-auto">
        <LegalSignalDetail signal={selectedSignal} onBack={() => setSelectedSignal(null)} />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <Scale size={22} className="text-indigo-400" /> Legal Signals
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Real-time court filings, arrests, and legal events across Florida
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-white text-xs font-bold transition-all"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {LEGAL_CATEGORIES.map(cat => {
          const CatIcon = cat.icon;
          return (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key)}
              className={`p-3 rounded-xl border text-left transition-all ${
                activeCategory === cat.key
                  ? "border-indigo-500/40 bg-indigo-500/10"
                  : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <CatIcon size={14} className={cat.color} />
                <span className={`text-lg font-black ${activeCategory === cat.key ? "text-white" : "text-slate-400"}`}>
                  {counts[cat.key]}
                </span>
              </div>
              <p className={`text-[10px] font-bold ${activeCategory === cat.key ? "text-white" : "text-slate-500"}`}>
                {cat.label}
              </p>
              <p className="text-[9px] text-slate-600 mt-0.5">{cat.desc}</p>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, county, case type..."
          className="pl-8 bg-white/5 border-white/10 text-white placeholder:text-slate-600 text-sm"
        />
      </div>

      {/* All / Category toggle */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setActiveCategory("all")}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            activeCategory === "all"
              ? "bg-white/10 text-white border border-white/20"
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          All ({counts.all})
        </button>
        {LEGAL_CATEGORIES.map(cat => (
          <button
            key={cat.key}
            onClick={() => setActiveCategory(cat.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeCategory === cat.key
                ? "bg-white/10 text-white border border-white/20"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {cat.label} ({counts[cat.key]})
          </button>
        ))}
      </div>

      {/* Signal List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="flex items-center gap-3 text-slate-500">
            <RefreshCw size={16} className="animate-spin" />
            <span className="text-sm">Loading legal signals...</span>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Scale size={32} className="text-slate-700 mb-3" />
          <p className="text-slate-500 text-sm font-medium">No legal signals found</p>
          <p className="text-slate-600 text-xs mt-1">
            {activeCategory === "all"
              ? "Signals are pulled from Florida public records every 30 minutes"
              : "No signals in this category yet — check back shortly"}
          </p>
          <div className="mt-4 p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 max-w-sm">
            <p className="text-indigo-300 text-xs font-bold mb-1 flex items-center gap-1">
              <Info size={11} /> Data Sources
            </p>
            <p className="text-slate-400 text-xs leading-relaxed">
              Pulling from FL county clerk APIs, FDLE arrest records, OSHA federal database, FDA enforcement, 
              FL e-Filing portal, and DHSMV. All free public records.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-slate-600 mb-3">{filtered.length} signal{filtered.length !== 1 ? "s" : ""} found</p>
          {filtered.map(signal => (
            <LegalSignalCard
              key={signal.id}
              signal={signal}
              onClick={() => setSelectedSignal(signal)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── DistributionTab ───────────────────────────────────────────────────────────

const DISTRIBUTABLE_SIGNAL_TYPES = [
  { value: "crash_report",                   label: "🚨 Crash/Injury Leads" },
  { value: "dui_arrest",                     label: "🍺 DUI Arrests" },
  { value: "arrest_record",                  label: "🚔 Criminal Arrests" },
  { value: "divorce_filing",                 label: "💔 Divorce Filings" },
  { value: "domestic_violence_injunction",   label: "⚠️ DV Injunctions" },
  { value: "custody_modification",           label: "👨‍👩‍👧 Custody Cases" },
  { value: "license_suspension",             label: "🚗 License Suspensions" },
  { value: "osha_incident",                  label: "🏭 OSHA Incidents" },
  { value: "fda_recall",                     label: "💊 FDA Recalls" },
  { value: "noaa_weather_alert",             label: "🌪️ Weather Alerts" },
  { value: "permit_filing",                  label: "🔨 Permit Filings" },
  { value: "code_enforcement",               label: "📋 Code Enforcement" },
  { value: "new_business_filing",            label: "🏪 New Business Licenses" },
];

function RuleCard({ rule, onToggle }: { rule: DistributionRule; onToggle: (id: number, active: boolean) => void }) {
  return (
    <div className={`border rounded-xl p-4 transition-all ${rule.active ? "border-emerald-500/20 bg-emerald-500/5" : "border-white/10 bg-white/[0.02] opacity-60"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-2 h-2 rounded-full ${rule.active ? "bg-emerald-400" : "bg-slate-600"}`} />
            <span className="text-white font-bold text-sm">{rule.name}</span>
            {rule.leadsDelivered > 0 && (
              <span className="text-[9px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded font-bold">
                {rule.leadsDelivered} delivered
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mb-2 flex-wrap">
            {rule.signalTypes.map(t => {
              const found = DISTRIBUTABLE_SIGNAL_TYPES.find(s => s.value === t);
              return (
                <span key={t} className="text-[10px] px-2 py-0.5 rounded bg-white/5 border border-white/10 text-slate-400">
                  {found?.label || t}
                </span>
              );
            })}
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <ArrowRight size={10} className="text-indigo-400" />
              {rule.targetAccountName}
            </span>
            {rule.targetPhone && (
              <span className="flex items-center gap-1">
                <Phone size={10} />
                {rule.targetPhone}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => onToggle(rule.id, !rule.active)}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            rule.active
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "bg-white/5 text-slate-500 border border-white/10"
          }`}
        >
          {rule.active ? "Active" : "Paused"}
        </button>
      </div>
    </div>
  );
}

export function DistributionTab({ onBack }: { onBack: () => void }) {
  const { activeAccountId } = useAccount();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showNewRule, setShowNewRule] = useState(false);
  const [newRule, setNewRule] = useState({
    name: "",
    signalTypes: [] as string[],
    targetPhone: "",
    targetAccountName: "",
  });

  const { data: rulesData, isLoading } = useQuery({
    queryKey: ["/api/sentinel/distribution-rules", activeAccountId],
    queryFn: () => apiRequest("GET", `/api/sentinel/distribution-rules?subAccountId=${activeAccountId}`),
    enabled: !!activeAccountId,
  });

  const rules: DistributionRule[] = rulesData?.rules || rulesData || [];

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      return apiRequest("PATCH", `/api/sentinel/distribution-rules/${id}`, { active });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/distribution-rules"] });
      toast({ title: "Rule updated" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/sentinel/distribution-rules", {
        ...newRule,
        subAccountId: activeAccountId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/distribution-rules"] });
      toast({ title: "Distribution rule created", description: "Leads will now route automatically" });
      setShowNewRule(false);
      setNewRule({ name: "", signalTypes: [], targetPhone: "", targetAccountName: "" });
    },
    onError: () => toast({ title: "Failed to create rule", variant: "destructive" }),
  });

  const toggleSignalType = (type: string) => {
    setNewRule(prev => ({
      ...prev,
      signalTypes: prev.signalTypes.includes(type)
        ? prev.signalTypes.filter(t => t !== type)
        : [...prev.signalTypes, type],
    }));
  };

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <Zap size={22} className="text-indigo-400" /> Lead Distribution
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Control which signals go to which clients — automatically
          </p>
        </div>
        <Button
          onClick={() => setShowNewRule(true)}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs"
        >
          + New Rule
        </Button>
      </div>

      {/* How it works */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { icon: Target, label: "Signal Detected", desc: "Pipeline finds a qualifying event", color: "text-amber-400" },
          { icon: Filter, label: "Rule Matched",    desc: "Distribution rules route the signal", color: "text-indigo-400" },
          { icon: Send,   label: "Lead Delivered",  desc: "SMS sent to the registered client",  color: "text-emerald-400" },
        ].map((step, i) => {
          const StepIcon = step.icon;
          return (
            <div key={i} className="p-4 rounded-xl border border-white/10 bg-white/[0.02] text-center">
              <StepIcon size={20} className={step.color + " mx-auto mb-2"} />
              <p className="text-white text-xs font-bold mb-0.5">{step.label}</p>
              <p className="text-slate-600 text-[10px]">{step.desc}</p>
            </div>
          );
        })}
      </div>

      {/* Active Rules */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw size={16} className="animate-spin text-slate-500 mr-2" />
          <span className="text-slate-500 text-sm">Loading rules...</span>
        </div>
      ) : rules.length === 0 && !showNewRule ? (
        <div className="text-center py-12">
          <Zap size={32} className="text-slate-700 mx-auto mb-3" />
          <p className="text-slate-500 text-sm font-medium mb-1">No distribution rules yet</p>
          <p className="text-slate-600 text-xs mb-4">Create rules to automatically route leads to your clients</p>
          <Button onClick={() => setShowNewRule(true)} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs">
            Create First Rule
          </Button>
        </div>
      ) : (
        <div className="space-y-3 mb-4">
          {rules.map(rule => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onToggle={(id, active) => toggleMutation.mutate({ id, active })}
            />
          ))}
        </div>
      )}

      {/* New Rule Form */}
      <AnimatePresence>
        {showNewRule && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="border border-indigo-500/30 rounded-2xl p-5 bg-indigo-500/5"
          >
            <h3 className="text-white font-bold text-sm mb-4 flex items-center gap-2">
              <Zap size={14} className="text-indigo-400" /> New Distribution Rule
            </h3>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 font-bold mb-1.5 block">Rule Name</label>
                <Input
                  value={newRule.name}
                  onChange={e => setNewRule(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Giovanni — DUI Leads"
                  className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 text-sm"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 font-bold mb-1.5 block">Signal Types to Route</label>
                <div className="grid grid-cols-2 gap-2">
                  {DISTRIBUTABLE_SIGNAL_TYPES.map(s => (
                    <button
                      key={s.value}
                      onClick={() => toggleSignalType(s.value)}
                      className={`text-left px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                        newRule.signalTypes.includes(s.value)
                          ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-300"
                          : "border-white/10 bg-white/5 text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 font-bold mb-1.5 block">Client Name</label>
                  <Input
                    value={newRule.targetAccountName}
                    onChange={e => setNewRule(p => ({ ...p, targetAccountName: e.target.value }))}
                    placeholder="e.g. Giovanni — Crash Connect"
                    className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-bold mb-1.5 block">Client Phone</label>
                  <Input
                    value={newRule.targetPhone}
                    onChange={e => setNewRule(p => ({ ...p, targetPhone: e.target.value }))}
                    placeholder="+1 (407) 000-0000"
                    className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 text-sm"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  onClick={() => createMutation.mutate()}
                  disabled={!newRule.name || newRule.signalTypes.length === 0 || !newRule.targetPhone || createMutation.isPending}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white"
                >
                  {createMutation.isPending ? "Creating..." : "Create Rule"}
                </Button>
                <Button
                  onClick={() => setShowNewRule(false)}
                  variant="outline"
                  className="border-white/10 text-slate-400 hover:text-white"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


// ── Home & Property Leads Tab ─────────────────────────────────────────────────

const NICHE_CONFIG: Record<string, { label: string; emoji: string; color: string; bg: string; border: string }> = {
  // Home & Property
  roofing:            { label: "Roofing",          emoji: "🏠", color: "text-orange-400",  bg: "bg-orange-500/10",  border: "border-orange-500/20" },
  hvac:               { label: "HVAC",              emoji: "❄️", color: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/20" },
  pool:               { label: "Pool",              emoji: "🏊", color: "text-cyan-400",    bg: "bg-cyan-500/10",    border: "border-cyan-500/20" },
  solar:              { label: "Solar",             emoji: "☀️", color: "text-yellow-400",  bg: "bg-yellow-500/10",  border: "border-yellow-500/20" },
  water_damage:       { label: "Water Damage",      emoji: "💧", color: "text-blue-300",    bg: "bg-blue-500/10",    border: "border-blue-500/20" },
  general_contractor: { label: "Contractor",        emoji: "🔨", color: "text-slate-400",   bg: "bg-slate-500/10",   border: "border-slate-500/20" },
  electrical:         { label: "Electrical",        emoji: "⚡", color: "text-yellow-300",  bg: "bg-yellow-500/10",  border: "border-yellow-500/20" },
  plumbing:           { label: "Plumbing",          emoji: "🔧", color: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/20" },
  painting:           { label: "Painting",          emoji: "🎨", color: "text-purple-400",  bg: "bg-purple-500/10",  border: "border-purple-500/20" },
  lawn_care:          { label: "Lawn Care",         emoji: "🌿", color: "text-green-400",   bg: "bg-green-500/10",   border: "border-green-500/20" },
  pest_control:       { label: "Pest Control",      emoji: "🐛", color: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/20" },
  pressure_washing:   { label: "Pressure Washing",  emoji: "💦", color: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/20" },
  landscaping:        { label: "Landscaping",       emoji: "🌳", color: "text-green-400",   bg: "bg-green-500/10",   border: "border-green-500/20" },
  fence:              { label: "Fence",             emoji: "🔒", color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/20" },
  // Beauty & Personal
  hair_salon:         { label: "Hair Salon",        emoji: "💇", color: "text-pink-400",    bg: "bg-pink-500/10",    border: "border-pink-500/20" },
  barber:             { label: "Barber",            emoji: "✂️", color: "text-indigo-400",  bg: "bg-indigo-500/10",  border: "border-indigo-500/20" },
  nail_salon:         { label: "Nail Salon",        emoji: "💅", color: "text-rose-400",    bg: "bg-rose-500/10",    border: "border-rose-500/20" },
  spa_massage:        { label: "Spa / Massage",     emoji: "🧖", color: "text-violet-400",  bg: "bg-violet-500/10",  border: "border-violet-500/20" },
  spa_esthetics:      { label: "Esthetics",         emoji: "🌸", color: "text-pink-300",    bg: "bg-pink-500/10",    border: "border-pink-500/20" },
  tattoo:             { label: "Tattoo",            emoji: "🎭", color: "text-slate-300",   bg: "bg-slate-500/10",   border: "border-slate-500/20" },
  // Auto
  auto_detailing:     { label: "Auto Detailing",    emoji: "🚗", color: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/20" },
  cleaning_service:   { label: "Cleaning",          emoji: "🧹", color: "text-teal-400",    bg: "bg-teal-500/10",    border: "border-teal-500/20" },
};

const SIGNAL_TYPE_LABELS: Record<string, string> = {
  noaa_weather_alert: "Weather Alert",
  permit_filing:      "Permit Filing",
  code_enforcement:   "Code Violation",
  new_license_filing: "New License",
  new_business:       "New Business",
  business_signal:    "Business Signal",
};

interface HomeLead {
  id: number;
  signalType: string;
  county: string;
  address?: string;
  ownerName?: string;
  ownerPhone?: string;
  serviceCategories: string[];
  urgency: string;
  description: string;
  status: string;
  score?: number;
  createdAt: string;
}

export function HomeLeadsTab({ onBack }: { onBack: () => void }) {
  const { currentAccount } = useAccount();
  const [filter, setFilter] = useState<string>("all");
  const [selected, setSelected] = useState<HomeLead | null>(null);

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["/api/home-service/leads", currentAccount?.id],
    queryFn: async () => {
      const res = await fetch(`/api/home-service/leads/${currentAccount!.id}`);
      if (!res.ok) throw new Error("Failed to fetch home service leads");
      const data = await res.json();
      return (data.leads || data) as HomeLead[];
    },
    enabled: !!currentAccount?.id,
    refetchInterval: 60000,
  });

  const filtered = filter === "all" ? leads : leads.filter(l =>
    (l.serviceCategories || []).includes(filter)
  );

  const allNiches = [...new Set(leads.flatMap(l => l.serviceCategories || []))];

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button onClick={onBack} className="text-slate-400 hover:text-white transition-colors">
          ← Back
        </button>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-600 to-teal-500 flex items-center justify-center">
            <span className="text-2xl">🏠</span>
          </div>
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight">HOME & PROPERTY LEADS</h1>
            <p className="text-slate-400 text-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Live signals — permits, weather alerts, business licenses, code enforcement
            </p>
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-2xl font-black text-white">{leads.length}</div>
          <div className="text-xs text-slate-500 uppercase tracking-widest">Active Leads</div>
        </div>
      </div>

      {/* Niche Filter Pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setFilter("all")}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
            filter === "all"
              ? "bg-white/10 text-white border-white/20"
              : "bg-white/5 text-slate-400 border-white/10 hover:border-white/20"
          }`}
        >
          All Niches ({leads.length})
        </button>
        {allNiches.map(niche => {
          const cfg = NICHE_CONFIG[niche];
          if (!cfg) return null;
          const count = leads.filter(l => (l.serviceCategories || []).includes(niche)).length;
          return (
            <button
              key={niche}
              onClick={() => setFilter(niche)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                filter === niche
                  ? `${cfg.bg} ${cfg.color} ${cfg.border}`
                  : "bg-white/5 text-slate-400 border-white/10 hover:border-white/20"
              }`}
            >
              {cfg.emoji} {cfg.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Lead Grid */}
      {isLoading ? (
        <div className="text-center py-20 text-slate-500">Loading home service leads...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">🏠</div>
          <div className="text-white font-bold text-xl mb-2">No leads yet</div>
          <div className="text-slate-500 text-sm">Signals are fetched every 30 minutes from permits, NOAA, DBPR, and code enforcement</div>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map(lead => {
            const primaryNiche = lead.serviceCategories?.[0];
            const cfg = NICHE_CONFIG[primaryNiche] || { label: primaryNiche, emoji: "📌", color: "text-slate-400", bg: "bg-slate-500/10", border: "border-slate-500/20" };
            const sigLabel = SIGNAL_TYPE_LABELS[lead.signalType] || lead.signalType;
            const urgencyColors: Record<string, string> = {
              critical: "text-red-400 bg-red-500/10 border-red-500/20",
              high: "text-orange-400 bg-orange-500/10 border-orange-500/20",
              medium: "text-amber-400 bg-amber-500/10 border-amber-500/20",
              low: "text-slate-400 bg-slate-500/10 border-slate-500/20",
            };

            return (
              <div
                key={lead.id}
                onClick={() => setSelected(selected?.id === lead.id ? null : lead)}
                className={`rounded-2xl border p-4 cursor-pointer transition-all ${cfg.bg} ${cfg.border} hover:scale-[1.01]`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{cfg.emoji}</span>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded border ${urgencyColors[lead.urgency] || urgencyColors.medium}`}>
                          {(lead.urgency || "medium").toUpperCase()}
                        </span>
                        <span className="text-xs text-slate-500">{sigLabel}</span>
                        <span className="text-xs text-slate-600">• {lead.county} County</span>
                      </div>
                      <p className="text-white font-semibold text-sm">{lead.description}</p>
                      {lead.address && <p className="text-slate-500 text-xs mt-0.5">📍 {lead.address}</p>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {lead.ownerPhone && (
                      <a
                        href={`tel:${lead.ownerPhone}`}
                        onClick={e => e.stopPropagation()}
                        className="px-3 py-1 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-bold hover:bg-green-500/20 transition-all"
                      >
                        📞 Call
                      </a>
                    )}
                    <div className="flex gap-1 flex-wrap justify-end">
                      {(lead.serviceCategories || []).map(cat => {
                        const c = NICHE_CONFIG[cat];
                        return c ? (
                          <span key={cat} className={`text-[10px] px-2 py-0.5 rounded font-bold border ${c.bg} ${c.color} ${c.border}`}>
                            {c.emoji} {c.label}
                          </span>
                        ) : null;
                      })}
                    </div>
                  </div>
                </div>

                {selected?.id === lead.id && (
                  <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-2 gap-3 text-sm">
                    {lead.ownerName && <div><span className="text-slate-500">Owner:</span> <span className="text-white">{lead.ownerName}</span></div>}
                    {lead.ownerPhone && <div><span className="text-slate-500">Phone:</span> <span className="text-white">{lead.ownerPhone}</span></div>}
                    <div><span className="text-slate-500">County:</span> <span className="text-white">{lead.county}</span></div>
                    <div><span className="text-slate-500">Source:</span> <span className="text-white">{sigLabel}</span></div>
                    <div><span className="text-slate-500">Status:</span> <span className="text-white">{lead.status}</span></div>
                    {lead.score && <div><span className="text-slate-500">Score:</span> <span className="text-white">{lead.score}/100</span></div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
