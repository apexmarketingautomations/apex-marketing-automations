import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Satellite, Radar, MapPin, Crosshair, AlertTriangle, CheckCircle2,
  Settings, Radio, Shield, Clock, Send, Eye, Activity, RefreshCw, X
} from "lucide-react";

const API_BASE = "/api/v1/external/sentinel";

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

async function apiFetch(path: string, token: string, method = "GET", body?: any) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-api-token": token },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export default function ExternalSentinel() {
  const [, params] = useRoute("/sentinel/:token");
  const token = params?.token || "";
  const queryClient = useQueryClient();
  const [scanPulse, setScanPulse] = useState(false);
  const [locationFilter, setLocationFilter] = useState("");
  const [showConfig, setShowConfig] = useState(false);
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

  const { data: incidentsData, isLoading: loadingIncidents } = useQuery({
    queryKey: ["ext-sentinel-incidents", token],
    queryFn: () => apiFetch("/incidents", token),
    enabled: !!token,
    refetchInterval: 30000,
  });

  const { data: configData } = useQuery({
    queryKey: ["ext-sentinel-config", token],
    queryFn: () => apiFetch("/config", token),
    enabled: !!token,
  });

  useEffect(() => {
    if (configData && configData.enabled !== undefined) {
      setConfigForm({
        keywords: (configData.keywords || []).join(", "),
        scanInterval: configData.scanInterval || 60,
        enabled: configData.enabled || false,
        smsAlertEnabled: configData.smsAlertEnabled !== false,
        smsAlertPhone: configData.smsAlertPhone || "",
        geofenceEnabled: configData.geofenceEnabled !== false,
        geofenceRadiusMiles: configData.geofenceRadiusMiles || 1,
        targetCities: (configData.targetCities || []).join(", "),
        targetStates: (configData.targetStates || []).join(", "),
      });
    }
  }, [configData]);

  const scanMutation = useMutation({
    mutationFn: async () => {
      setScanPulse(true);
      return apiFetch("/scan", token, "POST");
    },
    onSuccess: () => {
      setTimeout(() => setScanPulse(false), 2000);
      queryClient.invalidateQueries({ queryKey: ["ext-sentinel-incidents", token] });
    },
    onSettled: () => setTimeout(() => setScanPulse(false), 2000),
  });

  const ackMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/incidents/${id}/acknowledge`, token, "POST"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ext-sentinel-incidents", token] }),
  });

  const geofenceMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/incidents/${id}/deploy-geofence`, token, "POST"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ext-sentinel-incidents", token] }),
  });

  const smsMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/incidents/${id}/send-sms`, token, "POST"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ext-sentinel-incidents", token] }),
  });

  const configMutation = useMutation({
    mutationFn: () => apiFetch("/config", token, "PUT", {
      keywords: configForm.keywords.split(",").map(k => k.trim()).filter(Boolean),
      scanInterval: configForm.scanInterval,
      enabled: configForm.enabled,
      smsAlertEnabled: configForm.smsAlertEnabled,
      smsAlertPhone: configForm.smsAlertPhone || null,
      geofenceEnabled: configForm.geofenceEnabled,
      geofenceRadiusMiles: configForm.geofenceRadiusMiles,
      targetCities: configForm.targetCities.split(",").map(c => c.trim()).filter(Boolean),
      targetStates: configForm.targetStates.split(",").map(s => s.trim()).filter(Boolean),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ext-sentinel-config", token] });
      setShowConfig(false);
    },
  });

  const accountName = incidentsData?.accountName || "";
  const incidents = incidentsData?.incidents || [];

  const filteredIncidents = locationFilter
    ? incidents.filter((i: any) => (i.location || "").toLowerCase().includes(locationFilter.toLowerCase()))
    : incidents;
  const pendingIncidents = filteredIncidents.filter((i: any) => i.actionStatus === "pending");
  const actionedIncidents = filteredIncidents.filter((i: any) => i.actionStatus !== "pending");
  const criticalCount = filteredIncidents.filter((i: any) => i.severity === "critical" || i.severity === "high").length;

  if (!token) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <Shield size={48} className="text-red-600 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Access Denied</h1>
          <p className="text-gray-500">Invalid or missing access token.</p>
        </div>
      </div>
    );
  }

  if (loadingIncidents) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <Radar size={48} className="text-red-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]" data-testid="external-sentinel-page">
      <div className="p-6 md:p-10 max-w-6xl mx-auto">

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br from-red-700 to-red-900 flex items-center justify-center ${scanPulse ? "animate-pulse" : ""}`}>
                <Satellite size={24} className="text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-black text-white tracking-tight" data-testid="text-sentinel-title">
                  APEX SENTINEL
                </h1>
                <p className="text-slate-400 text-sm flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${configData?.enabled ? "bg-green-400 animate-pulse" : "bg-slate-600"}`} />
                  {configData?.enabled ? "Live Monitoring Active" : "Monitoring Offline"}
                  {accountName && <span className="text-slate-600">| {accountName}</span>}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowConfig(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 text-white hover:bg-white/10 text-sm font-medium transition-all"
                data-testid="button-sentinel-config"
              >
                <Settings size={16} /> Config
              </button>
              <button
                onClick={() => scanMutation.mutate()}
                disabled={scanMutation.isPending}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-gradient-to-r from-red-700 to-red-600 text-white font-bold text-sm shadow-lg shadow-red-900/30 hover:from-red-600 hover:to-red-500 transition-all disabled:opacity-50"
                data-testid="button-scan-now"
              >
                {scanMutation.isPending ? (
                  <><Radar size={16} className="animate-spin" /> Scanning...</>
                ) : (
                  <><Radar size={16} /> Scan Now</>
                )}
              </button>
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
                <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                  placeholder="Filter by location..."
                  className="bg-white/5 border border-white/10 text-white pl-8 pr-3 py-1.5 rounded-lg w-48 text-xs focus:outline-none focus:border-red-500/50 transition-colors placeholder:text-slate-600"
                  data-testid="input-location-filter"
                />
              </div>
              <span className="text-[10px] text-gray-600 uppercase tracking-widest whitespace-nowrap">
                {filteredIncidents.length} of {incidents.length} incident{incidents.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {pendingIncidents.length === 0 && actionedIncidents.length === 0 ? (
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
                {pendingIncidents.map((incident: any, i: number) => (
                  <IncidentCard
                    key={incident.id}
                    incident={incident}
                    index={i}
                    onGeofence={() => geofenceMutation.mutate(incident.id)}
                    onSms={() => smsMutation.mutate(incident.id)}
                    onAck={() => ackMutation.mutate(incident.id)}
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
                  {actionedIncidents.slice(0, 10).map((incident: any, i: number) => (
                    <IncidentCard
                      key={incident.id}
                      incident={incident}
                      index={i}
                      onGeofence={() => geofenceMutation.mutate(incident.id)}
                      onSms={() => smsMutation.mutate(incident.id)}
                      onAck={() => ackMutation.mutate(incident.id)}
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

        {showConfig && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setShowConfig(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-neutral-950 border border-white/10 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-white font-bold text-lg flex items-center gap-2">
                  <Settings size={20} className="text-red-400" /> Sentinel Configuration
                </h3>
                <button onClick={() => setShowConfig(false)} className="text-slate-500 hover:text-white transition-colors">
                  <X size={20} />
                </button>
              </div>

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
                  <input
                    value={configForm.keywords}
                    onChange={(e) => setConfigForm(f => ({ ...f, keywords: e.target.value }))}
                    placeholder="MVA, EXTRICATION, ROLLOVER, INJURIES"
                    className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500/50"
                    data-testid="input-keywords"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Target Cities (comma-separated)</label>
                  <input
                    value={configForm.targetCities}
                    onChange={(e) => setConfigForm(f => ({ ...f, targetCities: e.target.value }))}
                    placeholder="Las Vegas, Henderson, North Las Vegas"
                    className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500/50"
                    data-testid="input-target-cities"
                  />
                  <p className="text-[10px] text-slate-600 mt-1">Only show incidents from these cities. Leave empty for all.</p>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Target States (comma-separated)</label>
                  <input
                    value={configForm.targetStates}
                    onChange={(e) => setConfigForm(f => ({ ...f, targetStates: e.target.value }))}
                    placeholder="NV, CA, AZ"
                    className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500/50"
                    data-testid="input-target-states"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Scan Interval (sec)</label>
                    <input
                      type="number"
                      value={configForm.scanInterval}
                      onChange={(e) => setConfigForm(f => ({ ...f, scanInterval: parseInt(e.target.value) || 60 }))}
                      className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500/50"
                      data-testid="input-scan-interval"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Geofence Radius (mi)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={configForm.geofenceRadiusMiles}
                      onChange={(e) => setConfigForm(f => ({ ...f, geofenceRadiusMiles: parseFloat(e.target.value) || 1 }))}
                      className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500/50"
                      data-testid="input-geofence-radius"
                    />
                  </div>
                </div>
                <div className="space-y-3 pt-2">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-slate-300">Live Monitoring</span>
                    <div className={`w-10 h-5 rounded-full transition-colors ${configForm.enabled ? 'bg-red-600' : 'bg-zinc-700'} relative`}
                      onClick={() => setConfigForm(f => ({ ...f, enabled: !f.enabled }))}>
                      <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${configForm.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </div>
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-slate-300">SMS Alerts</span>
                    <div className={`w-10 h-5 rounded-full transition-colors ${configForm.smsAlertEnabled ? 'bg-red-600' : 'bg-zinc-700'} relative`}
                      onClick={() => setConfigForm(f => ({ ...f, smsAlertEnabled: !f.smsAlertEnabled }))}>
                      <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${configForm.smsAlertEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </div>
                  </label>
                  {configForm.smsAlertEnabled && (
                    <div>
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Alert Phone Number</label>
                      <input
                        value={configForm.smsAlertPhone}
                        onChange={(e) => setConfigForm(f => ({ ...f, smsAlertPhone: e.target.value }))}
                        placeholder="+1 (555) 123-4567"
                        className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500/50"
                        data-testid="input-sms-alert-phone"
                      />
                      <p className="text-[10px] text-slate-600 mt-1">Phone number for crash alert texts</p>
                    </div>
                  )}
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-slate-300">Auto-Deploy Geofence Ads</span>
                    <div className={`w-10 h-5 rounded-full transition-colors ${configForm.geofenceEnabled ? 'bg-red-600' : 'bg-zinc-700'} relative`}
                      onClick={() => setConfigForm(f => ({ ...f, geofenceEnabled: !f.geofenceEnabled }))}>
                      <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${configForm.geofenceEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </div>
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-white/10">
                <button
                  onClick={() => setShowConfig(false)}
                  className="px-4 py-2 rounded-lg border border-white/10 text-white hover:bg-white/10 text-sm font-medium transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => configMutation.mutate()}
                  disabled={configMutation.isPending}
                  className="px-5 py-2 rounded-lg bg-gradient-to-r from-red-700 to-red-600 text-white font-bold text-sm shadow-lg shadow-red-900/30 disabled:opacity-50 transition-all"
                  data-testid="button-save-config"
                >
                  {configMutation.isPending ? "Saving..." : "Save Configuration"}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        <div className="text-center">
          <p className="text-slate-800 text-[10px] uppercase tracking-widest">
            Powered by Apex Sentinel · Real-Time Crash Detection
          </p>
        </div>
      </div>
    </div>
  );
}

function IncidentCard({
  incident, index, onGeofence, onSms, onAck, geofencePending, smsPending, dimmed
}: {
  incident: any;
  index: number;
  onGeofence: () => void;
  onSms: () => void;
  onAck: () => void;
  geofencePending: boolean;
  smsPending: boolean;
  dimmed?: boolean;
}) {
  const sev = SEVERITY_COLORS[incident.severity || "medium"] || SEVERITY_COLORS.medium;
  const isPending = incident.actionStatus === "pending";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: dimmed ? 0.5 : 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ delay: index * 0.03 }}
      className={`border-b border-white/5 pb-4 last:border-0 last:pb-0 ${dimmed ? "opacity-50" : ""}`}
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
          <p className="text-gray-500 text-[10px] mt-1 flex items-center gap-1 justify-end" data-testid={`text-incident-date-${incident.id}`}>
            <Clock size={8} /> {formatDateTime(incident.detectedAt)}
          </p>
          <p className="text-gray-600 text-[9px] mt-0.5 text-right">
            {timeAgo(incident.detectedAt)}
          </p>
        </div>
      </div>

      {isPending && (
        <div className="flex gap-2 mt-3">
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