import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { apiRequest } from "@/lib/queryClient";
import { useAccount } from "@/hooks/use-account";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle, MapPin, Clock, Phone, Send, ChevronLeft,
  Filter, RefreshCw, Shield, Car, Activity, Search,
  ExternalLink, Copy, CheckCircle2, Satellite, Zap, Eye,
  Users, TrendingUp, Info, Bell, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SentinelIncident } from "@shared/schema";

// ── Utility helpers ────────────────────────────────────────────────────────────

function parseRaw(raw: unknown): Record<string, any> {
  if (raw && typeof raw === "object") return raw as Record<string, any>;
  try { return JSON.parse(raw as string); } catch (_e) { return {}; }
}

function timeAgo(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtTime(d: string) {
  return new Date(d).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  });
}

function copyText(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

// ── Severity config ────────────────────────────────────────────────────────────

const SEV: Record<string, { bg: string; text: string; border: string; dot: string; label: string }> = {
  critical: { bg: "bg-red-500/15",    text: "text-red-400",    border: "border-red-500/30",    dot: "bg-red-400",    label: "CRITICAL"   },
  high:     { bg: "bg-orange-500/15", text: "text-orange-400", border: "border-orange-500/30", dot: "bg-orange-400", label: "HIGH VALUE" },
  medium:   { bg: "bg-amber-500/15",  text: "text-amber-400",  border: "border-amber-500/30",  dot: "bg-amber-400",  label: "MEDIUM"     },
  low:      { bg: "bg-slate-500/10",  text: "text-slate-500",  border: "border-slate-600/30",  dot: "bg-slate-600",  label: "LOW"        },
};

// ── Lead score ────────────────────────────────────────────────────────────────

function LeadScoreBadge({ score }: { score: number }) {
  const config =
    score >= 90 ? { label: "🔥 Elite",     cls: "bg-red-500/20 text-red-300 border-red-500/30" } :
    score >= 75 ? { label: "⚡ Priority",   cls: "bg-orange-500/20 text-orange-300 border-orange-500/30" } :
    score >= 50 ? { label: "✓ Qualified",   cls: "bg-amber-500/20 text-amber-300 border-amber-500/30" } :
                  { label: "○ Standard",    cls: "bg-slate-500/10 text-slate-500 border-slate-600/30" };
  return (
    <span className={`text-[9px] font-black px-2 py-0.5 rounded border ${config.cls}`}>
      {config.label} {score > 0 && <span className="opacity-60">({score})</span>}
    </span>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-[#0a0a0a] border border-white/8 rounded-xl p-4">
      <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">{label}</p>
      <p className={`text-2xl font-black ${color || "text-white"}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-600 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Lead list card ────────────────────────────────────────────────────────────

function LeadListCard({
  incident, index, onClick, smsPending, onSms,
}: {
  incident: SentinelIncident;
  index: number;
  onClick: () => void;
  smsPending: boolean;
  onSms: (e: React.MouseEvent) => void;
}) {
  const sev = SEV[incident.severity || "medium"] || SEV.medium;
  const raw = parseRaw(incident.rawPayload);
  const score = raw.leadScore || raw.priorityScore || 0;
  const isUrgent = raw.operatorPriority === "urgent";
  const hasPhone = !!raw.skipTrace?.ownerPhone || !!raw.ownerPhone;
  const contactName = raw.skipTrace?.ownerName || raw.ownerName;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.02 }}
      onClick={onClick}
      className={`relative flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all hover:bg-white/[0.03] ${sev.border} ${isUrgent ? "ring-1 ring-red-500/20" : ""}`}
      style={{ background: "rgba(8,8,8,0.9)" }}
    >
      {/* Severity dot */}
      <div className="flex-shrink-0 mt-1">
        <div className={`w-2.5 h-2.5 rounded-full ${sev.dot} ${isUrgent ? "animate-pulse" : ""}`} />
      </div>

      <div className="flex-1 min-w-0">
        {/* Top row */}
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${sev.bg} ${sev.text}`}>
            {sev.label}
          </span>
          {isUrgent && (
            <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-red-500/25 text-red-300 border border-red-500/30 animate-pulse">
              IN TERRITORY
            </span>
          )}
          {hasPhone && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
              📞 CONTACT FOUND
            </span>
          )}
          {score > 0 && <LeadScoreBadge score={score} />}
          {incident.smsSent && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">
              SMS SENT
            </span>
          )}
        </div>

        {/* Title */}
        <p className="text-white font-bold text-sm mb-0.5 truncate">{incident.title}</p>

        {/* Location */}
        <p className="text-slate-500 text-xs flex items-center gap-1 mb-1">
          <MapPin size={9} /> {incident.location || "Location pending"}
          {raw.county && <span className="text-slate-600">· {raw.county} Co.</span>}
          {raw.distanceMiles != null && (
            <span className="text-slate-600">· {Number(raw.distanceMiles).toFixed(1)} mi</span>
          )}
        </p>

        {/* Contact name if found */}
        {contactName && (
          <p className="text-emerald-400 text-xs font-semibold flex items-center gap-1">
            <Users size={9} /> {contactName}
          </p>
        )}
      </div>

      {/* Right side */}
      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
        <span className="text-[10px] text-slate-600 flex items-center gap-1">
          <Clock size={9} /> {timeAgo(incident.detectedAt as unknown as string)}
        </span>
        {/* Quick SMS button */}
        {!incident.smsSent && (
          <button
            onClick={onSms}
            disabled={smsPending}
            className="text-[9px] font-bold px-2 py-1 rounded bg-blue-600/80 hover:bg-blue-500 text-white transition-all flex items-center gap-1"
          >
            <Send size={8} /> Alert
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ── Lead detail view ──────────────────────────────────────────────────────────

function LeadDetail({
  incident, onBack, onSms, onAck, smsPending,
}: {
  incident: SentinelIncident;
  onBack: () => void;
  onSms: () => void;
  onAck: () => void;
  smsPending: boolean;
}) {
  const { toast } = useToast();
  const sev = SEV[incident.severity || "medium"] || SEV.medium;
  const raw = parseRaw(incident.rawPayload);
  const lat = raw.lat || incident.lat;
  const lng = raw.lng || incident.lng;
  const mapsUrl = raw.googleMaps || (lat && lng ? `https://www.google.com/maps?q=${lat},${lng}` : null);
  const score = raw.leadScore || raw.priorityScore || 0;
  const skipTrace = raw.skipTrace || {};
  const vehicles: any[] = raw.vehicles || raw.Vehicles || [];
  const passengers: any[] = raw.passengers || raw.Passengers || [];

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
      {/* Back */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm mb-5 transition-colors"
      >
        <ChevronLeft size={14} /> Back to Leads
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-[9px] font-black px-2.5 py-1 rounded-full border ${sev.bg} ${sev.text} ${sev.border}`}>
              {sev.label}
            </span>
            {raw.operatorPriority === "urgent" && (
              <span className="text-[9px] font-black px-2.5 py-1 rounded-full bg-red-500/25 text-red-300 border border-red-500/30 animate-pulse">
                IN TERRITORY
              </span>
            )}
            {score > 0 && <LeadScoreBadge score={score} />}
          </div>
          <h2 className="text-2xl font-black text-white mb-1">{incident.title}</h2>
          <p className="text-slate-500 text-sm">
            Detected {fmtTime(incident.detectedAt as unknown as string)} · {timeAgo(incident.detectedAt as unknown as string)}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap">
          {!incident.smsSent ? (
            <Button
              onClick={onSms}
              disabled={smsPending}
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold gap-2"
            >
              <Send size={14} /> {smsPending ? "Sending..." : "Send SMS Alert"}
            </Button>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm font-bold">
              <CheckCircle2 size={14} /> SMS Sent
            </div>
          )}
          {incident.actionStatus === "pending" && (
            <Button
              onClick={onAck}
              variant="outline"
              className="border-white/10 text-slate-300 hover:text-white gap-2"
            >
              <Eye size={14} /> Acknowledge
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Location & Details */}
        <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-5">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            <MapPin size={12} className="text-red-400" /> Location & Details
          </h3>
          <div className="space-y-3">
            {[
              { label: "Location", value: incident.location },
              { label: "County", value: raw.county },
              { label: "State", value: raw.state || "FL" },
              { label: "Type", value: raw.type || incident.title },
              { label: "Source", value: raw.source || "FHP HSMV" },
              { label: "Received", value: raw.received },
              { label: "Distance from HQ", value: raw.distanceMiles != null ? `${Number(raw.distanceMiles).toFixed(1)} mi` : null },
              { label: "Remarks", value: raw.remarks },
            ].filter(f => f.value).map(({ label, value }) => (
              <div key={label} className="flex justify-between gap-2">
                <span className="text-slate-500 text-xs">{label}</span>
                <span className="text-white text-xs font-medium text-right max-w-[60%] break-words">{value}</span>
              </div>
            ))}
            {lat && lng && (
              <div className="flex justify-between gap-2">
                <span className="text-slate-500 text-xs">Coordinates</span>
                <button
                  onClick={() => { copyText(`${lat},${lng}`); toast({ title: "Copied" }); }}
                  className="text-blue-400 text-xs font-mono flex items-center gap-1 hover:text-blue-300"
                >
                  {Number(lat).toFixed(4)}, {Number(lng).toFixed(4)} <Copy size={9} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Map */}
        <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-5">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            <MapPin size={12} className="text-cyan-400" /> Map
          </h3>
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-center mb-3">
            <MapPin size={32} className="mx-auto text-red-400 mb-2" />
            <p className="text-white font-bold text-sm">{incident.location}</p>
            {lat && lng && (
              <p className="text-slate-500 text-xs mt-1">{Number(lat).toFixed(4)}, {Number(lng).toFixed(4)}</p>
            )}
          </div>
          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm font-bold hover:bg-blue-500/20 transition-all"
            >
              <ExternalLink size={13} /> Open in Google Maps
            </a>
          )}
        </div>
      </div>

      {/* Skip Trace / Contact Info */}
      {(skipTrace.ownerName || skipTrace.ownerPhone || skipTrace.ownerEmail) && (
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-5 mb-4">
          <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Users size={12} /> Contact Found — Skip Trace
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {skipTrace.ownerName && (
              <div>
                <p className="text-slate-500 text-xs mb-1">Name</p>
                <p className="text-white font-bold">{skipTrace.ownerName}</p>
              </div>
            )}
            {skipTrace.ownerPhone && (
              <div>
                <p className="text-slate-500 text-xs mb-1">Phone</p>
                <button
                  onClick={() => { copyText(skipTrace.ownerPhone); toast({ title: "Phone copied" }); }}
                  className="text-emerald-300 font-bold text-lg flex items-center gap-1.5 hover:text-emerald-200"
                >
                  {skipTrace.ownerPhone} <Copy size={12} />
                </button>
              </div>
            )}
            {skipTrace.ownerEmail && (
              <div>
                <p className="text-slate-500 text-xs mb-1">Email</p>
                <p className="text-white font-medium text-sm">{skipTrace.ownerEmail}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Vehicle & Injury Data */}
      {vehicles.length > 0 && (
        <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-5 mb-4">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Car size={12} className="text-amber-400" /> Vehicles Involved ({vehicles.length})
          </h3>
          <div className="space-y-3">
            {vehicles.map((v: any, i: number) => (
              <div key={i} className="p-3 rounded-xl bg-white/5 border border-white/5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white font-bold text-sm">
                    Vehicle {v.VehicleNumber || i + 1}: {v.Year} {v.Make} {v.Model}
                  </span>
                  {v.InsuranceCompany && (
                    <span className="text-xs text-slate-400 bg-white/5 px-2 py-0.5 rounded">
                      {v.InsuranceCompany}
                    </span>
                  )}
                </div>
                {v.Driver && (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-slate-500">Driver: </span>
                      <span className="text-white font-medium">{v.Driver.Name || "Unknown"}</span>
                    </div>
                    {v.Driver.InjuryType && (
                      <div>
                        <span className="text-slate-500">Injury: </span>
                        <span className={`font-bold ${
                          v.Driver.InjuryType?.toUpperCase().includes("FATAL") ? "text-red-400" :
                          v.Driver.InjuryType?.toUpperCase().includes("INCAPACIT") ? "text-orange-400" :
                          "text-amber-400"
                        }`}>{v.Driver.InjuryType}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Passengers */}
      {passengers.length > 0 && (
        <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-5 mb-4">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Users size={12} className="text-purple-400" /> Passengers ({passengers.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {passengers.map((p: any, i: number) => (
              <div key={i} className="p-3 rounded-xl bg-white/5 border border-white/5 text-sm">
                <span className="text-white font-medium">{p.Name || "Unknown"}</span>
                {p.InjuryType && (
                  <span className={`ml-2 text-xs font-bold ${
                    p.InjuryType?.toUpperCase().includes("FATAL") ? "text-red-400" :
                    p.InjuryType?.toUpperCase().includes("INCAPACIT") ? "text-orange-400" :
                    "text-amber-300"
                  }`}>{p.InjuryType}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Description */}
      {incident.description && (
        <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-5 mb-4">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
            <Info size={12} /> Description
          </h3>
          <p className="text-slate-300 text-sm leading-relaxed">{incident.description}</p>
        </div>
      )}

      {/* Response status */}
      <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-5">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
          <Activity size={12} /> Response Status
        </h3>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "SMS Alert", active: incident.smsSent, icon: Send },
            { label: "Geofence", active: incident.geofenceDeployed, icon: Shield },
            { label: "Acknowledged", active: incident.actionStatus !== "pending", icon: CheckCircle2 },
          ].map(({ label, active, icon: Icon }) => (
            <div key={label} className={`p-3 rounded-xl border text-center ${active ? "border-emerald-500/30 bg-emerald-500/10" : "border-white/8 bg-white/[0.02]"}`}>
              <Icon size={16} className={`mx-auto mb-1 ${active ? "text-emerald-400" : "text-slate-600"}`} />
              <p className={`text-[10px] font-bold ${active ? "text-emerald-400" : "text-slate-600"}`}>{label}</p>
              <p className={`text-[9px] mt-0.5 ${active ? "text-emerald-300" : "text-slate-700"}`}>{active ? "Done" : "Not Sent"}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AccidentLeadsPage() {
  const { activeAccountId: rawActiveId } = useAccount();
  const { user } = useAuth();
  const isAdmin = (user as any)?.isAdmin === "true" || (user as any)?.role === "DEV_ADMIN";
  const [skipTraceRunning, setSkipTraceRunning] = useState(false);

  const runManualSkipTrace = async () => {
    if (!activeAccountId || skipTraceRunning) return;
    setSkipTraceRunning(true);
    try {
      const res = await apiRequest("POST", `/api/sentinel/retro-skip-trace`, { subAccountId: activeAccountId });
      toast({ title: "Skip trace started", description: "Running in background — refresh in 2 minutes." });
    } catch (e: any) {
      toast({ title: "Skip trace failed", description: e.message, variant: "destructive" });
    } finally {
      setSkipTraceRunning(false);
    }
  };

  // Fetch accounts to resolve fallback if activeAccountId not set
  const { data: accounts = [] } = useQuery<any[]>({
    queryKey: ["/api/accounts"],
    queryFn: async () => {
      const res = await fetch("/api/accounts", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const activeAccountId = rawActiveId ?? accounts[0]?.id ?? null;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<SentinelIncident | null>(null);
  const [search, setSearch] = useState("");
  const [sevFilter, setSevFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [countyFilter, setCountyFilter] = useState<string>("all");

  // Fetch incidents
  const { data: incidentsData, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["/api/sentinel/incidents", activeAccountId],
    queryFn: () => apiRequest("GET", `/api/sentinel/incidents?subAccountId=${activeAccountId}&limit=200`),
    refetchInterval: 60_000,
    enabled: !!activeAccountId,
  });

  // Fetch crash contacts that have phone numbers (from skip trace)
  const { data: crashContacts = [] } = useQuery<any[]>({
    queryKey: ["/api/contacts", activeAccountId, "crash-phone"],
    queryFn: async () => {
      const res = await fetch(
        `/api/contacts/${activeAccountId}?tag=crash-lead&hasPhone=true`,
        { credentials: "include" }
      );
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!activeAccountId,
    refetchInterval: 60_000,
  });

  const incidents: SentinelIncident[] = (
    Array.isArray(incidentsData) ? incidentsData : incidentsData?.incidents || []
  ).filter((i: SentinelIncident) => {
    const raw = parseRaw(i.rawPayload);
    const isHomeSvc = raw.source === "sentinel_home_svc";
    return !isHomeSvc; // accident leads only
  });

  // Keep selected in sync
  const liveSelected = selected ? incidents.find(i => i.id === selected.id) || selected : null;

  // Mutations
  const smsMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/sentinel/incidents/${id}/sms`, { subAccountId: activeAccountId }),
    onSuccess: () => { toast({ title: "SMS alert sent" }); queryClient.invalidateQueries({ queryKey: ["/api/sentinel/incidents"] }); },
    onError: () => toast({ title: "SMS failed", variant: "destructive" }),
  });

  const ackMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/sentinel/incidents/${id}/acknowledge`, { subAccountId: activeAccountId }),
    onSuccess: () => { toast({ title: "Acknowledged" }); queryClient.invalidateQueries({ queryKey: ["/api/sentinel/incidents"] }); },
    onError: () => toast({ title: "Failed", variant: "destructive" }),
  });

  // Derived data
  const counties = Array.from(new Set(incidents.map(i => parseRaw(i.rawPayload).county).filter(Boolean))).sort();

  const filtered = incidents.filter(i => {
    const raw = parseRaw(i.rawPayload);
    if (sevFilter !== "all" && i.severity !== sevFilter) return false;
    if (statusFilter === "pending" && i.actionStatus !== "pending") return false;
    if (statusFilter === "actioned" && i.actionStatus === "pending") return false;
    if (countyFilter !== "all" && raw.county !== countyFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!(i.title + i.location + (raw.county || "")).toLowerCase().includes(q)) return false;
    }
    return true;
  }).sort((a, b) => {
    const scoreA = parseRaw(a.rawPayload).leadScore || parseRaw(a.rawPayload).priorityScore || 0;
    const scoreB = parseRaw(b.rawPayload).leadScore || parseRaw(b.rawPayload).priorityScore || 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return new Date(b.detectedAt as unknown as string).getTime() - new Date(a.detectedAt as unknown as string).getTime();
  });

  const stats = {
    total: incidents.length,
    highValue: incidents.filter(i => i.severity === "critical" || i.severity === "high").length,
    pending: incidents.filter(i => i.actionStatus === "pending").length,
    withContact: incidents.filter(i => {
      const r = parseRaw(i.rawPayload);
      return r.skipTrace?.ownerPhone || r.ownerPhone;
    }).length,
    inTerritory: incidents.filter(i => parseRaw(i.rawPayload).operatorPriority === "urgent").length,
  };

  // Detail view
  if (liveSelected) {
    return (
      <div className="p-6 md:p-10 max-w-4xl mx-auto">
        <LeadDetail
          incident={liveSelected}
          onBack={() => setSelected(null)}
          onSms={() => smsMutation.mutate(liveSelected.id)}
          onAck={() => { ackMutation.mutate(liveSelected.id); setSelected(null); }}
          smsPending={smsMutation.isPending}
        />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-600 to-orange-500 flex items-center justify-center">
            <Satellite size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Accident Lead Generator</h1>
            <p className="text-slate-500 text-xs flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Live · FHP HSMV Blotter · Updated {dataUpdatedAt ? timeAgo(new Date(dataUpdatedAt).toISOString()) : "never"}
            </p>
          </div>
        </div>
        <Button
          onClick={() => refetch()}
          variant="outline"
          className="border-white/10 text-slate-300 hover:text-white gap-2 text-xs"
        >
          <RefreshCw size={13} /> Refresh
        </Button>
      </div>

      {/* Contacts with phone numbers — the sellable leads */}
      {crashContacts.length > 0 && (() => {
        const contactLeads = crashContacts;
        const exportCSV = () => {
          const rows = [
            ["Name","Phone","Address","County","Date"].join(","),
            ...crashContacts.map((c: any) => {
              const name = `${c.firstName || ""} ${c.lastName || ""}`.trim();
              return [`"${name}"`,`"${c.phone || ""}"`,`"${c.address || ""}"`,`"${c.city || ""}"`,`"${new Date(c.createdAt).toLocaleDateString()}"`].join(",");
            })
          ];
          const b = new Blob([rows.join(String.fromCharCode(10))], {type:"text/csv"});
          const a = document.createElement("a");
          a.href = URL.createObjectURL(b);
          a.download = `crash-leads-${new Date().toISOString().slice(0,10)}.csv`;
          a.click();
        };
        return (
          <div className="mb-6 rounded-2xl border border-green-500/30 bg-green-500/5 p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-green-400 font-black text-lg">{crashContacts.length} LEADS WITH PHONE NUMBERS</div>
                <div className="text-slate-400 text-xs mt-0.5">Real names + numbers from skip trace — ready to sell</div>
              </div>
              <div className="flex gap-2">
                {isAdmin && (
                  <button
                    onClick={runManualSkipTrace}
                    disabled={skipTraceRunning}
                    className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-black text-sm transition-all flex items-center gap-1"
                  >
                    {skipTraceRunning ? "⏳ Running..." : "🔍 Skip Trace"}
                  </button>
                )}
                <button onClick={exportCSV} className="px-4 py-2 rounded-xl bg-green-500 hover:bg-green-400 text-black font-black text-sm transition-all">
                  ⬇ Export CSV
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {crashContacts.slice(0,10).map((c: any) => (
                <div key={c.id} className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-2.5">
                  <div>
                    <span className="text-white font-bold text-sm">{c.firstName} {c.lastName}</span>
                    <span className="text-slate-500 text-xs ml-2">{c.city} · {new Date(c.createdAt).toLocaleDateString()}</span>
                  </div>
                  <a href={`tel:${c.phone}`} className="text-green-400 font-mono font-bold text-sm hover:text-green-300">{c.phone}</a>
                </div>
              ))}
              {crashContacts.length > 10 && <div className="text-slate-500 text-xs text-center pt-1">+{crashContacts.length - 10} more — export CSV to see all</div>}
            </div>
          </div>
        );
      })()}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <StatCard label="Total Incidents" value={stats.total} sub="This session" />
        <StatCard label="High Value" value={stats.highValue} sub="Critical + High" color="text-orange-400" />
        <StatCard label="In Territory" value={stats.inTerritory} sub="Urgent priority" color="text-red-400" />
        <StatCard label="Contact Found" value={stats.withContact} sub="Skip traced" color="text-emerald-400" />
        <StatCard label="Pending Action" value={stats.pending} sub="Need response" color="text-amber-400" />
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search location, county..."
            className="pl-8 h-8 text-xs bg-white/5 border-white/10 text-white placeholder:text-slate-600"
          />
        </div>

        {/* Severity */}
        {["all", "critical", "high", "medium", "low"].map(s => (
          <button
            key={s}
            onClick={() => setSevFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
              sevFilter === s
                ? "bg-white/10 text-white border-white/20"
                : "text-slate-500 border-white/8 hover:text-slate-300"
            }`}
          >
            {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}

        {/* Status */}
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/5 border border-white/10 text-slate-400 focus:outline-none"
        >
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="actioned">Actioned</option>
        </select>

        {/* County */}
        {counties.length > 0 && (
          <select
            value={countyFilter}
            onChange={e => setCountyFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/5 border border-white/10 text-slate-400 focus:outline-none"
          >
            <option value="all">All Counties</option>
            {counties.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {/* Count */}
      <p className="text-xs text-slate-600 mb-3">
        {filtered.length} leads · sorted by lead score + recency
      </p>

      {/* Lead list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw size={16} className="animate-spin text-slate-500 mr-2" />
          <span className="text-slate-500 text-sm">Loading accident leads...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Satellite size={40} className="text-slate-700 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">No leads found</p>
          <p className="text-slate-600 text-xs mt-1">Sentinel polls FHP HSMV every 5 minutes</p>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {filtered.map((incident, i) => (
              <LeadListCard
                key={incident.id}
                incident={incident}
                index={i}
                onClick={() => setSelected(incident)}
                smsPending={smsMutation.isPending && smsMutation.variables === incident.id}
                onSms={(e) => { e.stopPropagation(); smsMutation.mutate(incident.id); }}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
