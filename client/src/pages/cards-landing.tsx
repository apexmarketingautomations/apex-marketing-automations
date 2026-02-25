import { useState } from "react";
import { motion } from "framer-motion";
import { ContactRound, QrCode, Smartphone, Share2, Star, Globe, Phone, Mail, Download, BarChart3, Palette, Zap, Shield, Check, ArrowRight, Nfc, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

const FEATURES = [
  { icon: ContactRound, title: "Professional Design", desc: "Stunning animated card with your photo, bio, and contact details" },
  { icon: QrCode, title: "QR Code Included", desc: "Print-ready QR code for business cards, stickers, and flyers" },
  { icon: Nfc, title: "NFC Ready", desc: "Program NFC stickers or tags to open your card with a tap" },
  { icon: Share2, title: "One-Link Sharing", desc: "Share your card via text, email, or social media with one link" },
  { icon: Download, title: "Save to Contacts", desc: "One-tap contact download — adds you directly to their phone" },
  { icon: Star, title: "Google Reviews", desc: "Built-in review link drives happy customers to leave reviews" },
  { icon: Palette, title: "Custom Themes", desc: "Choose from 5 premium themes to match your brand" },
  { icon: Globe, title: "Custom URL", desc: "Get your own personalized link like /card/your-name" },
  { icon: BarChart3, title: "View Analytics", desc: "See who viewed your card, tapped your links, and saved your contact" },
  { icon: Smartphone, title: "Mobile First", desc: "Looks perfect on every device — phone, tablet, or desktop" },
  { icon: Shield, title: "Always Online", desc: "Hosted on enterprise infrastructure — 99.9% uptime" },
  { icon: Zap, title: "Instant Updates", desc: "Change your info anytime — updates everywhere instantly" },
];

const TESTIMONIALS = [
  { name: "Marcus R.", role: "Real Estate Agent", quote: "I hand out NFC stickers at open houses. People tap, get my card, and I get a lead. Game changer." },
  { name: "Sarah K.", role: "Salon Owner", quote: "My clients tap my card, leave a Google review, and book their next appointment. All from one link." },
  { name: "Giovanni T.", role: "Attorney", quote: "Way more professional than handing out a paper card. Plus I can update my info without reprinting." },
];

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.1, duration: 0.5 } }),
};

