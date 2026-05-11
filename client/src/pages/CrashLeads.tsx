import { useQuery } from "@tanstack/react-query";
import { useAccount } from "@/hooks/use-account";

interface Contact {
  id: number;
  firstName: string;
  lastName: string;
  phone?: string;
  address?: string;
  city?: string;
  notes?: string;
  tags?: string[];
  createdAt: string;
}

function exportCSV(contacts: Contact[]) {
  const rows = [
    ["Name", "Phone", "Address", "County", "Date"].join(","),
    ...contacts.map(c => [
      `"${c.firstName} ${c.lastName}"`,
      `"${c.phone || ""}"`,
      `"${c.address || ""}"`,
      `"${c.city || ""}"`,
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

  const { data: allLeads = [], isLoading } = useQuery<Contact[]>({
    queryKey: ["/api/contacts", currentAccount?.id, "crash-has-phone"],
    queryFn: async () => {
      const res = await fetch(
        `/api/contacts/${currentAccount!.id}?tag=crash-lead&hasPhone=true`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!currentAccount?.id,
    refetchInterval: 60_000,
  });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-black text-white">CRASH LEADS</h1>
          <p className="text-slate-400 text-sm mt-1">
            Real names + phone numbers from FL accidents
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-3xl font-black text-green-400">{allLeads.length}</div>
            <div className="text-xs text-slate-500">with phone numbers</div>
          </div>
          <button
            onClick={() => exportCSV(allLeads)}
            disabled={allLeads.length === 0}
            className="px-5 py-2.5 rounded-xl bg-green-500 hover:bg-green-400 text-black font-black text-sm transition-all disabled:opacity-40"
          >
            ⬇ Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-20 text-slate-500">Loading...</div>
      ) : allLeads.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">📋</div>
          <div className="text-white font-bold text-xl mb-2">No leads with phone numbers yet</div>
          <div className="text-slate-500 text-sm">
            Skip trace runs automatically every 6 hours.<br/>
            Leads with addresses near property records will populate here.
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="text-left px-4 py-3 text-slate-400 font-bold">Name</th>
                <th className="text-left px-4 py-3 text-slate-400 font-bold">Phone</th>
                <th className="text-left px-4 py-3 text-slate-400 font-bold">Location</th>
                <th className="text-left px-4 py-3 text-slate-400 font-bold">County</th>
                <th className="text-left px-4 py-3 text-slate-400 font-bold">Date</th>
              </tr>
            </thead>
            <tbody>
              {allLeads.map((c, i) => (
                <tr
                  key={c.id}
                  className={`border-b border-white/5 hover:bg-white/5 transition-colors ${i % 2 === 0 ? "" : "bg-white/[0.02]"}`}
                >
                  <td className="px-4 py-3 text-white font-semibold">
                    {c.firstName} {c.lastName}
                  </td>
                  <td className="px-4 py-3">
                    <a href={`tel:${c.phone}`} className="text-green-400 font-mono font-bold hover:text-green-300">
                      {c.phone}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs max-w-[200px] truncate">
                    {c.address}
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-xs">
                    {c.city?.replace(" County", "")}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {new Date(c.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
