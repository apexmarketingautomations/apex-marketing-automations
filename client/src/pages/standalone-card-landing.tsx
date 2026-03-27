import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight, Smartphone, RefreshCw, Briefcase, Star, CheckCircle,
  CreditCard, QrCode, Share2, Zap, Send, Shield, Clock, HelpCircle,
  ChevronDown, MessageSquare, Phone, Mail, Globe, MapPin, Download,
  Play, DollarSign, Users, Award, X, ExternalLink
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

function DemoCard({ onCta }: { onCta: () => void }) {
  const tc = "#0ea5e9";
  const [showActions, setShowActions] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShowActions(true), 800);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="relative max-w-[340px] mx-auto">
      <div className="absolute -inset-3 bg-gradient-to-br from-cyan-500/20 via-blue-600/10 to-purple-600/20 rounded-[2rem] blur-xl" />
      <div className="relative bg-[#0f0f17] border border-white/[0.1] rounded-3xl overflow-hidden shadow-2xl shadow-cyan-500/10">
        <div className="h-32 relative" style={{ background: `linear-gradient(135deg, ${tc}60, ${tc}25)` }}>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[80px] font-black opacity-10 text-white">
            A
          </div>
          <div className="absolute top-3 right-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center">
              <img src="/apex-logo.png" alt="Logo" className="w-7 h-7 rounded-lg object-contain" />
            </div>
          </div>
        </div>

        <div className="px-5 pb-5 -mt-8">
          <div className="w-16 h-16 rounded-full border-[3px] border-[#0f0f17] flex items-center justify-center text-xl font-bold mb-2" style={{ backgroundColor: tc }}>
            A
          </div>
          <h3 className="text-lg font-bold text-white">Alex Rivera</h3>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="h-[2px] w-6 rounded-full" style={{ backgroundColor: tc }} />
            <p className="text-sm font-semibold" style={{ color: tc }}>Marketing Consultant</p>
          </div>
          <p className="text-slate-400 text-xs mt-0.5">Rivera Digital Agency</p>

          <AnimatePresence>
            {showActions && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                <div className="grid grid-cols-4 gap-1.5 mt-3">
                  {[
                    { icon: Phone, label: "Call" },
                    { icon: MessageSquare, label: "Text" },
                    { icon: Mail, label: "Email" },
                    { icon: Globe, label: "Web" },
                  ].map((btn, i) => (
                    <div key={i} className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08]">
                      <btn.icon className="w-4 h-4" style={{ color: tc }} />
                      <span className="text-[10px] text-slate-400">{btn.label}</span>
                    </div>
                  ))}
                </div>

                <button className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-xs text-white mt-2.5"
                  style={{ backgroundColor: tc }}>
                  <Download className="w-3.5 h-3.5" /> Save Contact
                </button>

                <div className="flex gap-1.5 mt-2">
                  {["Instagram", "LinkedIn"].map((s, i) => (
                    <span key={i} className="px-2.5 py-1 bg-white/[0.04] border border-white/[0.08] rounded-full text-[10px] text-slate-300">{s}</span>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.2 }}
        className="absolute -bottom-4 -right-4 bg-green-500/15 border border-green-500/30 backdrop-blur-lg px-3 py-1.5 rounded-full">
        <span className="text-green-400 text-xs font-bold flex items-center gap-1">
          <CheckCircle className="w-3 h-3" /> Saved to Contacts
        </span>
      </motion.div>
    </div>
  );
}

