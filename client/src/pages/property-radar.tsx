import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAccount } from "@/hooks/use-account";
import { useToast } from "@/hooks/use-toast";
import {
  Building, MapPin, Phone, DollarSign, AlertTriangle, CheckCircle2,
  Settings, Play, Home, TrendingUp, Send, Target, Eye, Search, Filter,
  ArrowRight, User, Mail, Hash, Layers, Zap, BarChart3, BookOpen, Map,
  UserSearch, Save, Users, Loader2, CheckSquare, Square
} from "lucide-react";
import { TutorialOverlay, useTutorial } from "@/components/tutorial-overlay";
import { PROPERTY_RADAR_STEPS } from "@/components/tutorial-steps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import type { SubAccount, PropertyLead, WholesalerConfig, SkipTraceResult } from "@shared/schema";
import { AddressAutocomplete } from "@/components/address-autocomplete";

const PRIORITY_COLORS: Record<string, { bg: string; text: string; border: string; label: string; glow: string }> = {
  critical: { bg: "bg-red-500/20", text: "text-red-400", border: "border-red-500/30", label: "HOT LEAD", glow: "shadow-red-500/20" },
  high: { bg: "bg-orange-500/20", text: "text-orange-400", border: "border-orange-500/30", label: "HIGH VALUE", glow: "shadow-orange-500/20" },
  medium: { bg: "bg-amber-500/20", text: "text-amber-400", border: "border-amber-500/30", label: "WARM", glow: "shadow-amber-500/20" },
  low: { bg: "bg-slate-500/20", text: "text-slate-400", border: "border-slate-500/30", label: "MONITOR", glow: "shadow-slate-500/20" },
};

const PIPELINE_STAGES = [
  { key: "new", label: "New Leads", color: "text-blue-400", bg: "bg-blue-500/10" },
  { key: "contacted", label: "Contacted", color: "text-purple-400", bg: "bg-purple-500/10" },
  { key: "offer_sent", label: "Offer Sent", color: "text-amber-400", bg: "bg-amber-500/10" },
  { key: "under_contract", label: "Under Contract", color: "text-green-400", bg: "bg-green-500/10" },
  { key: "closed", label: "Closed", color: "text-emerald-400", bg: "bg-emerald-500/10" },
];

const DISTRESS_SIGNALS: Record<string, { icon: string; color: string }> = {
  "Pre-Foreclosure": { icon: "🏚️", color: "text-red-400" },
  "Tax Lien": { icon: "💰", color: "text-red-400" },
  "Vacant": { icon: "🏗️", color: "text-orange-400" },
  "Code Violation": { icon: "⚠️", color: "text-orange-400" },
  "Probate": { icon: "📜", color: "text-purple-400" },
  "Divorce Filing": { icon: "💔", color: "text-pink-400" },
  "Expired Listing": { icon: "📋", color: "text-amber-400" },
  "Absentee Owner": { icon: "👻", color: "text-slate-400" },
  "Estate Sale": { icon: "🏠", color: "text-purple-400" },
  "Deferred Maintenance": { icon: "🔧", color: "text-amber-400" },
  "High Equity": { icon: "📈", color: "text-green-400" },
  "Price Reduced 3x": { icon: "📉", color: "text-red-400" },
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);
}

function timeAgo(dateStr: string | Date) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

type LeadWithMetrics = PropertyLead & {
  dealMetrics?: { arv: number; maxOffer: number; assignmentFee: number; potentialProfit: number; equityPercentage: number };
};

const MARKER_COLORS: Record<string, string> = {
  critical: "#EF4444",
  high: "#F97316",
  medium: "#F59E0B",
  low: "#94A3B8",
};

const FORT_MYERS_CENTER = { lat: 26.6406, lng: -81.8723 };

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

let mapsApiPromise: Promise<void> | null = null;

