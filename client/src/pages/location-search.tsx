import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Search, List, Map as MapIcon, ExternalLink, Navigation, Loader2, Filter, X } from "lucide-react";

interface SearchResult {
  id: number;
  type: string;
  name: string;
  formattedAddress: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  distance: number | null;
  status: string | null;
  subAccountId: number;
}

interface SearchResponse {
  count: number;
  results: SearchResult[];
  center: { lat: number; lng: number } | null;
}

const TYPE_COLORS: Record<string, string> = {
  contact: "#3B82F6",
  lead: "#22C55E",
  crash: "#EF4444",
  business: "#A855F7",
};

const TYPE_LABELS: Record<string, string> = {
  contact: "Contact",
  lead: "Lead",
  crash: "Crash",
  business: "Business",
};

const RADIUS_OPTIONS = [
  { value: "5", label: "5 miles" },
  { value: "10", label: "10 miles" },
  { value: "25", label: "25 miles" },
  { value: "50", label: "50 miles" },
  { value: "100", label: "100 miles" },
];

export default function LocationSearch() {
  const [searchType, setSearchType] = useState("all");
  const [addressQuery, setAddressQuery] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [zipQuery, setZipQuery] = useState("");
  const [stateQuery, setStateQuery] = useState("");
  const [radiusValue, setRadiusValue] = useState("25");
  const [statusFilter, setStatusFilter] = useState("");
  const [textQuery, setTextQuery] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [searchParams, setSearchParams] = useState<URLSearchParams | null>(null);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [showFilters, setShowFilters] = useState(true);

  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const { data, isLoading, isFetching } = useQuery<SearchResponse>({
    queryKey: ["/api/location-search", searchParams?.toString()],
    queryFn: async () => {
      if (!searchParams) return { count: 0, results: [], center: null };
      const res = await fetch(`/api/location-search?${searchParams.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: !!searchParams,
  });

  function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    const params = new URLSearchParams();
    if (searchType !== "all") params.set("type", searchType);
    if (addressQuery.trim()) params.set("address", addressQuery.trim());
    if (cityQuery.trim()) params.set("city", cityQuery.trim());
    if (zipQuery.trim()) params.set("zip", zipQuery.trim());
    if (stateQuery.trim()) params.set("state", stateQuery.trim());
    if (statusFilter.trim()) params.set("status", statusFilter.trim());
    if (textQuery.trim()) params.set("q", textQuery.trim());
    params.set("radius", radiusValue);
    setSearchParams(params);
  }

  function clearFilters() {
    setSearchType("all");
    setAddressQuery("");
    setCityQuery("");
    setZipQuery("");
    setStateQuery("");
    setRadiusValue("25");
    setStatusFilter("");
    setTextQuery("");
    setSearchParams(null);
    setSelectedResult(null);
  }

  useEffect(() => {
    if (viewMode !== "map") return;
    if ((window as any).google?.maps) {
      setMapReady(true);
      return;
    }
    fetch("/api/config/maps-key", { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        if (!data.apiKey) { setMapError("No Maps API key"); return; }
        if ((window as any).google?.maps) { setMapReady(true); return; }
        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${data.apiKey}`;
        script.async = true;
        script.onload = () => setMapReady(true);
        script.onerror = () => setMapError("Failed to load Google Maps");
        document.head.appendChild(script);
      })
      .catch(() => setMapError("Failed to load Maps config"));
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== "map" || !mapReady || !mapRef.current) return;
    if (!googleMapRef.current) {
      googleMapRef.current = new google.maps.Map(mapRef.current, {
        center: { lat: 26.6406, lng: -81.8723 },
        zoom: 10,
        disableDefaultUI: false,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        styles: [
          { elementType: "geometry", stylers: [{ color: "#1e293b" }] },
          { elementType: "labels.text.stroke", stylers: [{ color: "#0f172a" }] },
          { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
          { featureType: "road", elementType: "geometry", stylers: [{ color: "#334155" }] },
          { featureType: "water", elementType: "geometry", stylers: [{ color: "#0f172a" }] },
        ],
      });
      infoWindowRef.current = new google.maps.InfoWindow();
    }
  }, [viewMode, mapReady]);

  useEffect(() => {
    if (viewMode !== "map" || !googleMapRef.current || !data) return;

    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    const bounds = new google.maps.LatLngBounds();
    let hasPoints = false;

    function esc(s: string) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

    for (const r of data.results) {
      if (r.lat == null || r.lng == null) continue;
      hasPoints = true;
      const pos = { lat: r.lat, lng: r.lng };
      bounds.extend(pos);

      const marker = new google.maps.Marker({
        map: googleMapRef.current!,
        position: pos,
        title: r.name,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: TYPE_COLORS[r.type] || "#6366f1",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });

      marker.addListener("click", () => {
        setSelectedResult(r);
        if (infoWindowRef.current) {
          infoWindowRef.current.setContent(`<div style="padding:8px;min-width:160px">
            <div style="font-weight:600;margin-bottom:4px">${esc(r.name)}</div>
            <div style="font-size:12px;color:#666;margin-bottom:4px">${esc(r.formattedAddress)}</div>
            <div style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;color:white;background:${TYPE_COLORS[r.type] || '#6366f1'}">${esc(TYPE_LABELS[r.type] || r.type)}</div>
            ${r.distance != null ? `<div style="font-size:11px;color:#888;margin-top:4px">${r.distance} mi away</div>` : ""}
          </div>`);
          infoWindowRef.current.open(googleMapRef.current!, marker);
        }
      });

      markersRef.current.push(marker);
    }

    if (data.center) {
      bounds.extend({ lat: data.center.lat, lng: data.center.lng });
    }

    if (hasPoints) {
      googleMapRef.current.fitBounds(bounds, 60);
    } else if (data.center) {
      googleMapRef.current.setCenter({ lat: data.center.lat, lng: data.center.lng });
      googleMapRef.current.setZoom(12);
    }
  }, [data, viewMode]);

  function centerOnResult(result: SearchResult) {
    setSelectedResult(result);
    if (viewMode === "map" && googleMapRef.current && result.lat && result.lng) {
      googleMapRef.current.panTo({ lat: result.lat, lng: result.lng });
      googleMapRef.current.setZoom(15);
    }
  }

  return (
    <div className="flex flex-col h-full" data-testid="page-location-search">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
            <MapPin className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white" data-testid="text-page-title">Location Search</h1>
            <p className="text-xs text-slate-400">Search records by location, radius, and filters</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-2 rounded-lg border transition-all text-sm ${showFilters ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-300" : "bg-white/5 border-white/10 text-slate-400"}`}
            data-testid="button-toggle-filters"
          >
            <Filter className="w-4 h-4" />
          </button>
          <div className="flex bg-white/5 rounded-lg border border-white/10 overflow-hidden">
            <button
              onClick={() => setViewMode("list")}
              className={`px-3 py-2 text-sm flex items-center gap-1.5 transition-all ${viewMode === "list" ? "bg-indigo-500/20 text-indigo-300" : "text-slate-400 hover:text-white"}`}
              data-testid="button-view-list"
            >
              <List className="w-4 h-4" /> List
            </button>
            <button
              onClick={() => setViewMode("map")}
              className={`px-3 py-2 text-sm flex items-center gap-1.5 transition-all ${viewMode === "map" ? "bg-indigo-500/20 text-indigo-300" : "text-slate-400 hover:text-white"}`}
              data-testid="button-view-map"
            >
              <MapIcon className="w-4 h-4" /> Map
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {showFilters && (
          <div className="w-72 border-r border-white/10 p-4 overflow-y-auto flex-shrink-0">
            <form onSubmit={handleSearch} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1 block">Record Type</label>
                <select
                  value={searchType}
                  onChange={(e) => setSearchType(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                  data-testid="select-record-type"
                >
                  <option value="all">All Types</option>
                  <option value="contact">Contacts</option>
                  <option value="lead">Leads</option>
                  <option value="crash">Crashes</option>
                  <option value="business">Businesses</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-400 mb-1 block">Search Name</label>
                <input
                  type="text"
                  value={textQuery}
                  onChange={(e) => setTextQuery(e.target.value)}
                  placeholder="John Smith..."
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  data-testid="input-text-query"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-400 mb-1 block">Address (for radius search)</label>
                <input
                  type="text"
                  value={addressQuery}
                  onChange={(e) => setAddressQuery(e.target.value)}
                  placeholder="123 Main St, Fort Myers, FL"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  data-testid="input-address"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1 block">City</label>
                  <input
                    type="text"
                    value={cityQuery}
                    onChange={(e) => setCityQuery(e.target.value)}
                    placeholder="Fort Myers"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500"
                    data-testid="input-city"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1 block">ZIP</label>
                  <input
                    type="text"
                    value={zipQuery}
                    onChange={(e) => setZipQuery(e.target.value)}
                    placeholder="33901"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500"
                    data-testid="input-zip"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1 block">State</label>
                  <input
                    type="text"
                    value={stateQuery}
                    onChange={(e) => setStateQuery(e.target.value)}
                    placeholder="FL"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500"
                    data-testid="input-state"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1 block">Radius</label>
                  <select
                    value={radiusValue}
                    onChange={(e) => setRadiusValue(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                    data-testid="select-radius"
                  >
                    {RADIUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-400 mb-1 block">Status</label>
                <input
                  type="text"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  placeholder="open, new, pending..."
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  data-testid="input-status"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 rounded-lg text-sm flex items-center justify-center gap-2 transition-all"
                  data-testid="button-search"
                >
                  {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  Search
                </button>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="px-3 py-2.5 bg-white/5 border border-white/10 text-slate-400 hover:text-white rounded-lg text-sm transition-all"
                  data-testid="button-clear"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </form>

            {data && (
              <div className="mt-4 pt-3 border-t border-white/10">
                <p className="text-xs text-slate-400">
                  <span className="text-white font-semibold">{data.count}</span> result{data.count !== 1 ? "s" : ""} found
                </p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {Object.entries(TYPE_LABELS).map(([key, label]) => {
                    const count = data.results.filter(r => r.type === key).length;
                    if (!count) return null;
                    return (
                      <span key={key} className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: TYPE_COLORS[key] + "20", color: TYPE_COLORS[key] }}>
                        {count} {label}{count !== 1 ? "s" : ""}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex-1 overflow-hidden">
          {viewMode === "list" ? (
            <div className="h-full overflow-y-auto">
              {!searchParams ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-8">
                  <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 flex items-center justify-center mb-4">
                    <Search className="w-8 h-8 text-indigo-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">Search by Location</h3>
                  <p className="text-sm text-slate-400 max-w-md">
                    Use the filters on the left to search contacts, leads, crashes, and businesses by city, ZIP code, address, or radius.
                  </p>
                </div>
              ) : isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                </div>
              ) : data && (!data.results || data.results.length === 0) ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-8">
                  <MapPin className="w-12 h-12 text-slate-600 mb-3" />
                  <p className="text-slate-400">No results found. Try broadening your search.</p>
                </div>
              ) : (
                <div className="divide-y divide-white/5">
                  {data?.results.map((r) => (
                    <div
                      key={`${r.type}-${r.id}`}
                      onClick={() => centerOnResult(r)}
                      className={`flex items-center gap-4 px-6 py-4 hover:bg-white/5 cursor-pointer transition-all ${
                        selectedResult?.id === r.id && selectedResult?.type === r.type ? "bg-indigo-500/10 border-l-2 border-indigo-500" : ""
                      }`}
                      data-testid={`row-result-${r.type}-${r.id}`}
                    >
                      <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: TYPE_COLORS[r.type] + "20" }}>
                        <span className="text-xs font-bold" style={{ color: TYPE_COLORS[r.type] }}>{r.type[0].toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-white text-sm truncate">{r.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0" style={{ background: TYPE_COLORS[r.type] + "20", color: TYPE_COLORS[r.type] }}>
                            {TYPE_LABELS[r.type]}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 truncate mt-0.5">{r.formattedAddress || "No address"}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        {r.distance != null && (
                          <div className="flex items-center gap-1 text-xs text-cyan-400">
                            <Navigation className="w-3 h-3" />
                            {r.distance} mi
                          </div>
                        )}
                        {r.status && (
                          <p className="text-[10px] text-slate-500 mt-0.5">{r.status}</p>
                        )}
                      </div>
                      <ExternalLink className="w-4 h-4 text-slate-600 flex-shrink-0" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex">
              {mapError ? (
                <div className="flex-1 flex items-center justify-center text-red-400">{mapError}</div>
              ) : !mapReady && viewMode === "map" ? (
                <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-blue-400" /></div>
              ) : null}
              <div ref={mapRef} className={`flex-1 ${mapError || (!mapReady && viewMode === "map") ? "hidden" : ""}`} data-testid="map-container" />
              {selectedResult && (
                <div className="w-72 border-l border-white/10 p-4 overflow-y-auto flex-shrink-0">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-white">Details</h3>
                    <button onClick={() => setSelectedResult(null)} className="text-slate-500 hover:text-white">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: TYPE_COLORS[selectedResult.type] + "20", color: TYPE_COLORS[selectedResult.type] }}>
                        {TYPE_LABELS[selectedResult.type]}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Name</p>
                      <p className="text-sm text-white font-medium">{selectedResult.name}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Address</p>
                      <p className="text-sm text-slate-300">{selectedResult.formattedAddress || "N/A"}</p>
                    </div>
                    {selectedResult.city && (
                      <div>
                        <p className="text-xs text-slate-500">City / State / ZIP</p>
                        <p className="text-sm text-slate-300">{selectedResult.city}, {selectedResult.state} {selectedResult.zip}</p>
                      </div>
                    )}
                    {selectedResult.distance != null && (
                      <div>
                        <p className="text-xs text-slate-500">Distance</p>
                        <p className="text-sm text-cyan-400 flex items-center gap-1">
                          <Navigation className="w-3 h-3" /> {selectedResult.distance} miles
                        </p>
                      </div>
                    )}
                    {selectedResult.status && (
                      <div>
                        <p className="text-xs text-slate-500">Status</p>
                        <p className="text-sm text-slate-300">{selectedResult.status}</p>
                      </div>
                    )}
                    {selectedResult.lat && selectedResult.lng && (
                      <div>
                        <p className="text-xs text-slate-500">Coordinates</p>
                        <p className="text-xs text-slate-400 font-mono">{selectedResult.lat.toFixed(4)}, {selectedResult.lng.toFixed(4)}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
