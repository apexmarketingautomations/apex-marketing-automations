import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/use-auth";
import { Shield, Users, MessageSquare, Target, AlertTriangle, Satellite, Activity, DollarSign, Radio, RefreshCcw, Search, ChevronDown, GitBranch, Fingerprint } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

interface GlobalStats {
  totalAccounts: number;
  totalUsers: number;
  totalLeads: number;
  totalContacts: number;
  totalMessages: number;
  totalIncidents: number;
  activeDispatchSubscribers: number;
  totalDeals: number;
  totalDealValue: number;
  sentinelStatus: string;
}

interface FeedItem {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  severity?: string;
  action_status?: string;
  timestamp: string;
  sub_account_id: number;
  account_name: string;
  category: string;
}

interface AccountOverview {
  id: number;
  name: string;
  industry: string;
  plan: string;
  twilio_number: string;
  contact_count: number;
  message_count: number;
  lead_count: number;
}

interface RoutingFailure {
  id: number;
  phone: string | null;
  channel: string;
  source: string | null;
  reason: string;
  resolvedSubAccountId: number | null;
  resolvedAt: string | null;
  createdAt: string;
}

const categoryColors: Record<string, { bg: string; text: string; label: string }> = {
  meta_lead: { bg: "bg-green-500/20", text: "text-green-400", label: "Lead" },
  sentinel_incident: { bg: "bg-red-500/20", text: "text-red-400", label: "Incident" },
  contact: { bg: "bg-cyan-500/20", text: "text-cyan-400", label: "Contact" },
};

