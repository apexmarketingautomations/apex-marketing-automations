import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft, Search, Users, CreditCard as CardIcon, ShoppingCart,
  DollarSign, CheckCircle, Clock, Loader2, RefreshCw
} from "lucide-react";

function AdminLogin({ onLogin }: { onLogin: (secret: string) => void }) {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (s: string) => {
    if (!s) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/standalone/admin/stats", {
        headers: { "x-admin-secret": s, "Content-Type": "application/json" },
      });
      if (res.ok) {
        onLogin(s);
      } else {
        setError("Invalid admin secret");
      }
    } catch {
      setError("Connection error");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center px-4">
      <div className="max-w-sm w-full">
        <h1 className="text-2xl font-bold mb-6 text-center">Admin Access</h1>
        <input
          data-testid="input-admin-secret"
          type="password"
          value={secret}
          onChange={e => setSecret(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleLogin(secret)}
          placeholder="Admin secret"
          className="w-full px-4 py-3 bg-neutral-800 border border-neutral-700 rounded-xl text-white mb-4"
        />
        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
        <button
          data-testid="button-admin-login"
          onClick={() => handleLogin(secret)}
          disabled={loading}
          className="w-full px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-white font-semibold rounded-xl transition disabled:opacity-50"
        >
          {loading ? "Verifying..." : "Login"}
        </button>
      </div>
    </div>
  );
}

