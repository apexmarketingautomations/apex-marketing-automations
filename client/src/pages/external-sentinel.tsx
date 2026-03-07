import { useState } from "react";
import { useRoute } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Satellite, Radar, MapPin, Phone, Crosshair, AlertTriangle, CheckCircle2,
  Radio, Shield, Clock, Send, Target, Eye, Activity, RefreshCw
} from "lucide-react";

const API_BASE = "/api/v1/external/sentinel";

const SEVERITY_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: "bg-red-600/30", text: "text-red-400", label: "CRITICAL" },
  high: { bg: "bg-orange-600/30", text: "text-orange-400", label: "HIGH VALUE" },
  medium: { bg: "bg-amber-600/30", text: "text-amber-400", label: "MEDIUM" },
  low: { bg: "bg-zinc-700/50", text: "text-zinc-400", label: "LOW" },
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
    headers: {
      "Content-Type": "application/json",
      "x-api-token": token,
    },
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

  const { data: statsData, isLoading: loadingStats } = useQuery({
    queryKey: ["ext-sentinel-stats", token],
    queryFn: () => apiFetch("/stats", token),
    enabled: !!token,
    refetchInterval: 30000,
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

  const scanMutation = useMutation({
    mutationFn: async () => {
      setScanPulse(true);
      return apiFetch("/scan", token, "POST");
    },
    onSuccess: () => {
      setTimeout(() => setScanPulse(false), 2000);
      queryClient.invalidateQueries({ queryKey: ["ext-sentinel-incidents", token] });
      queryClient.invalidateQueries({ queryKey: ["ext-sentinel-stats", token] });
    },
    onSettled: () => setTimeout(() => setScanPulse(false), 2000),
  });

  const ackMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/incidents/${id}/acknowledge`, token, "POST"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ext-sentinel-incidents", token] });
      queryClient.invalidateQueries({ queryKey: ["ext-sentinel-stats", token] });
    },
  });

  const geofenceMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/incidents/${id}/deploy-geofence`, token, "POST"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ext-sentinel-incidents", token] });
    },
  });

  const smsMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/incidents/${id}/send-sms`, token, "POST"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ext-sentinel-incidents", token] });
    },
  });

  const accountName = incidentsData?.accountName || statsData?.accountName || "";
  const incidents = incidentsData?.incidents || [];
  const stats = statsData || { total: 0, last24h: 0, last7d: 0, bySeverity: {}, byStatus: {} };

  const filteredIncidents = locationFilter
    ? incidents.filter((i: any) => (i.location || "").toLowerCase().includes(locationFilter.toLowerCase()))
    : incidents;
  const pendingIncidents = filteredIncidents.filter((i: any) => i.actionStatus === "pending");
  const actionedIncidents = filteredIncidents.filter((i: any) => i.actionStatus !== "pending");
  const criticalCount = filteredIncidents.filter((i: any) => i.severity === "critical" || i.severity === "high").length;

  if (!token) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <Shield size={48} className="text-red-600 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Access Denied</h1>
          <p className="text-zinc-500">Invalid or missing access token.</p>
        </div>
      </div>
    );
  }

  if (loadingStats && loadingIncidents) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <Radar size={48} className="text-red-600 mx-auto mb-4 animate-spin" />
          <p className="text-zinc-400">Connecting to Sentinel...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black" data-testid="external-sentinel-page">
      <div className="border-b border-red-900/30 bg-black/90 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg bg-gradient-to-br from-red-700 to-red-900 flex items-center justify-center ${scanPulse ? "animate-pulse" : ""}`}>
              <Satellite size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black text-white tracking-tight" data-testid="text-sentinel-title">
                CRASH CONNECT SENTINEL
              </h1>
              <p className="text-zinc-500 text-xs flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${configData?.enabled ? "bg-red-500 animate-pulse" : "bg-zinc-700"}`} />
                {configData?.enabled ? "Live Monitoring Active" : "Monitoring Standby"}
                {accountName && <span className="text-zinc-700">|</span>}
                <span className="text-zinc-600">{accountName}</span>
              </p>
            </div>
          </div>
          <button
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-red-700 hover:bg-red-600 text-white font-bold text-sm transition-all disabled:opacity-50 shadow-lg shadow-red-900/40"
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

      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            className="bg-zinc-950 border border-red-900/40 p-4 rounded-xl"
            data-testid="card-total-incidents"
          >
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle size={14} className="text-red-600" />
              <p className="text-[10px] text-zinc-600 uppercase font-bold tracking-widest">Total Incidents</p>
            </div>
            <p className="text-3xl font-black text-white">{stats.total}</p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="bg-zinc-950 border border-red-900/30 p-4 rounded-xl"
            data-testid="card-critical-incidents"
          >
            <div className="flex items-center gap-2 mb-1">
              <Shield size={14} className="text-red-500" />
              <p className="text-[10px] text-zinc-600 uppercase font-bold tracking-widest">High Priority</p>
            </div>
            <p className="text-3xl font-black text-white">{criticalCount}</p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
            className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl"
            data-testid="card-last-24h"
          >
            <div className="flex items-center gap-2 mb-1">
              <Activity size={14} className="text-red-400" />
              <p className="text-[10px] text-zinc-600 uppercase font-bold tracking-widest">Last 24h</p>
            </div>
            <p className="text-3xl font-black text-white">{stats.last24h}</p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl"
            data-testid="card-actioned"
          >
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 size={14} className="text-emerald-500" />
              <p className="text-[10px] text-zinc-600 uppercase font-bold tracking-widest">Actioned</p>
            </div>
            <p className="text-3xl font-black text-white">{actionedIncidents.length}</p>
          </motion.div>
        </div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
          className="bg-zinc-950 border border-red-900/30 p-6 rounded-xl"
        >
          <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
            <h2 className="text-red-600 font-black tracking-widest uppercase flex items-center gap-2 text-sm" data-testid="text-live-stream-title">
              <Radio size={16} className={scanPulse ? "animate-pulse" : ""} />
              Live Accident Stream
            </h2>
            <div className="flex items-center gap-3">
              <div className="relative">
                <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
                <input
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                  placeholder="Filter by location..."
                  className="bg-zinc-900 border border-zinc-800 text-white pl-8 pr-3 py-1.5 rounded-lg w-48 text-xs focus:outline-none focus:border-red-700 transition-colors placeholder:text-zinc-700"
                  data-testid="input-location-filter"
                />
              </div>
              <button
                onClick={() => {
                  queryClient.invalidateQueries({ queryKey: ["ext-sentinel-incidents", token] });
                  queryClient.invalidateQueries({ queryKey: ["ext-sentinel-stats", token] });
                }}
                className="text-zinc-600 hover:text-red-500 transition-colors"
                data-testid="button-refresh"
              >
                <RefreshCw size={14} />
              </button>
              <span className="text-[10px] text-zinc-700 uppercase tracking-widest whitespace-nowrap">
                {filteredIncidents.length} of {incidents.length} incident{incidents.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {loadingIncidents ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i: number) => (
                <div key={i} className="h-20 bg-zinc-900 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : pendingIncidents.length === 0 && actionedIncidents.length === 0 ? (
            <div className="text-center py-16">
              <Radar size={48} className="mx-auto text-zinc-800 mb-4" />
              <h3 className="text-white font-bold text-lg mb-2">No Incidents Detected</h3>
              <p className="text-zinc-600 text-sm max-w-md mx-auto mb-6">
                Click "Scan Now" to pull live crash data from dispatch feeds.
              </p>
              <button
                onClick={() => scanMutation.mutate()}
                disabled={scanMutation.isPending}
                className="px-6 py-2.5 rounded-lg bg-red-700 hover:bg-red-600 text-white font-bold text-sm transition-all disabled:opacity-50"
                data-testid="button-scan-empty"
              >
                <Radar size={14} className="inline mr-2" /> Run First Scan
              </button>
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
                    <div className="flex-1 h-px bg-zinc-800" />
                    <span className="text-xs text-zinc-700 uppercase tracking-widest font-bold">Previously Actioned</span>
                    <div className="flex-1 h-px bg-zinc-800" />
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

        <div className="mt-6 text-center">
          <p className="text-zinc-800 text-[10px] uppercase tracking-widest">
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
      animate={{ opacity: dimmed ? 0.4 : 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ delay: index * 0.03 }}
      className={`border-b border-zinc-800/50 pb-4 last:border-0 last:pb-0`}
      data-testid={`card-incident-${incident.id}`}
    >
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-white font-bold text-sm truncate">{incident.title}</p>
            {incident.smsSent && (
              <span className="text-[8px] bg-red-900/40 text-red-400 px-1.5 py-0.5 rounded font-bold">SMS SENT</span>
            )}
            {incident.geofenceDeployed && (
              <span className="text-[8px] bg-emerald-900/40 text-emerald-400 px-1.5 py-0.5 rounded font-bold">GEO ACTIVE</span>
            )}
          </div>
          <p className="text-zinc-500 text-xs flex items-center gap-1">
            <MapPin size={10} /> {incident.location || "Location pending"}
          </p>
          {incident.description && (
            <p className="text-zinc-700 text-[11px] mt-1 line-clamp-1">{incident.description}</p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <span className={`${sev.bg} ${sev.text} text-[10px] px-2 py-1 rounded font-black tracking-wider`}>
            {sev.label}
          </span>
          <p className="text-zinc-600 text-[10px] mt-1 flex items-center gap-1 justify-end" data-testid={`text-incident-date-${incident.id}`}>
            <Clock size={8} /> {formatDateTime(incident.detectedAt)}
          </p>
          <p className="text-zinc-700 text-[9px] mt-0.5 text-right">
            {timeAgo(incident.detectedAt)}
          </p>
        </div>
      </div>

      {isPending && !dimmed && (
        <div className="flex gap-2 mt-3">
          <button
            onClick={onGeofence}
            disabled={incident.geofenceDeployed || geofencePending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-900/20 border border-red-800/30 text-red-400 text-xs font-bold hover:bg-red-900/40 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            data-testid={`button-geofence-${incident.id}`}
          >
            <Crosshair size={12} /> {incident.geofenceDeployed ? "Deployed" : "Deploy Geofence"}
          </button>
          <button
            onClick={onSms}
            disabled={incident.smsSent || smsPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-900/20 border border-red-800/30 text-red-300 text-xs font-bold hover:bg-red-900/40 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            data-testid={`button-sms-${incident.id}`}
          >
            <Send size={12} /> {incident.smsSent ? "Sent" : "SMS Alert"}
          </button>
          <button
            onClick={onAck}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800/50 border border-zinc-700/30 text-zinc-400 text-xs font-bold hover:bg-zinc-800 transition-all"
            data-testid={`button-ack-${incident.id}`}
          >
            <Eye size={12} /> Acknowledge
          </button>
        </div>
      )}
    </motion.div>
  );
}