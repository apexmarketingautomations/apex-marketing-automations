import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAccount } from "@/hooks/use-account";
import { useToast } from "@/hooks/use-toast";
import {
  Satellite, Radar, MapPin, Phone, Crosshair, AlertTriangle, CheckCircle2,
  Settings, Play, Pause, Radio, Shield, Clock, ChevronRight, ChevronLeft, Send, Target, Zap, Eye, BookOpen, Lock, ArrowUpCircle, Plus, ExternalLink, Globe, MessageSquare
} from "lucide-react";
import { TutorialOverlay, useTutorial } from "@/components/tutorial-overlay";
import { SENTINEL_STEPS } from "@/components/tutorial-steps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useLocation } from "wouter";
import type { SubAccount, SentinelIncident, SentinelConfig } from "@shared/schema";
import { hasFeature } from "@shared/schema";

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
  const [, navigate] = useLocation();
  const { showTutorial, startTutorial, closeTutorial } = useTutorial("apex_tutorial_sentinel");
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
  });
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
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (config) {
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
      });
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
          title: "Geofence Simulated",
          description: "Connect your Meta Ads credentials in the Integrations Hub to deploy live ads.",
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
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Sentinel config saved!" });
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
  const pendingIncidents = filteredIncidents.filter(i => i.actionStatus === "pending");
  const actionedIncidents = filteredIncidents.filter(i => i.actionStatus !== "pending");
  const criticalCount = filteredIncidents.filter(i => i.severity === "critical" || i.severity === "high").length;

  const liveSelectedIncident = selectedIncident
    ? incidents.find(i => i.id === selectedIncident.id) || selectedIncident
    : null;

  if (liveSelectedIncident) {
    return (
      <div className="p-6 md:p-10 max-w-6xl mx-auto">
        <IncidentDetailView
          incident={liveSelectedIncident}
          onBack={() => setSelectedIncident(null)}
          onGeofence={() => geofenceMutation.mutate(liveSelectedIncident.id)}
          onSms={() => smsMutation.mutate(liveSelectedIncident.id)}
          onAck={() => { ackMutation.mutate(liveSelectedIncident.id); setSelectedIncident(null); }}
          geofencePending={geofenceMutation.isPending}
          smsPending={smsMutation.isPending}
        />
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

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br from-red-600 to-orange-500 flex items-center justify-center ${scanPulse ? "animate-pulse" : ""}`}>
              <Satellite size={24} className="text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-black text-white tracking-tight" data-testid="text-sentinel-title">
                APEX SENTINEL
              </h1>
              <p className="text-slate-400 text-sm flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${config?.enabled ? "bg-green-400 animate-pulse" : "bg-slate-600"}`} />
                {config?.enabled ? "Live Monitoring Active" : "Monitoring Offline"}
                {currentAccount && <span className="text-slate-600">| {currentAccount.name}</span>}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={startTutorial} className="text-slate-400 hover:text-white" data-testid="button-start-tutorial">
              <BookOpen size={16} className="mr-1" /> Tutorial
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate("/crash-reports")}
              className="border-white/10 text-white hover:bg-white/10 gap-2"
              data-testid="button-crash-reports"
            >
              <Eye size={16} /> Crash Reports
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowConfig(true)}
              className="border-white/10 text-white hover:bg-white/10 gap-2"
              data-testid="button-sentinel-config"
            >
              <Settings size={16} /> Config
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowReportDialog(true)}
              className="border-white/10 text-white hover:bg-white/10 gap-2"
              data-testid="button-report-incident"
            >
              <Plus size={16} /> Report
            </Button>
            <Button
              onClick={() => scanMutation.mutate()}
              disabled={scanMutation.isPending || !currentAccount}
              className="bg-gradient-to-r from-red-600 to-orange-500 text-white font-bold gap-2 shadow-lg shadow-red-500/25"
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
          data-testid="card-critical-incidents"
        >
          <div className="flex items-center gap-2 mb-1">
            <Shield size={14} className="text-orange-500" />
            <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">High Priority</p>
          </div>
          <p className="text-3xl font-black text-white">{criticalCount}</p>
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

      <Dialog open={showConfig} onOpenChange={setShowConfig}>
        <DialogContent className="bg-neutral-950 border-white/10 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings size={20} className="text-red-400" /> Sentinel Configuration
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfig(false)} className="border-white/10 text-white hover:bg-white/10">Cancel</Button>
            <Button
              onClick={() => configMutation.mutate()}
              disabled={configMutation.isPending}
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
    </motion.div>
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