function loadGoogleMapsApi(): Promise<void> {
  if ((window as any).google?.maps) return Promise.resolve();
  if (mapsApiPromise) return mapsApiPromise;
  mapsApiPromise = new Promise((resolve, reject) => {
    fetch("/api/config/maps-key", { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        if (!data.apiKey) { reject(new Error("No Maps API key")); return; }
        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${data.apiKey}`;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load Google Maps"));
        document.head.appendChild(script);
      })
      .catch(reject);
  });
  return mapsApiPromise;
}

function PropertyMapView({ leads, onSelectLead }: { leads: LeadWithMetrics[]; onSelectLead: (lead: LeadWithMetrics) => void }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    loadGoogleMapsApi()
      .then(() => setMapReady(true))
      .catch(err => setMapError(err.message));
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current || mapInstanceRef.current) return;
    mapInstanceRef.current = new google.maps.Map(mapRef.current, {
      center: FORT_MYERS_CENTER,
      zoom: 11,
      styles: [
        { elementType: "geometry", stylers: [{ color: "#1e293b" }] },
        { elementType: "labels.text.stroke", stylers: [{ color: "#0f172a" }] },
        { elementType: "labels.text.fill", stylers: [{ color: "#64748b" }] },
        { featureType: "road", elementType: "geometry", stylers: [{ color: "#334155" }] },
        { featureType: "water", elementType: "geometry", stylers: [{ color: "#0c4a6e" }] },
        { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
      ],
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
    });
    infoWindowRef.current = new google.maps.InfoWindow();
  }, [mapReady]);

  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    const infoWindow = infoWindowRef.current!;

    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    const geoLeads = leads.filter(l => l.lat != null && l.lng != null);

    if (geoLeads.length === 0) {
      map.setCenter(FORT_MYERS_CENTER);
      map.setZoom(11);
      return;
    }

    const bounds = new google.maps.LatLngBounds();

    geoLeads.forEach(lead => {
      const color = MARKER_COLORS[lead.priority || "medium"] || MARKER_COLORS.medium;
      const marker = new google.maps.Marker({
        position: { lat: lead.lat!, lng: lead.lng! },
        map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: color,
          fillOpacity: 0.9,
          strokeColor: "#ffffff",
          strokeWeight: 2,
          scale: 10,
        },
        title: lead.address,
      });

      marker.addListener("mouseover", () => {
        infoWindow.setContent(
          `<div style="color:#1e293b;font-family:sans-serif;padding:4px 0;">
            <div style="font-weight:600;font-size:13px;">${escapeHtml(lead.address)}</div>
            <div style="font-size:12px;color:#64748b;">${escapeHtml(lead.city || "")}, ${escapeHtml(lead.state || "")} ${escapeHtml(lead.zip || "")}</div>
            <div style="font-size:13px;font-weight:600;color:#059669;margin-top:4px;">${escapeHtml(formatCurrency(lead.estimatedValue || 0))}</div>
          </div>`
        );
        infoWindow.open(map, marker);
      });

      marker.addListener("mouseout", () => {
        infoWindow.close();
      });

      marker.addListener("click", () => {
        infoWindow.close();
        onSelectLead(lead);
      });

      markersRef.current.push(marker);
      bounds.extend({ lat: lead.lat!, lng: lead.lng! });
    });

    map.fitBounds(bounds);
    if (geoLeads.length === 1) {
      map.setZoom(14);
    }

    return () => {
      markersRef.current.forEach(m => {
        google.maps.event.clearInstanceListeners(m);
        m.setMap(null);
      });
      markersRef.current = [];
    };
  }, [leads, mapReady]);

  if (mapError) {
    return (
      <div className="bg-slate-800/30 rounded-2xl border border-dashed border-slate-700/50 p-12 text-center" data-testid="map-error">
        <MapPin className="w-12 h-12 text-slate-600 mx-auto mb-3" />
        <p className="text-slate-400">Unable to load map: {mapError}</p>
        <p className="text-sm text-slate-500 mt-1">Ensure the Google Maps API key is configured.</p>
      </div>
    );
  }

  if (!mapReady) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="map-loading">
        <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full" />
        <p className="text-slate-400 ml-3">Loading map...</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div ref={mapRef} className="w-full rounded-xl overflow-hidden border border-slate-700/50" style={{ height: "600px" }} data-testid="map-container" />
      <div className="absolute bottom-4 left-4 bg-slate-900/90 backdrop-blur-sm rounded-lg border border-slate-700/50 p-3 flex items-center gap-4" data-testid="map-legend">
        {Object.entries(MARKER_COLORS).map(([priority, color]) => (
          <div key={priority} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full border border-white/50" style={{ backgroundColor: color }} />
            <span className="text-xs text-slate-300 capitalize">{priority === "critical" ? "Hot" : priority}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PropertyRadar() {
  const { showTutorial, startTutorial, closeTutorial } = useTutorial("apex_tutorial_property_radar");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { activeAccountId } = useAccount();
  const [showConfig, setShowConfig] = useState(false);
  const [scanPulse, setScanPulse] = useState(false);
  const [viewMode, setViewMode] = useState<"feed" | "pipeline" | "map">("feed");
  const [selectedLead, setSelectedLead] = useState<LeadWithMetrics | null>(null);
  const [dataSource, setDataSource] = useState<string>("");
  const [skipTraceResult, setSkipTraceResult] = useState<SkipTraceResult | null>(null);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<number>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const [configForm, setConfigForm] = useState({
    targetZips: "",
    targetCities: "",
    distressFilters: "",
    minEquity: 30000,
    autoSms: false,
    autoCall: false,
    autoAds: false,
    smsTemplate: "",
    enabled: true,
  });

  const { data: accounts = [] } = useQuery<SubAccount[]>({ queryKey: ["/api/accounts"] });
  const currentAccount = accounts.find(a => a.id === activeAccountId) || accounts[0];

  const { data: config } = useQuery<WholesalerConfig>({
    queryKey: ["/api/property-radar/config", currentAccount?.id],
    enabled: !!currentAccount?.id,
    queryFn: async () => {
      const res = await fetch(`/api/property-radar/config/${currentAccount!.id}`, { credentials: "include" });
      return res.json();
    },
  });

  const { data: apiStatus } = useQuery<{ hasRentcastKey: boolean; hasTwilioSid: boolean; hasTwilioToken: boolean }>({
    queryKey: ["/api/property-radar/status"],
    queryFn: async () => {
      const res = await fetch("/api/property-radar/status", { credentials: "include" });
      return res.json();
    },
  });

  const { data: leads = [], isLoading: loadingLeads } = useQuery<LeadWithMetrics[]>({
    queryKey: ["/api/property-radar/leads", currentAccount?.id],
    enabled: !!currentAccount?.id,
    queryFn: async () => {
      const res = await fetch(`/api/property-radar/leads/${currentAccount!.id}`, { credentials: "include" });
      return res.json();
    },
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (config) {
      setConfigForm({
        targetZips: (config.targetZips || []).join(", "),
        targetCities: (config.targetCities || []).join(", "),
        distressFilters: (config.distressFilters || []).join(", "),
        minEquity: config.minEquity || 30000,
        autoSms: config.autoSms || false,
        autoCall: config.autoCall || false,
        autoAds: config.autoAds || false,
        smsTemplate: config.smsTemplate || "",
        enabled: config.enabled !== false,
      });
    }
  }, [config]);

  const scanMutation = useMutation({
    mutationFn: async () => {
      setScanPulse(true);
      const res = await apiRequest("POST", "/api/property-radar/scan", { subAccountId: currentAccount!.id });
      return res.json();
    },
    onSuccess: (data) => {
      setScanPulse(false);
      setDataSource(data.source || "");
      queryClient.invalidateQueries({ queryKey: ["/api/property-radar/leads"] });
      toast({
        title: `${data.found} Distressed Properties Found`,
        description: data.found > 0 ? `Live data from ${data.source}` : "No properties found — check your zip codes and filters",
      });
    },
    onError: () => {
      setScanPulse(false);
      setDataSource("error");
      toast({ title: "Scan failed", description: "Could not reach property data feeds", variant: "destructive" });
    },
  });

  const smsMutation = useMutation({
    mutationFn: async (leadId: number) => {
      const res = await apiRequest("POST", `/api/property-radar/leads/${leadId}/sms`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/property-radar/leads"] });
      toast({ title: "SMS Sent", description: data.message });
    },
  });

  const adsMutation = useMutation({
    mutationFn: async (leadId: number) => {
      const res = await apiRequest("POST", `/api/property-radar/leads/${leadId}/deploy-ads`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/property-radar/leads"] });
      toast({ title: "Ads Deployed", description: data.message });
    },
  });

  const { data: skipTraceUsage } = useQuery<{ monthYear: string; lookupCount: number }>({
    queryKey: ["/api/skip-trace/usage", currentAccount?.id],
    enabled: !!currentAccount?.id,
    queryFn: async () => {
      const res = await fetch(`/api/skip-trace/usage/${currentAccount!.id}`, { credentials: "include" });
      return res.json();
    },
  });

  const skipTraceMutation = useMutation({
    mutationFn: async (propertyLeadId: number) => {
      const res = await apiRequest("POST", "/api/skip-trace/lookup", { subAccountId: currentAccount!.id, propertyLeadId });
      return res.json();
    },
    onSuccess: (data) => {
      setSkipTraceResult(data.result);
      queryClient.invalidateQueries({ queryKey: ["/api/property-radar/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/skip-trace/usage"] });
      toast({
        title: data.cached ? "Skip Trace (Cached)" : "Skip Trace Complete",
        description: data.result.ownerPhone ? `Found: ${data.result.ownerName || "Owner"} — ${data.result.ownerPhone}` : "Lookup complete — limited data found",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Skip Trace Failed", description: err.message, variant: "destructive" });
    },
  });

  const bulkSkipTraceMutation = useMutation({
    mutationFn: async (propertyLeadIds: number[]) => {
      const res = await apiRequest("POST", "/api/skip-trace/bulk", { subAccountId: currentAccount!.id, propertyLeadIds });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/property-radar/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/skip-trace/usage"] });
      setSelectedLeadIds(new Set());
      setBulkMode(false);
      toast({
        title: "Bulk Skip Trace Complete",
        description: `${data.completed} lookups completed, ${data.failed} failed`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Bulk Skip Trace Failed", description: err.message, variant: "destructive" });
    },
  });

  const saveAsContactMutation = useMutation({
    mutationFn: async (skipTraceResultId: number) => {
      const res = await apiRequest("POST", "/api/skip-trace/save-contact", { subAccountId: currentAccount!.id, skipTraceResultId });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({
        title: data.alreadySaved ? "Already Saved" : "Contact Created",
        description: `${data.contact.firstName} ${data.contact.lastName || ""} saved to CRM`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Save Failed", description: err.message, variant: "destructive" });
    },
  });

  const toggleLeadSelection = (id: number) => {
    setSelectedLeadIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllLeads = () => {
    if (selectedLeadIds.size === leads.length) {
      setSelectedLeadIds(new Set());
    } else {
      setSelectedLeadIds(new Set(leads.map(l => l.id)));
    }
  };

  const updateLeadAddressMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number; address: string; city: string; state: string; zip: string }) => {
      const res = await apiRequest("PATCH", `/api/property-radar/leads/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/property-radar/leads"] });
      toast({ title: "Address Updated" });
    },
  });

  const updateStageMutation = useMutation({
    mutationFn: async ({ id, stage }: { id: number; stage: string }) => {
      const res = await apiRequest("PATCH", `/api/property-radar/leads/${id}`, { pipelineStage: stage });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/property-radar/leads"] });
      toast({ title: "Pipeline Updated" });
    },
  });

  const saveConfigMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/property-radar/config/${currentAccount!.id}`, {
        subAccountId: currentAccount!.id,
        targetZips: configForm.targetZips.split(",").map(s => s.trim()).filter(Boolean),
        targetCities: configForm.targetCities.split(",").map(s => s.trim()).filter(Boolean),
        distressFilters: configForm.distressFilters.split(",").map(s => s.trim()).filter(Boolean),
        minEquity: configForm.minEquity,
        autoSms: configForm.autoSms,
        autoCall: configForm.autoCall,
        autoAds: configForm.autoAds,
        smsTemplate: configForm.smsTemplate,
        enabled: configForm.enabled,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/property-radar/config"] });
      setShowConfig(false);
      toast({ title: "Config Saved" });
    },
  });

  const criticalCount = leads.filter(l => l.priority === "critical").length;
  const highCount = leads.filter(l => l.priority === "high").length;
  const totalEquity = leads.reduce((sum, l) => sum + (l.estimatedEquity || 0), 0);
  const totalPotentialProfit = leads.reduce((sum, l) => sum + (l.dealMetrics?.potentialProfit || 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className={`w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30 ${scanPulse ? "animate-pulse" : ""}`}>
              <Building className="w-6 h-6 text-emerald-400" />
            </div>
            {scanPulse && (
              <motion.div className="absolute inset-0 rounded-xl border-2 border-emerald-400"
                animate={{ scale: [1, 1.5], opacity: [0.8, 0] }}
                transition={{ duration: 1, repeat: Infinity }}
              />
            )}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight" data-testid="text-page-title">Property Radar</h1>
            <p className="text-sm text-slate-400">Distressed Property Scanner & Deal Pipeline</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={startTutorial} className="text-slate-400 hover:text-white" data-testid="button-start-tutorial">
            <BookOpen size={16} className="mr-1" /> Tutorial
          </Button>
          <div className="flex bg-slate-800/50 rounded-lg border border-slate-700/50 p-1">
            <button
              onClick={() => setViewMode("feed")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${viewMode === "feed" ? "bg-emerald-500/20 text-emerald-400" : "text-slate-400 hover:text-white"}`}
              data-testid="button-view-feed"
            >
              Live Feed
            </button>
            <button
              onClick={() => setViewMode("pipeline")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${viewMode === "pipeline" ? "bg-emerald-500/20 text-emerald-400" : "text-slate-400 hover:text-white"}`}
              data-testid="button-view-pipeline"
            >
              Pipeline
            </button>
            <button
              onClick={() => setViewMode("map")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition flex items-center gap-1 ${viewMode === "map" ? "bg-emerald-500/20 text-emerald-400" : "text-slate-400 hover:text-white"}`}
              data-testid="button-view-map"
            >
              <Map className="w-3.5 h-3.5" /> Map
            </button>
          </div>
          {skipTraceUsage && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-500/10 border border-violet-500/20 rounded-lg" data-testid="text-skip-trace-usage">
              <UserSearch className="w-3.5 h-3.5 text-violet-400" />
              <span className="text-xs text-violet-300 font-medium">{skipTraceUsage.lookupCount} lookups this month</span>
            </div>
          )}
          {viewMode === "feed" && leads.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setBulkMode(!bulkMode); setSelectedLeadIds(new Set()); }}
              className={`border-slate-700 ${bulkMode ? "text-violet-400 border-violet-500/30" : "text-slate-300"}`}
              data-testid="button-bulk-mode"
            >
              <Users className="w-4 h-4 mr-1" /> {bulkMode ? "Cancel Bulk" : "Bulk Select"}
            </Button>
          )}
          {bulkMode && selectedLeadIds.size > 0 && (
            <Button
              onClick={() => bulkSkipTraceMutation.mutate(Array.from(selectedLeadIds))}
              disabled={bulkSkipTraceMutation.isPending}
              className="bg-violet-600 hover:bg-violet-500 text-white"
              data-testid="button-bulk-skip-trace"
            >
              <UserSearch className="w-4 h-4 mr-1" />
              {bulkSkipTraceMutation.isPending ? "Looking up..." : `Skip Trace ${selectedLeadIds.size} Leads`}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowConfig(true)} className="border-slate-700 text-slate-300" data-testid="button-config">
            <Settings className="w-4 h-4 mr-1" /> Config
          </Button>
          <Button
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending || !currentAccount}
            className="bg-emerald-600 hover:bg-emerald-500 text-white"
            data-testid="button-scan"
          >
            <Search className="w-4 h-4 mr-1" />
            {scanMutation.isPending ? "Scanning..." : "Scan Properties"}
          </Button>
        </div>
      </div>

      {/* Configuration Status Banner */}
      {apiStatus && !apiStatus.hasRentcastKey && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 space-y-2"
          data-testid="banner-property-config"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <div className="flex-1">
              <span className="text-sm text-amber-300 font-medium">Property Data Not Connected</span>
              <span className="text-sm text-amber-400/70 ml-2">Connect your RentCast API key to pull live property listings and distress data.</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 ml-7">
            <span className={`text-xs px-2 py-0.5 rounded border ${apiStatus.hasRentcastKey ? "border-green-500/40 text-green-400" : "border-red-500/40 text-red-400"}`}>
              {apiStatus.hasRentcastKey ? "✓" : "✗"} RENTCAST_API_KEY
            </span>
            <span className={`text-xs px-2 py-0.5 rounded border ${apiStatus.hasTwilioSid ? "border-green-500/40 text-green-400" : "border-slate-600 text-slate-400"}`}>
              {apiStatus.hasTwilioSid ? "✓" : "○"} Twilio SMS (optional)
            </span>
          </div>
        </motion.div>
      )}

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-slate-800/40 rounded-xl border border-slate-700/50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider">Total Leads</p>
              <p className="text-2xl font-bold text-white mt-1" data-testid="text-total-leads">{leads.length}</p>
            </div>
            <Home className="w-8 h-8 text-emerald-500/40" />
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-slate-800/40 rounded-xl border border-red-500/20 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider">Hot Leads</p>
              <p className="text-2xl font-bold text-red-400 mt-1" data-testid="text-hot-leads">{criticalCount}</p>
            </div>
            <Zap className="w-8 h-8 text-red-500/40" />
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-slate-800/40 rounded-xl border border-emerald-500/20 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider">Total Equity</p>
              <p className="text-2xl font-bold text-emerald-400 mt-1" data-testid="text-total-equity">{formatCurrency(totalEquity)}</p>
            </div>
            <DollarSign className="w-8 h-8 text-emerald-500/40" />
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-slate-800/40 rounded-xl border border-purple-500/20 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider">Potential Profit</p>
              <p className="text-2xl font-bold text-purple-400 mt-1" data-testid="text-potential-profit">{formatCurrency(totalPotentialProfit)}</p>
            </div>
            <TrendingUp className="w-8 h-8 text-purple-500/40" />
          </div>
        </motion.div>
      </div>

      {/* Main Content */}
      {viewMode === "map" ? (
        <PropertyMapView leads={leads} onSelectLead={setSelectedLead} />
      ) : viewMode === "feed" ? (
        <div className="space-y-4">
          {loadingLeads ? (
            <div className="text-center py-20">
              <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto" />
              <p className="text-slate-400 mt-4">Loading leads...</p>
            </div>
          ) : leads.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-20 bg-slate-800/30 rounded-2xl border border-dashed border-slate-700/50">
              <Building className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <h3 className="text-lg text-slate-400 mb-2">No Distressed Properties Detected</h3>
              <p className="text-sm text-slate-500 mb-4">Click "Scan Properties" to find motivated sellers in your target areas</p>
              <Button onClick={() => scanMutation.mutate()} className="bg-emerald-600 hover:bg-emerald-500" data-testid="button-scan-empty">
                <Search className="w-4 h-4 mr-2" /> Start Scanning
              </Button>
            </motion.div>
          ) : (
            <>
            {bulkMode && (
              <div className="flex items-center gap-3 bg-violet-500/10 border border-violet-500/20 rounded-xl px-4 py-3" data-testid="bulk-select-bar">
                <button onClick={selectAllLeads} className="flex items-center gap-2 text-sm text-violet-300 hover:text-violet-200" data-testid="button-select-all">
                  {selectedLeadIds.size === leads.length ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                  {selectedLeadIds.size === leads.length ? "Deselect All" : "Select All"}
                </button>
                <span className="text-xs text-slate-400">{selectedLeadIds.size} of {leads.length} selected</span>
              </div>
            )}
            <AnimatePresence>
              {leads.map((lead, idx) => {
                const prio = PRIORITY_COLORS[lead.priority || "medium"];
                return (
                  <motion.div
                    key={lead.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className={`bg-slate-800/50 rounded-xl border ${prio.border} p-5 hover:bg-slate-800/70 transition-all cursor-pointer shadow-lg ${prio.glow}`}
                    onClick={() => !bulkMode && setSelectedLead(lead)}
                    data-testid={`card-lead-${lead.id}`}
                  >
                    <div className="flex items-start justify-between">
                      {bulkMode && (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleLeadSelection(lead.id); }}
                          className="mr-3 mt-1 flex-shrink-0"
                          data-testid={`checkbox-lead-${lead.id}`}
                        >
                          {selectedLeadIds.has(lead.id) ? (
                            <CheckSquare className="w-5 h-5 text-violet-400" />
                          ) : (
                            <Square className="w-5 h-5 text-slate-500" />
                          )}
                        </button>
                      )}
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <span className={`px-2 py-0.5 text-xs font-bold rounded ${prio.bg} ${prio.text}`}>
                            {prio.label}
                          </span>
                          <span className="text-xs text-slate-500">{timeAgo(lead.createdAt)}</span>
                          {lead.smsSent && <span className="text-xs text-green-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> SMS Sent</span>}
                          {lead.adDeployed && <span className="text-xs text-blue-400 flex items-center gap-1"><Target className="w-3 h-3" /> Ads Live</span>}
                        </div>
                        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                          <Home className="w-4 h-4 text-emerald-400" />
                          {lead.address}
                        </h3>
                        <p className="text-sm text-slate-400 mt-1">
                          <MapPin className="w-3 h-3 inline mr-1" />
                          {lead.city}, {lead.state} {lead.zip}
                          {lead.ownerName && <span className="ml-3"><User className="w-3 h-3 inline mr-1" />{lead.ownerName}</span>}
                        </p>

                        <div className="flex flex-wrap gap-2 mt-3">
                          {(lead.distressSignals || []).map((signal, i) => {
                            const sig = DISTRESS_SIGNALS[signal] || { icon: "🔍", color: "text-slate-400" };
                            return (
                              <span key={i} className={`text-xs px-2 py-1 rounded-full bg-slate-700/50 ${sig.color}`}>
                                {sig.icon} {signal}
                              </span>
                            );
                          })}
                        </div>
                      </div>

                      <div className="text-right ml-6 space-y-1">
                        <div className="text-lg font-bold text-emerald-400">{formatCurrency(lead.estimatedValue || 0)}</div>
                        <div className="text-xs text-slate-500">ARV</div>
                        <div className="text-sm font-semibold text-purple-400 mt-2">{formatCurrency(lead.estimatedEquity || 0)}</div>
                        <div className="text-xs text-slate-500">Equity</div>
                        {lead.dealMetrics && (
                          <>
                            <div className="text-sm font-bold text-green-400 mt-2">{formatCurrency(lead.dealMetrics.potentialProfit)}</div>
                            <div className="text-xs text-slate-500">Potential Profit</div>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-700/50">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
                        onClick={(e) => { e.stopPropagation(); skipTraceMutation.mutate(lead.id); }}
                        disabled={skipTraceMutation.isPending}
                        data-testid={`button-skip-trace-${lead.id}`}
                      >
                        {skipTraceMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <UserSearch className="w-3 h-3 mr-1" />}
                        Skip Trace
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                        onClick={(e) => { e.stopPropagation(); smsMutation.mutate(lead.id); }}
                        disabled={lead.smsSent || !lead.ownerPhone}
                        data-testid={`button-sms-${lead.id}`}
                      >
                        <Send className="w-3 h-3 mr-1" /> {lead.smsSent ? "Sent" : "SMS Owner"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                        onClick={(e) => { e.stopPropagation(); adsMutation.mutate(lead.id); }}
                        disabled={!!lead.adDeployed}
                        data-testid={`button-ads-${lead.id}`}
                      >
                        <Target className="w-3 h-3 mr-1" /> {lead.adDeployed ? "Deployed" : "Deploy Ads"}
                      </Button>
                      <div className="flex-1" />
                      <select
                        className="bg-slate-700/50 border border-slate-600/50 rounded-md text-xs text-slate-300 px-2 py-1"
                        value={lead.pipelineStage || "new"}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateStageMutation.mutate({ id: lead.id, stage: e.target.value })}
                        data-testid={`select-stage-${lead.id}`}
                      >
                        {PIPELINE_STAGES.map(s => (
                          <option key={s.key} value={s.key}>{s.label}</option>
                        ))}
                      </select>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            </>
          )}
        </div>
      ) : (
        /* Pipeline View */
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {PIPELINE_STAGES.map(stage => {
            const stageLeads = leads.filter(l => (l.pipelineStage || "new") === stage.key);
            return (
              <div key={stage.key} className={`${stage.bg} rounded-xl border border-slate-700/50 p-4`}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className={`text-sm font-bold ${stage.color} uppercase tracking-wider`}>{stage.label}</h3>
                  <span className="text-xs text-slate-500 bg-slate-800/50 px-2 py-0.5 rounded-full">{stageLeads.length}</span>
                </div>
                <div className="space-y-3">
                  {stageLeads.map(lead => {
                    const prio = PRIORITY_COLORS[lead.priority || "medium"];
                    return (
                      <motion.div
                        key={lead.id}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className={`bg-slate-800/70 rounded-lg border ${prio.border} p-3 cursor-pointer hover:bg-slate-800 transition`}
                        onClick={() => setSelectedLead(lead)}
                        data-testid={`pipeline-card-${lead.id}`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${prio.bg} ${prio.text}`}>{prio.label}</span>
                        </div>
                        <p className="text-sm font-medium text-white truncate">{lead.address}</p>
                        <p className="text-xs text-slate-500">{lead.city}, {lead.state}</p>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-xs font-semibold text-emerald-400">{formatCurrency(lead.estimatedValue || 0)}</span>
                          <span className="text-xs text-purple-400">{lead.dealMetrics?.equityPercentage || 0}% equity</span>
                        </div>
                      </motion.div>
                    );
                  })}
                  {stageLeads.length === 0 && (
                    <p className="text-xs text-slate-600 text-center py-4">No leads</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Lead Detail Dialog */}
      <Dialog open={!!selectedLead} onOpenChange={() => { setSelectedLead(null); setSkipTraceResult(null); }}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg max-h-[90vh] overflow-y-auto">
          {selectedLead && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-xl">
                  <Home className="w-5 h-5 text-emerald-400" />
                  {selectedLead.address}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-slate-500 mb-1">Property Address</p>
                  <AddressAutocomplete
                    value={`${selectedLead.address || ""}, ${selectedLead.city || ""}, ${selectedLead.state || ""} ${selectedLead.zip || ""}`}
                    onAddressSelect={(data) => {
                      if (data.address) {
                        updateLeadAddressMutation.mutate({
                          id: selectedLead.id,
                          address: data.address,
                          city: data.city,
                          state: data.state,
                          zip: data.zip,
                        });
                      }
                    }}
                    placeholder="Edit property address..."
                    className="bg-slate-800 border-slate-700 text-white text-sm"
                    data-testid="input-lead-address"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-800/50 rounded-lg p-3">
                    <p className="text-xs text-slate-500">Owner</p>
                    <p className="text-sm font-medium text-white">{selectedLead.ownerName || "Unknown"}</p>
                    {selectedLead.ownerPhone && <p className="text-xs text-emerald-400 mt-1"><Phone className="w-3 h-3 inline mr-1" />{selectedLead.ownerPhone}</p>}
                    {selectedLead.ownerEmail && <p className="text-xs text-blue-400 mt-0.5"><Mail className="w-3 h-3 inline mr-1" />{selectedLead.ownerEmail}</p>}
                  </div>
                  <div className="bg-slate-800/50 rounded-lg p-3">
                    <p className="text-xs text-slate-500">Property Type</p>
                    <p className="text-sm font-medium text-white">{selectedLead.propertyType || "Unknown"}</p>
                  </div>
                  <div className="bg-slate-800/50 rounded-lg p-3">
                    <p className="text-xs text-slate-500">Estimated Value (ARV)</p>
                    <p className="text-lg font-bold text-emerald-400">{formatCurrency(selectedLead.estimatedValue || 0)}</p>
                  </div>
                  <div className="bg-slate-800/50 rounded-lg p-3">
                    <p className="text-xs text-slate-500">Equity</p>
                    <p className="text-lg font-bold text-purple-400">{formatCurrency(selectedLead.estimatedEquity || 0)}</p>
                  </div>
                </div>

                {selectedLead.dealMetrics && (
                  <div className="bg-emerald-500/10 rounded-lg border border-emerald-500/20 p-4">
                    <h4 className="text-sm font-bold text-emerald-400 mb-3 flex items-center gap-2">
                      <BarChart3 className="w-4 h-4" /> Deal Analysis
                    </h4>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <p className="text-xs text-slate-500">Max Offer (70%)</p>
                        <p className="text-sm font-bold text-white">{formatCurrency(selectedLead.dealMetrics.maxOffer)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Assignment Fee</p>
                        <p className="text-sm font-bold text-amber-400">{formatCurrency(selectedLead.dealMetrics.assignmentFee)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Potential Profit</p>
                        <p className="text-sm font-bold text-green-400">{formatCurrency(selectedLead.dealMetrics.potentialProfit)}</p>
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-xs text-slate-500 mb-2">Distress Signals</p>
                  <div className="flex flex-wrap gap-2">
                    {(selectedLead.distressSignals || []).map((signal, i) => {
                      const sig = DISTRESS_SIGNALS[signal] || { icon: "🔍", color: "text-slate-400" };
                      return (
                        <span key={i} className={`text-sm px-3 py-1 rounded-full bg-slate-800/50 border border-slate-700/50 ${sig.color}`}>
                          {sig.icon} {signal}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Skip Trace Section */}
                <div className="bg-violet-500/10 rounded-lg border border-violet-500/20 p-4">
                  <h4 className="text-sm font-bold text-violet-400 mb-3 flex items-center gap-2">
                    <UserSearch className="w-4 h-4" /> Owner Lookup (Skip Trace)
                  </h4>
                  {skipTraceResult ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs text-slate-500">Name</p>
                          <p className="text-sm font-medium text-white" data-testid="text-skip-name">{skipTraceResult.ownerName || "N/A"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Phone</p>
                          <p className="text-sm font-medium text-emerald-400" data-testid="text-skip-phone">
                            {skipTraceResult.ownerPhone ? (
                              <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{skipTraceResult.ownerPhone}</span>
                            ) : "N/A"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Email</p>
                          <p className="text-sm font-medium text-blue-400" data-testid="text-skip-email">
                            {skipTraceResult.ownerEmail ? (
                              <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{skipTraceResult.ownerEmail}</span>
                            ) : "N/A"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Mailing Address</p>
                          <p className="text-sm text-slate-300" data-testid="text-skip-mailing">{skipTraceResult.mailingAddress || "N/A"}</p>
                        </div>
                      </div>
                      {(skipTraceResult.additionalPhones?.length > 0 || skipTraceResult.additionalEmails?.length > 0) && (
                        <div className="border-t border-violet-500/20 pt-2">
                          {skipTraceResult.additionalPhones?.length > 0 && (
                            <p className="text-xs text-slate-400">Other phones: {skipTraceResult.additionalPhones.join(", ")}</p>
                          )}
                          {skipTraceResult.additionalEmails?.length > 0 && (
                            <p className="text-xs text-slate-400 mt-1">Other emails: {skipTraceResult.additionalEmails.join(", ")}</p>
                          )}
                        </div>
                      )}
                      <Button
                        size="sm"
                        className="w-full bg-violet-600 hover:bg-violet-500"
                        onClick={() => saveAsContactMutation.mutate(skipTraceResult.id)}
                        disabled={saveAsContactMutation.isPending || !!skipTraceResult.savedAsContactId}
                        data-testid="button-save-contact"
                      >
                        {skipTraceResult.savedAsContactId ? (
                          <><CheckCircle2 className="w-4 h-4 mr-2" /> Saved to CRM</>
                        ) : saveAsContactMutation.isPending ? (
                          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
                        ) : (
                          <><Save className="w-4 h-4 mr-2" /> Save as CRM Contact</>
                        )}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      className="w-full bg-violet-600 hover:bg-violet-500"
                      onClick={() => skipTraceMutation.mutate(selectedLead.id)}
                      disabled={skipTraceMutation.isPending}
                      data-testid="button-detail-skip-trace"
                    >
                      {skipTraceMutation.isPending ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Looking up owner...</>
                      ) : (
                        <><UserSearch className="w-4 h-4 mr-2" /> Look Up Owner Info</>
                      )}
                    </Button>
                  )}
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500"
                    onClick={() => { smsMutation.mutate(selectedLead.id); setSelectedLead(null); }}
                    disabled={selectedLead.smsSent || !selectedLead.ownerPhone}
                    data-testid="button-detail-sms"
                  >
                    <Send className="w-4 h-4 mr-2" /> {selectedLead.smsSent ? "SMS Sent" : "Send SMS"}
                  </Button>
                  <Button
                    className="flex-1 bg-blue-600 hover:bg-blue-500"
                    onClick={() => { adsMutation.mutate(selectedLead.id); setSelectedLead(null); }}
                    disabled={!!selectedLead.adDeployed}
                    data-testid="button-detail-ads"
                  >
                    <Target className="w-4 h-4 mr-2" /> {selectedLead.adDeployed ? "Ads Live" : "Deploy Ads"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Config Dialog */}
      <Dialog open={showConfig} onOpenChange={setShowConfig}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-emerald-400" />
              Property Radar Config
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Target ZIP Codes (comma separated)</label>
              <Input
                value={configForm.targetZips}
                onChange={(e) => setConfigForm(f => ({ ...f, targetZips: e.target.value }))}
                placeholder="89104, 89109, 89128"
                className="bg-slate-800 border-slate-700"
                data-testid="input-target-zips"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Target Cities</label>
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
                className="bg-slate-800 border-slate-700"
                types={["(cities)"]}
                data-testid="input-target-cities"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Distress Filters</label>
              <Input
                value={configForm.distressFilters}
                onChange={(e) => setConfigForm(f => ({ ...f, distressFilters: e.target.value }))}
                placeholder="Pre-Foreclosure, Tax Lien, Vacant, Probate"
                className="bg-slate-800 border-slate-700"
                data-testid="input-distress-filters"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Minimum Equity ($)</label>
              <Input
                type="number"
                value={configForm.minEquity}
                onChange={(e) => setConfigForm(f => ({ ...f, minEquity: parseInt(e.target.value) || 0 }))}
                className="bg-slate-800 border-slate-700"
                data-testid="input-min-equity"
              />
            </div>
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">Auto-SMS New Leads</span>
                <Switch checked={configForm.autoSms} onCheckedChange={(v) => setConfigForm(f => ({ ...f, autoSms: v }))} data-testid="switch-auto-sms" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">Auto-Call (Ghost SDR)</span>
                <Switch checked={configForm.autoCall} onCheckedChange={(v) => setConfigForm(f => ({ ...f, autoCall: v }))} data-testid="switch-auto-call" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">Auto-Deploy Ads</span>
                <Switch checked={configForm.autoAds} onCheckedChange={(v) => setConfigForm(f => ({ ...f, autoAds: v }))} data-testid="switch-auto-ads" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfig(false)} className="border-slate-700 text-slate-300" data-testid="button-config-cancel">Cancel</Button>
            <Button onClick={() => saveConfigMutation.mutate()} className="bg-emerald-600 hover:bg-emerald-500" data-testid="button-config-save">Save Config</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {showTutorial && <TutorialOverlay steps={PROPERTY_RADAR_STEPS} storageKey="apex_tutorial_property_radar" onClose={closeTutorial} accentColor="emerald" />}
    </div>
  );
}
