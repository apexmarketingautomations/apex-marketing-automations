import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "@/hooks/use-account";
import { useAuth } from "@/hooks/use-auth";

interface Contact {
  id: number;
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  county?: string;
  notes?: string;
  tags?: string[];
  createdAt: string;
  // Lifecycle fields (Phase 5)
  identityStatus?: string;
  skipTraceStatus?: string;
  enrichmentProvider?: string;
  enrichmentAttemptedAt?: string;
  leadVertical?: string;
  leadSubtype?: string;
  contactQualityScore?: number;
}

interface PagedResult {
  data: Contact[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Returns structured status based on new skip_trace_status field (with tag fallback for
 * contacts created before the schema upgrade).
 */
function getEnrichmentStatus(c: Contact): { label: string; color: string; icon: string } {
  const sts = c.skipTraceStatus;
  const tags = c.tags || [];

  // Use structured status if available
  if (sts === "matched")       return { label: "Matched", color: "text-green-400",   icon: "✓" };
  if (sts === "no_match")      return { label: "No Match", color: "text-slate-500",  icon: "○" };
  if (sts === "failed")        return { label: "Failed",   color: "text-red-400",    icon: "✗" };
  if (sts === "pending")       return { label: "Pending",  color: "text-yellow-500", icon: "⏳" };
  if (sts === "attempted")     return { label: "Attempted", color: "text-slate-400", icon: "~" };

  // Tag-based fallback for pre-migration contacts
  if (c.phone && tags.includes("skip-traced")) return { label: "Enriched",  color: "text-green-400",   icon: "✓" };
  if (c.phone)                                 return { label: "Has Phone", color: "text-emerald-400", icon: "📞" };
  if (tags.includes("skip-traced"))            return { label: "No Match",  color: "text-slate-500",   icon: "○" };

  return { label: "Not Traced", color: "text-yellow-500", icon: "?" };
}

function getIdentityBadge(c: Contact): { label: string; cls: string } | null {
  const is = c.identityStatus;
  if (is === "verified")      return { label: "Verified", cls: "bg-green-500/15 text-green-400 border-green-500/25" };
  if (is === "placeholder")   return { label: "Raw Incident", cls: "bg-slate-500/15 text-slate-400 border-slate-600/25" };
  if (is === "unidentified")  return { label: "Unidentified", cls: "bg-slate-700/30 text-slate-600 border-slate-700/25" };
  return null;
}

function exportCSV(contacts: Contact[]) {
  const rows = [
    ["Name", "Phone", "Email", "Crash Location", "County", "Enrichment Status", "Date"].join(","),
    ...contacts.map(c => [
      `"${c.firstName} ${c.lastName}"`,
      `"${c.phone || ""}"`,
      `"${c.email || ""}"`,
      `"${(c.address || "").replace(/"/g, '""')}"`,
      `"${(c.city    || "").replace(/"/g, '""')}"`,
      `"${getEnrichmentStatus(c).label}"`,
      `"${new Date(c.createdAt).toLocaleDateString()}"`,
    ].join(","))
  ];
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `crash-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// ── Admin: BatchData skip-trace trigger ────────────────────────────────────────
function AdminSkipTraceButton({ subAccountId }: { subAccountId: number }) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/batch-skip-trace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ subAccountId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || "Failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data.message || "Skip-trace started");
      // Refresh contacts after a short delay so new phones appear
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
        setResult(null);
      }, 8000);
    },
    onError: (err: Error) => {
      setResult(`Error: ${err.message}`);
      setTimeout(() => setResult(null), 5000);
    },
  });

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 text-black font-black text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        title="BatchData skip-trace — enrich crash leads with skip-trace data"
      >
        {mutation.isPending ? "Starting..." : "BatchData Pull"}
      </button>
      {result && (
        <div className={`text-xs px-2 py-1 rounded-lg ${mutation.isError ? "bg-red-500/20 text-red-400" : "bg-orange-500/20 text-orange-300"}`}>
          {result}
        </div>
      )}
    </div>
  );
}

export function CrashLeadsPage() {
  const { currentAccount } = useAccount();
  const { user }           = useAuth();
  const [page, setPage]    = useState(1);
  const [showPhoneOnly, setShowPhoneOnly] = useState(false);
  const LIMIT = 50;

  // Only show admin controls to platform owner / DEV_ADMIN
  const isAdmin = user?.isAdmin === "true" || user?.role === "DEV_ADMIN";

  const { data: result, isLoading } = useQuery<PagedResult>({
    queryKey: ["/api/contacts", currentAccount?.id, "crash-leads-paged", page, showPhoneOnly],
    queryFn: async () => {
      const params = new URLSearchParams({
        tag:   "crash-lead",
        source: "sentinel_crash",
        page:  String(page),
        limit: String(LIMIT),
      });
      if (showPhoneOnly) params.set("hasPhone", "true");
      const res = await fetch(
        `/api/contacts/${currentAccount!.id}?${params}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!currentAccount?.id,
    refetchInterval: 30_000,
  });

