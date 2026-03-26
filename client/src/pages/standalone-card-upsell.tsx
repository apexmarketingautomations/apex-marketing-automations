import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { CheckCircle, X, Sparkles, Palette, Headphones, TrendingUp, Loader2 } from "lucide-react";
import { trackEvent } from "../lib/analytics";

export default function StandaloneCardUpsell() {
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("session_id") || "";
    if (!sid) {
      setLocation("/standalone/card");
      return;
    }
    setSessionId(sid);
    trackEvent("upsell_viewed");
  }, [setLocation]);

  const handleAccept = async () => {
    setLoading(true);
    trackEvent("upsell_accepted", { offer: "pro_bundle", amount: 1999 });
    try {
      const res = await fetch("/api/standalone/upsell-accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, offer: "pro_bundle", amount: 1999 }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setLocation(`/standalone/success?session_id=${sessionId}`);
      }
    } catch {
      setLocation(`/standalone/success?session_id=${sessionId}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDecline = async () => {
    trackEvent("upsell_declined", { offer: "pro_bundle" });
    try {
      await fetch("/api/standalone/upsell-decline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, offer: "pro_bundle" }),
      });
    } catch {}
    setLocation(`/standalone/success?session_id=${sessionId}`);
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-white flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-md w-full"
      >
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-green-500/15 flex items-center justify-center mx-auto mb-3">
            <CheckCircle className="w-7 h-7 text-green-400" />
          </div>
          <h2 className="text-lg font-semibold text-green-400 mb-1">Payment Successful!</h2>
          <p className="text-neutral-400 text-sm">Your card is being set up now.</p>
        </div>

        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6 mb-4">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <h3 className="font-bold text-lg">Pro Business Bundle</h3>
          </div>
          <p className="text-neutral-400 text-sm mb-5">
            Everything in Premium plus branding help and setup guidance.
          </p>

          <div className="space-y-3 mb-6">
            {[
              { icon: Palette, text: "Custom branding help" },
              { icon: Headphones, text: "Setup guidance for your business" },
              { icon: TrendingUp, text: "Optimization tips for more leads" },
              { icon: CheckCircle, text: "All Premium features included" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3">
                <item.icon className="w-4 h-4 text-cyan-400 shrink-0" />
                <span className="text-neutral-200 text-sm">{item.text}</span>
              </div>
            ))}
          </div>

          <div className="text-center mb-5">
            <span className="text-3xl font-extrabold text-white">$19.99</span>
            <span className="text-neutral-500 text-sm ml-2">one-time</span>
          </div>

          <button
            data-testid="button-upsell-accept"
            onClick={handleAccept}
            disabled={loading}
            className="w-full py-3.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 text-white font-bold rounded-xl transition shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Add to My Order — $19.99"}
          </button>
        </div>

        <button
          data-testid="button-upsell-decline"
          onClick={handleDecline}
          className="w-full flex items-center justify-center gap-1.5 py-3 text-neutral-500 hover:text-neutral-300 text-sm transition"
        >
          <X className="w-4 h-4" />
          No thanks, take me to my card
        </button>
      </motion.div>
    </div>
  );
}
