import { useState } from "react";
import { useLocation } from "wouter";
import { Copy, ExternalLink, Users, DollarSign, Clock, CheckCircle, CreditCard, Loader2, ArrowLeft } from "lucide-react";

export default function StandaloneCardDashboard() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!email) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/standalone/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.toLowerCase().trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Not found");
        return;
      }
      setData(await res.json());
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const baseUrl = window.location.origin;

  if (!data) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-neutral-950 to-neutral-900 text-white">
        <header className="container mx-auto px-4 py-6">
          <button onClick={() => setLocation("/standalone/card")} className="flex items-center gap-2 text-neutral-400 hover:text-white text-sm">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        </header>
        <main className="container mx-auto px-4 max-w-md py-16">
          <div className="text-center mb-8">
            <CreditCard className="w-10 h-10 text-cyan-400 mx-auto mb-3" />
            <h1 className="text-2xl font-bold mb-2">Your Dashboard</h1>
            <p className="text-neutral-400 text-sm">Enter the email you used to purchase your card</p>
          </div>
          <div className="space-y-4">
            <input
              data-testid="input-dashboard-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
              placeholder="your@email.com"
              className="w-full px-4 py-3 bg-neutral-800 border border-neutral-700 rounded-xl text-white placeholder-neutral-500 focus:outline-none focus:border-cyan-500"
            />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              data-testid="button-dashboard-login"
              onClick={handleLogin}
              disabled={loading || !email}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-white font-semibold rounded-xl transition"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Access Dashboard"}
            </button>
          </div>
        </main>
      </div>
    );
  }

  const { cards, referralCode, referralStats } = data;
  const referralUrl = `${baseUrl}/standalone/card?ref=${referralCode}`;

  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-950 to-neutral-900 text-white">
      <header className="container mx-auto px-4 py-6 flex items-center justify-between">
        <button onClick={() => setLocation("/standalone/card")} className="flex items-center gap-2 text-neutral-400 hover:text-white text-sm">
          <ArrowLeft className="w-4 h-4" /> Home
        </button>
        <span className="text-sm text-neutral-500">Dashboard</span>
      </header>

      <main className="container mx-auto px-4 max-w-lg pb-12">
        <h1 className="text-2xl font-bold mb-6">Welcome back, {data.user.name}</h1>

        {cards.map((card: any) => (
          <div key={card.id} className="bg-neutral-800/50 border border-neutral-700 rounded-2xl p-5 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">{card.fullName}</h3>
              <span className={`text-xs px-2 py-1 rounded-full ${card.published ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"}`}>
                {card.published ? "Live" : "Draft"}
              </span>
            </div>
            {card.businessName && <p className="text-neutral-400 text-sm mb-3">{card.businessName}</p>}
            <div className="flex gap-2">
              <input
                readOnly
                value={`${baseUrl}/standalone/c/${card.slug}`}
                className="flex-1 px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-sm text-neutral-300"
              />
              <button
                onClick={() => copyToClipboard(`${baseUrl}/standalone/c/${card.slug}`, `card-${card.id}`)}
                className="px-3 py-2 bg-cyan-500 hover:bg-cyan-400 rounded-lg text-sm transition"
              >
                <Copy className="w-4 h-4" />
              </button>
              <button
                onClick={() => window.open(`/standalone/c/${card.slug}`, "_blank")}
                className="px-3 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg text-sm transition"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
            </div>
            {copied === `card-${card.id}` && <p className="text-green-400 text-xs mt-1">Copied!</p>}
          </div>
        ))}

        <div className="bg-gradient-to-br from-cyan-950/30 to-blue-950/30 border border-cyan-800/30 rounded-2xl p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-5 h-5 text-cyan-400" />
            <h3 className="font-semibold">Your Referral Link</h3>
          </div>
          <p className="text-neutral-300 text-sm mb-3">
            Earn $10 for every person who buys through your link
          </p>
          <div className="flex gap-2">
            <input
              data-testid="input-referral-link"
              readOnly
              value={referralUrl}
              className="flex-1 px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-sm text-neutral-300"
            />
            <button
              data-testid="button-copy-referral"
              onClick={() => copyToClipboard(referralUrl, "referral")}
              className="px-3 py-2 bg-cyan-500 hover:bg-cyan-400 rounded-lg text-sm transition"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
          {copied === "referral" && <p className="text-green-400 text-xs mt-1">Copied!</p>}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-neutral-800/50 border border-neutral-700 rounded-2xl p-4 text-center">
            <Users className="w-5 h-5 text-cyan-400 mx-auto mb-1" />
            <p data-testid="text-referral-count" className="text-2xl font-bold">{referralStats.totalReferrals}</p>
            <p className="text-neutral-400 text-xs">Referred Sales</p>
          </div>
          <div className="bg-neutral-800/50 border border-neutral-700 rounded-2xl p-4 text-center">
            <DollarSign className="w-5 h-5 text-green-400 mx-auto mb-1" />
            <p className="text-2xl font-bold">${((referralStats.pendingEarnings + referralStats.approvedEarnings + referralStats.paidEarnings) / 100).toFixed(0)}</p>
            <p className="text-neutral-400 text-xs">Total Earned</p>
          </div>
        </div>

        <div className="bg-neutral-800/30 border border-neutral-700/50 rounded-2xl p-5">
          <h3 className="font-semibold mb-3">Commission Breakdown</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Clock className="w-4 h-4 text-yellow-400" />
                <span className="text-neutral-300">Pending</span>
              </div>
              <span data-testid="text-pending-earnings" className="font-medium">${(referralStats.pendingEarnings / 100).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-blue-400" />
                <span className="text-neutral-300">Approved</span>
              </div>
              <span data-testid="text-approved-earnings" className="font-medium">${(referralStats.approvedEarnings / 100).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <DollarSign className="w-4 h-4 text-green-400" />
                <span className="text-neutral-300">Paid</span>
              </div>
              <span data-testid="text-paid-earnings" className="font-medium">${(referralStats.paidEarnings / 100).toFixed(2)}</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
