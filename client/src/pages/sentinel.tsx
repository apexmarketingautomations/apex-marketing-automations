import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAccount } from "@/hooks/use-account";
import { useToast } from "@/hooks/use-toast";
import {
  Satellite, Radar, MapPin, Phone, Crosshair, AlertTriangle, CheckCircle2,
  Settings, Play, Pause, Radio, Shield, Clock, ChevronRight, ChevronLeft, Send, Target, Zap, Eye, BookOpen, Lock, ArrowUpCircle, Plus, ExternalLink, Globe, MessageSquare, AlertCircle, Home
} from "lucide-react";
import { TutorialOverlay, useTutorial } from "@/components/tutorial-overlay";
import { LegalLeadsTab, DistributionTab } from "@/pages/LegalLeadsTab";
import { SENTINEL_STEPS } from "@/components/tutorial-steps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useLocation } from "wouter";
import type { SubAccount, SentinelIncident, SentinelConfig, CadUnitAssigned, CadTimelineEvent } from "@shared/schema";
import { hasFeature } from "@shared/schema";

function parseCadUnits(val: unknown): CadUnitAssigned[] {
  if (!val || !Array.isArray(val)) return [];
  return val.filter((u: any) => u && typeof u === "object" && typeof u.unitId === "string");
}

function parseCadTimeline(val: unknown): CadTimelineEvent[] {
  if (!val || !Array.isArray(val)) return [];
  return val.filter((e: any) => e && typeof e === "object" && typeof e.timestamp === "string" && typeof e.event === "string");
}

function getProvenanceLabel(incident: SentinelIncident): { label: string; color: string } {
  if (incident.cadSource) {
    return { label: `Source: CAD \u2014 ${incident.cadSource}`, color: "text-cyan-400" };
  }
  const raw = incident.rawPayload as any;
  if (raw && (raw.source === "fhp_hsmv" || raw.source === "fhp")) {
    return { label: "Source: FHP Blotter", color: "text-amber-400" };
  }
  return { label: "Source: Sentinel Detection", color: "text-slate-400" };
}

interface SentinelRawPayload {
  id?: string;
  lat?: number | null;
  lng?: number | null;
  type?: string;
  source?: string;
  state?: string;
  county?: string;
  remarks?: string;
  received?: string;
  distanceMiles?: string | number;
  googleMaps?: string;
}

function parseRawPayload(raw: unknown): SentinelRawPayload {
  if (raw && typeof raw === "object") return raw as SentinelRawPayload;
  return {};
}

const SEVERITY_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  critical: { bg: "bg-red-500/20", text: "text-red-500", border: "border-red-500/30", label: "CRITICAL" },
  high: { bg: "bg-orange-500/20", text: "text-orange-500", border: "border-orange-500/30", label: "HIGH VALUE" },
  medium: { bg: "bg-amber-500/20", text: "text-amber-500", border: "border-amber-500/30", label: "MEDIUM" },
  low: { bg: "bg-slate-500/20", text: "text-slate-400", border: "border-slate-500/30", label: "LOW" },
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDateTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