export default function StandaloneCardLanding() {
  const [, setLocation] = useLocation();
  const [promo, setPromo] = useState<any>(null);
  const [showDemo, setShowDemo] = useState(false);
  const demoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) {
      sessionStorage.setItem("standalone_ref", ref);
      trackEvent("referral_captured", { code: ref });
    }
    trackEvent("landing_page_view");
    fetch("/api/standalone/promo-status").then(r => r.json()).then(setPromo).catch(() => {});

    const sid = sessionStorage.getItem("standalone_session_id") || crypto.randomUUID();
    sessionStorage.setItem("standalone_session_id", sid);
    fetch("/api/standalone/track-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: "landing", referralCode: ref || "", sessionId: sid }),
    }).catch(() => {});
  }, []);

  const goCreate = () => setLocation("/standalone/create");
  const scrollToDemo = () => {
    setShowDemo(true);
    setTimeout(() => demoRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
  };

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
        <section className="container mx-auto px-4 pt-12 pb-10 md:pt-20 md:pb-14 max-w-5xl">
          <div className="grid md:grid-cols-2 gap-10 items-center">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
              <p data-testid="text-hook" className="text-sm md:text-base text-neutral-400 font-medium mb-3 tracking-wide uppercase">
                Paper cards get lost. Yours won't.
              </p>
              <h1 data-testid="text-headline" className="text-3xl sm:text-4xl md:text-[2.75rem] font-extrabold leading-[1.15] mb-5">
                One digital card people can{" "}
                <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                  save directly to their contacts
                </span>
                {" "}— so they never lose your info.
              </h1>
              <p data-testid="text-subheadline" className="text-base md:text-lg text-neutral-300 mb-6 leading-relaxed">
                Create a mobile-friendly business card people actually save. Share by text, QR code, AirDrop, or DM. Update it anytime. Pay once.
              </p>

              <div className="flex flex-col sm:flex-row items-start gap-3">
                <button data-testid="button-create-card" onClick={goCreate}
                  className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold rounded-xl text-lg transition shadow-lg shadow-cyan-500/25">
                  Create Yours Now <ArrowRight className="w-5 h-5" />
                </button>
                <button data-testid="button-see-demo" onClick={scrollToDemo}
                  className="inline-flex items-center gap-2 px-6 py-4 bg-white/[0.05] border border-white/[0.1] hover:bg-white/[0.08] text-white font-medium rounded-xl text-sm transition">
                  <Play className="w-4 h-4 text-cyan-400" /> See a live example
                </button>
              </div>

              {promo?.promoActive && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.45 }}
                  data-testid="text-promo-badge"
                  className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500/10 border border-amber-500/30 rounded-full text-amber-400 text-sm font-medium">
                  <Star className="w-4 h-4" />
                  Limited-time launch price — lock it in before it goes back to ${(promo.regularPrice / 100).toFixed(0)}.
                </motion.div>
              )}
            </motion.div>

            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3, duration: 0.6 }}
              className="hidden md:block">
              <DemoCard onCta={goCreate} />
            </motion.div>
          </div>
        </section>

        <section className="container mx-auto px-4 py-10 max-w-3xl">
          <div className="grid grid-cols-3 gap-4">
            {[
              { value: "2 min", label: "Setup time", icon: Clock },
              { value: "$0/mo", label: "No subscriptions", icon: Shield },
              { value: "∞", label: "Shares & saves", icon: Share2 },
            ].map((stat, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.1 }}
                className="text-center py-5 bg-white/[0.02] border border-white/[0.06] rounded-2xl">
                <stat.icon className="w-5 h-5 text-cyan-400 mx-auto mb-2" />
                <p className="text-2xl font-extrabold text-white">{stat.value}</p>
                <p className="text-neutral-400 text-xs mt-0.5">{stat.label}</p>
              </motion.div>
            ))}
          </div>
        </section>

        <section ref={demoRef} className="container mx-auto px-4 py-14 max-w-4xl">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-2">See what you'll get</h2>
          <p className="text-neutral-400 text-center text-sm mb-10">This is an actual card. Yours will look just like this.</p>

          <div className="grid md:grid-cols-2 gap-10 items-center">
            <div className="md:hidden block">
              <DemoCard onCta={goCreate} />
            </div>
            <div className="hidden md:block">
              <DemoCard onCta={goCreate} />
            </div>
            <div className="space-y-4">
              {[
                { icon: Download, title: "One-tap save to contacts", desc: "They tap a button and your info goes straight into their phone — name, number, email, everything." },
                { icon: Phone, title: "Call, text, email buttons", desc: "People can reach you instantly. No typing, no searching for your number." },
                { icon: QrCode, title: "Built-in QR code", desc: "Print it on flyers, receipts, signage, or your desk. Anyone can scan and save you instantly." },
                { icon: RefreshCw, title: "Update anytime", desc: "Changed your number? New role? Update your card from your dashboard — it stays current." },
              ].map((item, i) => (
                <motion.div key={i} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 + i * 0.1 }}
                  className="flex gap-3">
                  <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center shrink-0">
                    <item.icon className="w-5 h-5 text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-white mb-0.5">{item.title}</h3>
                    <p className="text-neutral-400 text-xs leading-relaxed">{item.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
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
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-2">Everything included</h2>
          <p className="text-neutral-400 text-center text-sm mb-8">One card. Nothing to install. No monthly fees.</p>
          <div className="space-y-3">
            {[
              { icon: CreditCard, text: "Your own digital business card with a unique shareable link" },
              { icon: Send, text: "One-tap save to contacts — your info goes straight into their phone" },
              { icon: MessageSquare, text: "Call, text, and email buttons people can use right from your card" },
              { icon: Share2, text: "Social media links — Instagram, Facebook, TikTok, LinkedIn, YouTube" },
              { icon: Star, text: "Google review and booking links to drive more business" },
              { icon: QrCode, text: "QR code for print materials, signage, and events" },
              { icon: RefreshCw, text: "Edit your card anytime from your dashboard — always free" },
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

        <section className="container mx-auto px-4 py-14 max-w-2xl">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-3">Compare the cost</h2>
          <p className="text-neutral-400 text-center text-sm mb-8">One digital card replaces paper forever — and costs less than one box.</p>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-red-500/[0.05] border border-red-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <X className="w-5 h-5 text-red-400" />
                <h3 className="font-bold text-sm text-red-400">500 Paper Business Cards</h3>
              </div>
              <div className="space-y-2.5">
                {[
                  { label: "Design cost", price: "$50–$200" },
                  { label: "Printing (500 cards)", price: "$30–$80" },
                  { label: "Reprint when info changes", price: "$30–$80" },
                  { label: "People lose them", price: "Wasted $$$" },
                ].map((item, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className="text-neutral-400">{item.label}</span>
                    <span className="text-red-300 font-medium">{item.price}</span>
                  </div>
                ))}
                <div className="pt-2 border-t border-red-500/20 flex justify-between">
                  <span className="text-neutral-300 text-sm font-semibold">Total</span>
                  <span className="text-red-400 text-sm font-bold">$110–$360+</span>
                </div>
              </div>
            </div>

            <div className="bg-cyan-500/[0.05] border border-cyan-500/20 rounded-2xl p-5 relative">
              <div className="absolute -top-3 right-4 px-3 py-1 bg-cyan-500 text-white text-[10px] font-bold rounded-full uppercase tracking-wider">
                Best Value
              </div>
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle className="w-5 h-5 text-cyan-400" />
                <h3 className="font-bold text-sm text-cyan-400">Apex Digital Card</h3>
              </div>
              <div className="space-y-2.5">
                {[
                  { label: "Professional design", price: "Included" },
                  { label: "Unlimited shares & saves", price: "Included" },
                  { label: "Update anytime", price: "Free forever" },
                  { label: "Never gets lost or outdated", price: "✓" },
                ].map((item, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className="text-neutral-400">{item.label}</span>
                    <span className="text-cyan-300 font-medium">{item.price}</span>
                  </div>
                ))}
                <div className="pt-2 border-t border-cyan-500/20 flex justify-between">
                  <span className="text-neutral-300 text-sm font-semibold">Total</span>
                  <span className="text-cyan-400 text-sm font-bold">{price} one-time</span>
                </div>
              </div>
            </div>
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
                    <p className="text-amber-400 text-xs font-medium text-center mb-1">
                      50% off launch price — saves you ${((promo.regularPrice - promo.promoPrice) / 100).toFixed(2)}
                    </p>
                    <p className="text-neutral-500 text-[11px] text-center mb-5">
                      Price goes back to ${(promo.regularPrice / 100).toFixed(0)} after the first {promo.spotsTotal} customers.
                    </p>
                  </>
                ) : (
                  <div className="text-4xl font-extrabold text-white text-center mb-5">{price}</div>
                )}

                <div className="space-y-2.5 mb-5">
                  {[
                    "Your card stays live forever",
                    "No monthly fees — ever",
                    "Free updates from your dashboard",
                    "Saves directly to their phone contacts",
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2.5">
                      <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
                      <span className="text-neutral-100 text-sm font-medium">{item}</span>
                    </div>
                  ))}
                </div>

                <button data-testid="button-create-card-cta" onClick={goCreate}
                  className="w-full py-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold rounded-xl text-base transition shadow-lg shadow-cyan-500/20">
                  Create Yours Now
                </button>
                <p className="text-neutral-500 text-xs text-center mt-3 flex items-center justify-center gap-1.5">
                  <Shield className="w-3 h-3" /> Secure checkout via Stripe
                </p>
              </div>
            )}
          </motion.div>
        </section>

        <section className="container mx-auto px-4 py-14 max-w-2xl">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-2">How it works</h2>
          <p className="text-neutral-400 text-center text-sm mb-10">Your card goes live in under 3 minutes.</p>
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              { step: "1", title: "Fill out a short form", desc: "Enter your name, contact info, and links. Takes about 2 minutes.", icon: CreditCard },
              { step: "2", title: "Pay once", desc: "Secure one-time payment. No subscription, no hidden fees.", icon: DollarSign },
              { step: "3", title: "Share everywhere", desc: "Get your unique link and QR code. Text it, post it, print it.", icon: Share2 },
            ].map((item, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.1 }}
                className="text-center relative">
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mx-auto mb-3">
                  <span className="text-cyan-400 font-extrabold text-lg">{item.step}</span>
                </div>
                <h3 className="font-semibold text-sm mb-1">{item.title}</h3>
                <p className="text-neutral-400 text-xs leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="container mx-auto px-4 py-14 max-w-2xl">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-2">Built for real businesses</h2>
          <p className="text-neutral-400 text-center text-sm mb-8">No gimmicks. Just a clean, professional card.</p>
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { icon: Briefcase, title: "Entrepreneurs", desc: "Share your card with clients, at events, or in your email signature." },
              { icon: Users, title: "Freelancers", desc: "Look professional without the overhead. One link does everything." },
              { icon: Award, title: "Small Business", desc: "Give every team member a digital card. Update company info once." },
            ].map((item, i) => (
              <div key={i} className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-5 text-center">
                <item.icon className="w-6 h-6 text-cyan-400 mx-auto mb-2.5" />
                <h3 className="font-semibold text-sm mb-1">{item.title}</h3>
                <p className="text-neutral-400 text-xs leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="container mx-auto px-4 py-14 max-w-xl">
          <div className="flex items-center gap-2 justify-center mb-6">
            <HelpCircle className="w-5 h-5 text-cyan-400" />
            <h2 className="text-xl font-bold">Frequently Asked Questions</h2>
          </div>
          <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl px-5">
            <FaqItem q="Can I see an example before I buy?" a="Yes! Scroll up to the demo card on this page — that's exactly what your card will look like. You'll also preview your actual card with your real info before checkout." />
            <FaqItem q="Is this a subscription?" a="No. You pay once and your card stays live forever. There are no monthly fees, no renewals, and no hidden charges. Ever." />
            <FaqItem q="What if I change my phone number or job?" a="No problem. Log into your dashboard anytime and update any field — name, phone, bio, photo, links, anything. Changes show up instantly. It's always free to update." />
            <FaqItem q="Do I need to download an app?" a="No. Your card is a mobile-friendly web page with its own link. Anyone can view it on any phone or computer — nothing to install, no account needed." />
            <FaqItem q="How do people save my contact?" a="They tap 'Save Contact' on your card and your full info — name, phone, email, title — goes directly into their phone's contact list. Like adding a real contact, but instant." />
            <FaqItem q="Can I share it on social media?" a="Absolutely. Your card has a unique link you can put anywhere — Instagram bio, Facebook, LinkedIn, TikTok, email signatures, text messages, even printed on flyers with the QR code." />
            <FaqItem q="What if I need help setting up?" a="We're here to help. Reach out to our support team anytime and we'll get you set up. Most people finish their card in under 2 minutes though." />
          </div>
        </section>

        <section className="container mx-auto px-4 py-16 max-w-lg text-center">
          <h2 className="text-2xl md:text-3xl font-bold mb-3">Ready to ditch paper cards?</h2>
          <p className="text-neutral-400 text-sm mb-6">Set yours up in under 3 minutes. Share it everywhere. Pay once.</p>
          <button data-testid="button-create-card-bottom" onClick={goCreate}
            className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold rounded-xl text-lg transition shadow-lg shadow-cyan-500/25">
            Create Yours Now <ArrowRight className="w-5 h-5" />
          </button>
          {promo?.promoActive && (
            <p className="text-amber-400 text-xs font-medium mt-3">
              Launch price: {price} — 50% off for a limited time
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
