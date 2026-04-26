import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Nfc, ContactRound, Smartphone, QrCode, Download, BarChart3, Star, Zap, ShieldCheck, Mail, ArrowRight, Check, Wifi, Phone } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface InventoryResp {
  campaignId: number;
  slug: string;
  name: string;
  total: number;
  remaining: number;
  trialDays: number;
  postTrialAmountCents: number;
  isOpen: boolean;
}

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.08, duration: 0.5 } }),
};

const STEPS = [
  { icon: Nfc, title: "They tap your card", desc: "NFC or QR — works on every phone, no app needed." },
  { icon: Smartphone, title: "Your card opens instantly", desc: "Photo, contact, links, reviews — all live in one tap." },
  { icon: ContactRound, title: "You get the lead", desc: "Apex captures who tapped, follows up by AI, and books them." },
];

const FEATURES = [
  { icon: Nfc, title: "Real NFC card mailed to you", desc: "Premium printed card with embedded NFC — yours to keep no matter what." },
  { icon: Zap, title: "30 days of full Apex access", desc: "Lead capture, AI follow-up, booking, review filter — all unlocked." },
  { icon: BarChart3, title: "See who tapped your card", desc: "Real-time analytics: who viewed, who saved you, who's interested." },
  { icon: Mail, title: "Auto follow-up by AI", desc: "Texts and emails fire automatically when someone scans you." },
  { icon: Star, title: "Drives Google reviews", desc: "Built-in review prompt turns happy customers into 5-star ratings." },
  { icon: ShieldCheck, title: "Cancel in two clicks", desc: "No retention calls. No hidden fees. The card stays yours." },
];

