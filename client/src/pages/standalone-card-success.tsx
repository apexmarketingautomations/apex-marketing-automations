import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { CheckCircle, Copy, ExternalLink, Users, ArrowRight, Loader2 } from "lucide-react";
import { trackEvent } from "../lib/analytics";

export default function StandaloneCardSuccess() {
  const [, setLocation] = useLocation();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (!sessionId) {
      setLocation("/standalone/card");
      return;
    }

    const trackSid = sessionStorage.getItem("standalone_session_id") || crypto.randomUUID();
    sessionStorage.setItem("standalone_session_id", trackSid);
    fetch("/api/standalone/track-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: "success", sessionId: trackSid }),
    }).catch(() => {});

    let attempts = 0;
    const poll = async () => {
      try {
        const res = await fetch(`/api/standalone/session/${sessionId}`);
        const result = await res.json();
        if (result.status === "complete" && result.card) {
          setData(result);
          setLoading(false);
          trackEvent("purchase_completed", { cardSlug: result.card.slug });
          sessionStorage.removeItem("standalone_card_data");
          sessionStorage.removeItem("standalone_ref");
        } else if (attempts < 15) {
          attempts++;
          setTimeout(poll, 2000);
        } else {
          setLoading(false);
        }
      } catch {
        if (attempts < 15) {
          attempts++;
          setTimeout(poll, 2000);
        } else {
          setLoading(false);
        }
      }
    };
    poll();
  }, [setLocation]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const baseUrl = window.location.origin;

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-cyan-400 mx-auto mb-4" />
          <p className="text-lg font-medium">Setting up your card...</p>
          <p className="text-neutral-400 text-sm mt-2">This usually takes just a few seconds</p>
        </div>
      </div>
    );
  }

  if (!data?.card) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold mb-4">Payment Received</h1>
          <p className="text-neutral-400 mb-6">Your card is being set up. Check your dashboard in a moment.</p>
          <button
            onClick={() => setLocation("/standalone/dashboard")}
            className="px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-white font-semibold rounded-xl transition"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const cardUrl = `${baseUrl}/standalone/c/${data.card.slug}`;
  const referralUrl = `${baseUrl}/standalone/card?ref=${data.referralCode}`;

  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-950 to-neutral-900 text-white">
      <main className="container mx-auto px-4 py-12 max-w-lg">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-400" />
          </div>
          <h1 data-testid="text-success-title" className="text-3xl font-bold mb-2">Your Card is Live!</h1>
          <p className="text-neutral-400">Share it with your customers and start getting leads</p>
        </div>

        <div className="space-y-4">
          <div className="bg-neutral-800/50 border border-neutral-700 rounded-2xl p-5">
            <label className="text-sm text-neutral-400 mb-2 block">Your Card Link</label>
            <div className="flex gap-2">
              <input
                data-testid="input-card-url"
                readOnly
                value={cardUrl}
                className="flex-1 px-4 py-2.5 bg-neutral-900 border border-neutral-700 rounded-xl text-white text-sm"
              />
              <button
                data-testid="button-copy-card-url"
                onClick={() => copyToClipboard(cardUrl, "card")}
                className="px-4 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-white rounded-xl transition flex items-center gap-1"
              >
                <Copy className="w-4 h-4" />
                {copied === "card" ? "Copied!" : "Copy"}
              </button>
            </div>
            <button
              data-testid="button-view-card"
              onClick={() => window.open(cardUrl, "_blank")}
              className="flex items-center gap-2 text-cyan-400 hover:text-cyan-300 text-sm mt-3 transition"
            >
              <ExternalLink className="w-4 h-4" /> View your card
            </button>
          </div>

          <div className="bg-gradient-to-br from-cyan-950/30 to-blue-950/30 border border-cyan-800/30 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-5 h-5 text-cyan-400" />
              <h3 className="font-semibold">Earn $10 Per Referral</h3>
            </div>
            <p className="text-neutral-300 text-sm mb-4">
              Every business owner who buys through your link earns you $10.
              Share your referral link below.
            </p>
            <div className="flex gap-2">
              <input
                data-testid="input-referral-url"
                readOnly
                value={referralUrl}
                className="flex-1 px-4 py-2.5 bg-neutral-900 border border-neutral-700 rounded-xl text-white text-sm"
              />
              <button
                data-testid="button-copy-referral-url"
                onClick={() => copyToClipboard(referralUrl, "referral")}
                className="px-4 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-white rounded-xl transition flex items-center gap-1"
              >
                <Copy className="w-4 h-4" />
                {copied === "referral" ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          <div className="bg-neutral-800/30 border border-neutral-700/50 rounded-2xl p-5">
            <h3 className="font-semibold mb-2">What's Next?</h3>
            <ul className="space-y-2 text-sm text-neutral-300">
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                Share your card link with customers
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                Add it to your email signature
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                Share your referral link and earn commissions
              </li>
            </ul>
          </div>

          <div className="bg-neutral-800/20 border border-neutral-700/30 rounded-2xl p-5">
            <p className="text-neutral-400 text-sm italic">
              Want this to automatically respond to leads and book customers for you?
            </p>
            <p className="text-cyan-400 text-sm mt-1">Coming soon — Apex Marketing Automation</p>
          </div>

          <button
            data-testid="button-go-dashboard"
            onClick={() => setLocation("/standalone/dashboard")}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl transition mt-4"
          >
            Go to Dashboard <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </main>
    </div>
  );
}
