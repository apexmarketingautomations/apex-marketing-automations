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
  // home_service types (new_business_filing, salon_license) removed — belong in home pipeline

type LegalCategory = "criminal" | "family" | "traffic" | "personal_injury";

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
  // NOTE: "business" (salon_license, new_business_filing) are home/local service leads.
  // They are displayed in the Home & Property section, not here.
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
    queryFn: async () => {
      const res = await apiRequest("GET",
        `/api/sentinel/legal-signals?subAccountId=${activeAccountId}&category=${activeCategory}&limit=50`
      );
      return res.json();
    },
    refetchInterval: 60000,
    enabled: !!activeAccountId,
  });

  const signals: LegalSignal[] = Array.isArray(signalsData) ? signalsData : (signalsData?.signals ?? []);

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
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/sentinel/distribution-rules?subAccountId=${activeAccountId}`);
      return res.json();
    },
    enabled: !!activeAccountId,
  });

  const rules: DistributionRule[] = Array.isArray(rulesData) ? rulesData : (rulesData?.rules ?? []);

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
  roofing:            { label: "Roofing",         emoji: "🏠", color: "text-orange-400",  bg: "bg-orange-500/10",  border: "border-orange-500/20" },
  hvac:               { label: "HVAC",             emoji: "❄️", color: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/20" },
  pool:               { label: "Pool",             emoji: "🏊", color: "text-cyan-400",    bg: "bg-cyan-500/10",    border: "border-cyan-500/20" },
  solar:              { label: "Solar",            emoji: "☀️", color: "text-yellow-400",  bg: "bg-yellow-500/10",  border: "border-yellow-500/20" },
  water_damage:       { label: "Water Damage",     emoji: "💧", color: "text-blue-300",    bg: "bg-blue-500/10",    border: "border-blue-500/20" },
  general_contractor: { label: "Contractor",       emoji: "🔨", color: "text-slate-400",   bg: "bg-slate-500/10",   border: "border-slate-500/20" },
  electrical:         { label: "Electrical",       emoji: "⚡", color: "text-yellow-300",  bg: "bg-yellow-500/10",  border: "border-yellow-500/20" },
  plumbing:           { label: "Plumbing",         emoji: "🔧", color: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/20" },
  painting:           { label: "Painting",         emoji: "🎨", color: "text-purple-400",  bg: "bg-purple-500/10",  border: "border-purple-500/20" },
  lawn_care:          { label: "Lawn Care",        emoji: "🌿", color: "text-green-400",   bg: "bg-green-500/10",   border: "border-green-500/20" },
  pest_control:       { label: "Pest Control",     emoji: "🐛", color: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/20" },
  pressure_washing:   { label: "Pressure Washing", emoji: "💦", color: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/20" },
  landscaping:        { label: "Landscaping",      emoji: "🌳", color: "text-green-400",   bg: "bg-green-500/10",   border: "border-green-500/20" },
  fence:              { label: "Fence",            emoji: "🔒", color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/20" },
  hair_salon:         { label: "Hair Salon",       emoji: "💇", color: "text-pink-400",    bg: "bg-pink-500/10",    border: "border-pink-500/20" },
  barber:             { label: "Barber",           emoji: "✂️", color: "text-indigo-400",  bg: "bg-indigo-500/10",  border: "border-indigo-500/20" },
  nail_salon:         { label: "Nail Salon",       emoji: "💅", color: "text-rose-400",    bg: "bg-rose-500/10",    border: "border-rose-500/20" },
  spa_massage:        { label: "Spa / Massage",    emoji: "🧖", color: "text-violet-400",  bg: "bg-violet-500/10",  border: "border-violet-500/20" },
  auto_detailing:     { label: "Auto Detailing",   emoji: "🚗", color: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/20" },
  cleaning_service:   { label: "Cleaning",         emoji: "🧹", color: "text-teal-400",    bg: "bg-teal-500/10",    border: "border-teal-500/20" },
};

const SIGNAL_TYPE_LABELS: Record<string, string> = {
  noaa_weather_alert: "Weather Alert",
  permit_filing:      "Permit Filing",
  code_enforcement:   "Code Violation",
  new_license_filing: "New License",
  new_business:       "New Business",
  business_signal:    "Business Signal",
  fda_recall:         "FDA Recall",
  cpsc_recall:        "CPSC Recall",
  osha_incident:      "OSHA Incident",
};

const PIPELINE_STAGES = [
  { key: "new",        label: "New",       color: "text-slate-400  bg-slate-500/10  border-slate-500/30" },
  { key: "reviewing",  label: "Reviewing", color: "text-blue-400   bg-blue-500/10   border-blue-500/30" },
  { key: "contacted",  label: "Contacted", color: "text-violet-400 bg-violet-500/10 border-violet-500/30" },
  { key: "qualified",  label: "Qualified", color: "text-amber-400  bg-amber-500/10  border-amber-500/30" },
  { key: "booked",     label: "Booked",    color: "text-cyan-400   bg-cyan-500/10   border-cyan-500/30" },
  { key: "won",        label: "Won",       color: "text-green-400  bg-green-500/10  border-green-500/30" },
  { key: "lost",       label: "Lost",      color: "text-red-400    bg-red-500/10    border-red-500/30" },
];

interface HomeLead {
  id: number;
  signalType: string;
  county: string;
  address?: string;
  ownerName?: string;
  ownerPhone?: string;
  ownerEmail?: string;
  serviceCategories: string[];
  urgency: string;
  description: string;
  status: string;
  score?: number;
  scoreBreakdown?: string;   // repurposed as operator notes
  estimatedJobMin?: number;
  estimatedJobMax?: number;
  lat?: number;
  lng?: number;
  createdAt: string;
}

// Safely normalise whatever the API sends to a string[]
function safeCategories(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

// ── Lead Detail Drawer ──────────────────────────────────────────────────────
function LeadDrawer({
  lead,
  onClose,
  onStageChange,
  onNoteSave,
}: {
  lead: HomeLead;
  onClose: () => void;
  onStageChange: (id: number, stage: string) => void;
  onNoteSave: (id: number, notes: string) => void;
}) {
  const { toast } = useToast();
  const [notes, setNotes] = useState(lead.scoreBreakdown || "");
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const cats = safeCategories(lead.serviceCategories);
  const primaryCat = cats[0];
  const cfg = NICHE_CONFIG[primaryCat] || { label: primaryCat || "Lead", emoji: "📌", color: "text-slate-400", bg: "bg-slate-500/10", border: "border-slate-500/20" };
  const currentStage = PIPELINE_STAGES.find(s => s.key === lead.status) || PIPELINE_STAGES[0];

  async function generateAISummary() {
    setAiLoading(true);
    setAiSummary(null);
    try {
      const res = await apiRequest("POST", "/api/ai/chat", {
        messages: [
          { role: "system", content: "You are a concise lead analyst. Summarise this lead in 2-3 sentences and give one specific outreach angle." },
          { role: "user", content: `Lead: ${lead.description || ""}. Signal: ${SIGNAL_TYPE_LABELS[lead.signalType] || lead.signalType}. County: ${lead.county}. Services needed: ${cats.join(", ")}. Score: ${lead.score ?? "N/A"}/100.` },
        ],
        maxTokens: 120,
      });
      setAiSummary(res.text || res.message || "AI summary unavailable.");
    } catch {
      setAiSummary("AI provider not configured. Add OPENAI_APEX_INT_KEY or Gemini_API_Key_saas to Railway env vars.");
    } finally {
      setAiLoading(false);
    }
  }

  const mapsUrl = lead.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.address)}`
    : lead.lat && lead.lng
    ? `https://www.google.com/maps?q=${lead.lat},${lead.lng}`
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 280 }}
        className="relative z-10 h-full w-full max-w-md bg-[#0d0f14] border-l border-white/10 overflow-y-auto flex flex-col"
      >
        {/* Header */}
        <div className={`p-5 border-b border-white/10 ${cfg.bg}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-3xl">{cfg.emoji}</span>
              <div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-0.5">
                  {SIGNAL_TYPE_LABELS[lead.signalType] || lead.signalType} · {lead.county} County
                </div>
                <h2 className="text-white font-black text-lg leading-tight">
                  {lead.ownerName || lead.description?.slice(0, 60) || "Unknown Lead"}
                </h2>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none flex-shrink-0">✕</button>
          </div>

          {/* Score badge */}
          {lead.score != null && (
            <div className="mt-3 flex items-center gap-3">
              <div className="flex-1 bg-white/10 rounded-full h-1.5">
                <div className="h-1.5 rounded-full bg-gradient-to-r from-amber-500 to-green-400" style={{ width: `${lead.score}%` }} />
              </div>
              <span className="text-xs font-bold text-white">{lead.score}/100</span>
            </div>
          )}
        </div>

        <div className="flex-1 p-5 space-y-5">
          {/* Pipeline Stage */}
          <div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Pipeline Stage</div>
            <div className="flex flex-wrap gap-1.5">
              {PIPELINE_STAGES.map(stage => (
                <button
                  key={stage.key}
                  onClick={() => onStageChange(lead.id, stage.key)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all ${
                    lead.status === stage.key
                      ? stage.color
                      : "text-slate-500 bg-white/5 border-white/10 hover:border-white/20"
                  }`}
                >
                  {stage.label}
                </button>
              ))}
            </div>
          </div>

          {/* Contact Info */}
          <div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Contact</div>
            <div className="space-y-2">
              {lead.ownerName && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-500 w-16 flex-shrink-0">Name</span>
                  <span className="text-white font-medium">{lead.ownerName}</span>
                </div>
              )}
              {lead.ownerPhone && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-500 w-16 flex-shrink-0">Phone</span>
                  <a href={`tel:${lead.ownerPhone}`} className="text-green-400 font-mono hover:text-green-300">{lead.ownerPhone}</a>
                </div>
              )}
              {lead.ownerEmail && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-500 w-16 flex-shrink-0">Email</span>
                  <a href={`mailto:${lead.ownerEmail}`} className="text-blue-400 hover:text-blue-300 break-all">{lead.ownerEmail}</a>
                </div>
              )}
              {lead.address && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-500 w-16 flex-shrink-0">Address</span>
                  <span className="text-slate-300">{lead.address}</span>
                </div>
              )}
            </div>
          </div>

          {/* CRM Actions */}
          <div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Outreach</div>
            <div className="grid grid-cols-3 gap-2">
              {lead.ownerPhone && (
                <a
                  href={`tel:${lead.ownerPhone}`}
                  className="flex flex-col items-center gap-1 p-3 rounded-xl bg-green-500/10 border border-green-500/20 hover:bg-green-500/20 transition-all"
                >
                  <span className="text-lg">📞</span>
                  <span className="text-xs font-bold text-green-400">Call</span>
                </a>
              )}
              {lead.ownerPhone && (
                <a
                  href={`sms:${lead.ownerPhone}`}
                  className="flex flex-col items-center gap-1 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 transition-all"
                >
                  <span className="text-lg">💬</span>
                  <span className="text-xs font-bold text-blue-400">SMS</span>
                </a>
              )}
              {lead.ownerEmail && (
                <a
                  href={`mailto:${lead.ownerEmail}?subject=Home%20Service%20Inquiry`}
                  className="flex flex-col items-center gap-1 p-3 rounded-xl bg-violet-500/10 border border-violet-500/20 hover:bg-violet-500/20 transition-all"
                >
                  <span className="text-lg">📧</span>
                  <span className="text-xs font-bold text-violet-400">Email</span>
                </a>
              )}
              {mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center gap-1 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 transition-all"
                >
                  <span className="text-lg">🗺️</span>
                  <span className="text-xs font-bold text-amber-400">Maps</span>
                </a>
              )}
            </div>
          </div>

          {/* Source Metadata */}
          <div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Source Data</div>
            <div className="rounded-xl bg-white/5 border border-white/10 p-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Signal Type</span>
                <span className="text-slate-300 font-medium">{SIGNAL_TYPE_LABELS[lead.signalType] || lead.signalType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">County</span>
                <span className="text-slate-300">{lead.county}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Urgency</span>
                <span className={`font-bold ${lead.urgency === "critical" ? "text-red-400" : lead.urgency === "high" ? "text-orange-400" : "text-amber-400"}`}>
                  {(lead.urgency || "medium").toUpperCase()}
                </span>
              </div>
              {lead.estimatedJobMin != null && lead.estimatedJobMax != null && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Est. Job Value</span>
                  <span className="text-green-400 font-bold">${lead.estimatedJobMin.toLocaleString()}–${lead.estimatedJobMax.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">Detected</span>
                <span className="text-slate-400 text-xs">{new Date(lead.createdAt).toLocaleString()}</span>
              </div>
              <div className="flex flex-wrap gap-1 pt-1">
                {cats.map(cat => {
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

          {/* AI Summary */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">AI Summary</div>
              <button
                onClick={generateAISummary}
                disabled={aiLoading}
                className="text-xs px-3 py-1 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400 hover:bg-violet-500/20 transition-all disabled:opacity-50"
              >
                {aiLoading ? "Thinking..." : "Generate ✨"}
              </button>
            </div>
            {aiSummary ? (
              <div className="rounded-xl bg-violet-500/5 border border-violet-500/20 p-3 text-sm text-slate-300 leading-relaxed">
                {aiSummary}
              </div>
            ) : (
              <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-xs text-slate-600">
                Click Generate to get an AI-written outreach angle for this lead.
              </div>
            )}
          </div>

          {/* Operator Notes */}
          <div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Notes</div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add operator notes..."
              rows={3}
              className="w-full rounded-xl bg-white/5 border border-white/10 focus:border-violet-500/50 outline-none px-3 py-2 text-sm text-white placeholder:text-slate-600 resize-none"
            />
            <button
              onClick={() => { onNoteSave(lead.id, notes); toast({ title: "Notes saved" }); }}
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

export function HomeLeadsTab({ onBack }: { onBack: () => void }) {
  const { currentAccount } = useAccount();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>("all");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [selected, setSelected] = useState<HomeLead | null>(null);

  const { data: raw, isLoading, error } = useQuery({
    queryKey: ["/api/home-service/leads", currentAccount?.id],
    queryFn: async () => {
      const res = await fetch(`/api/home-service/leads/${currentAccount!.id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!currentAccount?.id,
    refetchInterval: 60_000,
  });

  // Defensive normalisation: API returns { leads: [...], scope, contractorCount }
  const leads: HomeLead[] = (() => {
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.leads) ? raw.leads : [];
    return arr.map((l: any) => ({ ...l, serviceCategories: safeCategories(l.serviceCategories) }));
  })();

  const patchLead = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/home-service/leads/${id}`, body);
      return res;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/home-service/leads", currentAccount?.id] }),
  });

  function handleStageChange(id: number, stage: string) {
    // Optimistic update on the selected lead
    setSelected(prev => prev && prev.id === id ? { ...prev, status: stage } : prev);
    patchLead.mutate({ id, body: { stage } });
    toast({ title: `Stage → ${stage}` });
  }

  function handleNoteSave(id: number, notes: string) {
    patchLead.mutate({ id, body: { notes } });
  }

  const allNiches = [...new Set(leads.flatMap(l => l.serviceCategories))];

  const filtered = leads.filter(l => {
    const cats = l.serviceCategories;
    const matchesNiche = filter === "all" || cats.includes(filter);
    const matchesStage = stageFilter === "all" || l.status === stageFilter;
    return matchesNiche && matchesStage;
  });

  const stageCounts = PIPELINE_STAGES.reduce((acc, s) => {
    acc[s.key] = leads.filter(l => l.status === s.key).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button onClick={onBack} className="text-slate-400 hover:text-white transition-colors">← Back</button>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-600 to-teal-500 flex items-center justify-center">
            <span className="text-2xl">🏠</span>
          </div>
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight">HOME & PROPERTY LEADS</h1>
            <p className="text-slate-400 text-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Live signals — permits, weather alerts, DBPR licenses, code enforcement
            </p>
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-2xl font-black text-white">{leads.length}</div>
          <div className="text-xs text-slate-500 uppercase tracking-widest">Total Leads</div>
        </div>
      </div>

      {/* Pipeline Stage Bar */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        <button
          onClick={() => setStageFilter("all")}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold border whitespace-nowrap transition-all flex-shrink-0 ${stageFilter === "all" ? "bg-white/10 text-white border-white/20" : "bg-white/5 text-slate-400 border-white/10 hover:border-white/20"}`}
        >
          All Stages ({leads.length})
        </button>
        {PIPELINE_STAGES.map(stage => (
          <button
            key={stage.key}
            onClick={() => setStageFilter(stage.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border whitespace-nowrap transition-all flex-shrink-0 ${stageFilter === stage.key ? stage.color : "bg-white/5 text-slate-400 border-white/10 hover:border-white/20"}`}
          >
            {stage.label} ({stageCounts[stage.key] ?? 0})
          </button>
        ))}
      </div>

      {/* Niche Filter Pills */}
      {allNiches.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${filter === "all" ? "bg-white/10 text-white border-white/20" : "bg-white/5 text-slate-400 border-white/10 hover:border-white/20"}`}
          >
            All Niches
          </button>
          {allNiches.map(niche => {
            const cfg = NICHE_CONFIG[niche];
            if (!cfg) return null;
            const count = leads.filter(l => l.serviceCategories.includes(niche)).length;
            return (
              <button
                key={niche}
                onClick={() => setFilter(niche)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${filter === niche ? `${cfg.bg} ${cfg.color} ${cfg.border}` : "bg-white/5 text-slate-400 border-white/10 hover:border-white/20"}`}
              >
                {cfg.emoji} {cfg.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* States */}
      {isLoading ? (
        <div className="text-center py-20 text-slate-500">
          <div className="animate-spin text-4xl mb-4">⚙️</div>
          Loading home service leads...
        </div>
      ) : error ? (
        <div className="text-center py-20">
          <div className="text-4xl mb-4">⚠️</div>
          <div className="text-red-400 font-bold mb-2">Failed to load leads</div>
          <div className="text-slate-500 text-sm">{String(error)}</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">🏠</div>
          <div className="text-white font-bold text-xl mb-2">
            {leads.length === 0 ? "No leads yet" : "No leads match this filter"}
          </div>
          <div className="text-slate-500 text-sm">
            {leads.length === 0
              ? "Signals are fetched every 30 minutes from permits, NOAA, DBPR, and code enforcement"
              : "Try a different stage or niche filter"}
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          {filtered.map(lead => {
            const cats = lead.serviceCategories;
            const primaryNiche = cats[0];
            const cfg = NICHE_CONFIG[primaryNiche] || { label: primaryNiche || "Lead", emoji: "📌", color: "text-slate-400", bg: "bg-slate-500/10", border: "border-slate-500/20" };
            const sigLabel = SIGNAL_TYPE_LABELS[lead.signalType] || lead.signalType;
            const stage = PIPELINE_STAGES.find(s => s.key === lead.status) || PIPELINE_STAGES[0];
            const urgencyColors: Record<string, string> = {
              critical: "text-red-400 bg-red-500/10 border-red-500/20",
              high:     "text-orange-400 bg-orange-500/10 border-orange-500/20",
              medium:   "text-amber-400 bg-amber-500/10 border-amber-500/20",
              low:      "text-slate-400 bg-slate-500/10 border-slate-500/20",
            };

            return (
              <div
                key={lead.id}
                onClick={() => setSelected(lead)}
                className={`rounded-2xl border p-4 cursor-pointer transition-all hover:scale-[1.005] ${cfg.bg} ${cfg.border}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-2xl flex-shrink-0">{cfg.emoji}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded border ${urgencyColors[lead.urgency] || urgencyColors.medium}`}>
                          {(lead.urgency || "medium").toUpperCase()}
                        </span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded border ${stage.color}`}>
                          {stage.label}
                        </span>
                        <span className="text-xs text-slate-500">{sigLabel}</span>
                        <span className="text-xs text-slate-600">· {lead.county}</span>
                      </div>
                      <p className="text-white font-semibold text-sm truncate">
                        {lead.ownerName ? `${lead.ownerName} — ` : ""}{lead.description}
                      </p>
                      {lead.address && <p className="text-slate-500 text-xs mt-0.5 truncate">📍 {lead.address}</p>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {lead.score != null && (
                      <div className="text-xs font-black text-white bg-white/10 px-2 py-0.5 rounded">{lead.score}</div>
                    )}
                    {lead.ownerPhone && (
                      <a
                        href={`tel:${lead.ownerPhone}`}
                        onClick={e => e.stopPropagation()}
                        className="px-3 py-1 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-bold hover:bg-green-500/20 transition-all"
                      >
                        📞 Call
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail Drawer */}
      <AnimatePresence>
        {selected && (
          <LeadDrawer
            lead={selected}
            onClose={() => setSelected(null)}
            onStageChange={handleStageChange}
            onNoteSave={handleNoteSave}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Provider Configuration Tab ─────────────────────────────────────────────
export function ProviderConfigTab({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();
  const { data: status, isLoading, refetch } = useQuery({
    queryKey: ["/api/ai/status"],
    queryFn: async () => {
      const res = await fetch("/api/ai/status");
      if (!res.ok) throw new Error("Failed to fetch AI status");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; latency: number; reply?: string; error?: string }>>({});

  async function runTest() {
    const start = Date.now();
    setTesting("active");
    try {
      const res = await apiRequest("POST", "/api/ai/chat", {
        messages: [{ role: "user", content: "Reply with exactly: PROVIDER_OK" }],
        maxTokens: 10,
        route: "provider-connectivity-test",
      });
      const ok = !!res.text;
      setTestResults(prev => ({
        ...prev,
        active: { ok, latency: Date.now() - start, reply: res.text?.slice(0, 60), error: res.errorMessage },
      }));
      toast({ title: ok ? "✅ AI responded successfully" : "⚠️ AI call returned but empty" });
    } catch (e: any) {
      setTestResults(prev => ({
        ...prev,
        active: { ok: false, latency: Date.now() - start, error: e.message },
      }));
      toast({ title: "❌ AI test failed", description: e.message, variant: "destructive" });
    } finally {
      setTesting(null);
      refetch();
    }
  }

  const PROVIDER_META = [
    {
      key: "anthropic",
      name: "Anthropic Claude",
      emoji: "🟠",
      envVar: "ANTHROPIC_API_KEY",
      model: "claude-sonnet-4-20250514",
      docUrl: "https://console.anthropic.com/keys",
      note: "PRIMARY — preferred when key is set",
      priorityLabel: "#1 Primary",
    },
    {
      key: "openai",
      name: "OpenAI",
      emoji: "🤖",
      envVar: "OPENAI_APEX_INT_KEY",
      model: "gpt-4o-mini",
      docUrl: "https://platform.openai.com/api-keys",
      note: "Fallback if Anthropic unavailable",
      priorityLabel: "#2 Fallback",
    },
    {
      key: "gemini",
      name: "Google Gemini",
      emoji: "♊",
      envVar: "Gemini_API_Key_saas",
      model: "gemini-2.5-flash",
      docUrl: "https://aistudio.google.com/app/apikey",
      note: "Final fallback — limited tool support",
      priorityLabel: "#3 Final Fallback",
    },
  ];

  const activeProvider = status?.activeProvider;
  const configured     = status?.configured;

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={onBack} className="text-slate-400 hover:text-white transition-colors">← Back</button>
        <div>
          <h1 className="text-3xl font-black text-white tracking-tight">AI PROVIDERS</h1>
          <p className="text-slate-400 text-sm mt-0.5">Registry · diagnostics · fallback chain</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className={`px-3 py-1.5 rounded-xl border text-xs font-black ${configured ? "text-green-400 bg-green-500/10 border-green-500/20" : "text-red-400 bg-red-500/10 border-red-500/20"}`}>
            {isLoading ? "Checking..." : configured ? `✅ AI ONLINE` : "❌ NO PROVIDER"}
          </div>
        </div>
      </div>

      {/* Active provider + test */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 mb-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Active Provider</div>
            <div className="text-xl font-black text-white">
              {isLoading ? "Loading..." : activeProvider === "anthropic" ? "🟠 Anthropic Claude" : activeProvider === "openai" ? "🤖 OpenAI" : activeProvider === "gemini" ? "♊ Gemini" : "❌ None"}
            </div>
            {status?.fallbackChain?.length > 0 && (
              <div className="text-xs text-slate-500 mt-1">
                Chain: {status.fallbackChain.join(" → ")}
              </div>
            )}
          </div>
          <button
            onClick={runTest}
            disabled={!!testing || !configured}
            className="px-5 py-2.5 rounded-xl font-bold text-sm border transition-all disabled:opacity-40 bg-violet-500/10 border-violet-500/30 text-violet-300 hover:bg-violet-500/20"
          >
            {testing ? "Testing…" : "Test Active Provider"}
          </button>
        </div>

        {testResults.active && (
          <div className={`mt-4 rounded-xl p-3 text-xs border flex items-start gap-2 ${testResults.active.ok ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-red-500/10 border-red-500/20 text-red-400"}`}>
            <span>{testResults.active.ok ? "✅" : "❌"}</span>
            <div>
              <div className="font-bold">{testResults.active.ok ? `Response OK in ${testResults.active.latency}ms` : `Failed (${testResults.active.latency}ms)`}</div>
              {testResults.active.reply  && <div className="text-slate-400 mt-0.5">Reply: "{testResults.active.reply}"</div>}
              {testResults.active.error  && <div className="mt-0.5">{testResults.active.error}</div>}
            </div>
          </div>
        )}
      </div>

      {/* No provider warning */}
      {!isLoading && !configured && (
        <div className="mb-6 rounded-2xl bg-red-500/10 border border-red-500/30 p-4">
          <div className="font-bold text-red-400 mb-1">⚠️ No AI provider configured</div>
          <p className="text-slate-400 text-sm">
            All AI features are disabled: lead summaries, outreach generation, call analysis, task agent.
            Add <code className="bg-white/10 px-1 rounded">ANTHROPIC_API_KEY</code> to Railway env vars to enable immediately.
          </p>
        </div>
      )}

      {/* Provider cards */}
      <div className="space-y-3">
        {PROVIDER_META.map(p => {
          const info        = status?.providers?.[p.key];
          const isCfg       = info?.configured;
          const isActive    = activeProvider === p.key;

          return (
            <div
              key={p.key}
              className={`rounded-2xl border p-5 transition-all ${
                isActive  ? "border-violet-500/40 bg-violet-500/5" :
                isCfg     ? "border-green-500/20 bg-green-500/5"  :
                            "border-white/10 bg-white/5"
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{p.emoji}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-white font-bold">{p.name}</span>
                      {isActive && <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">ACTIVE</span>}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">{p.priorityLabel} · {p.note}</div>
                  </div>
                </div>
                <div className={`text-xs font-black px-2.5 py-1 rounded-lg border ${isCfg ? "text-green-400 bg-green-500/10 border-green-500/20" : "text-slate-500 bg-white/5 border-white/10"}`}>
                  {isCfg ? "✓ Ready" : "Not set"}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                <div className="text-slate-500">Env var</div>
                <code className="text-xs text-slate-300 font-mono">{p.envVar}</code>

                <div className="text-slate-500">Key present</div>
                <span className={info?.keyPresent ? "text-green-400" : "text-red-400"}>
                  {info?.keyPresent ? `Yes — ${info.keyPrefix}` : "No"}
                </span>

                <div className="text-slate-500">Model</div>
                <span className="text-slate-400 text-xs">{p.model}</span>
              </div>

              {!isCfg && (
                <a
                  href={p.docUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                >
                  Get API key at {p.docUrl.replace("https://", "").split("/")[0]} →
                </a>
              )}
            </div>
          );
        })}
      </div>

      {/* Railway setup */}
      <div className="mt-6 rounded-2xl bg-white/5 border border-white/10 p-5">
        <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Add a key to Railway</div>
        <ol className="space-y-1.5 text-sm text-slate-400">
          <li><span className="text-white font-bold">1.</span> Railway → your service → <strong>Variables</strong> tab</li>
          <li><span className="text-white font-bold">2.</span> Click <strong>New Variable</strong></li>
          <li><span className="text-white font-bold">3.</span> Name: <code className="bg-white/10 px-1 rounded text-xs text-slate-200">ANTHROPIC_API_KEY</code> · Value: your key</li>
          <li><span className="text-white font-bold">4.</span> Click <strong>Add</strong> — Railway redeploys automatically</li>
          <li><span className="text-white font-bold">5.</span> Return here and click <strong>Test Active Provider</strong></li>
        </ol>
      </div>
    </div>
  );
}
