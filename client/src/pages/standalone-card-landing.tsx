import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Smartphone, Share2, Zap, CreditCard, Star, Users, CheckCircle } from "lucide-react";

export default function StandaloneCardLanding() {
  const [, setLocation] = useLocation();
  const [promo, setPromo] = useState<any>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) {
      sessionStorage.setItem("standalone_ref", ref);
    }
    fetch("/api/standalone/promo-status")
      .then(r => r.json())
      .then(setPromo)
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-950 via-neutral-900 to-neutral-950 text-white">
      <header className="container mx-auto px-4 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="w-6 h-6 text-cyan-400" />
          <span className="font-bold text-lg">Digital Card</span>
        </div>
        <button
          data-testid="link-dashboard"
          onClick={() => setLocation("/standalone/dashboard")}
          className="text-sm text-neutral-400 hover:text-white transition"
        >
          My Dashboard
        </button>
      </header>

      <main className="container mx-auto px-4">
        <section className="py-16 md:py-24 text-center max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 data-testid="text-headline" className="text-4xl md:text-6xl font-bold leading-tight mb-6">
              Replace Your Business Cards{" "}
              <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">Instantly</span>
            </h1>
            <p data-testid="text-subheadline" className="text-lg md:text-xl text-neutral-300 mb-10 max-w-2xl mx-auto">
              Create a digital business card people can tap, save, share, and keep.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="flex flex-col sm:flex-row gap-4 justify-center mb-12"
          >
            <button
              data-testid="button-create-card"
              onClick={() => setLocation("/standalone/create")}
              className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold rounded-xl text-lg transition shadow-lg shadow-cyan-500/20"
            >
              Create Yours Now <ArrowRight className="w-5 h-5" />
            </button>
          </motion.div>

          {promo && promo.promoActive && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.5 }}
              className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500/10 border border-amber-500/30 rounded-full text-amber-400 text-sm font-medium"
              data-testid="text-promo-badge"
            >
              <Star className="w-4 h-4" />
              First {promo.spotsTotal} people get 50% off — {promo.spotsLeft} spots left
            </motion.div>
          )}
        </section>

        <section className="py-16 max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: Smartphone, title: "Saves to Their Phone", desc: "Your contact info goes straight into someone's contacts" },
              { icon: Share2, title: "Share Anywhere", desc: "Tap, text, AirDrop, or DM your card to anyone" },
              { icon: Zap, title: "Built in Minutes", desc: "Fill out a simple form, pay once, and your card is live" },
              { icon: CheckCircle, title: "All Your Info", desc: "Phone, email, website, reviews, booking, and social links" },
              { icon: Users, title: "Earn Referrals", desc: "Share your referral link and earn $10 for every sale" },
              { icon: Star, title: "Premium Design", desc: "Clean, modern, mobile-first card that makes you look great" },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.1 }}
                className="bg-neutral-800/50 border border-neutral-700/50 rounded-2xl p-6"
              >
                <item.icon className="w-8 h-8 text-cyan-400 mb-3" />
                <h3 className="font-semibold text-lg mb-2">{item.title}</h3>
                <p className="text-neutral-400 text-sm">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="py-16 text-center max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold mb-4">No Paper. No Getting Thrown Away.</h2>
          <p className="text-neutral-400 mb-8">
            Your digital card lives online forever. One link. All your info.
            Always up to date.
          </p>

          {promo && (
            <div className="bg-neutral-800/80 border border-neutral-700 rounded-2xl p-8 mb-8">
              <p className="text-neutral-400 text-sm mb-2">One-time purchase</p>
              {promo.promoActive ? (
                <div className="flex items-center justify-center gap-4 mb-4">
                  <span className="text-neutral-500 line-through text-2xl">${(promo.regularPrice / 100).toFixed(0)}</span>
                  <span className="text-4xl font-bold text-white">${(promo.promoPrice / 100).toFixed(2)}</span>
                </div>
              ) : (
                <div className="text-4xl font-bold text-white mb-4">${(promo.regularPrice / 100).toFixed(0)}</div>
              )}
              <ul className="text-left text-neutral-300 space-y-2 mb-6 max-w-xs mx-auto text-sm">
                {["Your own digital business card", "Save contact button", "Call, text, email links", "Social media links", "Review & booking links", "QR code sharing", "Your own referral link"].map((item, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-cyan-400 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <button
                data-testid="button-create-card-cta"
                onClick={() => setLocation("/standalone/create")}
                className="w-full px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold rounded-xl transition"
              >
                Create Yours Now
              </button>
            </div>
          )}
        </section>
      </main>

      <footer className="border-t border-neutral-800 py-8 text-center text-neutral-500 text-sm">
        <p>Digital Business Cards by Apex</p>
      </footer>
    </div>
  );
}