export default function StandaloneCardAdmin() {
  const [, setLocation] = useLocation();
  const [secret, setSecret] = useState(sessionStorage.getItem("standalone_admin_secret") || "");
  const [tab, setTab] = useState<"orders" | "referrals" | "users" | "cards">("orders");
  const [stats, setStats] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [referrals, setReferrals] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [cards, setCards] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const headers = { "x-admin-secret": secret, "Content-Type": "application/json" };

  const loadData = useCallback(async () => {
    if (!secret) return;
    setLoading(true);
    try {
      const [statsRes, ordersRes, referralsRes, usersRes, cardsRes] = await Promise.all([
        fetch("/api/standalone/admin/stats", { headers }),
        fetch(`/api/standalone/admin/orders?search=${encodeURIComponent(search)}`, { headers }),
        fetch("/api/standalone/admin/referrals", { headers }),
        fetch("/api/standalone/admin/users", { headers }),
        fetch("/api/standalone/admin/cards", { headers }),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (ordersRes.ok) setOrders(await ordersRes.json());
      if (referralsRes.ok) setReferrals(await referralsRes.json());
      if (usersRes.ok) setUsers(await usersRes.json());
      if (cardsRes.ok) setCards(await cardsRes.json());
    } catch {}
    setLoading(false);
  }, [secret, search]);

  useEffect(() => {
    if (secret) {
      sessionStorage.setItem("standalone_admin_secret", secret);
      loadData();
    }
  }, [secret, loadData]);

  const handleApprove = async (id: number) => {
    await fetch(`/api/standalone/admin/referrals/${id}/approve`, { method: "POST", headers });
    loadData();
  };

  const handlePay = async (id: number) => {
    await fetch(`/api/standalone/admin/referrals/${id}/pay`, { method: "POST", headers });
    loadData();
  };

  if (!secret) return <AdminLogin onLogin={setSecret} />;

  const tabClass = (t: string) =>
    `px-4 py-2 rounded-lg text-sm font-medium transition ${tab === t ? "bg-cyan-500 text-white" : "bg-neutral-800 text-neutral-400 hover:text-white"}`;

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <header className="border-b border-neutral-800 px-4 py-4">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => setLocation("/standalone/card")} className="text-neutral-400 hover:text-white">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-bold">Card Admin</h1>
          </div>
          <button onClick={loadData} className="text-neutral-400 hover:text-white">
            <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-5xl">
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <div className="bg-neutral-800/50 border border-neutral-700 rounded-xl p-4 text-center">
              <Users className="w-5 h-5 text-cyan-400 mx-auto mb-1" />
              <p className="text-xl font-bold">{stats.users}</p>
              <p className="text-neutral-400 text-xs">Users</p>
            </div>
            <div className="bg-neutral-800/50 border border-neutral-700 rounded-xl p-4 text-center">
              <CardIcon className="w-5 h-5 text-blue-400 mx-auto mb-1" />
              <p className="text-xl font-bold">{stats.cards}</p>
              <p className="text-neutral-400 text-xs">Cards</p>
            </div>
            <div className="bg-neutral-800/50 border border-neutral-700 rounded-xl p-4 text-center">
              <ShoppingCart className="w-5 h-5 text-green-400 mx-auto mb-1" />
              <p className="text-xl font-bold">{stats.paidOrders}</p>
              <p className="text-neutral-400 text-xs">Paid Orders</p>
            </div>
            <div className="bg-neutral-800/50 border border-neutral-700 rounded-xl p-4 text-center">
              <Users className="w-5 h-5 text-purple-400 mx-auto mb-1" />
              <p className="text-xl font-bold">{stats.referrals}</p>
              <p className="text-neutral-400 text-xs">Referrals</p>
            </div>
            <div className="bg-neutral-800/50 border border-neutral-700 rounded-xl p-4 text-center">
              <DollarSign className="w-5 h-5 text-green-400 mx-auto mb-1" />
              <p className="text-xl font-bold">${(stats.totalRevenue / 100).toFixed(0)}</p>
              <p className="text-neutral-400 text-xs">Revenue</p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-4">
          <button className={tabClass("orders")} onClick={() => setTab("orders")}>Orders</button>
          <button className={tabClass("referrals")} onClick={() => setTab("referrals")}>Referrals</button>
          <button className={tabClass("users")} onClick={() => setTab("users")}>Users</button>
          <button className={tabClass("cards")} onClick={() => setTab("cards")}>Cards</button>
        </div>

        {tab === "orders" && (
          <>
            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 w-4 h-4 text-neutral-500" />
                <input
                  data-testid="input-admin-search"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && loadData()}
                  placeholder="Search by email or name..."
                  className="w-full pl-10 pr-4 py-2.5 bg-neutral-800 border border-neutral-700 rounded-xl text-white text-sm"
                />
              </div>
            </div>
            <div className="space-y-2">
              {orders.map((o: any) => (
                <div key={o.id} className="bg-neutral-800/50 border border-neutral-700 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-sm">{o.user?.name} ({o.user?.email})</p>
                    <p className="text-neutral-400 text-xs">
                      ${(o.amount / 100).toFixed(2)} · {o.paymentStatus} · {new Date(o.createdAt).toLocaleDateString()}
                    </p>
                    {o.referralCodeUsed && <p className="text-cyan-400 text-xs">Ref: {o.referralCodeUsed}</p>}
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${o.paymentStatus === "paid" ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"}`}>
                    {o.paymentStatus}
                  </span>
                </div>
              ))}
              {orders.length === 0 && <p className="text-neutral-500 text-center py-8">No orders found</p>}
            </div>
          </>
        )}

        {tab === "referrals" && (
          <div className="space-y-2">
            {referrals.map((r: any) => (
              <div key={r.id} className="bg-neutral-800/50 border border-neutral-700 rounded-xl p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-sm">{r.referrer?.name} → {r.referred?.name}</p>
                    <p className="text-neutral-400 text-xs">
                      ${(r.commissionAmount / 100).toFixed(2)} · {new Date(r.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      r.status === "paid" ? "bg-green-500/20 text-green-400" :
                      r.status === "approved" ? "bg-blue-500/20 text-blue-400" :
                      "bg-yellow-500/20 text-yellow-400"
                    }`}>
                      {r.status}
                    </span>
                    {r.status === "pending" && (
                      <button onClick={() => handleApprove(r.id)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs transition">
                        Approve
                      </button>
                    )}
                    {r.status === "approved" && (
                      <button onClick={() => handlePay(r.id)} className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded-lg text-xs transition">
                        Mark Paid
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {referrals.length === 0 && <p className="text-neutral-500 text-center py-8">No referrals yet</p>}
          </div>
        )}

        {tab === "users" && (
          <div className="space-y-2">
            {users.map((u: any) => (
              <div key={u.id} className="bg-neutral-800/50 border border-neutral-700 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{u.name}</p>
                  <p className="text-neutral-400 text-xs">{u.email} · {u.phone || "No phone"}</p>
                </div>
                <span className="text-neutral-500 text-xs">{new Date(u.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
            {users.length === 0 && <p className="text-neutral-500 text-center py-8">No users yet</p>}
          </div>
        )}

        {tab === "cards" && (
          <div className="space-y-2">
            {cards.map((c: any) => (
              <div key={c.id} className="bg-neutral-800/50 border border-neutral-700 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{c.fullName}</p>
                  <p className="text-neutral-400 text-xs">{c.businessName || "No business"} · /{c.slug}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-full ${c.published ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"}`}>
                    {c.published ? "Live" : "Draft"}
                  </span>
                  <a href={`/standalone/c/${c.slug}`} target="_blank" className="text-cyan-400 text-xs hover:text-cyan-300">View</a>
                </div>
              </div>
            ))}
            {cards.length === 0 && <p className="text-neutral-500 text-center py-8">No cards yet</p>}
          </div>
        )}
      </main>
    </div>
  );
}
