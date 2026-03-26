import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Smartphone, RefreshCw, Briefcase, Star, CheckCircle, CreditCard, Users } from "lucide-react";

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
            <p data-testid="text-hook" className="text-lg md:text-xl text-red-400 font-semibold mb-4">
              Most business cards get thrown away.
            </p>
            <h1 data-testid="text-headline" className="text-3xl md:text-5xl font-bold leading-tight mb-6">
              Stop wasting money on something{" "}
              <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">people don't keep.</span>
            </h1>
            <p data-testid="text-subheadline" className="text-lg md:text-xl text-neutral-300 mb-10 max-w-2xl mx-auto">
              Create a <strong>digital business card</strong> that people can save instantly, share anywhere, and never lose.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="space-y-6"
          >
            <div className="flex flex-col sm:flex-row gap-5 justify-center text-left max-w-md mx-auto">
              <div className="flex items-center gap-3">
                <Smartphone className="w-6 h-6 text-cyan-400 shrink-0" />
                <span className="text-neutral-200">Tap to share in seconds</span>
              </div>
              <div className="flex items-center gap-3">
                <RefreshCw className="w-6 h-6 text-cyan-400 shrink-0" />
                <span className="text-neutral-200">Update anytime</span>
              </div>
              <div className="flex items-center gap-3">
                <Briefcase className="w-6 h-6 text-cyan-400 shrink-0" />
                <span className="text-neutral-200">Look more professional instantly</span>
              </div>
            </div>

            <button
              data-testid="button-create-card"
              onClick={() => setLocation("/standalone/create")}
              className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold rounded-xl text-lg transition shadow-lg shadow-cyan-500/20"
            >
              Get Yours Set Up in Minutes <ArrowRight className="w-5 h-5" />
            </button>
          </motion.div>

          {promo && promo.promoActive && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-6 inline-flex items-center gap-2 px-6 py-3 bg-amber-500/10 border border-amber-500/30 rounded-full text-amber-400 text-sm font-medium"
              data-testid="text-promo-badge"
            >
              <Star className="w-4 h-4" />
              First {promo.spotsTotal} people get 50% off — {promo.spotsLeft} spots left
            </motion.div>
          )}
        </section>

        <section className="py-12 max-w-2xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            {promo && (
              <div className="bg-neutral-800/80 border border-neutral-700 rounded-2xl p-8 mb-8">
                <p className="text-neutral-400 text-sm mb-2 text-center">One-time payment</p>
                {promo.promoActive ? (
                  <>
                    <div className="flex items-center justify-center gap-4 mb-2">
                      <span className="text-neutral-500 line-through text-2xl">${(promo.regularPrice / 100).toFixed(0)}</span>
                      <span className="text-4xl font-bold text-white">${(promo.promoPrice / 100).toFixed(2)}</span>
                    </div>
                    <p className="text-amber-400 text-sm font-medium text-center mb-6">Limited-time launch price — lock it in before it goes back to ${(promo.regularPrice / 100).toFixed(0)}.</p>
                  </>
                ) : (
                  <div className="text-4xl font-bold text-white mb-6 text-center">${(promo.regularPrice / 100).toFixed(0)}</div>
                )}

                <div className="space-y-3 mb-6">
                  {[
                    "No monthly fees",
                    "One-time payment",
                    "Works instantly after setup",
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
                      <span className="text-neutral-200 font-medium">{item}</span>
                    </div>
                  ))}
                </div>

                <div className="border-t border-neutral-700 pt-6 mb-6">
                  <ul className="text-left text-neutral-300 space-y-2 text-sm">
                    {[
                      "Your own digital business card",
                      "Save contact button",
                      "Call, text, email links",
                      "Social media links",
                      "Review & booking links",
                      "QR code sharing",
                      "Your own referral link",
                    ].map((item, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-cyan-400 shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  data-testid="button-create-card-cta"
                  onClick={() => setLocation("/standalone/create")}
                  className="w-full px-6 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold rounded-xl text-lg transition shadow-lg shadow-cyan-500/20"
                >
                  Get Your Card Now
                </button>
              </div>
            )}
          </motion.div>
        </section>

        <section className="py-12 max-w-2xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="bg-neutral-800/30 border border-neutral-700/50 rounded-2xl p-8 text-center"
          >
            <Users className="w-8 h-8 text-cyan-400 mx-auto mb-4" />
            <p className="text-neutral-300 text-lg">
              Used by <strong className="text-white">entrepreneurs, freelancers, and small business owners</strong> to modernize how they connect.
            </p>
          </motion.div>
        </section>
      </main>

      <footer className="border-t border-neutral-800 py-8 text-center text-neutral-500 text-sm">
        <p>Digital Business Cards by Apex</p>
      </footer>
    </div>
  );
}