function ManualSkipTracePanel() {
  const [fields, setFields] = useState({ ownerName: "", address: "", city: "", state: "FL", zip: "" });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  function set(k: string, v: string) { setFields(f => ({ ...f, [k]: v })); }

  async function run() {
    if (!fields.address.trim()) { setError("Address is required"); return; }
    setRunning(true); setResult(null); setError(null);
    try {
      const res = await fetch("/api/admin/manual-skip-trace", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Request failed"); return; }
      setResult(data);
    } catch (e: any) {
      setError("Network error: " + e.message);
    } finally {
      setRunning(false);
    }
  }

  const inp = "w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50";

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
      className="bg-[#0a0a0a] border border-cyan-500/20 rounded-2xl p-6"
    >
      <h2 className="text-sm font-bold text-cyan-400 uppercase tracking-widest mb-1 flex items-center gap-2">
        <Search size={14} /> Manual Skip Trace
      </h2>
      <p className="text-xs text-slate-500 mb-4">
        Single-subject lookup via BatchData. Enter a name + address and get phone, email, and household members back.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-xs text-slate-400 font-bold mb-1 block">Owner / Subject Name</label>
          <input value={fields.ownerName} onChange={e => set("ownerName", e.target.value)}
            placeholder="John Smith" className={inp} />
        </div>
        <div>
          <label className="text-xs text-slate-400 font-bold mb-1 block">Street Address <span className="text-red-400">*</span></label>
          <input value={fields.address} onChange={e => set("address", e.target.value)}
            placeholder="123 Main St" className={inp} />
        </div>
        <div>
          <label className="text-xs text-slate-400 font-bold mb-1 block">City</label>
          <input value={fields.city} onChange={e => set("city", e.target.value)}
            placeholder="Fort Myers" className={inp} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-slate-400 font-bold mb-1 block">State</label>
            <input value={fields.state} onChange={e => set("state", e.target.value)}
              placeholder="FL" maxLength={2} className={inp} />
          </div>
          <div>
            <label className="text-xs text-slate-400 font-bold mb-1 block">ZIP</label>
            <input value={fields.zip} onChange={e => set("zip", e.target.value)}
              placeholder="33901" maxLength={10} className={inp} />
          </div>
        </div>
      </div>

      <button onClick={run} disabled={running}
        className="px-5 py-2 rounded-lg text-xs font-bold border border-cyan-500/40 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-40 transition-all mb-4"
      >
        {running ? "Looking up…" : "🔍 Run Skip Trace"}
      </button>

      {error && (
        <div className="rounded-xl p-3 text-xs bg-red-500/10 border border-red-500/20 text-red-400 mb-3">{error}</div>
      )}

      {result && (
        <div className="rounded-xl p-4 bg-green-500/5 border border-green-500/20 text-xs space-y-2">
          <div className="flex gap-4 flex-wrap">
            <span className="text-slate-400">Name: <span className="text-white font-bold">{result.ownerName || "—"}</span></span>
            <span className="text-slate-400">Phone: <span className="text-cyan-300 font-bold">{result.ownerPhone || "—"}</span></span>
            <span className="text-slate-400">Email: <span className="text-cyan-300 font-bold">{result.ownerEmail || "—"}</span></span>
          </div>
          {result.mailingAddress && (
            <div className="text-slate-400">Mailing: <span className="text-white">{result.mailingAddress}</span></div>
          )}
          {result.additionalPhones?.length > 0 && (
            <div className="text-slate-400">More phones: <span className="text-white">{result.additionalPhones.join(", ")}</span></div>
          )}
          {result.additionalEmails?.length > 0 && (
            <div className="text-slate-400">More emails: <span className="text-white">{result.additionalEmails.join(", ")}</span></div>
          )}
          {result.allPersons?.length > 1 && (
            <div className="text-slate-500 pt-1 border-t border-white/5">
              {result.totalPersonsFound} person(s) at address — other household members may also be in results.
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

function AdminSkipTracePanel() {
  const { toast } = { toast: (x: any) => {} }; // inline — replace with useToast if available
  const [subAccountId, setSubAccountId] = useState("");
  const [force, setForce] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function runRetroSkipTrace(scope: "single" | "all") {
    setRunning(true);
    setResult(null);
    try {
      const body: Record<string, any> = { force };
      if (scope === "single" && subAccountId) body.subAccountId = parseInt(subAccountId);
      const res = await fetch("/api/sentinel/retro-skip-trace", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setResult(res.ok ? (data.message || "Started") : (data.error || "Failed"));
    } catch (e: any) {
      setResult("Error: " + e.message);
    } finally {
      setRunning(false);
    }
  }

  async function runBatchSkipTrace() {
    if (!subAccountId) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/batch-skip-trace", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subAccountId: parseInt(subAccountId), force }),
      });
      const data = await res.json();
      setResult(res.ok ? (data.message || `Queued ${data.queued ?? ""} leads`) : (data.error || "Failed"));
    } catch (e: any) {
      setResult("Error: " + e.message);
    } finally {
      setRunning(false);
    }
  }

  async function runEnrichLegalSignals() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/sentinel/enrich-legal-signals", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      setResult(res.ok ? `Enriched ${data.enriched}/${data.checked} signals` : (data.error || "Failed"));
    } catch (e: any) {
      setResult("Error: " + e.message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
      className="bg-[#0a0a0a] border border-cyan-500/20 rounded-2xl p-6"
    >
      <h2 className="text-sm font-bold text-cyan-400 uppercase tracking-widest mb-4 flex items-center gap-2">
        <Fingerprint size={14} /> Admin Skip Trace
      </h2>
      <p className="text-xs text-slate-500 mb-4">
        Enrich crash leads with phone/email/name via BatchData. Requires <code className="bg-white/10 px-1 rounded">BATCHDATA_API_KEY</code> in Railway env vars.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="text-xs text-slate-400 font-bold mb-1 block">Sub-Account ID (optional for retro)</label>
          <input
            type="number"
            value={subAccountId}
            onChange={e => setSubAccountId(e.target.value)}
            placeholder="e.g. 3"
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
          />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-xs text-slate-400 font-bold cursor-pointer">
            <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)}
              className="w-4 h-4 rounded border-white/20 bg-white/5" />
            Force re-enrich (ignore existing)
          </label>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => runRetroSkipTrace("all")}
          disabled={running}
          className="px-4 py-2 rounded-lg text-xs font-bold border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-40 transition-all"
        >
          {running ? "Running…" : "🔍 Retro All Crash Leads"}
        </button>
        <button
          onClick={() => runRetroSkipTrace("single")}
          disabled={running || !subAccountId}
          className="px-4 py-2 rounded-lg text-xs font-bold border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-40 transition-all"
        >
          {running ? "Running…" : "🔍 Retro Single Account"}
        </button>
        <button
          onClick={runBatchSkipTrace}
          disabled={running || !subAccountId}
          className="px-4 py-2 rounded-lg text-xs font-bold border border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 disabled:opacity-40 transition-all"
        >
          {running ? "Running…" : "⚡ Batch Skip Trace Account"}
        </button>
        <button
          onClick={runEnrichLegalSignals}
          disabled={running}
          className="px-4 py-2 rounded-lg text-xs font-bold border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 disabled:opacity-40 transition-all"
        >
          {running ? "Running…" : "🧬 Enrich Legal Signals (no-phone)"}
        </button>
      </div>

      {result && (
        <div className={`rounded-xl p-3 text-xs border ${result.startsWith("Error") || result.toLowerCase().includes("fail") ? "bg-red-500/10 border-red-500/20 text-red-400" : "bg-green-500/10 border-green-500/20 text-green-400"}`}>
          {result}
        </div>
      )}
    </motion.div>
  );
}

export default function AdminConsolePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.isAdmin === "true" || (user as any)?.role === "DEV_ADMIN";
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [resolveInput, setResolveInput] = useState<Record<number, string>>({});

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery<GlobalStats>({
    queryKey: ["/api/admin/global-stats"],
    queryFn: async () => {
      const res = await fetch("/api/admin/global-stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
    refetchInterval: 3_600_000,
    enabled: isAdmin,
  });

  const { data: feed, isLoading: feedLoading, refetch: refetchFeed } = useQuery<FeedItem[]>({
    queryKey: ["/api/admin/master-feed"],
    queryFn: async () => {
      const res = await fetch("/api/admin/master-feed?limit=100");
      if (!res.ok) throw new Error("Failed to fetch feed");
      return res.json();
    },
    refetchInterval: 3_600_000,
    enabled: isAdmin,
  });

  const { data: accounts } = useQuery<AccountOverview[]>({
    queryKey: ["/api/admin/accounts-overview"],
    queryFn: async () => {
      const res = await fetch("/api/admin/accounts-overview");
      if (!res.ok) throw new Error("Failed to fetch accounts");
      return res.json();
    },
    enabled: isAdmin,
  });

  const { data: routingFailuresData, refetch: refetchRoutingFailures } = useQuery<{ failures: RoutingFailure[]; total: number }>({
    queryKey: ["/api/admin/routing-failures"],
    queryFn: async () => {
      const res = await fetch("/api/admin/routing-failures");
      if (!res.ok) throw new Error("Failed to fetch routing failures");
      return res.json();
    },
    enabled: isAdmin,
    refetchInterval: 3_600_000,
  });

  const resolveFailureMutation = useMutation({
    mutationFn: async ({ id, subAccountId }: { id: number; subAccountId: number }) => {
      const res = await fetch(`/api/admin/routing-failures/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subAccountId }),
      });
      if (!res.ok) throw new Error("Failed to resolve routing failure");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/routing-failures"] });
    },
  });

  if (!isAdmin) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[70vh]">
        <div className="text-center space-y-4">
          <Shield size={48} className="text-red-400 mx-auto" />
          <h1 className="text-2xl font-black text-white">Access Denied</h1>
          <p className="text-slate-400">DEV_ADMIN clearance required.</p>
        </div>
      </div>
    );
  }

  const filteredFeed = (feed || []).filter((item) => {
    if (filterCategory !== "all" && item.category !== filterCategory) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return (
        (item.name || "").toLowerCase().includes(term) ||
        (item.email || "").toLowerCase().includes(term) ||
        (item.phone || "").toLowerCase().includes(term) ||
        (item.account_name || "").toLowerCase().includes(term) ||
        (item.location || "").toLowerCase().includes(term)
      );
    }
    return true;
  });

  const statCards = [
    { key: "totalLeads", label: "Total Leads", icon: Target, value: stats?.totalLeads ?? 0, color: "from-green-500 to-emerald-600", iconBg: "bg-green-500/20", iconColor: "text-green-400" },
    { key: "totalUsers", label: "Active Users", icon: Users, value: stats?.totalUsers ?? 0, color: "from-cyan-500 to-blue-600", iconBg: "bg-cyan-500/20", iconColor: "text-cyan-400" },
    { key: "totalAccounts", label: "Sub-Accounts", icon: Shield, value: stats?.totalAccounts ?? 0, color: "from-violet-500 to-purple-600", iconBg: "bg-violet-500/20", iconColor: "text-violet-400" },
    { key: "totalMessages", label: "Total Messages", icon: MessageSquare, value: stats?.totalMessages ?? 0, color: "from-blue-500 to-indigo-600", iconBg: "bg-blue-500/20", iconColor: "text-blue-400" },
    { key: "totalContacts", label: "CRM Contacts", icon: Users, value: stats?.totalContacts ?? 0, color: "from-teal-500 to-cyan-600", iconBg: "bg-teal-500/20", iconColor: "text-teal-400" },
    { key: "totalIncidents", label: "Sentinel Incidents", icon: AlertTriangle, value: stats?.totalIncidents ?? 0, color: "from-red-500 to-rose-600", iconBg: "bg-red-500/20", iconColor: "text-red-400" },
    { key: "activeDispatchSubscribers", label: "Dispatch Subscribers", icon: Radio, value: stats?.activeDispatchSubscribers ?? 0, color: "from-amber-500 to-orange-600", iconBg: "bg-amber-500/20", iconColor: "text-amber-400" },
    { key: "totalDealValue", label: "Pipeline Value", icon: DollarSign, value: stats?.totalDealValue ?? 0, color: "from-emerald-500 to-green-600", iconBg: "bg-emerald-500/20", iconColor: "text-emerald-400", isCurrency: true },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-black text-white flex items-center gap-3" data-testid="text-admin-console-title">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-red-500 to-violet-600 flex items-center justify-center shadow-lg shadow-red-500/25">
              <Shield size={24} className="text-white" />
            </div>
            APEX SYSTEM COMMAND
          </h1>
          <p className="text-slate-400 mt-1 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-green-500/20 text-green-400 border border-green-500/30">
              <Activity size={10} />
              DEV_ADMIN
            </span>
            Root-level clearance active
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/40 border border-white/10">
            <Satellite size={16} className={stats?.sentinelStatus === "RUNNING" ? "text-green-400 animate-pulse" : "text-red-400"} />
            <span className="text-sm font-bold text-white" data-testid="sentinel-status">{stats?.sentinelStatus ?? "..."}</span>
          </div>
          <button
            onClick={() => { refetchStats(); refetchFeed(); }}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
            data-testid="button-refresh-stats"
          >
            <RefreshCcw size={16} className="text-slate-400" />
          </button>
        </div>
      </div>

      {statsLoading ? (
        <div className="text-center py-12 text-slate-400">Initializing command console...</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="stats-grid">
          {statCards.map((card, idx) => (
            <motion.div key={card.key} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
              <div className="relative overflow-hidden rounded-xl bg-black/40 border border-white/10 hover:border-white/20 transition-all p-4 group" data-testid={`stat-card-${card.key}`}>
                <div className="absolute inset-0 bg-gradient-to-br opacity-5 group-hover:opacity-10 transition-opacity" style={{ backgroundImage: `linear-gradient(to bottom right, var(--tw-gradient-stops))` }} />
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-10 h-10 rounded-lg ${card.iconBg} flex items-center justify-center`}>
                    <card.icon size={20} className={card.iconColor} />
                  </div>
                </div>
                <p className="text-2xl font-black text-white">
                  {card.isCurrency ? `$${Number(card.value).toLocaleString()}` : Number(card.value).toLocaleString()}
                </p>
                <p className="text-xs text-slate-400 mt-1">{card.label}</p>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* ── Manual Skip Trace — top of page for easy access ── */}
      <ManualSkipTracePanel />

      <div className="bg-black/40 border border-white/10 rounded-xl overflow-hidden" data-testid="admin-console">
        <div className="p-4 border-b border-white/10 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Activity size={18} className="text-cyan-400" />
            Master Lead Feed
            <span className="text-xs text-slate-500 font-normal ml-2">Live</span>
          </h2>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="relative flex-1 md:flex-none">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search feed..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full md:w-48 pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/50"
                data-testid="input-search-feed"
              />
            </div>
            <div className="relative">
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-cyan-500/50 cursor-pointer"
                data-testid="select-filter-category"
              >
                <option value="all">All Categories</option>
                <option value="meta_lead">Leads</option>
                <option value="sentinel_incident">Incidents</option>
                <option value="contact">Contacts</option>
              </select>
              <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full" data-testid="master-lead-table">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-xs font-bold text-slate-400 uppercase tracking-wider px-4 py-3">Timestamp</th>
                <th className="text-left text-xs font-bold text-slate-400 uppercase tracking-wider px-4 py-3">Category</th>
                <th className="text-left text-xs font-bold text-slate-400 uppercase tracking-wider px-4 py-3">Name</th>
                <th className="text-left text-xs font-bold text-slate-400 uppercase tracking-wider px-4 py-3">Location / Contact</th>
                <th className="text-left text-xs font-bold text-slate-400 uppercase tracking-wider px-4 py-3">Assigned To</th>
                <th className="text-left text-xs font-bold text-slate-400 uppercase tracking-wider px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="master-feed-body">
              {feedLoading ? (
                <tr><td colSpan={6} className="text-center py-12 text-slate-500">Loading master feed...</td></tr>
              ) : filteredFeed.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-slate-500">No entries found</td></tr>
              ) : (
                filteredFeed.map((item, idx) => {
                  const cat = categoryColors[item.category] || { bg: "bg-slate-500/20", text: "text-slate-400", label: item.category };
                  return (
                    <motion.tr
                      key={`${item.category}-${item.id}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: idx * 0.02 }}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors"
                      data-testid={`row-feed-${item.category}-${item.id}`}
                    >
                      <td className="px-4 py-3 text-sm text-slate-300 whitespace-nowrap">
                        {item.timestamp ? new Date(item.timestamp).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${cat.bg} ${cat.text}`}>
                          {cat.label}
                        </span>
                        {item.severity && (
                          <span className={`ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold ${
                            item.severity === "high" ? "bg-red-500/20 text-red-400" :
                            item.severity === "medium" ? "bg-amber-500/20 text-amber-400" :
                            "bg-slate-500/20 text-slate-400"
                          }`}>
                            {item.severity}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-white font-medium">{item.name || "—"}</td>
                      <td className="px-4 py-3 text-sm text-slate-400">
                        {item.location || item.email || item.phone || "—"}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {item.account_name ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-400 text-xs font-medium">
                            {item.account_name}
                          </span>
                        ) : (
                          <span className="text-slate-600 text-xs">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/inbox`}>
                          <button className="text-xs px-2 py-1 rounded bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition-colors" data-testid={`button-view-${item.category}-${item.id}`}>
                            View
                          </button>
                        </Link>
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {accounts && accounts.length > 0 && (
        <div className="bg-black/40 border border-white/10 rounded-xl overflow-hidden" data-testid="accounts-overview">
          <div className="p-4 border-b border-white/10">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Shield size={18} className="text-violet-400" />
              Accounts Overview
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left text-xs font-bold text-slate-400 uppercase tracking-wider px-4 py-3">Account</th>
                  <th className="text-left text-xs font-bold text-slate-400 uppercase tracking-wider px-4 py-3">Industry</th>
                  <th className="text-left text-xs font-bold text-slate-400 uppercase tracking-wider px-4 py-3">Plan</th>
                  <th className="text-left text-xs font-bold text-slate-400 uppercase tracking-wider px-4 py-3">Contacts</th>
                  <th className="text-left text-xs font-bold text-slate-400 uppercase tracking-wider px-4 py-3">Messages</th>
                  <th className="text-left text-xs font-bold text-slate-400 uppercase tracking-wider px-4 py-3">Leads</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((acct) => (
                  <tr key={acct.id} className="border-b border-white/5 hover:bg-white/5 transition-colors" data-testid={`row-account-${acct.id}`}>
                    <td className="px-4 py-3 text-sm text-white font-medium">{acct.name}</td>
                    <td className="px-4 py-3 text-sm text-slate-400 capitalize">{acct.industry || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                        acct.plan === "enterprise" ? "bg-violet-500/20 text-violet-400" :
                        acct.plan === "pro" ? "bg-cyan-500/20 text-cyan-400" :
                        "bg-slate-500/20 text-slate-400"
                      }`}>
                        {acct.plan?.toUpperCase() || "STARTER"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-white">{Number(acct.contact_count).toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-white">{Number(acct.message_count).toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-white">{Number(acct.lead_count).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-black/40 border border-orange-500/30 rounded-xl overflow-hidden" data-testid="routing-failures-panel">
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <GitBranch size={18} className="text-orange-400" />
            Routing Failures
            {routingFailuresData && routingFailuresData.total > 0 && (
              <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30">
                {routingFailuresData.total} unresolved
              </span>
            )}
          </h2>
          <button
            onClick={() => refetchRoutingFailures()}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
            data-testid="button-refresh-routing-failures"
          >
            <RefreshCcw size={14} className="text-slate-400" />
          </button>
        </div>
        {!routingFailuresData || routingFailuresData.failures.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm" data-testid="routing-failures-empty">
            No unresolved routing failures. All messages are being routed correctly.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full" data-testid="routing-failures-table">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left text-xs font-bold text-slate-400 uppercase tracking-wider px-4 py-3">Time</th>
                  <th className="text-left text-xs font-bold text-slate-400 uppercase tracking-wider px-4 py-3">Phone</th>
                  <th className="text-left text-xs font-bold text-slate-400 uppercase tracking-wider px-4 py-3">Channel</th>
                  <th className="text-left text-xs font-bold text-slate-400 uppercase tracking-wider px-4 py-3">Reason</th>
                  <th className="text-left text-xs font-bold text-slate-400 uppercase tracking-wider px-4 py-3">Assign to Account</th>
                </tr>
              </thead>
              <tbody>
                {routingFailuresData.failures.map((failure) => (
                  <tr key={failure.id} className="border-b border-white/5 hover:bg-white/5 transition-colors" data-testid={`row-routing-failure-${failure.id}`}>
                    <td className="px-4 py-3 text-sm text-slate-400 whitespace-nowrap">
                      {new Date(failure.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-white font-mono">{failure.phone || "—"}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-orange-500/20 text-orange-400">
                        {failure.channel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-400 max-w-xs truncate" title={failure.reason}>
                      {failure.reason}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="1"
                          placeholder="Account ID"
                          value={resolveInput[failure.id] || ""}
                          onChange={(e) => setResolveInput(prev => ({ ...prev, [failure.id]: e.target.value }))}
                          className="w-28 px-2 py-1 rounded bg-white/5 border border-white/10 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
                          data-testid={`input-resolve-account-${failure.id}`}
                        />
                        <button
                          onClick={() => {
                            const accountId = parseInt(resolveInput[failure.id] || "");
                            if (!isNaN(accountId) && accountId > 0) {
                              resolveFailureMutation.mutate({ id: failure.id, subAccountId: accountId });
                              setResolveInput(prev => { const copy = { ...prev }; delete copy[failure.id]; return copy; });
                            }
                          }}
                          disabled={resolveFailureMutation.isPending}
                          className="px-2 py-1 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 text-xs font-bold transition-colors disabled:opacity-50"
                          data-testid={`button-resolve-failure-${failure.id}`}
                        >
                          Assign
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Batch / Retro Skip Trace ── */}
      <AdminSkipTracePanel />
    </motion.div>
  );
}
