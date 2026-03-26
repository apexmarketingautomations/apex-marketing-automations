import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowRight, Smartphone, RefreshCw, Briefcase, Star, CheckCircle,
  CreditCard, QrCode, Share2, Zap, Send, Shield, Clock, HelpCircle,
  ChevronDown, MessageSquare
} from "lucide-react";
import { trackEvent } from "../lib/analytics";

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-white/[0.06]">
      <button
        data-testid={`faq-${q.slice(0, 20).replace(/\s+/g, "-").toLowerCase()}`}
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-4 text-left"
      >
        <span className="text-white font-medium text-sm pr-4">{q}</span>
        <ChevronDown className={`w-4 h-4 text-neutral-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <p className="text-neutral-400 text-sm pb-4 leading-relaxed">{a}</p>}
    </div>
  );
}

export default function StandaloneCardLanding() {
  const [, setLocation] = useLocation();
  const [promo, setPromo] = useState<any>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) {
      sessionStorage.setItem("standalone_ref", ref);
      trackEvent("referral_captured", { code: ref });
    }
    trackEvent("landing_page_view");
    fetch("/api/standalone/promo-status").then(r => r.json()).then(setPromo).catch(() => {});
  }, []);

  const goCreate = () => setLocation("/standalone/create");
  const price = promo?.promoActive
    ? `$${(promo.promoPrice / 100).toFixed(2)}`
    : promo ? `$${(promo.regularPrice / 100).toFixed(0)}` : "$24.50";

  return (
    <div className="min-h-screen bg-[#09090b] text-white">
      <header className="container mx-auto px-4 py-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img src="/apex-logo.png" alt="Apex" className="w-8 h-8 rounded-lg object-contain" />
          <span className="font-bold text-base tracking-tight">Apex Digital Card</span>
        </div>
        <button data-testid="link-dashboard" onClick={() => setLocation("/standalone/dashboard")}
          className="text-sm text-neutral-500 hover:text-white transition">
          My Dashboard
        </button>
      </header>

      <main>
        <section className="container mx-auto px-4 pt-16 pb-12 md:pt-24 md:pb-16 text-center max-w-3xl">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <p data-testid="text-hook" className="text-sm md:text-base text-neutral-400 font-medium mb-3 tracking-wide uppercase">
              Paper cards get lost. Yours won't.
            </p>
            <h1 data-testid="text-headline" className="text-3xl sm:text-4xl md:text-[3.25rem] font-extrabold leading-[1.15] mb-5">
              One digital card people can{" "}
              <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                save directly to their contacts
              </span>
              {" "}— so they never lose your info.
            </h1>
            <p data-testid="text-subheadline" className="text-base md:text-lg text-neutral-300 mb-8 max-w-xl mx-auto leading-relaxed">
              Create a mobile-friendly business card people actually save. Share by text, QR code, AirDrop, or DM. Update it anytime. Pay once.
            </p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
            className="flex flex-col items-center gap-3">
            <button data-testid="button-create-card" onClick={goCreate}
              className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold rounded-xl text-lg transition shadow-lg shadow-cyan-500/25">
              Create Yours Now <ArrowRight className="w-5 h-5" />
            </button>
            <span className="text-neutral-400 text-xs">Instantly saves to their contact list — no more lost business cards</span>
          </motion.div>

          {promo?.promoActive && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.45 }}
              data-testid="text-promo-badge"
              className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500/10 border border-amber-500/30 rounded-full text-amber-400 text-sm font-medium">
              <Star className="w-4 h-4" />
              Limited-time launch price — lock it in before it goes back to ${(promo.regularPrice / 100).toFixed(0)}.
            </motion.div>
          )}
        </section>

        <section className="container mx-auto px-4 py-14 max-w-4xl">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-10">
            Why go digital?
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: Smartphone, title: "Tap to Share", desc: "Text it, AirDrop it, or let someone scan your QR. No app needed." },
              { icon: RefreshCw, title: "Always Up to Date", desc: "Changed your number or role? Update your card anytime — it's always current." },
              { icon: Briefcase, title: "Look Professional", desc: "Clean, modern design that works on any phone. First impressions matter." },
              { icon: Share2, title: "Share Anywhere", desc: "Works in texts, DMs, emails, social bios, and printed QR codes." },
              { icon: Zap, title: "Built in Minutes", desc: "Fill out a simple form. Your card goes live right after payment." },
              { icon: Shield, title: "No Subscription", desc: "One payment. Your card stays live. No monthly fees, ever." },
            ].map((item, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.07 }}
                className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5"
              >
                <item.icon className="w-7 h-7 text-cyan-400 mb-3" />
                <h3 className="font-semibold text-[15px] mb-1.5">{item.title}</h3>
                <p className="text-neutral-400 text-sm leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="container mx-auto px-4 py-14 max-w-2xl">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-2">What you get</h2>
          <p className="text-neutral-400 text-center text-sm mb-8">Everything in one card. Nothing to install.</p>
          <div className="space-y-3">
            {[
              { icon: CreditCard, text: "Your own digital business card with a unique link" },
              { icon: Send, text: "One-tap save to contacts — your info goes straight into their phone like a real contact" },
              { icon: MessageSquare, text: "Call, text, and email buttons" },
              { icon: Share2, text: "Social media links — Instagram, Facebook, TikTok, LinkedIn, YouTube" },
              { icon: Star, text: "Google review and booking links" },
              { icon: QrCode, text: "QR code for print materials, signage, and events" },
              { icon: RefreshCw, text: "Edit your card anytime from your dashboard" },
            ].map((item, i) => (
              <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.05 }}
                className="flex items-center gap-4 px-5 py-3.5 bg-white/[0.02] border border-white/[0.05] rounded-xl"
              >
                <item.icon className="w-5 h-5 text-cyan-400 shrink-0" />
                <span className="text-neutral-200 text-sm">{item.text}</span>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="container mx-auto px-4 py-14 max-w-md" id="pricing">
          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            {promo && (
              <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-7">
                <p className="text-neutral-400 text-xs font-medium uppercase tracking-wider text-center mb-3">One-time payment</p>
                {promo.promoActive ? (
                  <>
                    <div className="flex items-center justify-center gap-3 mb-1">
                      <span className="text-neutral-500 line-through text-xl">${(promo.regularPrice / 100).toFixed(0)}</span>
                      <span className="text-4xl font-extrabold text-white">{price}</span>
                    </div>
                    <p className="text-amber-400 text-xs font-medium text-center mb-5">
                      Limited-time launch price — locks in before it goes back to ${(promo.regularPrice / 100).toFixed(0)}.
                    </p>
                  </>
                ) : (
                  <div className="text-4xl font-extrabold text-white text-center mb-5">{price}</div>
                )}

                <div className="space-y-2.5 mb-5">
                  {["No monthly fees", "One-time payment", "Works instantly after setup"].map((item, i) => (
                    <div key={i} className="flex items-center gap-2.5">
                      <CheckCircle className="w-4.5 h-4.5 text-green-400 shrink-0" />
                      <span className="text-neutral-100 text-sm font-medium">{item}</span>
                    </div>
                  ))}
                </div>

                <button data-testid="button-create-card-cta" onClick={goCreate}
                  className="w-full py-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold rounded-xl text-base transition shadow-lg shadow-cyan-500/20">
                  Create Yours Now
                </button>
                <p className="text-neutral-500 text-xs text-center mt-3">Secure checkout via Stripe</p>
              </div>
            )}
          </motion.div>
        </section>

        <section className="container mx-auto px-4 py-14 max-w-2xl">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-2">Built for real businesses</h2>
          <p className="text-neutral-400 text-center text-sm mb-8">No gimmicks. Just a clean, professional card.</p>
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { icon: Clock, title: "Fast Setup", desc: "Fill out a short form, pay once, and your card is live in minutes." },
              { icon: Shield, title: "No Surprises", desc: "No subscriptions, no upsells on your card. It just works." },
              { icon: Smartphone, title: "Mobile-First", desc: "Designed for phones first. Looks great on any screen." },
            ].map((item, i) => (
              <div key={i} className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-5 text-center">
                <item.icon className="w-6 h-6 text-cyan-400 mx-auto mb-2.5" />
                <h3 className="font-semibold text-sm mb-1">{item.title}</h3>
                <p className="text-neutral-400 text-xs leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
          <p className="text-neutral-400 text-sm text-center mt-8 max-w-lg mx-auto">
            <strong className="text-white">Built for entrepreneurs, freelancers, and small business owners.</strong>
          </p>
        </section>

        <section className="container mx-auto px-4 py-14 max-w-xl">
          <div className="flex items-center gap-2 justify-center mb-6">
            <HelpCircle className="w-5 h-5 text-cyan-400" />
            <h2 className="text-xl font-bold">Frequently Asked Questions</h2>
          </div>
          <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl px-5">
            <FaqItem q="Do I need to download an app?" a="No. Your card is a mobile-friendly web page with its own link. Anyone can view it on any phone or computer — nothing to install." />
            <FaqItem q="Can I update my card after I create it?" a="Yes. Log into your dashboard anytime to change your name, phone, bio, photo, links, or anything else. Updates show instantly." />
            <FaqItem q="Is this a subscription?" a="No. You pay once and your card stays live. There are no monthly fees, no renewals, and no hidden charges." />
            <FaqItem q="How do I share my card?" a="You get a unique link you can text, email, or post anywhere. Your card also has a QR code people can scan. Works with AirDrop, DMs, email signatures, and more." />
            <FaqItem q="What if I need help?" a="Reach out to our support team anytime. We're here to help you get set up and make the most of your card." />
          </div>
        </section>

        <section className="container mx-auto px-4 py-16 max-w-lg text-center">
          <h2 className="text-2xl md:text-3xl font-bold mb-3">Ready to ditch paper cards?</h2>
          <p className="text-neutral-400 text-sm mb-6">Set yours up in minutes. Share it everywhere. Pay once.</p>
          <button data-testid="button-create-card-bottom" onClick={goCreate}
            className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold rounded-xl text-lg transition shadow-lg shadow-cyan-500/25">
            Create Yours Now <ArrowRight className="w-5 h-5" />
          </button>
          {promo?.promoActive && (
            <p className="text-amber-400 text-xs font-medium mt-3">
              Launch price: {price} for a limited time
            </p>
          )}
        </section>
      </main>

      <footer className="border-t border-white/[0.06] py-6 text-center text-neutral-600 text-xs">
        <p>Digital Business Cards by Apex</p>
      </footer>

      <div className="sm:hidden fixed bottom-0 left-0 right-0 p-3 bg-[#09090b]/95 backdrop-blur-lg border-t border-white/[0.08] z-50">
        <button data-testid="button-sticky-cta" onClick={goCreate}
          className="w-full py-3.5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold rounded-xl text-sm transition shadow-lg shadow-cyan-500/20">
          Create Yours Now — {price}
        </button>
      </div>
    </div>
  );
}