export default function EventSignup() {
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [inventory, setInventory] = useState<InventoryResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Free NFC Card + 30 Days of Apex";
    Promise.all([
      apiRequest("GET", "/api/event/config").then(r => r.json()),
      apiRequest("GET", "/api/event/inventory").then(r => r.json()),
    ]).then(([cfg, inv]) => {
      if (cfg?.publishableKey) setStripePromise(loadStripe(cfg.publishableKey));
      setInventory(inv);
    }).catch(e => console.error("Event config load error:", e))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#030014] text-white flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <div className="w-5 h-5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
          Loading…
        </div>
      </div>
    );
  }

  if (!inventory) {
    return (
      <div className="min-h-screen bg-[#030014] text-white flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold mb-2">Campaign unavailable</h1>
          <p className="text-slate-400 text-sm">Check back in a moment, or visit our pricing page.</p>
          <a href="/pricing" className="inline-block mt-6 px-6 py-3 bg-cyan-500 text-black font-bold rounded-lg" data-testid="link-pricing">See plans</a>
        </div>
      </div>
    );
  }

  const isOpen = inventory.isOpen;
  const monthly = (inventory.postTrialAmountCents / 100).toFixed(0);

  const scrollToSignup = () => {
    document.getElementById("signup")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen bg-[#030014] text-white overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.18),transparent_55%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />

      <div className="relative z-10">
        <nav className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
          <div className="flex items-center gap-2">
            <ContactRound className="text-cyan-400" size={26} />
            <span className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-transparent">TapCard</span>
            <span className="text-xs text-slate-500 ml-1">by Apex</span>
          </div>
          <a href="/login">
            <button className="px-4 py-2 text-sm rounded-lg border border-white/10 text-slate-300 hover:bg-white/5 transition" data-testid="button-login">
              Log In
            </button>
          </a>
        </nav>

        {/* HERO */}
        <section className="max-w-7xl mx-auto px-6 pt-10 pb-16 lg:pt-16 lg:pb-24 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={0}>
              <div
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6 border ${
                  isOpen
                    ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-300"
                    : "bg-rose-500/10 border-rose-500/30 text-rose-300"
                }`}
                data-testid="text-inventory"
              >
                <span className={`w-2 h-2 rounded-full ${isOpen ? "bg-cyan-400 animate-pulse" : "bg-rose-400"}`} />
                <span className="text-xs font-semibold uppercase tracking-widest">
                  {isOpen ? `${inventory.remaining} of ${inventory.total} cards left` : "All cards claimed"}
                </span>
              </div>
            </motion.div>

            <motion.h1
              className="text-4xl md:text-5xl lg:text-6xl font-black leading-[1.05] mb-5"
              initial="hidden" animate="visible" variants={fadeUp} custom={1}
              data-testid="text-headline"
            >
              Get a free NFC business card.{" "}
              <span className="bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
                Keep it forever.
              </span>
            </motion.h1>

            <motion.p
              className="text-lg text-slate-400 mb-8 max-w-xl leading-relaxed"
              initial="hidden" animate="visible" variants={fadeUp} custom={2}
            >
              {inventory.trialDays} days of Apex on us — the AI marketing system that makes the card actually work.
              No setup fee. Cancel anytime. The card is yours regardless.
            </motion.p>

            <motion.ul className="space-y-3 mb-8" initial="hidden" animate="visible" variants={fadeUp} custom={3}>
              {[
                "Real NFC card shipped to your door",
                `${inventory.trialDays} days of full Apex access (lead capture, AI follow-up, booking)`,
                "One tap shares your contact AND tells you who's interested",
                "Cancel in two clicks. No retention calls.",
              ].map((line, i) => (
                <li key={i} className="flex items-start gap-3 text-slate-200">
                  <Check className="text-cyan-400 shrink-0 mt-0.5" size={18} />
                  <span className="text-sm md:text-base">{line}</span>
                </li>
              ))}
            </motion.ul>

            <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={4} className="flex flex-wrap items-center gap-4">
              {isOpen ? (
                <button
                  onClick={scrollToSignup}
                  className="inline-flex items-center gap-2 px-7 py-4 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold text-base shadow-lg shadow-cyan-500/20 transition"
                  data-testid="button-claim-card"
                >
                  Claim my card <ArrowRight size={18} />
                </button>
              ) : (
                <a
                  href="/pricing"
                  className="inline-flex items-center gap-2 px-7 py-4 rounded-xl bg-gradient-to-r from-slate-700 to-slate-800 hover:from-slate-600 hover:to-slate-700 text-white font-bold text-base transition"
                  data-testid="link-pricing-hero"
                >
                  See plans <ArrowRight size={18} />
                </a>
              )}
              <div className="text-xs text-slate-500 flex items-center gap-2">
                <ShieldCheck size={14} className="text-cyan-500/70" />
                $0 today · Stripe-validated · No spam
              </div>
            </motion.div>
          </div>

          {/* CARD VISUAL */}
          <motion.div
            className="relative flex justify-center lg:justify-end"
            initial={{ opacity: 0, scale: 0.92, rotate: -4 }}
            animate={{ opacity: 1, scale: 1, rotate: -6 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
          >
            <div className="absolute -inset-8 bg-gradient-to-tr from-cyan-500/20 via-indigo-500/20 to-purple-500/20 blur-3xl rounded-full" />
            <motion.div
              className="relative w-[300px] md:w-[360px] aspect-[1.6/1] rounded-2xl p-6 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 border border-white/10 shadow-2xl shadow-indigo-900/40"
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              data-testid="visual-card"
            >
              <div className="absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.18),transparent_50%)]" />
              <div className="relative h-full flex flex-col justify-between">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.25em] text-cyan-400/80 mb-1">TapCard</div>
                    <div className="text-white font-bold text-lg leading-tight">Your Name</div>
                    <div className="text-slate-400 text-xs">Your Title · Your Company</div>
                  </div>
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-cyan-500/15 border border-cyan-400/30">
                    <Wifi size={11} className="text-cyan-300 rotate-90" />
                    <span className="text-[9px] font-bold text-cyan-200 uppercase tracking-wider">NFC</span>
                  </div>
                </div>

                <div className="flex items-end justify-between">
                  <div className="flex items-center gap-3 text-slate-400">
                    <Phone size={14} />
                    <Mail size={14} />
                    <Star size={14} />
                  </div>
                  <div className="w-10 h-10 rounded-md bg-white/90 flex items-center justify-center">
                    <QrCode size={26} className="text-slate-900" />
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </section>

        {/* HOW IT WORKS */}
        <section className="max-w-6xl mx-auto px-6 py-16">
          <motion.div className="text-center mb-12" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={0}>
            <h2 className="text-3xl md:text-4xl font-bold mb-3">How it works</h2>
            <p className="text-slate-400">From handshake to booked appointment — in one tap.</p>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {STEPS.map((s, i) => (
              <motion.div key={i} initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={i}>
                <div className="relative h-full p-6 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-cyan-500/20 transition">
                  <div className="absolute -top-3 -left-3 w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-indigo-600 text-white text-sm font-bold flex items-center justify-center shadow-lg shadow-cyan-500/30">
                    {i + 1}
                  </div>
                  <div className="w-11 h-11 rounded-xl bg-cyan-500/10 flex items-center justify-center mb-4">
                    <s.icon size={20} className="text-cyan-400" />
                  </div>
                  <h3 className="text-white font-bold mb-2">{s.title}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{s.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* WHAT'S INCLUDED */}
        <section className="max-w-6xl mx-auto px-6 py-16">
          <motion.div className="text-center mb-12" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={0}>
            <h2 className="text-3xl md:text-4xl font-bold mb-3">What's in the box</h2>
            <p className="text-slate-400">A real card, plus the system that turns taps into customers.</p>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f, i) => (
              <motion.div key={i} initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={i}>
                <div className="h-full p-5 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-cyan-500/20 transition flex gap-4">
                  <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
                    <f.icon size={20} className="text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="text-white font-bold text-sm mb-1">{f.title}</h3>
                    <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* TIMELINE / TRANSPARENCY */}
        <section className="max-w-4xl mx-auto px-6 py-16">
          <motion.div className="text-center mb-10" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={0}>
            <h2 className="text-3xl md:text-4xl font-bold mb-3">No surprises after day 30</h2>
            <p className="text-slate-400">Here's exactly what happens, in plain English.</p>
          </motion.div>

          <div className="space-y-3">
            {[
              { day: "Day 0", title: "You sign up", desc: "$0 today. Stripe verifies your card so we can ship and so the trial starts clean." },
              { day: `Day 1 – ${inventory.trialDays - 1}`, title: "Card ships, Apex unlocks", desc: "Real NFC card mailed to your door. Full Apex access turns on immediately." },
              { day: `Day ${Math.max(inventory.trialDays - 7, 1)} & ${Math.max(inventory.trialDays - 2, 1)}`, title: "We email a heads-up", desc: "Two reminders before any charge. So you decide on your terms." },
              { day: `Day ${inventory.trialDays + 1}`, title: `$${monthly}/mo Starter — or you cancel`, desc: `Two clicks to cancel from your dashboard. Your NFC card is yours regardless.` },
            ].map((item, i) => (
              <motion.div key={i} initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={i}>
                <div className="flex gap-4 p-4 rounded-xl bg-white/[0.03] border border-white/5">
                  <div className="w-24 shrink-0 text-cyan-400 font-bold text-sm uppercase tracking-wider">{item.day}</div>
                  <div className="flex-1">
                    <div className="text-white font-semibold text-sm mb-0.5">{item.title}</div>
                    <div className="text-slate-400 text-sm">{item.desc}</div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* SIGNUP */}
        <section id="signup" className="max-w-md mx-auto px-6 py-16 scroll-mt-8">
          {isOpen ? (
            <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={0}>
              <div className="text-center mb-8">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-cyan-500/10 border border-cyan-500/30 rounded-full mb-4">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                  <span className="text-[11px] uppercase tracking-widest text-cyan-300 font-semibold">{inventory.remaining} of {inventory.total} left</span>
                </div>
                <h2 className="text-3xl font-bold mb-2">Claim your card</h2>
                <p className="text-slate-400 text-sm">Two short steps. Under 90 seconds.</p>
              </div>

              {stripePromise ? (
                <Elements stripe={stripePromise} options={{ appearance: { theme: "night" } }}>
                  <SignupForm inventory={inventory} />
                </Elements>
              ) : (
                <div className="text-red-400 text-sm text-center p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                  Payment system unavailable. Try again in a moment.
                </div>
              )}

              <p className="text-[11px] text-slate-500 mt-6 leading-relaxed text-center">
                We validate your card on file via Stripe so we can ship and so your account is ready when the trial ends.
                On day {inventory.trialDays + 1}, your card is charged ${monthly}/month for the Starter plan unless you cancel
                before then. We send reminders on day {Math.max(inventory.trialDays - 7, 1)} and day {Math.max(inventory.trialDays - 2, 1)}.
                Your NFC card is yours to keep regardless.
              </p>
            </motion.div>
          ) : (
            <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={0}
              className="text-center p-8 rounded-2xl bg-white/[0.03] border border-white/5">
              <h2 className="text-2xl font-bold mb-3">All {inventory.total} cards claimed.</h2>
              <p className="text-slate-400 mb-6 text-sm">The free-card window for this event is closed. Watch for the next one — or grab Apex now.</p>
              <a href="/pricing" className="inline-block px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-lg transition" data-testid="link-pricing">
                See plans
              </a>
            </motion.div>
          )}
        </section>

        <footer className="border-t border-white/5 py-8 text-center">
          <p className="text-slate-500 text-sm">
            <a href="/" className="text-cyan-400 hover:text-cyan-300">Apex Marketing Automations</a> — AI-Powered Business Growth Platform
          </p>
        </footer>
      </div>
    </div>
  );
}

function SignupForm({ inventory }: { inventory: InventoryResp }) {
  const stripe = useStripe();
  const elements = useElements();
  const [step, setStep] = useState<"info" | "card" | "done">("info");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [setupIntentId, setSetupIntentId] = useState<string | null>(null);
  const [form, setForm] = useState({
    fullName: "", email: "",
    shippingStreet: "", shippingCity: "", shippingState: "", shippingZip: "",
  });

  const canSubmitInfo = useMemo(() =>
    form.fullName.trim().length >= 2 &&
    /\S+@\S+\.\S+/.test(form.email) &&
    form.shippingStreet.trim().length > 2 &&
    form.shippingCity.trim().length > 0 &&
    form.shippingState.trim().length > 0 &&
    form.shippingZip.trim().length >= 3,
    [form]
  );

  async function handleSubmitInfo(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmitInfo) return;
    setSubmitting(true); setError(null);
    try {
      const r = await apiRequest("POST", "/api/event/signup", { ...form, shippingCountry: "US" });
      const data = await r.json();
      if (!data?.clientSecret) throw new Error(data?.error || "Signup failed");
      setClientSecret(data.clientSecret);
      setSetupIntentId(data.setupIntentId);
      setStep("card");
    } catch (err: any) {
      setError(err?.message || "Signup failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmCard() {
    if (!stripe || !elements || !clientSecret) return;
    setSubmitting(true); setError(null);
    try {
      const { error: stripeErr, setupIntent } = await stripe.confirmSetup({
        elements,
        clientSecret,
        confirmParams: { return_url: window.location.origin + "/event?completed=1" },
        redirect: "if_required",
      });
      if (stripeErr) throw new Error(stripeErr.message || "Card validation failed");
      if (!setupIntent || setupIntent.status !== "succeeded") throw new Error("Card validation incomplete");

      const r = await apiRequest("POST", "/api/event/finalize", { setupIntentId: setupIntentId || setupIntent.id });
      const data = await r.json();
      if (!data?.ok) throw new Error(data?.error || "Finalize failed");
      setStep("done");
    } catch (err: any) {
      setError(err?.message || "Card validation failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "done") {
    return (
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-6 text-center">
        <div className="text-4xl mb-3">✅</div>
        <h2 className="text-xl font-bold mb-2" data-testid="text-success-headline">You're in.</h2>
        <p className="text-sm text-gray-300 mb-1">Your trial is active. The operator will program your card now.</p>
        <p className="text-xs text-gray-500">Check your email for your dashboard link.</p>
      </div>
    );
  }

  if (step === "card") {
    return (
      <div className="bg-white/5 rounded-2xl p-5 border border-white/10">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-300 text-xs font-bold flex items-center justify-center">2</div>
          <h2 className="text-lg font-bold">Add card on file</h2>
        </div>
        <p className="text-xs text-gray-400 mb-4 ml-8">$0 today. Stripe verifies the card so we can ship.</p>
        <PaymentElement options={{ layout: "tabs" }} />
        {error && <p className="text-red-400 text-sm mt-3" data-testid="text-error">{error}</p>}
        <button
          onClick={handleConfirmCard}
          disabled={!stripe || submitting}
          className="w-full mt-4 py-3 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 disabled:opacity-50 text-white font-bold rounded-lg transition"
          data-testid="button-confirm-card"
        >
          {submitting ? "Validating…" : "Validate & start trial"}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmitInfo} className="space-y-3 bg-white/5 rounded-2xl p-5 border border-white/10">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-300 text-xs font-bold flex items-center justify-center">1</div>
        <h2 className="text-lg font-bold">Your details</h2>
      </div>
      <Field label="Full name">
        <input type="text" required value={form.fullName} onChange={e => setForm({...form, fullName: e.target.value})}
          className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white focus:border-cyan-500/50 focus:outline-none transition"
          data-testid="input-fullname" autoComplete="name" />
      </Field>
      <Field label="Email">
        <input type="email" required value={form.email} onChange={e => setForm({...form, email: e.target.value})}
          className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white focus:border-cyan-500/50 focus:outline-none transition"
          data-testid="input-email" autoComplete="email" />
      </Field>
      <Field label="Shipping address">
        <input type="text" required placeholder="Street" value={form.shippingStreet}
          onChange={e => setForm({...form, shippingStreet: e.target.value})}
          className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white focus:border-cyan-500/50 focus:outline-none transition"
          data-testid="input-street" autoComplete="street-address" />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <input type="text" required placeholder="City" value={form.shippingCity}
          onChange={e => setForm({...form, shippingCity: e.target.value})}
          className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white col-span-2 focus:border-cyan-500/50 focus:outline-none transition"
          data-testid="input-city" autoComplete="address-level2" />
        <input type="text" required placeholder="State" value={form.shippingState}
          onChange={e => setForm({...form, shippingState: e.target.value.toUpperCase().slice(0, 2)})}
          className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white focus:border-cyan-500/50 focus:outline-none transition"
          data-testid="input-state" autoComplete="address-level1" maxLength={2} />
      </div>
      <input type="text" required placeholder="ZIP" value={form.shippingZip}
        onChange={e => setForm({...form, shippingZip: e.target.value})}
        className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white focus:border-cyan-500/50 focus:outline-none transition"
        data-testid="input-zip" autoComplete="postal-code" />
      {error && <p className="text-red-400 text-sm" data-testid="text-error">{error}</p>}
      <button type="submit" disabled={!canSubmitInfo || submitting}
        className="w-full mt-2 py-3 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 disabled:opacity-50 text-white font-bold rounded-lg transition"
        data-testid="button-continue">
        {submitting ? "Reserving card…" : "Continue to payment validation"}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-widest text-gray-500 mb-1">{label}</div>
      {children}
    </label>
  );
}
