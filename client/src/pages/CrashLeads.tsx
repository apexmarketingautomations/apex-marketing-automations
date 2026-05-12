import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "@/hooks/use-account";

interface Contact {
  id: number;
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  notes?: string;
  tags?: string[];
  createdAt: string;
}

interface PagedResult {
  data: Contact[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function exportCSV(contacts: Contact[]) {
  const rows = [
    ["Name", "Phone", "Email", "Crash Location", "County", "Phone Status", "Date"].join(","),
    ...contacts.map(c => [
      `"${c.firstName} ${c.lastName}"`,
      `"${c.phone || ""}"`,
      `"${c.email || ""}"`,
      `"${c.address || ""}"`,
      `"${c.city || ""}"`,
      `"${c.phone ? "Confirmed" : "Pending Skip-Trace"}"`,
      `"${new Date(c.createdAt).toLocaleDateString()}"`,
    ].join(","))
  ];
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `crash-leads-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

export function CrashLeadsPage() {
  const { currentAccount } = useAccount();
  const [page, setPage] = useState(1);
  const [showPhoneOnly, setShowPhoneOnly] = useState(false);
  const LIMIT = 50;

  const { data: result, isLoading } = useQuery<PagedResult>({
    queryKey: ["/api/contacts", currentAccount?.id, "crash-leads-paged", page, showPhoneOnly],
    queryFn: async () => {
      const params = new URLSearchParams({
        tag: "crash-lead",
        source: "sentinel_crash",
        page: String(page),
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

  // Fetch all for CSV export
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

  const contacts = result?.data ?? [];
  const total = result?.total ?? 0;
  const totalPages = result?.totalPages ?? 1;
  const withPhone = contacts.filter(c => c.phone).length;
  const allContacts = allResult?.data ?? [];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-black text-white">CRASH LEADS</h1>
          <p className="text-slate-400 text-sm mt-1">
            Real-time FL injury crashes · BatchData skip-trace running
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-3xl font-black text-green-400">{result?.total ?? "—"}</div>
            <div className="text-xs text-slate-500">total crash leads</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-black text-cyan-400">
              {allResult ? allContacts.filter(c => c.phone).length : "—"}
            </div>
            <div className="text-xs text-slate-500">with phone</div>
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => exportCSV(allContacts)}
              disabled={allContacts.length === 0}
              className="px-4 py-2 rounded-xl bg-green-500 hover:bg-green-400 text-black font-black text-sm transition-all disabled:opacity-40"
            >
              ⬇ Export CSV
            </button>
            <button
              onClick={() => { setShowPhoneOnly(v => !v); setPage(1); }}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${showPhoneOnly ? "bg-cyan-600 text-white" : "bg-white/10 text-slate-300 hover:bg-white/20"}`}
            >
              {showPhoneOnly ? "📞 Phone Only" : "All Leads"}
            </button>
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
            Skip trace runs every 6 hours on street-address crashes.
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
                  <th className="text-left px-4 py-3 text-slate-400 font-bold hidden lg:table-cell">Date</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c, i) => {
                  const hasPhone = !!c.phone;
                  return (
                    <tr
                      key={c.id}
                      className={`border-b border-white/5 transition-colors ${hasPhone ? "bg-green-500/5 hover:bg-green-500/10" : "hover:bg-white/[0.02]"} ${i % 2 === 0 ? "" : "bg-white/[0.01]"}`}
                    >
                      <td className="px-4 py-3">
                        <div className="text-white font-semibold text-sm">
                          {hasPhone ? `${c.firstName} ${c.lastName}` : c.lastName?.replace(/^[A-Z]+ — /, "") || "Injury Crash"}
                        </div>
                        {c.email && <div className="text-slate-500 text-xs">{c.email}</div>}
                      </td>
                      <td className="px-4 py-3">
                        {hasPhone ? (
                          <a href={`tel:${c.phone}`} className="text-green-400 font-mono font-bold hover:text-green-300">
                            {c.phone}
                          </a>
                        ) : (
                          <span className="text-xs text-slate-600 italic">Skip-tracing...</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs max-w-[220px] truncate hidden md:table-cell">
                        {c.address}
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-xs">
                        {c.city?.replace(" County", "")}
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
                <button
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-sm disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  «
                </button>
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-sm disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ‹
                </button>
                {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => {
                  const p = totalPages <= 10 ? i + 1 : Math.max(1, Math.min(page - 4, totalPages - 9)) + i;
                  return (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`w-9 h-9 rounded-lg text-sm font-bold transition-all ${p === page ? "bg-cyan-600 text-white" : "bg-white/5 hover:bg-white/10 text-slate-300"}`}
                    >
                      {p}
                    </button>
                  );
                })}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-sm disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ›
                </button>
                <button
                  onClick={() => setPage(totalPages)}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-sm disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  »
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