  const { data: allResult } = useQuery<PagedResult>({
    queryKey: ["/api/contacts", currentAccount?.id, "crash-leads-all"],
    queryFn: async () => {
      const res = await fetch(
        `/api/contacts/${currentAccount!.id}?tag=crash-lead&source=sentinel_crash&limit=500`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!currentAccount?.id,
  });

  const contacts   = result?.data     ?? [];
  const total      = result?.total    ?? 0;
  const totalPages = result?.totalPages ?? 1;
  const allContacts = allResult?.data  ?? [];

  // Use structured skipTraceStatus when available; fall back to tag-based for pre-migration rows
  const enrichedCount  = allContacts.filter(c =>
    c.skipTraceStatus === "matched" || (!c.skipTraceStatus && c.phone && (c.tags || []).includes("skip-traced"))
  ).length;
  const hasPhonetCount = allContacts.filter(c => !!c.phone).length;
  const pendingCount   = allContacts.filter(c =>
    !c.skipTraceStatus || c.skipTraceStatus === "not_attempted"
  ).length;
  const noMatchCount   = allContacts.filter(c =>
    c.skipTraceStatus === "no_match" || (!c.skipTraceStatus && !c.phone && (c.tags || []).includes("skip-traced"))
  ).length;
  const exhaustedCount = noMatchCount; // alias for old references

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-black text-white">CRASH LEADS</h1>
          <p className="text-slate-400 text-sm mt-1">
            Real-time FL injury crashes · BatchData secondary enrichment
          </p>
          {/* Enrichment status bar */}
          {allResult && (
            <div className="flex items-center gap-3 mt-2 text-xs flex-wrap">
              <span className="text-green-400 font-bold">✓ {enrichedCount} matched</span>
              <span className="text-emerald-400">📞 {hasPhonetCount} with phone</span>
              <span className="text-yellow-500">? {pendingCount} not traced</span>
              <span className="text-slate-600">○ {noMatchCount} no match</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap justify-end">
          {/* Stats */}
          <div className="text-right">
            <div className="text-3xl font-black text-green-400">{total || "—"}</div>
            <div className="text-xs text-slate-500">total crash leads</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-black text-cyan-400">{enrichedCount || "—"}</div>
            <div className="text-xs text-slate-500">with phone</div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-2">
            {/* Full CSV export (admin only — hits server-side route for all accounts) */}
            {isAdmin ? (
              <a
                href="/api/admin/crash-contacts/export"
                download
                className="px-4 py-2 rounded-xl bg-green-500 hover:bg-green-400 text-black font-black text-sm transition-all text-center"
              >
                ⬇ Export All (Admin)
              </a>
            ) : (
              <button
                onClick={() => exportCSV(allContacts)}
                disabled={allContacts.length === 0}
                className="px-4 py-2 rounded-xl bg-green-500 hover:bg-green-400 text-black font-black text-sm transition-all disabled:opacity-40"
              >
                ⬇ Export CSV
              </button>
            )}

            <button
              onClick={() => { setShowPhoneOnly(v => !v); setPage(1); }}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${showPhoneOnly ? "bg-cyan-600 text-white" : "bg-white/10 text-slate-300 hover:bg-white/20"}`}
            >
              {showPhoneOnly ? "Phone Only" : "All Leads"}
            </button>

            {/* BatchData skip-trace pull — crash lead accounts (3, 13, 14) */}
            {isAdmin && currentAccount?.id !== undefined && [3, 13, 14].includes(currentAccount.id) && (
              <AdminSkipTraceButton subAccountId={currentAccount.id} />
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-20 text-slate-500">Loading crash leads...</div>
      ) : contacts.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">📋</div>
          <div className="text-white font-bold text-xl mb-2">No leads found</div>
          <div className="text-slate-500 text-sm">
            BatchData skip-trace runs every 6 hours on street-address crashes.
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-white/10 overflow-hidden mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="text-left px-4 py-3 text-slate-400 font-bold">Name / Crash</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-bold">Phone</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-bold hidden md:table-cell">Location</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-bold">County</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-bold hidden lg:table-cell">Status</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-bold hidden lg:table-cell">Date</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c, i) => {
                  const hasPhone = !!c.phone;
                  const status   = getEnrichmentStatus(c);
                  const idBadge  = getIdentityBadge(c);
                  // Show placeholder display name for unidentified incidents
                  const displayName = c.identityStatus === "verified" || hasPhone
                    ? `${c.firstName} ${c.lastName ?? ""}`.trim()
                    : c.county
                      ? `Crash — ${c.county} County`
                      : c.lastName?.replace(/^— /, "") || "Injury Crash";

                  return (
                    <tr
                      key={c.id}
                      className={`border-b border-white/5 transition-colors ${
                        hasPhone ? "bg-green-500/5 hover:bg-green-500/10" : "hover:bg-white/[0.02]"
                      } ${i % 2 === 0 ? "" : "bg-white/[0.01]"}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                          {idBadge && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${idBadge.cls}`}>
                              {idBadge.label}
                            </span>
                          )}
                        </div>
                        <div className={`font-semibold text-sm ${hasPhone ? "text-white" : "text-slate-400"}`}>
                          {displayName}
                        </div>
                        {c.email && <div className="text-slate-500 text-xs">{c.email}</div>}
                        {c.leadSubtype && (
                          <div className="text-slate-600 text-[10px] uppercase tracking-wide">
                            {c.leadSubtype.replace(/_/g, " ")}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {hasPhone ? (
                          <a href={`tel:${c.phone}`} className="text-green-400 font-mono font-bold hover:text-green-300">
                            {c.phone}
                          </a>
                        ) : (
                          <span className="text-xs text-slate-600 italic">
                            {status.label}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs max-w-[220px] truncate hidden md:table-cell">
                        {c.address}
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-xs">
                        {c.county || c.city?.replace(" County", "")}
                      </td>
                      <td className={`px-4 py-3 text-xs font-bold hidden lg:table-cell ${status.color}`}>
                        <span className="mr-1">{status.icon}</span>{status.label}
                        {c.enrichmentProvider && (
                          <div className="text-[9px] text-slate-600 font-normal">{c.enrichmentProvider}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs hidden lg:table-cell">
                        {new Date(c.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <div className="text-slate-500 text-sm">
                Page {page} of {totalPages} · {total} total leads
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(1)} disabled={page === 1}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-sm disabled:opacity-30 disabled:cursor-not-allowed">«</button>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-sm disabled:opacity-30 disabled:cursor-not-allowed">‹</button>
                {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => {
                  const p = totalPages <= 10 ? i + 1 : Math.max(1, Math.min(page - 4, totalPages - 9)) + i;
                  return (
                    <button key={p} onClick={() => setPage(p)}
                      className={`w-9 h-9 rounded-lg text-sm font-bold transition-all ${p === page ? "bg-cyan-600 text-white" : "bg-white/5 hover:bg-white/10 text-slate-300"}`}>
                      {p}
                    </button>
                  );
                })}
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-sm disabled:opacity-30 disabled:cursor-not-allowed">›</button>
                <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-sm disabled:opacity-30 disabled:cursor-not-allowed">»</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