export default function Sentinel() {
  const [location, navigate] = useLocation();
  const { showTutorial, startTutorial, closeTutorial } = useTutorial("apex_tutorial_sentinel");

  // ── Tab routing — ?tab=home|legal|distribution|crash ──
  const urlParams = new URLSearchParams(location.includes("?") ? location.split("?")[1] : "");
  const activeTab = urlParams.get("tab") ?? "crash";
  const setActiveTab = (tab: string) => navigate(`/sentinel?tab=${tab}`);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { activeAccountId } = useAccount();
  const [showConfig, setShowConfig] = useState(false);
  const [scanPulse, setScanPulse] = useState(false);
  const [configForm, setConfigForm] = useState({
    keywords: "",
    scanInterval: 60,
    enabled: false,
    smsAlertEnabled: true,
    smsAlertPhone: "",
    geofenceEnabled: true,
    geofenceRadiusMiles: 1,
    targetCities: "",
    targetStates: "",
    niche: "accident" as "accident" | "home_services",
    homeSvcConfig: null as any,
  });
  const [originalNiche, setOriginalNiche] = useState<"accident" | "home_services">("accident");
  const [nicheChangeConfirmed, setNicheChangeConfirmed] = useState(false);
  const [locationFilter, setLocationFilter] = useState("");
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [reportForm, setReportForm] = useState({ title: "", location: "", description: "", severity: "medium" });
  const [selectedIncident, setSelectedIncident] = useState<SentinelIncident | null>(null);

  const { data: accounts = [] } = useQuery<SubAccount[]>({ queryKey: ["/api/accounts"] });
  const currentAccount = accounts.find(a => a.id === activeAccountId) || accounts[0];
  const accountPlan = (currentAccount as any)?.plan || 'starter';
  const hasSentinelAccess = hasFeature(accountPlan, 'sentinel');

  const { data: config } = useQuery<SentinelConfig>({
    queryKey: ["/api/sentinel/config", currentAccount?.id],
    enabled: !!currentAccount?.id && hasSentinelAccess,
    queryFn: async () => {
      const res = await fetch(`/api/sentinel/config/${currentAccount!.id}`);
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      return res.json();
    },
  });

  const { data: incidents = [], isLoading: loadingIncidents } = useQuery<SentinelIncident[]>({
    queryKey: ["/api/sentinel/incidents", currentAccount?.id],
    enabled: !!currentAccount?.id && hasSentinelAccess,
    queryFn: async () => {
      const res = await fetch(`/api/sentinel/incidents/${currentAccount!.id}`);
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      return res.json();
    },
    refetchInterval: 3_600_000,
  });

  useEffect(() => {
    if (config) {
      const niche = (config.niche === 'home_services' ? 'home_services' : 'accident') as "accident" | "home_services";
      setConfigForm({
        keywords: (config.keywords || []).join(", "),
        scanInterval: config.scanInterval || 60,
        enabled: config.enabled || false,
        smsAlertEnabled: config.smsAlertEnabled !== false,
        smsAlertPhone: config.smsAlertPhone || "",
        geofenceEnabled: config.geofenceEnabled !== false,
        geofenceRadiusMiles: config.geofenceRadiusMiles || 1,
        targetCities: ((config as any).targetCities || []).join(", "),
        targetStates: ((config as any).targetStates || []).join(", "),
        niche,
        homeSvcConfig: (config as any)?.homeSvcConfig ?? null,
      });
      setOriginalNiche(niche);
      setNicheChangeConfirmed(false);
    }
  }, [config]);

  const scanMutation = useMutation({
    mutationFn: async () => {
      setScanPulse(true);
      const res = await apiRequest("POST", "/api/sentinel/scan", { subAccountId: currentAccount!.id });
      return res.json();
    },
    onSuccess: (data: any) => {
      setTimeout(() => setScanPulse(false), 2000);
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/incidents", currentAccount?.id] });
      toast({
        title: `Scan Complete — ${data.found} incident${data.found !== 1 ? "s" : ""} detected`,
        description: data.found > 0 ? `Live data from ${data.source}` : "No incidents found from live feeds",
      });
    },
    onError: () => {
      setScanPulse(false);
      toast({ title: "Scan failed", variant: "destructive" });
    },
  });

  const geofenceMutation = useMutation({
    mutationFn: async (incidentId: number) => {
      const res = await apiRequest("POST", `/api/sentinel/incidents/${incidentId}/deploy-geofence`);
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.metaAdsStatus === "SIMULATION_MODE") {
        toast({
          variant: "destructive",
          title: "NOT deployed — Meta Ads not connected",
          description: "Geofence was simulated only. No live ad was created. Connect Meta Ads in Integrations Hub to actually deploy.",
        });
      } else {
        toast({ title: "Geofence Deployed!", description: data.message });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/incidents", currentAccount?.id] });
    },
  });

  const smsMutation = useMutation({
    mutationFn: async (incidentId: number) => {
      const res = await apiRequest("POST", `/api/sentinel/incidents/${incidentId}/send-sms`);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "SMS Alert Sent!", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/incidents", currentAccount?.id] });
    },
    onError: (err: any) => {
      toast({ title: "SMS Failed", description: err.message || "Check owner phone number", variant: "destructive" });
    },
  });

  const ackMutation = useMutation({
    mutationFn: async (incidentId: number) => {
      const res = await apiRequest("POST", `/api/sentinel/incidents/${incidentId}/acknowledge`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/incidents", currentAccount?.id] });
    },
  });

  const markLeadMutation = useMutation({
    mutationFn: async (incidentId: number) => {
      const res = await apiRequest("POST", `/api/sentinel/incidents/${incidentId}/flag-lead`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Lead flagged", description: "Incident marked for follow-up." });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/incidents", currentAccount?.id] });
    },
    onError: (err: any) => {
      toast({
        title:       "Could not flag lead",
        description: err.message || "Check incident type and try again.",
        variant:     "destructive",
      });
    },
  });

  const nicheChanged = configForm.niche !== originalNiche;
  const nicheSaveBlocked = nicheChanged && !nicheChangeConfirmed;

  const configMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/sentinel/config", {
        subAccountId: currentAccount!.id,
        keywords: configForm.keywords.split(",").map(k => k.trim()).filter(Boolean),
        scanInterval: configForm.scanInterval,
        enabled: configForm.enabled,
        smsAlertEnabled: configForm.smsAlertEnabled,
        smsAlertPhone: configForm.smsAlertPhone || null,
        geofenceEnabled: configForm.geofenceEnabled,
        geofenceRadiusMiles: configForm.geofenceRadiusMiles,
        targetCities: configForm.targetCities.split(",").map(c => c.trim()).filter(Boolean),
        targetStates: configForm.targetStates.split(",").map(s => s.trim()).filter(Boolean),
        niche: configForm.niche,
        homeSvcConfig: configForm.homeSvcConfig ?? null,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Sentinel config saved!" });
      setOriginalNiche(configForm.niche);
      setNicheChangeConfirmed(false);
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/config", currentAccount?.id] });
      setShowConfig(false);
    },
  });

  const reportMutation = useMutation({
    mutationFn: async (data: typeof reportForm) => {
      const res = await apiRequest("POST", "/api/sentinel/incidents", {
        subAccountId: currentAccount!.id,
        title: data.title,
        location: data.location,
        description: data.description || undefined,
        severity: data.severity,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/incidents", currentAccount?.id] });
      toast({ title: "Incident reported" });
      setReportForm({ title: "", location: "", description: "", severity: "medium" });
      setShowReportDialog(false);
    },
  });

  const filteredIncidents = locationFilter
    ? incidents.filter(i => (i.location || "").toLowerCase().includes(locationFilter.toLowerCase()))
    : incidents;
  const getPriorityScore = (i: SentinelIncident) =>
    (i.rawPayload as any)?.priorityScore ?? 0;

  const pendingIncidents = filteredIncidents
    .filter(i => i.actionStatus === "pending")
    .sort((a, b) => getPriorityScore(b) - getPriorityScore(a));

  const actionedIncidents = filteredIncidents
    .filter(i => i.actionStatus !== "pending")
    .sort((a, b) => new Date(b.detectedAt as any).getTime() - new Date(a.detectedAt as any).getTime());

  const criticalCount  = filteredIncidents.filter(i => i.severity === "critical" || i.severity === "high").length;
  const urgentCount    = filteredIncidents.filter(i => (i.rawPayload as any)?.operatorPriority === 'urgent').length;

  const liveSelectedIncident = selectedIncident
    ? incidents.find(i => i.id === selectedIncident.id) || selectedIncident
    : null;

  if (liveSelectedIncident) {
    const isHomeSvcIncident =
      (liveSelectedIncident.rawPayload as any)?.source === 'sentinel_home_svc';

    // ── Show legal leads tab (simple MVP view) ──────────────────────────────
  if (activeTab === "legal") {
    return <LegalLeadsTab onBack={() => setActiveTab("crash")} />;
  }

  // ── Show distribution tab ────────────────────────────────────────────────
  if (activeTab === "distribution") {
    return <DistributionTab onBack={() => setActiveTab("crash")} />;
  }

  return (
      <div className="p-6 md:p-10 max-w-6xl mx-auto">
        {/* ── Unified Sentinel Tab Bar ── */}
        <div className="flex gap-1 mb-6 bg-white/5 border border-white/10 rounded-2xl p-1">
          {[
            { key: "crash",        label: "Crash Leads",     icon: "🚨", desc: "PI Attorneys" },
            { key: "home",         label: "Home & Property",  icon: "🏠", desc: "Contractors" },
            { key: "legal",        label: "Legal Signals",    icon: "⚖️", desc: "All Attorneys" },
            { key: "distribution", label: "Distribution",     icon: "📡", desc: "Routing Rules" },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={[
                "flex-1 flex flex-col items-center gap-0.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all",
                activeTab === tab.key
                  ? "bg-white/10 text-white border border-white/20"
                  : "text-slate-500 hover:text-slate-300 hover:bg-white/5",
              ].join(" ")}
            >
              <span className="text-base">{tab.icon}</span>
              <span>{tab.label}</span>
              <span className={"text-[9px] font-normal " + (activeTab === tab.key ? "text-slate-400" : "text-slate-600")}>{tab.desc}</span>
            </button>
          ))}
        </div>
        {isHomeSvcIncident ? (
          <HomeSvcIncidentDetailView
            incident={liveSelectedIncident}
            onBack={() => setSelectedIncident(null)}
            onSms={() => smsMutation.mutate(liveSelectedIncident.id)}
            onAck={() => { ackMutation.mutate(liveSelectedIncident.id); setSelectedIncident(null); }}
            onMarkLead={() => markLeadMutation.mutate(liveSelectedIncident.id)}
            smsPending={smsMutation.isPending}
            markLeadPending={markLeadMutation.isPending}
          />
        ) : (
          <IncidentDetailView
            incident={liveSelectedIncident}
            onBack={() => setSelectedIncident(null)}
            onGeofence={() => geofenceMutation.mutate(liveSelectedIncident.id)}
            onSms={() => smsMutation.mutate(liveSelectedIncident.id)}
            onAck={() => { ackMutation.mutate(liveSelectedIncident.id); setSelectedIncident(null); }}
            geofencePending={geofenceMutation.isPending}
            smsPending={smsMutation.isPending}
          />
        )}
      </div>
    );
  }

  if (!hasSentinelAccess) {
    return (
      <div className="p-6 md:p-10 max-w-3xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center py-20">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-red-600/30 to-orange-500/30 flex items-center justify-center mx-auto mb-6 border border-red-500/20">
            <Lock size={36} className="text-red-400" />
          </div>
          <h1 className="text-4xl font-black text-white mb-3" data-testid="text-sentinel-locked">APEX SENTINEL</h1>
          <p className="text-lg text-slate-400 mb-2">Real-Time Crash Detection & Lead Generation</p>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400 text-sm font-bold mb-8">
            <ArrowUpCircle size={16} /> PRO FEATURE
          </div>
          <div className="max-w-md mx-auto space-y-4 text-left mb-10">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-white/5">
              <Radar size={18} className="text-red-400 mt-0.5 shrink-0" />
              <div><span className="text-white font-semibold text-sm">Live FHP Crash Feed</span><p className="text-slate-500 text-xs">Real-time Florida Highway Patrol data scanning every 60 seconds</p></div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-white/5">
              <MapPin size={18} className="text-orange-400 mt-0.5 shrink-0" />
              <div><span className="text-white font-semibold text-sm">SWFL Priority Zones</span><p className="text-slate-500 text-xs">Cape Coral, Fort Myers, Naples, Bonita — instant alerts for your territory</p></div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-white/5">
              <Phone size={18} className="text-emerald-400 mt-0.5 shrink-0" />
              <div><span className="text-white font-semibold text-sm">SMS & Webhook Alerts</span><p className="text-slate-500 text-xs">Get crash leads delivered to your phone and CRM instantly</p></div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-white/5">
              <Target size={18} className="text-cyan-400 mt-0.5 shrink-0" />
              <div><span className="text-white font-semibold text-sm">Geofence Ad Deployment</span><p className="text-slate-500 text-xs">Auto-deploy targeted ads around crash scenes for maximum reach</p></div>
            </div>
          </div>
          <p className="text-slate-500 text-xs mb-4">Current plan: <span className="text-white font-bold uppercase">{accountPlan}</span></p>
          <Button
            size="lg"
            className="bg-gradient-to-r from-red-600 to-orange-500 text-white font-bold text-lg px-10 py-6 shadow-lg shadow-red-500/25"
            onClick={() => window.location.href = "/pricing"}
            data-testid="button-upgrade-sentinel"
          >
            <ArrowUpCircle size={20} className="mr-2" /> Upgrade to Pro
          </Button>
        </motion.div>
      </div>
    );
  }

  const activeNiche = config?.niche === 'home_services' ? 'home_services' : 'accident';
  const isHomeSvc = activeNiche === 'home_services';

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${isHomeSvc ? "from-blue-600 to-teal-500" : "from-red-600 to-orange-500"} flex items-center justify-center ${scanPulse ? "animate-pulse" : ""}`}>
              {isHomeSvc ? <Home size={24} className="text-white" /> : <Satellite size={24} className="text-white" />}
            </div>
            <div>
              <h1 className="text-3xl font-black text-white tracking-tight" data-testid="text-sentinel-title">
                APEX SENTINEL
              </h1>
              <p className="text-slate-400 text-sm flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${config?.enabled ? "bg-green-400 animate-pulse" : "bg-slate-600"}`} />
                {config?.enabled ? "Live Monitoring Active" : "Monitoring Offline"}
                {isHomeSvc && <span className="text-blue-400 font-bold text-[10px] uppercase tracking-widest ml-1">Home Services</span>}
                {currentAccount && <span className="text-slate-600">| {currentAccount.name}</span>}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={startTutorial} className="text-slate-400 hover:text-white" data-testid="button-start-tutorial">
              <BookOpen size={16} className="mr-1" /> Tutorial
            </Button>
            {!isHomeSvc && (
              <Button
                variant="outline"
                onClick={() => navigate("/crash-reports")}
                className="border-white/10 text-white hover:bg-white/10 gap-2"
                data-testid="button-crash-reports"
              >
                <Eye size={16} /> Crash Reports
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setShowConfig(true)}
              className="border-white/10 text-white hover:bg-white/10 gap-2"
              data-testid="button-sentinel-config"
            >
              <Settings size={16} /> Config
            </Button>
            {!isHomeSvc && (
              <Button
                variant="outline"
                onClick={() => setShowReportDialog(true)}
                className="border-white/10 text-white hover:bg-white/10 gap-2"
                data-testid="button-report-incident"
              >
                <Plus size={16} /> Report
              </Button>
            )}
            <Button
              onClick={() => scanMutation.mutate()}
              disabled={scanMutation.isPending || !currentAccount}
              className={`${isHomeSvc ? "bg-gradient-to-r from-blue-600 to-teal-500 shadow-blue-500/25" : "bg-gradient-to-r from-red-600 to-orange-500 shadow-red-500/25"} text-white font-bold gap-2 shadow-lg`}
              data-testid="button-scan-now"
            >
              {scanMutation.isPending ? (
                <><Radar size={16} className="animate-spin" /> Scanning...</>
              ) : (
                <><Radar size={16} /> Scan Now</>
              )}
            </Button>
          </div>
        </div>
      </motion.div>

      {isHomeSvc ? (
        <HomeSvcSentinelView
          incidents={filteredIncidents}
          loadingIncidents={loadingIncidents}
          currentAccount={currentAccount}
          onSms={(id) => smsMutation.mutate(id)}
          onAck={(id) => ackMutation.mutate(id)}
          onMarkLead={(id) => markLeadMutation.mutate(id)}
          smsPending={smsMutation.isPending}
          markLeadPending={markLeadMutation.isPending}
          onSelectIncident={setSelectedIncident}
        />
      ) : (<>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="bg-[#0a0a0a] border border-red-500/30 p-4 rounded-2xl shadow-[0_0_20px_rgba(239,68,68,0.1)]"
          data-testid="card-total-incidents"
        >
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={14} className="text-red-500" />
            <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Total Incidents</p>
          </div>
          <p className="text-3xl font-black text-white">{incidents.length}</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-[#0a0a0a] border border-orange-500/30 p-4 rounded-2xl"
          data-testid="card-urgent-incidents"
        >
          <div className="flex items-center gap-2 mb-1">
            <Shield size={14} className="text-orange-500" />
            <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">In Territory</p>
          </div>
          <p className="text-3xl font-black text-white">{urgentCount}</p>
          <p className="text-[9px] text-slate-600 mt-1">urgent priority</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="bg-[#0a0a0a] border border-cyan-500/30 p-4 rounded-2xl"
          data-testid="card-pending-action"
        >
          <div className="flex items-center gap-2 mb-1">
            <Clock size={14} className="text-cyan-500" />
            <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Pending Action</p>
          </div>
          <p className="text-3xl font-black text-white">{pendingIncidents.length}</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="bg-[#0a0a0a] border border-green-500/30 p-4 rounded-2xl"
          data-testid="card-actioned"
        >
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 size={14} className="text-green-500" />
            <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Actioned</p>
          </div>
          <p className="text-3xl font-black text-white">{actionedIncidents.length}</p>
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
        className="bg-[#0a0a0a] border border-red-500/30 p-6 rounded-2xl mb-8"
      >
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h2 className="text-red-500 font-black tracking-widest uppercase flex items-center gap-2" data-testid="text-live-stream-title">
            <Radio size={16} className={scanPulse ? "animate-pulse" : ""} />
            Sentinel: Live Accident Stream
          </h2>
          <div className="flex items-center gap-3">
            <div className="relative">
              <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 z-10" />
              <AddressAutocomplete
                value={locationFilter}
                onAddressSelect={(data) => setLocationFilter(data.city || data.address || "")}
                onChange={(val) => setLocationFilter(val)}
                placeholder="Filter by location..."
                className="bg-white/5 border-white/10 text-white pl-8 w-48 h-8 text-xs"
                types={["geocode"]}
                data-testid="input-location-filter"
              />
            </div>
            <span className="text-[10px] text-gray-600 uppercase tracking-widest whitespace-nowrap">
              {filteredIncidents.length} of {incidents.length} incident{incidents.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {loadingIncidents ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 bg-white/5 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : pendingIncidents.length === 0 && actionedIncidents.length === 0 ? (
          <div className="text-center py-12">
            <Radar size={48} className="mx-auto text-slate-700 mb-4" />
            <h3 className="text-white font-bold text-lg mb-2">No Incidents Detected</h3>
            <p className="text-slate-500 text-sm max-w-md mx-auto mb-4">
              Click "Scan Now" to scan dispatch feeds for high-value accidents in your area.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {pendingIncidents.map((incident, i) => (
                <IncidentCard
                  key={incident.id}
                  incident={incident}
                  index={i}
                  onGeofence={() => geofenceMutation.mutate(incident.id)}
                  onSms={() => smsMutation.mutate(incident.id)}
                  onAck={() => ackMutation.mutate(incident.id)}
                  onClick={() => setSelectedIncident(incident)}
                  geofencePending={geofenceMutation.isPending}
                  smsPending={smsMutation.isPending}
                />
              ))}
            </AnimatePresence>

            {pendingIncidents.filter(i => (i.rawPayload as any)?.operatorPriority === 'monitor').length > 3 && (
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5 mb-2">
                <p className="text-slate-400 text-xs">
                  {pendingIncidents.filter(i => (i.rawPayload as any)?.operatorPriority === 'monitor').length} statewide-only crashes pending
                </p>
                <button
                  onClick={() => {
                    const monitorIds = pendingIncidents
                      .filter(i => (i.rawPayload as any)?.operatorPriority === 'monitor')
                      .map(i => i.id);
                    Promise.all(monitorIds.map(id =>
                      apiRequest("POST", `/api/sentinel/incidents/${id}/acknowledge`)
                    )).then(() => {
                      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/incidents", currentAccount?.id] });
                      toast({ title: `${monitorIds.length} statewide incidents acknowledged` });
                    });
                  }}
                  className="text-xs text-slate-500 hover:text-white border border-white/10 px-3 py-1 rounded-lg hover:bg-white/5 transition-all"
                  data-testid="button-bulk-ack-statewide"
                >
                  Acknowledge all statewide
                </button>
              </div>
            )}

            {actionedIncidents.length > 0 && (
              <>
                <div className="flex items-center gap-3 mt-6 mb-3">
                  <div className="flex-1 h-px bg-white/10" />
                  <span className="text-xs text-slate-600 uppercase tracking-widest font-bold">Previously Actioned</span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>
                {actionedIncidents.slice(0, 10).map((incident, i) => (
                  <IncidentCard
                    key={incident.id}
                    incident={incident}
                    index={i}
                    onGeofence={() => geofenceMutation.mutate(incident.id)}
                    onSms={() => smsMutation.mutate(incident.id)}
                    onAck={() => ackMutation.mutate(incident.id)}
                    onClick={() => setSelectedIncident(incident)}
                    geofencePending={false}
                    smsPending={false}
                    dimmed
                  />
                ))}
              </>
            )}
          </div>
        )}
      </motion.div>
      </>)}

      <Dialog open={showConfig} onOpenChange={setShowConfig}>
        <DialogContent className="bg-neutral-950 border-white/10 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings size={20} className="text-red-400" /> Sentinel Configuration
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Sentinel Mode</label>
              <select
                value={configForm.niche}
                onChange={(e) => {
                  const val = e.target.value as "accident" | "home_services";
                  setConfigForm(f => ({ ...f, niche: val }));
                  setNicheChangeConfirmed(false);
                }}
                className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white appearance-none cursor-pointer"
                data-testid="select-niche"
              >
                <option value="accident" className="bg-neutral-900">Accident (Crash Detection)</option>
                <option value="home_services" className="bg-neutral-900">Home Services</option>
              </select>
              {nicheChanged && (
                <div className="mt-3 p-3 border border-amber-500/40 bg-amber-500/10 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertCircle size={16} className="text-amber-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-amber-300 font-bold mb-1">Switching Sentinel mode changes scan behavior immediately for this account.</p>
                      <p className="text-[10px] text-amber-400/70 mb-2">
                        {configForm.niche === 'home_services'
                          ? "Accident feed scanning will stop. Home Services NOAA weather alerts will activate."
                          : "Home Services scanning will stop. Accident crash detection will resume."}
                      </p>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={nicheChangeConfirmed}
                          onChange={(e) => setNicheChangeConfirmed(e.target.checked)}
                          className="rounded border-amber-500/50 bg-transparent"
                          data-testid="checkbox-confirm-niche"
                        />
                        <span className="text-xs text-amber-300">I understand — switch this account's Sentinel mode</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {configForm.niche === 'home_services' ? (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">
                    Target States for NOAA Alerts
                  </label>
                  <Input
                    value={configForm.targetStates}
                    onChange={(e) => setConfigForm(f => ({ ...f, targetStates: e.target.value }))}
                    placeholder="FL, TX, GA, NC"
                    className="bg-white/5 border-white/10 text-white"
                    data-testid="input-target-states-home-svc"
                  />
                  <p className="text-[10px] text-amber-500/70 mt-1">
                    Required — 2-letter state codes, comma-separated. Scans return nothing if empty.
                  </p>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">
                    Scan Interval (sec)
                  </label>
                  <Input
                    type="number"
                    value={configForm.scanInterval}
                    onChange={(e) => setConfigForm(f => ({ ...f, scanInterval: parseInt(e.target.value) || 60 }))}
                    className="bg-white/5 border-white/10 text-white"
                  />
                  <p className="text-[10px] text-slate-600 mt-1">Manual scan only — no scheduler in Level 2.</p>
                </div>
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-300">SMS Alerts</span>
                    <Switch checked={configForm.smsAlertEnabled} onCheckedChange={(v) => setConfigForm(f => ({ ...f, smsAlertEnabled: v }))} />
                  </div>
                  {configForm.smsAlertEnabled && (
                    <div>
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Alert Phone Number</label>
                      <Input
                        value={configForm.smsAlertPhone}
                        onChange={(e) => setConfigForm(f => ({ ...f, smsAlertPhone: e.target.value }))}
                        placeholder="+1 (555) 123-4567"
                        className="bg-white/5 border-white/10 text-white"
                      />
                    </div>
                  )}
                </div>
                <div className="border border-white/5 rounded-lg p-3 space-y-3">
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Level 3 — Territories</p>
                  {(() => {
                    const territories = configForm.homeSvcConfig?.territories ?? [];
                    return (
                      <div className="space-y-2">
                        {territories.map((t: any, idx: number) => (
                          <div key={idx} className="bg-white/5 border border-white/10 rounded-md px-3 py-2 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-xs text-white font-bold truncate">{t.name}</p>
                              <p className="text-[9px] text-slate-500">{(t.stateCodes || []).join(', ')}{t.counties?.length ? ` · ${t.counties.join(', ')}` : ''}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const updated = [...territories];
                                updated.splice(idx, 1);
                                setConfigForm(f => ({ ...f, homeSvcConfig: { ...f.homeSvcConfig, territories: updated } }));
                              }}
                              className="text-red-400 text-[10px] font-bold hover:text-red-300 shrink-0"
                              data-testid={`button-remove-territory-${idx}`}
                            >Remove</button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            const name = prompt('Territory name (e.g. "SWFL")');
                            if (!name) return;
                            const states = prompt('State codes, comma-separated (e.g. FL,TX)');
                            if (!states) return;
                            const counties = prompt('Counties (optional, comma-separated)') || '';
                            const newTerritory = {
                              name,
                              stateCodes: states.split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean),
                              counties: counties ? counties.split(',').map((c: string) => c.trim()).filter(Boolean) : undefined,
                            };
                            const current = configForm.homeSvcConfig?.territories ?? [];
                            setConfigForm(f => ({ ...f, homeSvcConfig: { ...f.homeSvcConfig, territories: [...current, newTerritory] } }));
                          }}
                          className="flex items-center gap-1 text-[10px] text-amber-400 font-bold hover:text-amber-300"
                          data-testid="button-add-territory"
                        >
                          <Plus size={10} /> Add Territory
                        </button>
                      </div>
                    );
                  })()}
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-3">Level 3 — Delivery Rules</p>
                  {(() => {
                    const rules = configForm.homeSvcConfig?.deliveryRules ?? [];
                    return (
                      <div className="space-y-2">
                        {rules.map((r: any, idx: number) => (
                          <div key={idx} className="bg-white/5 border border-white/10 rounded-md px-3 py-2 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-xs text-white font-bold truncate">{r.name}</p>
                              <p className="text-[9px] text-slate-500">
                                {r.minScore ? `Score ≥ ${r.minScore}` : 'Any score'}
                                {r.territory ? ` · ${r.territory}` : ''}
                                {r.serviceTypes?.length ? ` · ${r.serviceTypes.join(', ')}` : ''}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const updated = [...rules];
                                updated.splice(idx, 1);
                                setConfigForm(f => ({ ...f, homeSvcConfig: { ...f.homeSvcConfig, deliveryRules: updated } }));
                              }}
                              className="text-red-400 text-[10px] font-bold hover:text-red-300 shrink-0"
                              data-testid={`button-remove-rule-${idx}`}
                            >Remove</button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            const name = prompt('Rule name (e.g. "High-score roofing")');
                            if (!name) return;
                            const minScoreStr = prompt('Min score to trigger (0–100, or leave empty for any)') || '';
                            const territory = prompt('Territory name (or leave empty for any)') || '';
                            const services = prompt('Service types, comma-separated (or leave empty for any)') || '';
                            const newRule = {
                              id: `rule-${Date.now()}`,
                              name,
                              action: 'auto_queue' as const,
                              minScore: minScoreStr && !isNaN(parseInt(minScoreStr)) ? Math.max(0, Math.min(100, parseInt(minScoreStr))) : undefined,
                              territory: territory || undefined,
                              serviceTypes: services ? services.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined,
                            };
                            const current = configForm.homeSvcConfig?.deliveryRules ?? [];
                            setConfigForm(f => ({ ...f, homeSvcConfig: { ...f.homeSvcConfig, deliveryRules: [...current, newRule] } }));
                          }}
                          className="flex items-center gap-1 text-[10px] text-amber-400 font-bold hover:text-amber-300"
                          data-testid="button-add-delivery-rule"
                        >
                          <Plus size={10} /> Add Delivery Rule
                        </button>
                      </div>
                    );
                  })()}
                  <p className="text-[10px] text-slate-700 mt-2">Keywords, Geofence, and advanced targeting are not active in Home Services mode.</p>
                </div>
              </div>
            ) : (
              <>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Incident Feed</label>
              <div className="bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-emerald-400 font-mono">
                FHP HSMV — trafficincidents.flhsmv.gov
              </div>
              <p className="text-[10px] text-slate-600 mt-1">Live Florida Highway Patrol crash data (updates every 60s)</p>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Target Counties</label>
              <div className="flex flex-wrap gap-1.5">
                {['LEE', 'COLLIER', 'CHARLOTTE', 'HENDRY', 'GLADES'].map(c => (
                  <span key={c} className="px-2 py-0.5 rounded bg-red-500/20 text-red-300 text-xs font-bold border border-red-500/30">{c}</span>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Target Cities (SWFL)</label>
              <div className="flex flex-wrap gap-1.5">
                {['Cape Coral', 'Fort Myers', 'North Fort Myers', 'Naples', 'Bonita Springs', 'Lehigh Acres', 'Estero', 'Marco Island', 'Punta Gorda', 'Port Charlotte'].map(c => (
                  <span key={c} className="px-2 py-0.5 rounded bg-orange-500/20 text-orange-300 text-xs font-medium border border-orange-500/30">{c}</span>
                ))}
              </div>
              <p className="text-[10px] text-slate-600 mt-1">Crashes in these cities get priority alerts</p>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Keywords (comma-separated)</label>
              <Input
                value={configForm.keywords}
                onChange={(e) => setConfigForm(f => ({ ...f, keywords: e.target.value }))}
                placeholder="MVA, EXTRICATION, ROLLOVER, INJURIES"
                className="bg-white/5 border-white/10 text-white"
                data-testid="input-keywords"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Target Cities (comma-separated)</label>
              <AddressAutocomplete
                value={configForm.targetCities}
                onAddressSelect={(data) => {
                  const current = configForm.targetCities ? configForm.targetCities.split(",").map(s => s.trim()).filter(Boolean) : [];
                  if (data.city && !current.includes(data.city)) {
                    current.push(data.city);
                  }
                  setConfigForm(f => ({ ...f, targetCities: current.join(", ") }));
                }}
                onChange={(val) => setConfigForm(f => ({ ...f, targetCities: val }))}
                placeholder="Las Vegas, Henderson, North Las Vegas"
                className="bg-white/5 border-white/10 text-white"
                types={["(cities)"]}
                data-testid="input-target-cities"
              />
              <p className="text-[10px] text-slate-600 mt-1">Only show incidents from these cities. Leave empty for all.</p>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Target States (comma-separated)</label>
              <Input
                value={configForm.targetStates}
                onChange={(e) => setConfigForm(f => ({ ...f, targetStates: e.target.value }))}
                placeholder="NV, CA, AZ"
                className="bg-white/5 border-white/10 text-white"
                data-testid="input-target-states"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Scan Interval (sec)</label>
                <Input
                  type="number"
                  value={configForm.scanInterval}
                  onChange={(e) => setConfigForm(f => ({ ...f, scanInterval: parseInt(e.target.value) || 60 }))}
                  className="bg-white/5 border-white/10 text-white"
                  data-testid="input-scan-interval"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Geofence Radius (mi)</label>
                <Input
                  type="number"
                  step="0.1"
                  value={configForm.geofenceRadiusMiles}
                  onChange={(e) => setConfigForm(f => ({ ...f, geofenceRadiusMiles: parseFloat(e.target.value) || 1 }))}
                  className="bg-white/5 border-white/10 text-white"
                  data-testid="input-geofence-radius"
                />
              </div>
            </div>
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">Live Monitoring</span>
                <Switch checked={configForm.enabled} onCheckedChange={(v) => setConfigForm(f => ({ ...f, enabled: v }))} data-testid="switch-enabled" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">SMS Alerts</span>
                <Switch checked={configForm.smsAlertEnabled} onCheckedChange={(v) => setConfigForm(f => ({ ...f, smsAlertEnabled: v }))} data-testid="switch-sms" />
              </div>
              {configForm.smsAlertEnabled && (
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Client Alert Phone Number</label>
                  <Input
                    value={configForm.smsAlertPhone}
                    onChange={(e) => setConfigForm(f => ({ ...f, smsAlertPhone: e.target.value }))}
                    placeholder="+1 (555) 123-4567"
                    className="bg-white/5 border-white/10 text-white"
                    data-testid="input-sms-alert-phone"
                  />
                  <p className="text-[10px] text-slate-600 mt-1">Your client's phone number for crash alert texts</p>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">Auto-Deploy Geofence Ads</span>
                <Switch checked={configForm.geofenceEnabled} onCheckedChange={(v) => setConfigForm(f => ({ ...f, geofenceEnabled: v }))} data-testid="switch-geofence" />
              </div>
            </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfig(false)} className="border-white/10 text-white hover:bg-white/10">Cancel</Button>
            <Button
              onClick={() => configMutation.mutate()}
              disabled={configMutation.isPending || nicheSaveBlocked}
              className="bg-gradient-to-r from-red-600 to-orange-500 text-white font-bold gap-2"
              data-testid="button-save-config"
            >
              {configMutation.isPending ? "Saving..." : "Save Configuration"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={showReportDialog} onOpenChange={setShowReportDialog}>
        <DialogContent className="bg-neutral-950 border-white/10 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={20} className="text-orange-400" /> Report Incident
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Title</label>
              <Input
                value={reportForm.title}
                onChange={(e) => setReportForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Multi-vehicle collision on I-75"
                className="bg-white/5 border-white/10 text-white"
                data-testid="input-report-title"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Crash Location</label>
              <AddressAutocomplete
                value={reportForm.location}
                onAddressSelect={(data) => {
                  const parts = [data.address, data.city, data.state, data.zip].filter(Boolean);
                  setReportForm(f => ({ ...f, location: parts.join(", ") }));
                }}
                onChange={(val) => setReportForm(f => ({ ...f, location: val }))}
                placeholder="Search crash location address..."
                className="bg-white/5 border-white/10 text-white"
                data-testid="input-report-location"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Description</label>
              <Input
                value={reportForm.description}
                onChange={(e) => setReportForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Brief description of the incident"
                className="bg-white/5 border-white/10 text-white"
                data-testid="input-report-description"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Severity</label>
              <select
                value={reportForm.severity}
                onChange={(e) => setReportForm(f => ({ ...f, severity: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 text-white rounded-md px-3 py-2 text-sm"
                data-testid="select-report-severity"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReportDialog(false)} className="border-white/10 text-white hover:bg-white/10">Cancel</Button>
            <Button
              onClick={() => reportMutation.mutate(reportForm)}
              disabled={reportMutation.isPending || !reportForm.title}
              className="bg-gradient-to-r from-red-600 to-orange-500 text-white font-bold gap-2"
              data-testid="button-submit-report"
            >
              {reportMutation.isPending ? "Reporting..." : "Report Incident"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {showTutorial && <TutorialOverlay steps={SENTINEL_STEPS} storageKey="apex_tutorial_sentinel" onClose={closeTutorial} accentColor="red" />}
    </div>
  );
}

function IncidentCard({
  incident, index, onGeofence, onSms, onAck, onClick, geofencePending, smsPending, dimmed
}: {
  incident: SentinelIncident;
  index: number;
  onGeofence: () => void;
  onSms: () => void;
  onAck: () => void;
  onClick?: () => void;
  geofencePending: boolean;
  smsPending: boolean;
  dimmed?: boolean;
}) {
  const sev = SEVERITY_COLORS[incident.severity || "medium"] || SEVERITY_COLORS.medium;
  const isPending = incident.actionStatus === "pending";
  const raw = parseRawPayload(incident.rawPayload);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: dimmed ? 0.5 : 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ delay: index * 0.03 }}
      className={`border-b border-white/5 pb-4 last:border-0 last:pb-0 cursor-pointer hover:bg-white/[0.02] rounded-lg p-2 -mx-2 transition-colors ${dimmed ? "opacity-50" : ""}`}
      onClick={onClick}
      data-testid={`card-incident-${incident.id}`}
    >
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-white font-bold text-sm truncate">{incident.title}</p>
            {incident.smsSent && (
              <span className="text-[8px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded font-bold">SMS SENT</span>
            )}
            {incident.geofenceDeployed && (
              <span className="text-[8px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded font-bold">GEO ACTIVE</span>
            )}
          </div>
          <p className="text-gray-500 text-xs flex items-center gap-1">
            <MapPin size={10} /> {incident.location || "Location pending"}
          </p>
          {incident.description && (
            <p className="text-gray-600 text-[11px] mt-1 line-clamp-1">{incident.description}</p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <span className={`${sev.bg} ${sev.text} text-[10px] px-2 py-1 rounded font-black tracking-wider`}>
            {sev.label}
          </span>
          {(() => {
            const priority = (incident.rawPayload as any)?.operatorPriority;
            if (priority === 'urgent') return (
              <span className="text-[8px] bg-red-500/30 text-red-300 px-1.5 py-0.5 rounded font-black border border-red-500/40">
                IN TERRITORY
              </span>
            );
            if (priority === 'monitor') return (
              <span className="text-[8px] bg-slate-500/20 text-slate-500 px-1.5 py-0.5 rounded font-bold">
                STATEWIDE
              </span>
            );
            return null;
          })()}
          {raw.source && (
            <span className="text-[8px] bg-cyan-500/10 text-cyan-400 px-1.5 py-0.5 rounded font-bold mt-1 inline-block">
              {raw.source === "lvmpd_live" ? "LVMPD" :
               raw.source === "fhp_live" ? "FL FHP" :
               raw.source?.toUpperCase()}
              {raw.state ? ` · ${raw.state}` : ""}
            </span>
          )}
          <p className="text-gray-500 text-[10px] mt-1 flex items-center gap-1 justify-end" data-testid={`text-incident-date-${incident.id}`}>
            <Clock size={8} /> {formatDateTime(incident.detectedAt as unknown as string)}
          </p>
          <p className="text-gray-600 text-[9px] mt-0.5 text-right">
            {timeAgo(incident.detectedAt as unknown as string)}
          </p>
        </div>
      </div>

      {isPending && (
        <div className="flex gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onGeofence}
            disabled={incident.geofenceDeployed || geofencePending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold hover:bg-red-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            data-testid={`button-geofence-${incident.id}`}
          >
            <Crosshair size={12} /> {incident.geofenceDeployed ? "Deployed" : "Deploy Geofence"}
          </button>
          <button
            onClick={onSms}
            disabled={incident.smsSent || smsPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold hover:bg-blue-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            data-testid={`button-sms-${incident.id}`}
          >
            <Send size={12} /> {incident.smsSent ? "Sent" : "SMS Alert"}
          </button>
          <button
            onClick={onAck}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 text-xs font-bold hover:bg-white/10 transition-all"
            data-testid={`button-ack-${incident.id}`}
          >
            <Eye size={12} /> Acknowledge
          </button>
        </div>
      )}
    </motion.div>
  );
}

function IncidentDetailView({
  incident, onBack, onGeofence, onSms, onAck, geofencePending, smsPending
}: {
  incident: SentinelIncident;
  onBack: () => void;
  onGeofence: () => void;
  onSms: () => void;
  onAck: () => void;
  geofencePending: boolean;
  smsPending: boolean;
}) {
  const sev = SEVERITY_COLORS[incident.severity || "medium"] || SEVERITY_COLORS.medium;
  const raw = parseRawPayload(incident.rawPayload);
  const isPending = incident.actionStatus === "pending";
  const lat = raw.lat || incident.lat;
  const lng = raw.lng || incident.lng;
  const googleMapsUrl = raw.googleMaps || (lat && lng ? `https://www.google.com/maps?q=${lat},${lng}` : null);

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
      <Button variant="ghost" onClick={onBack} className="text-slate-400 hover:text-white mb-4" data-testid="button-back-to-incidents">
        <ChevronLeft size={16} className="mr-1" /> Back to Incidents
      </Button>

      {(() => {
        const prov = getProvenanceLabel(incident);
        return (
          <div className={`text-xs font-bold uppercase tracking-widest mb-3 ${prov.color}`} data-testid="text-provenance-label">
            {prov.label}
          </div>
        );
      })()}

      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-black text-white" data-testid="text-incident-title">{incident.title}</h2>
          <p className="text-slate-500 text-sm">
            Detected {formatDateTime(incident.detectedAt as unknown as string)} · {timeAgo(incident.detectedAt as unknown as string)}
          </p>
        </div>
        <span className={`${sev.bg} ${sev.text} text-xs px-3 py-1.5 rounded-full font-black tracking-wider border ${sev.border}`}>
          {sev.label}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-6" data-testid="card-location-details">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            <MapPin size={14} className="text-red-400" /> Location & Details
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailField label="Location" value={incident.location} testId="text-detail-location" />
            <DetailField label="Detected Time" value={formatDateTime(incident.detectedAt as unknown as string)} testId="text-detail-detected" />
            <DetailField label="County" value={raw?.county} testId="text-detail-county" />
            <DetailField label="State" value={raw?.state || incident.state} testId="text-detail-state" />
            {lat && lng && (
              <DetailField label="Coordinates" value={`${lat}, ${lng}`} testId="text-detail-coords" />
            )}
            <DetailField label="Received Date" value={raw?.received} testId="text-detail-received" />
            <DetailField label="Source" value={raw?.source?.toUpperCase()} testId="text-detail-source" />
            <DetailField label="Type" value={incident.title} testId="text-detail-type" />
            {raw?.distanceMiles && raw.distanceMiles !== "unknown" && (
              <DetailField label="Distance from HQ" value={`${raw.distanceMiles} mi`} testId="text-detail-distance" />
            )}
          </div>
          {raw?.remarks && (
            <div className="mt-4">
              <p className="text-[10px] text-slate-600 uppercase font-bold tracking-widest mb-1">Remarks</p>
              <p className="text-sm text-slate-300" data-testid="text-detail-remarks">{raw.remarks}</p>
            </div>
          )}
          {incident.description && (
            <div className="mt-4">
              <p className="text-[10px] text-slate-600 uppercase font-bold tracking-widest mb-1">Description</p>
              <p className="text-sm text-slate-300" data-testid="text-detail-description">{incident.description}</p>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-6" data-testid="card-map-section">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Globe size={14} className="text-cyan-400" /> Map
            </h3>
            {googleMapsUrl ? (
              <div>
                <div className="bg-white/5 border border-white/10 rounded-xl p-8 text-center mb-4">
                  <MapPin size={48} className="mx-auto text-red-400 mb-3" />
                  <p className="text-white font-bold text-sm mb-1">{incident.location}</p>
                  {lat && lng && <p className="text-slate-500 text-xs">{lat}, {lng}</p>}
                </div>
                <a
                  href={googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm font-bold hover:bg-blue-500/20 transition-all w-full justify-center"
                  data-testid="link-open-google-maps"
                >
                  <ExternalLink size={14} /> Open in Google Maps
                </a>
              </div>
            ) : (
              <div className="bg-white/5 border border-white/10 rounded-xl p-8 text-center">
                <MapPin size={48} className="mx-auto text-slate-600 mb-3" />
                <p className="text-slate-500 text-sm">No coordinates available for this incident</p>
              </div>
            )}
          </div>

          <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-6" data-testid="card-response-status">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Shield size={14} className="text-emerald-400" /> Response Status
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5">
                <div className="flex items-center gap-2">
                  <MessageSquare size={14} className={incident.smsSent ? "text-green-400" : "text-slate-600"} />
                  <span className="text-sm text-white">SMS Alert</span>
                </div>
                <span className={`text-xs font-bold px-2 py-1 rounded ${incident.smsSent ? "bg-green-500/20 text-green-400" : "bg-slate-500/20 text-slate-500"}`} data-testid="text-sms-status">
                  {incident.smsSent ? "Sent" : "Not Sent"}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5">
                <div className="flex items-center gap-2">
                  <Crosshair size={14} className={incident.geofenceDeployed ? "text-green-400" : "text-slate-600"} />
                  <span className="text-sm text-white">Geofence Deployment</span>
                </div>
                <span className={`text-xs font-bold px-2 py-1 rounded ${incident.geofenceDeployed ? "bg-green-500/20 text-green-400" : "bg-slate-500/20 text-slate-500"}`} data-testid="text-geofence-status">
                  {incident.geofenceDeployed ? "Deployed" : "Not Deployed"}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5">
                <div className="flex items-center gap-2">
                  <Eye size={14} className={incident.actionStatus !== "pending" ? "text-green-400" : "text-slate-600"} />
                  <span className="text-sm text-white">Action Status</span>
                </div>
                <span className={`text-xs font-bold px-2 py-1 rounded ${incident.actionStatus !== "pending" ? "bg-green-500/20 text-green-400" : "bg-amber-500/20 text-amber-400"}`} data-testid="text-action-status">
                  {(incident.actionStatus || "pending").replace(/_/g, " ").toUpperCase()}
                </span>
              </div>
            </div>

            {isPending && (
              <div className="flex gap-2 mt-4">
                <button
                  onClick={onGeofence}
                  disabled={incident.geofenceDeployed || geofencePending}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold hover:bg-red-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  data-testid="button-detail-geofence"
                >
                  <Crosshair size={12} /> {geofencePending ? "Deploying..." : "Deploy Geofence"}
                </button>
                <button
                  onClick={onSms}
                  disabled={incident.smsSent || smsPending}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold hover:bg-blue-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  data-testid="button-detail-sms"
                >
                  <Send size={12} /> {smsPending ? "Sending..." : "Send SMS"}
                </button>
                <button
                  onClick={onAck}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-400 text-xs font-bold hover:bg-white/10 transition-all"
                  data-testid="button-detail-ack"
                >
                  <Eye size={12} /> Acknowledge
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <CadDataCard incident={incident} />
    </motion.div>
  );
}

function CadDataCard({ incident }: { incident: SentinelIncident }) {
  const units = parseCadUnits(incident.unitsAssigned);
  const timeline = parseCadTimeline(incident.responseTimeline);
  const hasCadData = !!(incident.dispatchedAs || incident.callNotes || units.length > 0 || timeline.length > 0);

  if (!hasCadData) return null;

  return (
    <div className="bg-[#0a0a0a] border border-cyan-500/20 rounded-2xl p-6 mb-6" data-testid="card-cad-data">
      <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-widest mb-4 flex items-center gap-2">
        <Radio size={14} className="text-cyan-400" /> Dispatch / CAD Data
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        {incident.dispatchedAs && (
          <DetailField label="Dispatched As" value={incident.dispatchedAs} testId="text-cad-dispatched-as" />
        )}
        {incident.cadSource && (
          <DetailField label="CAD Source" value={incident.cadSource} testId="text-cad-source" />
        )}
        {incident.cadLastUpdatedAt && (
          <DetailField label="Last CAD Update" value={new Date(incident.cadLastUpdatedAt).toLocaleString()} testId="text-cad-last-updated" />
        )}
      </div>

      {incident.callNotes && (
        <div className="mb-4">
          <p className="text-[10px] text-slate-600 uppercase font-bold tracking-widest mb-1">Call Notes</p>
          <p className="text-sm text-slate-300 whitespace-pre-wrap" data-testid="text-cad-call-notes">{incident.callNotes}</p>
        </div>
      )}

      {units.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] text-slate-600 uppercase font-bold tracking-widest mb-2">Units Assigned</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="table-cad-units">
              <thead>
                <tr className="text-slate-500 border-b border-white/5">
                  <th className="text-left py-1.5 px-2 font-bold">Unit ID</th>
                  <th className="text-left py-1.5 px-2 font-bold">Type</th>
                  <th className="text-left py-1.5 px-2 font-bold">Dispatched</th>
                  <th className="text-left py-1.5 px-2 font-bold">Arrived</th>
                  <th className="text-left py-1.5 px-2 font-bold">Cleared</th>
                </tr>
              </thead>
              <tbody>
                {units.map((u, i) => (
                  <tr key={u.unitId} className="border-b border-white/5 text-slate-300" data-testid={`row-cad-unit-${i}`}>
                    <td className="py-1.5 px-2 font-medium text-white">{u.unitId}</td>
                    <td className="py-1.5 px-2">{u.unitType || "\u2014"}</td>
                    <td className="py-1.5 px-2">{u.dispatchedAt || "\u2014"}</td>
                    <td className="py-1.5 px-2">{u.arrivedAt || "\u2014"}</td>
                    <td className="py-1.5 px-2">{u.clearedAt || "\u2014"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {timeline.length > 0 && (
        <div>
          <p className="text-[10px] text-slate-600 uppercase font-bold tracking-widest mb-2">Response Timeline</p>
          <div className="space-y-1.5" data-testid="list-cad-timeline">
            {timeline.map((e, i) => (
              <div key={i} className="flex items-start gap-3 text-xs p-2 rounded-lg bg-white/5 border border-white/5" data-testid={`row-cad-timeline-${i}`}>
                <span className="text-cyan-400 font-mono whitespace-nowrap">{new Date(e.timestamp).toLocaleTimeString()}</span>
                <span className="text-white font-medium">{e.event}</span>
                {e.unit && <span className="text-slate-500">({e.unit})</span>}
                {e.details && <span className="text-slate-400">{e.details}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailField({ label, value, testId }: { label: string; value: string | undefined | null; testId: string }) {
  return (
    <div>
      <p className="text-[10px] text-slate-600 uppercase font-bold tracking-widest mb-0.5">{label}</p>
      <p className="text-sm text-white font-medium" data-testid={testId}>{value || "—"}</p>
    </div>
  );
}

const HOME_SVC_LABEL: Record<string, string> = {
  roofing:           'Roofing',
  gutters:           'Gutters',
  siding:            'Siding',
  tree_removal:      'Tree Removal',
  fencing:           'Fencing',
  storm_cleanup:     'Storm Cleanup',
  water_restoration: 'Water Restoration',
  plumbing:          'Plumbing',
  mold_remediation:  'Mold Remediation',
  hvac:              'HVAC',
  electrical:        'Electrical',
};

function serviceLabel(key: string): string {
  return HOME_SVC_LABEL[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatExpiry(expires: string | null | undefined): string | null {
  if (!expires) return null;
  try {
    const d = new Date(expires);
    return `Expires ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  } catch { return null; }
}

function computeExpiryStatus(expires: string | null | undefined): 'active' | 'expiring_soon' | 'expired' {
  if (!expires) return 'active';
  try {
    const expiresAt = new Date(expires).getTime();
    const now = Date.now();
    if (expiresAt < now) return 'expired';
    if (expiresAt - now < 60 * 60 * 1000) return 'expiring_soon';
    return 'active';
  } catch { return 'active'; }
}

const SCORE_TIER_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  immediate: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30', label: 'IMMEDIATE' },
  strong:    { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30', label: 'STRONG' },
  standard:  { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/30', label: 'STANDARD' },
  monitor:   { bg: 'bg-slate-500/20', text: 'text-slate-400', border: 'border-slate-500/30', label: 'MONITOR' },
};

const LEAD_READINESS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  ready:      { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Ready' },
  warm:       { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'Warm' },
  developing: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Developing' },
  monitoring: { bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'Monitoring' },
};

function sortByOperatorPriority(incidents: SentinelIncident[]): SentinelIncident[] {
  return [...incidents].sort((a, b) => {
    const rawA = a.rawPayload as any;
    const rawB = b.rawPayload as any;
    const expA = computeExpiryStatus(rawA?.expires);
    const expB = computeExpiryStatus(rawB?.expires);
    if (expA === 'expired' && expB !== 'expired') return 1;
    if (expB === 'expired' && expA !== 'expired') return -1;
    const statusOrder: Record<string, number> = { auto_queued: 0, pending: 1, lead_flagged: 2, acknowledged: 3, expired: 4 };
    const sA = statusOrder[a.actionStatus || 'pending'] ?? 1;
    const sB = statusOrder[b.actionStatus || 'pending'] ?? 1;
    if (sA !== sB) return sA - sB;
    const scoreA = rawA?.opportunityScore ?? 0;
    const scoreB = rawB?.opportunityScore ?? 0;
    return scoreB - scoreA;
  });
}

function HomeSvcSentinelView({
  incidents,
  loadingIncidents,
  currentAccount,
  onSms,
  onAck,
  onMarkLead,
  smsPending,
  markLeadPending,
  onSelectIncident,
}: {
  incidents: SentinelIncident[];
  loadingIncidents: boolean;
  currentAccount: SubAccount | undefined;
  onSms: (id: number) => void;
  onAck: (id: number) => void;
  onMarkLead: (id: number) => void;
  smsPending: boolean;
  markLeadPending: boolean;
  onSelectIncident: (incident: SentinelIncident) => void;
}) {
  const activeSignals  = incidents.filter(i => {
    const exp = computeExpiryStatus((i.rawPayload as any)?.expires);
    return exp !== 'expired' && (i.actionStatus === 'pending' || i.actionStatus === 'auto_queued');
  });
  const expiredSignals = incidents.filter(i => computeExpiryStatus((i.rawPayload as any)?.expires) === 'expired');
  const actionedSignals = incidents.filter(i => {
    const exp = computeExpiryStatus((i.rawPayload as any)?.expires);
    return exp !== 'expired' && i.actionStatus !== 'pending' && i.actionStatus !== 'auto_queued';
  });
  const actionRequired  = incidents.filter(i => (i.rawPayload as any)?.actionRequired === true).length;
  const flaggedCount    = incidents.filter(i => i.actionStatus === 'lead_flagged').length;
  const autoQueuedCount = incidents.filter(i => i.actionStatus === 'auto_queued').length;
  const inTerritoryCount = incidents.filter(i => {
    const t = (i.rawPayload as any)?.territory;
    return t && t !== 'unassigned';
  }).length;

  const sortedActive = sortByOperatorPriority(activeSignals);
  const sortedActioned = sortByOperatorPriority(actionedSignals);

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="bg-[#0a0a0a] border border-amber-500/30 p-4 rounded-2xl">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={14} className="text-amber-500" />
            <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Total Signals</p>
          </div>
          <p className="text-3xl font-black text-white" data-testid="text-home-svc-total">{incidents.length}</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-[#0a0a0a] border border-red-500/30 p-4 rounded-2xl">
          <div className="flex items-center gap-2 mb-1">
            <Zap size={14} className="text-red-400" />
            <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Auto-Queued</p>
          </div>
          <p className="text-3xl font-black text-white" data-testid="text-home-svc-auto-queued">{autoQueuedCount}</p>
          <p className="text-[9px] text-slate-600 mt-0.5">delivery rules fired</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}
          className="bg-[#0a0a0a] border border-cyan-500/30 p-4 rounded-2xl">
          <div className="flex items-center gap-2 mb-1">
            <Crosshair size={14} className="text-cyan-500" />
            <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">In Territory</p>
          </div>
          <p className="text-3xl font-black text-white" data-testid="text-home-svc-in-territory">{inTerritoryCount}</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="bg-[#0a0a0a] border border-green-500/30 p-4 rounded-2xl">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 size={14} className="text-green-500" />
            <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Flagged</p>
          </div>
          <p className="text-3xl font-black text-white" data-testid="text-home-svc-flagged">{flaggedCount}</p>
        </motion.div>
      </div>

      {expiredSignals.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="bg-slate-900/50 border border-slate-700/30 rounded-xl p-3 mb-4 flex items-center gap-3">
          <Clock size={14} className="text-slate-500 flex-shrink-0" />
          <p className="text-xs text-slate-500">
            <span className="font-bold text-slate-400">{expiredSignals.length}</span> expired signal{expiredSignals.length !== 1 ? 's' : ''} hidden from active queue
          </p>
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
        className="bg-[#0a0a0a] border border-amber-500/30 p-6 rounded-2xl mb-8">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h2 className="text-amber-500 font-black tracking-widest uppercase flex items-center gap-2">
            <Radio size={16} /> Operator Queue
          </h2>
          <span className="text-[10px] text-gray-600 uppercase tracking-widest">
            {sortedActive.length} active · {incidents.length} total · NOAA NWS
          </span>
        </div>

        {loadingIncidents ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => <div key={i} className="h-20 bg-white/5 rounded-xl animate-pulse" />)}
          </div>
        ) : incidents.length === 0 ? (
          <div className="text-center py-12">
            <Radar size={48} className="mx-auto text-slate-700 mb-4" />
            <h3 className="text-white font-bold text-lg mb-2" data-testid="text-no-signals">No Signals Detected</h3>
            <p className="text-slate-500 text-sm max-w-md mx-auto">
              Click Scan Now to check NOAA for active alerts in your target states.
              Ensure target states are configured in Settings.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {sortedActive.map((incident, i) => (
                <HomeSvcIncidentCard
                  key={incident.id}
                  incident={incident}
                  index={i}
                  onSms={() => onSms(incident.id)}
                  onAck={() => onAck(incident.id)}
                  onMarkLead={() => onMarkLead(incident.id)}
                  onClick={() => onSelectIncident(incident)}
                  smsPending={smsPending}
                  markLeadPending={markLeadPending}
                />
              ))}
            </AnimatePresence>

            {sortedActioned.length > 0 && (
              <>
                <div className="flex items-center gap-3 mt-6 mb-3">
                  <div className="flex-1 h-px bg-white/10" />
                  <span className="text-xs text-slate-600 uppercase tracking-widest font-bold">Previously Actioned</span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>
                {sortedActioned.slice(0, 10).map((incident, i) => (
                  <HomeSvcIncidentCard
                    key={incident.id}
                    incident={incident}
                    index={i}
                    onSms={() => onSms(incident.id)}
                    onAck={() => onAck(incident.id)}
                    onMarkLead={() => onMarkLead(incident.id)}
                    onClick={() => onSelectIncident(incident)}
                    smsPending={false}
                    markLeadPending={false}
                    dimmed
                  />
                ))}
              </>
            )}

            {expiredSignals.length > 0 && (
              <>
                <div className="flex items-center gap-3 mt-6 mb-3">
                  <div className="flex-1 h-px bg-slate-800" />
                  <span className="text-xs text-slate-700 uppercase tracking-widest font-bold">Expired</span>
                  <div className="flex-1 h-px bg-slate-800" />
                </div>
                {expiredSignals.slice(0, 5).map((incident, i) => (
                  <HomeSvcIncidentCard
                    key={incident.id}
                    incident={incident}
                    index={i}
                    onSms={() => onSms(incident.id)}
                    onAck={() => onAck(incident.id)}
                    onMarkLead={() => onMarkLead(incident.id)}
                    onClick={() => onSelectIncident(incident)}
                    smsPending={false}
                    markLeadPending={false}
                    dimmed
                    isExpired
                  />
                ))}
              </>
            )}
          </div>
        )}
      </motion.div>
    </>
  );
}

function HomeSvcIncidentCard({
  incident, index, onSms, onAck, onMarkLead, onClick, smsPending, markLeadPending, dimmed, isExpired: forceExpired,
}: {
  incident: SentinelIncident;
  index: number;
  onSms: () => void;
  onAck: () => void;
  onMarkLead: () => void;
  onClick?: () => void;
  smsPending: boolean;
  markLeadPending: boolean;
  dimmed?: boolean;
  isExpired?: boolean;
}) {
  const sev = SEVERITY_COLORS[incident.severity || 'medium'] || SEVERITY_COLORS.medium;
  const raw = incident.rawPayload as any;
  const isPending = incident.actionStatus === 'pending' || incident.actionStatus === 'auto_queued';
  const serviceTypes: string[] = Array.isArray(raw?.serviceTypes) ? raw.serviceTypes : [];
  const expiryLabel = formatExpiry(raw?.expires);
  const expiryStatus = forceExpired ? 'expired' : computeExpiryStatus(raw?.expires);
  const score: number = raw?.opportunityScore ?? 0;
  const scoreTier: string = raw?.scoreTier ?? 'monitor';
  const territory: string = raw?.territory ?? 'unassigned';
  const leadReadiness: string = raw?.leadReadiness ?? 'monitoring';
  const tierStyle = SCORE_TIER_COLORS[scoreTier] || SCORE_TIER_COLORS.monitor;
  const readinessStyle = LEAD_READINESS_COLORS[leadReadiness] || LEAD_READINESS_COLORS.monitoring;
  const serviceValueTier: string = raw?.serviceValueTier ?? 'basic';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: dimmed ? 0.5 : expiryStatus === 'expired' ? 0.4 : 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ delay: index * 0.03 }}
      className={`border-b border-white/5 pb-4 last:border-0 last:pb-0 cursor-pointer rounded-lg p-3 -mx-2 transition-colors ${
        expiryStatus === 'expired'
          ? 'opacity-40 hover:opacity-60'
          : incident.actionStatus === 'auto_queued'
            ? 'border border-orange-500/20 bg-orange-500/5 hover:bg-orange-500/10'
            : 'hover:bg-white/[0.02]'
      }`}
      onClick={onClick}
      data-testid={`card-home-svc-incident-${incident.id}`}
    >
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <p className="text-white font-bold text-sm truncate">{incident.title}</p>
            {raw?.signalType && (
              <span className="text-[8px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-black uppercase tracking-wider border border-amber-500/30">
                {raw.signalType.replace(/_/g, ' ')}
              </span>
            )}
            {incident.actionStatus === 'auto_queued' && (
              <span className="text-[8px] bg-orange-500/20 text-orange-300 px-1.5 py-0.5 rounded font-bold border border-orange-500/30" data-testid={`badge-auto-queued-${incident.id}`}>AUTO-QUEUED</span>
            )}
            {incident.actionStatus === 'lead_flagged' && (
              <span className="text-[8px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded font-bold">FLAGGED</span>
            )}
            {incident.smsSent && (
              <span className="text-[8px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded font-bold">SMS SENT</span>
            )}
            {expiryStatus === 'expired' && (
              <span className="text-[8px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-bold border border-red-500/30" data-testid={`badge-expired-${incident.id}`}>EXPIRED</span>
            )}
            {expiryStatus === 'expiring_soon' && (
              <span className="text-[8px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded font-bold border border-yellow-500/30 animate-pulse" data-testid={`badge-expiring-${incident.id}`}>EXPIRING SOON</span>
            )}
          </div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <p className="text-gray-500 text-xs flex items-center gap-1">
              <MapPin size={10} /> {incident.location || 'Area not specified'}
            </p>
            {territory !== 'unassigned' && (
              <span className="text-[9px] bg-cyan-500/10 text-cyan-400 px-1.5 py-0.5 rounded font-bold border border-cyan-500/20" data-testid={`badge-territory-${incident.id}`}>
                <Crosshair size={8} className="inline mr-0.5" />{territory}
              </span>
            )}
          </div>
          {serviceTypes.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {serviceTypes.slice(0, 4).map(svc => (
                <span key={svc} className={`text-[9px] px-1.5 py-0.5 rounded border ${
                  serviceValueTier === 'premium' && ['roofing', 'water_restoration', 'mold_remediation', 'foundation_repair'].includes(svc)
                    ? 'bg-amber-500/10 text-amber-300 border-amber-500/20 font-bold'
                    : 'bg-white/5 text-slate-400 border-white/10'
                }`}>
                  {serviceLabel(svc)}
                </span>
              ))}
              {serviceValueTier === 'premium' && (
                <span className="text-[8px] text-amber-500 font-bold uppercase tracking-wider">Premium</span>
              )}
            </div>
          )}
          {expiryLabel && expiryStatus !== 'expired' && <p className="text-[10px] text-slate-600 mt-1">{expiryLabel}</p>}
        </div>
        <div className="text-right flex-shrink-0 space-y-1">
          <div className="flex items-center gap-1.5 justify-end">
            <span className={`${tierStyle.bg} ${tierStyle.text} text-[10px] px-2 py-1 rounded font-black tracking-wider border ${tierStyle.border}`} data-testid={`badge-score-tier-${incident.id}`}>
              {tierStyle.label}
            </span>
          </div>
          <div className="flex items-center gap-1 justify-end" data-testid={`text-score-${incident.id}`}>
            <span className="text-lg font-black text-white">{score}</span>
            <span className="text-[9px] text-slate-600 font-bold">/100</span>
          </div>
          <span className={`${readinessStyle.bg} ${readinessStyle.text} text-[8px] px-1.5 py-0.5 rounded font-bold inline-block`} data-testid={`badge-readiness-${incident.id}`}>
            {readinessStyle.label}
          </span>
          <p className="text-gray-600 text-[9px]">
            {timeAgo(incident.detectedAt as unknown as string)}
          </p>
        </div>
      </div>

      {isPending && expiryStatus !== 'expired' && (
        <div className="flex gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onMarkLead}
            disabled={incident.actionStatus === 'lead_flagged' || markLeadPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-bold hover:bg-amber-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            data-testid={`button-flag-lead-${incident.id}`}
          >
            <Target size={12} />
            {incident.actionStatus === 'lead_flagged' ? 'Flagged' : 'Flag as Lead'}
          </button>
          <button
            onClick={onSms}
            disabled={incident.smsSent || smsPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold hover:bg-blue-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            data-testid={`button-sms-home-svc-${incident.id}`}
          >
            <Send size={12} /> {incident.smsSent ? 'Sent' : 'SMS Alert'}
          </button>
          <button
            onClick={onAck}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 text-xs font-bold hover:bg-white/10 transition-all"
            data-testid={`button-ack-home-svc-${incident.id}`}
          >
            <Eye size={12} /> Acknowledge
          </button>
        </div>
      )}
    </motion.div>
  );
}

function ScoreBreakdownBar({ label, points, maxPoints, color }: { label: string; points: number; maxPoints: number; color: string }) {
  const pct = maxPoints > 0 ? Math.round((points / maxPoints) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]">
        <span className="text-slate-400 font-bold uppercase tracking-wider">{label}</span>
        <span className="text-white font-bold">{points}/{maxPoints}</span>
      </div>
      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function HomeSvcIncidentDetailView({
  incident, onBack, onSms, onAck, onMarkLead, smsPending, markLeadPending,
}: {
  incident: SentinelIncident;
  onBack: () => void;
  onSms: () => void;
  onAck: () => void;
  onMarkLead: () => void;
  smsPending: boolean;
  markLeadPending: boolean;
}) {
  const sev = SEVERITY_COLORS[incident.severity || 'medium'] || SEVERITY_COLORS.medium;
  const raw = incident.rawPayload as any;
  const isPending = incident.actionStatus === 'pending' || incident.actionStatus === 'auto_queued';
  const serviceTypes: string[] = Array.isArray(raw?.serviceTypes) ? raw.serviceTypes : [];
  const expiryLabel = formatExpiry(raw?.expires);
  const expiryStatus = computeExpiryStatus(raw?.expires);
  const effectiveLabel = raw?.onset ? formatDateTime(raw.onset) : null;
  const lat = raw?.lat || incident.lat;
  const lng = raw?.lng || incident.lng;
  const googleMapsUrl = raw?.googleMaps || (lat && lng ? `https://www.google.com/maps?q=${lat},${lng}` : null);
  const score: number = raw?.opportunityScore ?? 0;
  const scoreTier: string = raw?.scoreTier ?? 'monitor';
  const breakdown = raw?.scoreBreakdown ?? {};
  const territory: string = raw?.territory ?? 'unassigned';
  const leadReadiness: string = raw?.leadReadiness ?? 'monitoring';
  const serviceValueTier: string = raw?.serviceValueTier ?? 'basic';
  const tierStyle = SCORE_TIER_COLORS[scoreTier] || SCORE_TIER_COLORS.monitor;
  const readinessStyle = LEAD_READINESS_COLORS[leadReadiness] || LEAD_READINESS_COLORS.monitoring;

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
      <Button variant="ghost" onClick={onBack} className="text-slate-400 hover:text-white mb-4">
        <ChevronLeft size={16} className="mr-1" /> Back to Signals
      </Button>

      <div className="text-xs font-bold uppercase tracking-widest mb-3 text-amber-400 flex items-center gap-2">
        Source: NOAA NWS — Home Services Signal
        {expiryStatus === 'expired' && (
          <span className="text-[8px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-black border border-red-500/20">EXPIRED</span>
        )}
        {incident.actionStatus === 'auto_queued' && (
          <span className="text-[8px] bg-orange-500/20 text-orange-300 px-1.5 py-0.5 rounded font-black border border-orange-500/30">AUTO-QUEUED</span>
        )}
      </div>

      {expiryStatus === 'expired' && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-4 flex items-center gap-3">
          <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
          <p className="text-red-400 text-sm font-bold">This alert has expired. The NOAA alert is no longer active.</p>
        </div>
      )}

      {expiryStatus === 'expiring_soon' && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 mb-4 flex items-center gap-3 animate-pulse">
          <Clock size={16} className="text-yellow-400 flex-shrink-0" />
          <p className="text-yellow-400 text-sm font-bold">This alert expires within the hour. Act quickly if needed.</p>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-black text-white" data-testid="text-home-svc-detail-title">{incident.title}</h2>
          <p className="text-slate-500 text-sm">
            Detected {formatDateTime(incident.detectedAt as unknown as string)} · {timeAgo(incident.detectedAt as unknown as string)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {territory !== 'unassigned' && (
            <span className="bg-cyan-500/10 text-cyan-400 text-xs px-3 py-1.5 rounded-full font-bold border border-cyan-500/20" data-testid="text-home-svc-territory">
              <Crosshair size={12} className="inline mr-1" />{territory}
            </span>
          )}
          <span className={`${tierStyle.bg} ${tierStyle.text} text-xs px-3 py-1.5 rounded-full font-black tracking-wider border ${tierStyle.border}`} data-testid="text-home-svc-score-tier">
            {tierStyle.label}
          </span>
        </div>
      </div>

      <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-6 mb-6" data-testid="panel-score-breakdown">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <ArrowUpCircle size={14} className="text-amber-400" /> Opportunity Score
          </h3>
          <div className="flex items-center gap-2">
            <span className={`${readinessStyle.bg} ${readinessStyle.text} text-[10px] px-2 py-1 rounded font-bold`} data-testid="text-home-svc-readiness">
              Lead: {readinessStyle.label}
            </span>
            <span className="text-3xl font-black text-white" data-testid="text-home-svc-score">{score}</span>
            <span className="text-sm text-slate-600 font-bold">/100</span>
          </div>
        </div>
        <div className="space-y-3">
          <ScoreBreakdownBar label="Severity" points={breakdown.severityPoints ?? 0} maxPoints={30} color="bg-red-500" />
          <ScoreBreakdownBar label="Urgency" points={breakdown.urgencyPoints ?? 0} maxPoints={20} color="bg-orange-500" />
          <ScoreBreakdownBar label="Signal Type" points={breakdown.signalTypePoints ?? 0} maxPoints={20} color="bg-amber-500" />
          <ScoreBreakdownBar label="Service Value" points={breakdown.serviceValuePoints ?? 0} maxPoints={15} color="bg-emerald-500" />
          <ScoreBreakdownBar label="Territory Match" points={breakdown.territoryPoints ?? 0} maxPoints={10} color="bg-cyan-500" />
          <ScoreBreakdownBar label="Freshness" points={breakdown.freshnessPoints ?? 0} maxPoints={5} color="bg-blue-500" />
          <ScoreBreakdownBar label="Cluster Bonus" points={breakdown.clusterBonus ?? 0} maxPoints={5} color="bg-purple-500" />
        </div>
        {serviceValueTier && (
          <div className="mt-4 pt-3 border-t border-white/5 flex items-center gap-2">
            <span className="text-[10px] text-slate-600 uppercase font-bold tracking-widest">Service Value Tier:</span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${
              serviceValueTier === 'premium' ? 'bg-amber-500/20 text-amber-400' :
              serviceValueTier === 'standard' ? 'bg-blue-500/20 text-blue-400' :
              'bg-slate-500/20 text-slate-400'
            }`} data-testid="text-home-svc-svc-tier">
              {serviceValueTier.charAt(0).toUpperCase() + serviceValueTier.slice(1)}
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-6">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Radio size={14} className="text-amber-400" /> Signal Details
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <DetailField label="NOAA Event"    value={raw?.noaaEvent}                        testId="text-home-svc-event" />
            <DetailField label="Signal Type"   value={raw?.signalType?.replace(/_/g, ' ')}   testId="text-home-svc-signal" />
            <DetailField label="NOAA Severity" value={raw?.noaaSeverity}                     testId="text-home-svc-noaa-sev" />
            <DetailField label="Urgency"       value={raw?.noaaUrgency}                      testId="text-home-svc-urgency" />
            <DetailField label="Certainty"     value={raw?.noaaCertainty}                    testId="text-home-svc-certainty" />
            <DetailField label="State"         value={raw?.state}                            testId="text-home-svc-state" />
            <DetailField label="Territory"     value={territory !== 'unassigned' ? territory : 'Unassigned'}  testId="text-home-svc-territory-field" />
          </div>
          {expiryLabel && (
            <div className={`${expiryStatus === 'expired' ? 'bg-red-500/10 border-red-500/20' : expiryStatus === 'expiring_soon' ? 'bg-yellow-500/10 border-yellow-500/20' : 'bg-amber-500/10 border-amber-500/20'} border rounded-lg p-3 mb-4`}>
              <p className={`${expiryStatus === 'expired' ? 'text-red-400' : expiryStatus === 'expiring_soon' ? 'text-yellow-400' : 'text-amber-400'} text-xs font-bold`}>{expiryStatus === 'expired' ? 'EXPIRED — ' : ''}{expiryLabel}</p>
            </div>
          )}
          {effectiveLabel && <DetailField label="Effective From" value={effectiveLabel} testId="text-home-svc-effective" />}
          <div className="mt-4">
            <p className="text-[10px] text-slate-600 uppercase font-bold tracking-widest mb-1">Affected Area</p>
            <p className="text-sm text-white font-medium" data-testid="text-home-svc-area">{incident.location || 'Area not specified'}</p>
          </div>
          {incident.description && (
            <div className="mt-4">
              <p className="text-[10px] text-slate-600 uppercase font-bold tracking-widest mb-1">Headline</p>
              <p className="text-sm text-slate-300" data-testid="text-home-svc-headline">{incident.description}</p>
            </div>
          )}
        </div>

        <div className="space-y-6">
          {serviceTypes.length > 0 && (
            <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-6">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Home size={14} className="text-amber-400" /> Recommended Service Categories
              </h3>
              <p className="text-[10px] text-slate-600 mb-3">Based on signal type: {raw?.signalType?.replace(/_/g, ' ') || 'storm'}</p>
              <div className="flex flex-wrap gap-2" data-testid="list-home-svc-categories">
                {serviceTypes.map(svc => {
                  const isPremium = ['roofing', 'water_restoration', 'mold_remediation', 'foundation_repair'].includes(svc);
                  return (
                    <span key={svc} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${
                      isPremium
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        : 'bg-white/5 text-slate-300 border-white/10'
                    }`}>
                      {serviceLabel(svc)}
                      {isPremium && <span className="ml-1 text-[8px] text-amber-500 font-black">$$$</span>}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {googleMapsUrl && (
            <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-6">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Globe size={14} className="text-cyan-400" /> Map
              </h3>
              <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-center mb-4">
                <MapPin size={36} className="mx-auto text-amber-400 mb-2" />
                <p className="text-white font-bold text-sm mb-1">{incident.location}</p>
                {lat && lng && <p className="text-slate-500 text-xs">{Number(lat).toFixed(4)}, {Number(lng).toFixed(4)}</p>}
              </div>
              <a
                href={googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm font-bold hover:bg-blue-500/20 transition-all w-full justify-center"
                data-testid="link-home-svc-google-maps"
              >
                <ExternalLink size={14} /> Open in Google Maps
              </a>
            </div>
          )}

          <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-6">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Shield size={14} className="text-emerald-400" /> Operator State
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5">
                <div className="flex items-center gap-2">
                  <Eye size={14} className={incident.actionStatus !== "pending" ? "text-green-400" : "text-slate-600"} />
                  <span className="text-sm text-white">Action Status</span>
                </div>
                <span className={`text-xs font-bold px-2 py-1 rounded ${
                  incident.actionStatus === 'auto_queued' ? "bg-emerald-500/20 text-emerald-400" :
                  incident.actionStatus === 'lead_flagged' ? "bg-green-500/20 text-green-400" :
                  incident.actionStatus !== "pending" ? "bg-green-500/20 text-green-400" :
                  "bg-amber-500/20 text-amber-400"
                }`} data-testid="text-home-svc-action-status">
                  {(incident.actionStatus || "pending").replace(/_/g, " ").toUpperCase()}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5">
                <div className="flex items-center gap-2">
                  <Target size={14} className={incident.actionStatus === 'lead_flagged' ? "text-green-400" : "text-slate-600"} />
                  <span className="text-sm text-white">Flagged for Follow-up</span>
                </div>
                <span className={`text-xs font-bold px-2 py-1 rounded ${incident.actionStatus === 'lead_flagged' ? "bg-green-500/20 text-green-400" : "bg-slate-500/20 text-slate-500"}`} data-testid="text-home-svc-flag-status">
                  {incident.actionStatus === 'lead_flagged' ? "Flagged" : "Not Flagged"}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5">
                <div className="flex items-center gap-2">
                  <MessageSquare size={14} className={incident.smsSent ? "text-green-400" : "text-slate-600"} />
                  <span className="text-sm text-white">SMS Alert</span>
                </div>
                <span className={`text-xs font-bold px-2 py-1 rounded ${incident.smsSent ? "bg-green-500/20 text-green-400" : "bg-slate-500/20 text-slate-500"}`} data-testid="text-home-svc-sms-status">
                  {incident.smsSent ? "Sent" : "Not Sent"}
                </span>
              </div>
            </div>

            {isPending && expiryStatus !== 'expired' && (
              <div className="flex gap-2 mt-4">
                <button
                  onClick={onMarkLead}
                  disabled={incident.actionStatus === 'lead_flagged' || markLeadPending}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-bold hover:bg-amber-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  data-testid="button-detail-flag-lead"
                >
                  <Target size={12} /> {markLeadPending ? "Flagging..." : "Flag as Lead"}
                </button>
                <button
                  onClick={onSms}
                  disabled={incident.smsSent || smsPending}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold hover:bg-blue-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  data-testid="button-detail-home-svc-sms"
                >
                  <Send size={12} /> {smsPending ? "Sending..." : "Send SMS"}
                </button>
                <button
                  onClick={onAck}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-400 text-xs font-bold hover:bg-white/10 transition-all"
                  data-testid="button-detail-home-svc-ack"
                >
                  <Eye size={12} /> Acknowledge
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