export default function CardsLanding() {
  const [interval, setInterval] = useState<"monthly" | "yearly">("monthly");

  const checkoutMutation = useMutation({
    mutationFn: async (plan: string) => {
      const res = await apiRequest("POST", "/api/card-checkout", { plan, interval });
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.url) window.location.href = data.url;
    },
  });

  return (
    <div className="min-h-screen bg-[#030014] text-white overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.15),transparent_50%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />

      <div className="relative z-10">
        <nav className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
          <div className="flex items-center gap-2">
            <ContactRound className="text-cyan-400" size={28} />
            <span className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-transparent">TapCard</span>
            <span className="text-xs text-slate-500 ml-1">by Apex</span>
          </div>
          <a href="/api/login">
            <Button variant="outline" className="border-white/10 text-slate-300 hover:bg-white/5" data-testid="button-login">
              Log In
            </Button>
          </a>
        </nav>

        <section className="max-w-5xl mx-auto px-6 py-20 text-center">
          <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={0}>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 mb-6">
              <Nfc size={14} className="text-cyan-400" />
              <span className="text-cyan-300 text-sm font-medium">NFC + QR + One-Link Digital Cards</span>
            </div>
          </motion.div>

          <motion.h1
            className="text-5xl md:text-7xl font-black mb-6 leading-tight"
            initial="hidden" animate="visible" variants={fadeUp} custom={1}
          >
            Your Business Card,{" "}
            <span className="bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
              Reinvented
            </span>
          </motion.h1>

          <motion.p
            className="text-xl text-slate-400 max-w-2xl mx-auto mb-10"
            initial="hidden" animate="visible" variants={fadeUp} custom={2}
          >
            Stop handing out paper cards nobody keeps. Get a stunning digital card with NFC tap, QR code,
            Google Reviews, contact download, and analytics — all for less than a coffee.
          </motion.p>

          <motion.div className="flex gap-4 justify-center" initial="hidden" animate="visible" variants={fadeUp} custom={3}>
            <a href="#pricing">
              <Button size="lg" className="bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold text-lg px-8 py-6" data-testid="button-get-started">
                Get Your Card <ArrowRight size={20} className="ml-2" />
              </Button>
            </a>
            <a href="/DanteS">
              <Button size="lg" variant="outline" className="border-white/10 text-slate-300 hover:bg-white/5 text-lg px-8 py-6" data-testid="button-see-example">
                See Example
              </Button>
            </a>
          </motion.div>
        </section>

        <section className="max-w-6xl mx-auto px-6 py-16">
          <motion.div className="text-center mb-12" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={0}>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Everything You Need in One Card</h2>
            <p className="text-slate-400 text-lg">No app downloads. No printing costs. Just share your link.</p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f, i) => (
              <motion.div key={i} initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={i}>
                <Card className="bg-white/[0.03] border-white/5 hover:border-cyan-500/20 transition-all h-full">
                  <CardContent className="p-5 flex gap-4">
                    <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
                      <f.icon size={20} className="text-cyan-400" />
                    </div>
                    <div>
                      <h3 className="text-white font-bold text-sm mb-1">{f.title}</h3>
                      <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-6 py-16">
          <motion.div className="text-center mb-12" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={0}>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">What People Are Saying</h2>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t, i) => (
              <motion.div key={i} initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={i}>
                <Card className="bg-white/[0.03] border-white/5 h-full">
                  <CardContent className="p-6">
                    <div className="flex gap-1 mb-3">
                      {[1,2,3,4,5].map(s => <Star key={s} size={14} className="text-yellow-400 fill-yellow-400" />)}
                    </div>
                    <p className="text-slate-300 text-sm italic mb-4">"{t.quote}"</p>
                    <div>
                      <p className="text-white font-bold text-sm">{t.name}</p>
                      <p className="text-slate-500 text-xs">{t.role}</p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </section>

        <section id="pricing" className="max-w-4xl mx-auto px-6 py-20">
          <motion.div className="text-center mb-10" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={0}>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Simple, Transparent Pricing</h2>
            <p className="text-slate-400 text-lg mb-6">No hidden fees. Cancel anytime.</p>

            <div className="inline-flex items-center gap-1 p-1 rounded-full bg-white/5 border border-white/10">
              <button
                onClick={() => setInterval("monthly")}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${interval === "monthly" ? "bg-cyan-600 text-white" : "text-slate-400 hover:text-white"}`}
                data-testid="button-monthly"
              >
                Monthly
              </button>
              <button
                onClick={() => setInterval("yearly")}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${interval === "yearly" ? "bg-cyan-600 text-white" : "text-slate-400 hover:text-white"}`}
                data-testid="button-yearly"
              >
                Yearly <span className="text-emerald-400 text-xs ml-1">Save 42%</span>
              </button>
            </div>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl mx-auto">
            <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={0}>
              <Card className="bg-white/[0.03] border-white/10 h-full">
                <CardContent className="p-8">
                  <h3 className="text-lg font-bold text-white mb-2">TapCard</h3>
                  <p className="text-slate-400 text-sm mb-6">Everything you need to go digital</p>
                  <div className="mb-6">
                    <span className="text-4xl font-black text-white">
                      ${interval === "monthly" ? "9.99" : "69.99"}
                    </span>
                    <span className="text-slate-400 text-sm">/{interval === "monthly" ? "mo" : "yr"}</span>
                    {interval === "yearly" && (
                      <div className="text-emerald-400 text-sm mt-1">That's $5.83/mo — save $50/year</div>
                    )}
                  </div>
                  <ul className="space-y-3 mb-8">
                    {["Professional animated card", "QR code generator", "NFC compatible", "Contact download (VCF)", "Google Review link", "Custom URL slug", "5 premium themes", "Unlimited updates", "Mobile optimized"].map((f, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-slate-300">
                        <Check size={16} className="text-cyan-400 shrink-0" /> {f}
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold py-6"
                    onClick={() => checkoutMutation.mutate("tapcard")}
                    disabled={checkoutMutation.isPending}
                    data-testid="button-checkout-tapcard"
                  >
                    <CreditCard size={16} className="mr-2" />
                    {checkoutMutation.isPending ? "Loading..." : "Get Started"}
                  </Button>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={1}>
              <Card className="bg-gradient-to-b from-cyan-500/10 to-indigo-500/10 border-cyan-500/30 h-full relative">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-gradient-to-r from-cyan-600 to-indigo-600 text-xs font-bold text-white">
                  MOST POPULAR
                </div>
                <CardContent className="p-8">
                  <h3 className="text-lg font-bold text-white mb-2">TapCard Pro</h3>
                  <p className="text-slate-400 text-sm mb-6">Card + full marketing suite</p>
                  <div className="mb-6">
                    <span className="text-4xl font-black text-white">
                      ${interval === "monthly" ? "48" : "384"}
                    </span>
                    <span className="text-slate-400 text-sm">/{interval === "monthly" ? "mo" : "yr"}</span>
                    {interval === "yearly" && (
                      <div className="text-emerald-400 text-sm mt-1">Save $192/year vs monthly</div>
                    )}
                  </div>
                  <ul className="space-y-3 mb-8">
                    {["Everything in TapCard", "AI Chatbot & Voice Agent", "SMS Auto-Reply", "Review Filter System", "Workflow Automation", "Sales Pipeline & CRM", "Meta Ads Launcher", "Sentinel Scanner", "Email Campaigns", "Priority Support"].map((f, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-slate-300">
                        <Check size={16} className="text-cyan-400 shrink-0" /> {f}
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full bg-gradient-to-r from-cyan-500 to-indigo-500 hover:from-cyan-400 hover:to-indigo-400 text-white font-bold py-6"
                    onClick={() => checkoutMutation.mutate("tapcard_pro")}
                    disabled={checkoutMutation.isPending}
                    data-testid="button-checkout-pro"
                  >
                    <Zap size={16} className="mr-2" />
                    {checkoutMutation.isPending ? "Loading..." : "Upgrade to Pro"}
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </section>

        <section className="max-w-3xl mx-auto px-6 py-16 text-center">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={0}>
            <h2 className="text-3xl font-bold mb-4">Ready to Ditch the Paper?</h2>
            <p className="text-slate-400 text-lg mb-8">Join hundreds of professionals who've gone digital. Set up your card in under 2 minutes.</p>
            <a href="#pricing">
              <Button size="lg" className="bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold text-lg px-10 py-6" data-testid="button-final-cta">
                Create Your Card Now <ArrowRight size={20} className="ml-2" />
              </Button>
            </a>
          </motion.div>
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
