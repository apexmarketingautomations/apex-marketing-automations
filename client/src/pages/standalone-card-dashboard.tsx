import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { Copy, ExternalLink, Users, DollarSign, Clock, CheckCircle, CreditCard, Loader2, ArrowLeft, Pencil, Phone, Mail, UserCheck, NotebookPen } from "lucide-react";

function LeadNotes({ leadId, initial, ownerEmail }: {
  leadId: number;
  initial: string | null;
  ownerEmail: string;
}) {
  const [notes,   setNotes]   = useState(initial || "");
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [editing, setEditing] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const save = async (value: string) => {
    setSaving(true);
    setSaved(false);
    try {
      await fetch(`/api/standalone/lead/${leadId}/notes`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: ownerEmail, notes: value }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* allow-silent-catch: notes save failed silently */ }
    finally { setSaving(false); setEditing(false); }
  };

  if (!editing) {
    return (
      <button
        onClick={() => { setEditing(true); setTimeout(() => taRef.current?.focus(), 50); }}
        className="mt-2 w-full text-left group"
      >
        {notes ? (
          <p className="text-neutral-400 text-xs italic leading-snug group-hover:text-neutral-300 transition-colors">
            📝 {notes}
          </p>
        ) : (
          <p className="text-neutral-600 text-xs flex items-center gap-1 group-hover:text-neutral-400 transition-colors">
            <NotebookPen size={10} /> Add a note — where you met, what they do…
          </p>
        )}
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      <textarea
        ref={taRef}
        value={notes}
        onChange={e => setNotes(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(notes); if (e.key === "Escape") setEditing(false); }}
        placeholder="Where you met, what they do, anything useful…"
        rows={2}
        className="w-full px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-600 text-white text-xs placeholder-neutral-600 outline-none focus:border-cyan-600 resize-none transition-colors"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={() => save(notes)}
          disabled={saving}
          className="px-3 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
        </button>
        <button
          onClick={() => setEditing(false)}
          className="px-3 py-1 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-neutral-300 text-xs transition-colors"
        >
          Cancel
        </button>
        <span className="text-neutral-600 text-[10px] ml-auto">⌘↵ to save</span>
      </div>
    </div>
  );
}

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
              <div className="flex items-center gap-2">
                {card.tier && card.tier !== "base" && (
                  <span data-testid={`badge-tier-${card.id}`} className={`text-xs px-2 py-1 rounded-full font-bold ${
                    card.tier === "pro"
                      ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                      : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                  }`}>
                    {card.tier === "pro" ? "PRO" : "PREMIUM"}
                  </span>
                )}
                <span className={`text-xs px-2 py-1 rounded-full ${card.published ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"}`}>
                  {card.published ? "Live" : "Draft"}
                </span>
              </div>
            </div>
            {card.businessName && <p className="text-neutral-400 text-sm mb-3">{card.businessName}</p>}
            {card.tier && card.tier !== "base" && (
              <div data-testid={`tier-features-${card.id}`} className="mb-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-xs text-neutral-400">
                <p className="font-semibold text-white text-[11px] uppercase tracking-wider mb-1.5">
                  {card.tier === "pro" ? "Pro" : "Premium"} Features Active
                </p>
                <ul className="space-y-1">
                  {card.removeApexBranding && <li>✓ Apex branding removed</li>}
                  {card.premiumSupportFlag && <li>✓ Priority support</li>}
                  <li>✓ Custom accent color</li>
                  <li>✓ Premium themes unlocked</li>
                  {card.tier === "pro" && <li>✓ Advanced layouts</li>}
                </ul>
              </div>
            )}
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
              <button
                data-testid={`button-edit-card-${card.id}`}
                onClick={() => setLocation(`/standalone/edit/${card.editToken}`)}
                className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm transition"
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>
            {copied === `card-${card.id}` && <p className="text-green-400 text-xs mt-1">Copied!</p>}

            {/* ── Leads section ──────────────────────────────────────────── */}
            <div className="mt-4 pt-4 border-t border-neutral-700/50">
              <div className="flex items-center gap-2 mb-3">
                <UserCheck className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-semibold text-white">
                  People Who Left Their Info
                </span>
                {card.leads?.length > 0 && (
                  <span className="ml-auto text-xs bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full font-bold">
                    {card.leads.length} lead{card.leads.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {!card.leads?.length ? (
                <p className="text-neutral-500 text-xs py-2">
                  No one yet — share your card and they'll show up here when someone taps and drops their info.
                </p>
              ) : (
                <div className="space-y-2">
                  {card.leads.map((lead: any) => (
                    <div key={lead.id} className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-700/40">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-cyan-500/15 border border-cyan-500/20 flex items-center justify-center shrink-0 text-sm font-bold text-cyan-300">
                          {lead.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-semibold">{lead.name}</p>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                            {lead.phone && (
                              <a href={`tel:${lead.phone}`} className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors">
                                <Phone size={10} />{lead.phone}
                              </a>
                            )}
                            {lead.email && (
                              <a href={`mailto:${lead.email}`} className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors">
                                <Mail size={10} />{lead.email}
                              </a>
                            )}
                          </div>
                          {lead.message && (
                            <p className="text-neutral-400 text-xs mt-1 italic">"{lead.message}"</p>
                          )}
                        </div>
                        <span className="text-neutral-600 text-[10px] shrink-0 mt-0.5">
                          {new Date(lead.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      {/* Owner notes — editable inline */}
                      <LeadNotes
                        leadId={lead.id}
                        initial={lead.ownerNotes}
                        ownerEmail={data.user.email}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
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
