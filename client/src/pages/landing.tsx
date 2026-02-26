import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { SalesChatbot } from "@/components/sales-chatbot";
import {
  MessageSquare, GitFork, Bot, LayoutTemplate, Megaphone, Phone, Star,
  DollarSign, Link2, Rocket, TrendingUp, Palette, Sparkles, ArrowRight,
  Zap, Users, CircleDollarSign, Shield, CheckCircle2, ChevronDown, ChevronUp,
  BarChart3, Globe, Instagram, Target, Mail, Kanban, CalendarDays, Webhook,
  FileBarChart, Building2, Satellite
} from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.06, duration: 0.5 },
  }),
};

const tools = [
  { icon: MessageSquare, title: "Unified Inbox", desc: "SMS, Instagram, WhatsApp & email — one place, AI-scored.", color: "cyan" },
  { icon: Phone, title: "AI Voice Agent", desc: "Deploy AI receptionists that handle calls 24/7 with custom personas.", color: "blue" },
  { icon: LayoutTemplate, title: "AI Site Builder", desc: "Generate stunning landing pages from a single prompt. 22 section types.", color: "orange" },
  { icon: Bot, title: "Neural Trainer", desc: "Scrape websites, build RAG knowledge bases, deploy AI chatbots.", color: "green" },
  { icon: GitFork, title: "Workflow Builder", desc: "Visual automation engine with triggers, delays, conditions, and actions.", color: "purple" },
  { icon: Megaphone, title: "Growth Engine", desc: "AI-powered ad campaigns with generated copy and visuals.", color: "pink" },
  { icon: Rocket, title: "God Mode", desc: "Launch an entire business in 60 seconds — phone, agent, site, workflows.", color: "red" },
  { icon: Star, title: "Reputation Manager", desc: "Smart review routing — happy to Google, unhappy to private feedback.", color: "yellow" },
  { icon: Kanban, title: "CRM Pipeline", desc: "Drag-and-drop deal pipeline with contact management and tracking.", color: "indigo" },
  { icon: CalendarDays, title: "Calendar & Booking", desc: "Appointment scheduling with contact linking and status management.", color: "emerald" },
  { icon: Mail, title: "Email Campaigns", desc: "Campaign builder with templates, scheduling, and open/click tracking.", color: "rose" },
  { icon: Instagram, title: "Instagram DM Inbox", desc: "Manage Instagram conversations with real-time messaging.", color: "fuchsia" },
  { icon: Target, title: "Meta Ad Manager", desc: "Facebook/Instagram ad campaigns with audience targeting and analytics.", color: "sky" },
  { icon: Satellite, title: "Apex Sentinel", desc: "Real-time incident scanning for personal injury lead generation.", color: "amber" },
  { icon: Globe, title: "Website Integration", desc: "Connect client websites, train AI chatbots, generate embed widgets.", color: "teal" },
  { icon: Palette, title: "White-Label", desc: "Your brand, your domain, your colors. Full agency customization.", color: "violet" },
  { icon: BarChart3, title: "Analytics Dashboard", desc: "Real-time charts for messages, AI usage, conversions, pipeline.", color: "lime" },
  { icon: Webhook, title: "Webhooks & APIs", desc: "Connect to Zapier, Make.com, and any external tool.", color: "slate" },
];

const colorMap: Record<string, { bg: string; text: string; border: string }> = {
  cyan: { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/20" },
  blue: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20" },
  orange: { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/20" },
  green: { bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/20" },
  purple: { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/20" },
  pink: { bg: "bg-pink-500/10", text: "text-pink-400", border: "border-pink-500/20" },
  red: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/20" },
  yellow: { bg: "bg-yellow-500/10", text: "text-yellow-400", border: "border-yellow-500/20" },
  indigo: { bg: "bg-indigo-500/10", text: "text-indigo-400", border: "border-indigo-500/20" },
  emerald: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
  rose: { bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-500/20" },
  fuchsia: { bg: "bg-fuchsia-500/10", text: "text-fuchsia-400", border: "border-fuchsia-500/20" },
  sky: { bg: "bg-sky-500/10", text: "text-sky-400", border: "border-sky-500/20" },
  amber: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20" },
  teal: { bg: "bg-teal-500/10", text: "text-teal-400", border: "border-teal-500/20" },
  violet: { bg: "bg-violet-500/10", text: "text-violet-400", border: "border-violet-500/20" },
  lime: { bg: "bg-lime-500/10", text: "text-lime-400", border: "border-lime-500/20" },
  slate: { bg: "bg-slate-500/10", text: "text-slate-400", border: "border-slate-500/20" },
};

const tiers = [
  {
    id: "starter",
    name: "Starter AI",
    price: 48,
    originalPrice: 97,
    description: "Complete automation for the solo entrepreneur.",
    features: ["1 Sub-Account", "Unified Inbox", "AI Site Builder", "Review Buffer", "3 Active Workflows", "1 AI Chatbot", "$10 AI Credits/mo"],
    glow: "border-white/10",
    gradient: "from-gray-500 to-white",
  },
  {
    id: "agency_pro",
    name: "Agency Pro",
    price: 148,
    originalPrice: 297,
    description: "Build an empire with unlimited sub-accounts.",
    features: ["Unlimited Sub-Accounts", "Ghost SDR Parallel Dialer", "Snapshot Marketplace", "Snapshot Cloning", "Advanced Theming", "Unlimited Workflows", "$25 AI Credits/mo", "Affiliate Dashboard"],
    glow: "border-cyan-500/50 shadow-[0_0_30px_rgba(6,182,212,0.15)]",
    gradient: "from-cyan-500 to-blue-600",
    popular: true,
  },
  {
    id: "god_mode",
    name: "God Mode",
    price: 248,
    originalPrice: 497,
    description: "Total White-Label dominance. Zero limits.",
    features: ["Full White-Labeling", "Custom Domain", "Marketplace Profit Sharing", "Sentinel Global Rules", "Bulk Rollback Controls", "Agency Command Center", "$50 AI Credits/mo", "Priority Founder Support"],
    glow: "border-purple-500/50 shadow-[0_0_30px_rgba(168,85,247,0.15)]",
    gradient: "from-purple-500 to-red-500",
  },
];

const testimonials = [
  { name: "Marcus T.", role: "Agency Owner", quote: "Replaced 4 different tools within a week. The AI voice agent alone pays for the entire subscription.", avatar: "M" },
  { name: "Sarah K.", role: "Personal Injury Firm", quote: "Sentinel catches accident leads before our competitors even know they happened. Game changer.", avatar: "S" },
  { name: "David R.", role: "Real Estate Investor", quote: "God Mode spun up 12 sub-accounts in an afternoon. Each one generating leads on autopilot.", avatar: "D" },
  { name: "Lisa M.", role: "Marketing Director", quote: "The white-label option lets us resell this as our own platform. Our clients have no idea.", avatar: "L" },
];

const faqs = [
  { q: "Is there a free trial?", a: "Yes! Every plan comes with a 60-day free trial. You get full access to all features in your tier with no credit card required to start." },
  { q: "What happens after the Blitz pricing ends?", a: "If you sign up during the 30-day Blitz window, your price is locked forever. As long as your subscription stays active, you'll never pay more than your launch price." },
  { q: "Can I switch plans later?", a: "Absolutely. You can upgrade or downgrade at any time. If you upgrade, you'll get prorated credit for your current billing cycle." },
  { q: "What is a sub-account?", a: "A sub-account is a separate workspace for a client or business. Each has its own inbox, contacts, workflows, and AI bots. Agency Pro and God Mode include unlimited sub-accounts." },
  { q: "Do I need coding skills?", a: "Not at all. Everything is drag-and-drop or AI-generated. From websites to workflows to chatbots — no code required." },
  { q: "How does usage billing work?", a: "Your plan includes AI credits. SMS, voice minutes, and AI generations are billed at transparent rates with your margin built in. You profit on every interaction your clients make." },
];

const stats = [
  { label: "AI-Powered Tools", value: "18+" },
  { label: "Avg. Setup Time", value: "60s" },
  { label: "Cost Savings", value: "73%" },
  { label: "Revenue Channels", value: "6" },
];

export default function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [slotsLeft, setSlotsLeft] = useState(12);

  useEffect(() => {
    const stored = sessionStorage.getItem("apex_slots");
    if (stored) {
      setSlotsLeft(parseInt(stored));
    } else {
      const randomSlots = Math.floor(Math.random() * 5) + 8;
      setSlotsLeft(randomSlots);
      sessionStorage.setItem("apex_slots", String(randomSlots));
    }
  }, []);

  return (
    <div className="min-h-screen text-white overflow-x-hidden" style={{ backgroundColor: "#030014" }}>
      <div className="fixed inset-0 bg-grid z-0 pointer-events-none" />

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-black/60 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/apex-logo.png" alt="Apex" className="w-8 h-8" />
            <span className="font-black text-white tracking-tight hidden sm:block">APEX <span className="text-indigo-400 font-light text-xs">MARKETING AUTOMATIONS</span></span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm text-slate-400">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <a href="#testimonials" className="hover:text-white transition-colors">Testimonials</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
            <Link href="/demo" className="hover:text-white transition-colors">Live Demo</Link>
          </div>
          <a
            href="/api/login"
            className="px-5 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-sm font-bold rounded-lg transition-all shadow-lg shadow-indigo-500/20"
            data-testid="button-nav-login"
          >
            Sign In
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-32 pb-20 md:pt-44 md:pb-32 px-6">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1200px] h-[900px] bg-gradient-to-b from-indigo-600/20 via-purple-600/10 to-transparent rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-gradient-to-tr from-cyan-600/10 to-transparent rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-5xl mx-auto text-center">
          <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }}>
            <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-xs font-bold border border-red-500/40 bg-red-500/10 text-red-400 mb-6 animate-pulse" data-testid="badge-blitz">
              <Zap size={14} /> 30-DAY LAUNCH BLITZ — 50% OFF LOCKED FOREVER
            </div>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="text-5xl md:text-7xl lg:text-8xl font-black tracking-tight leading-[0.9] mb-6"
            data-testid="text-hero-title"
          >
            <span className="block">THE AI COMMAND</span>
            <span className="block bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
              CENTER FOR GROWTH
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-10"
          >
            18 AI-powered tools in one platform. Manage messaging, deploy voice agents, build websites, run ad campaigns, and automate everything — with zero code.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <a
              href="/api/login"
              className="px-10 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-500/25 text-lg flex items-center gap-2 hover:scale-105 active:scale-95"
              data-testid="button-hero-cta"
            >
              Start Free 60-Day Trial <ArrowRight size={20} />
            </a>
            <Link
              href="/demo"
              className="px-10 py-4 border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 text-white font-bold rounded-xl transition-all text-lg"
              data-testid="button-hero-demo"
            >
              Watch Live Demo
            </Link>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="text-xs text-slate-600 mt-6"
          >
            No credit card required. Cancel anytime.
          </motion.p>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="relative z-10 py-8 border-y border-white/5 bg-white/[0.02]">
        <div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="text-center"
            >
              <div className="text-3xl md:text-4xl font-black text-white">{stat.value}</div>
              <div className="text-xs text-slate-500 mt-1 uppercase tracking-wider">{stat.label}</div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="relative z-10 py-20 md:py-28 px-6">
        <div className="max-w-7xl mx-auto">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }} className="text-center mb-16">
            <motion.div variants={fadeUp} custom={0}>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-white/10 bg-white/5 text-slate-400 mb-4">
                18 POWERFUL MODULES
              </div>
            </motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="text-3xl md:text-5xl font-black tracking-tight" data-testid="text-features-title">
              Everything You Need to <span className="bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">Dominate</span>
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="text-slate-400 mt-4 max-w-2xl mx-auto">
              One platform replaces your CRM, dialer, site builder, ad manager, inbox, and chatbot tools. Save thousands per month.
            </motion.p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {tools.map((tool, i) => {
              const c = colorMap[tool.color] || colorMap.cyan;
              return (
                <motion.div
                  key={tool.title}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, margin: "-30px" }}
                  variants={fadeUp}
                  custom={i}
                  data-testid={`card-feature-${tool.title.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <div className={`group h-full bg-white/[0.03] border ${c.border} rounded-2xl p-5 hover:bg-white/[0.06] transition-all duration-300`}>
                    <div className="flex items-start gap-4">
                      <div className={`w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center shrink-0`}>
                        <tool.icon size={20} className={c.text} />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-white mb-1">{tool.title}</h3>
                        <p className="text-xs text-slate-400 leading-relaxed">{tool.desc}</p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section className="relative z-10 py-16 px-6 bg-gradient-to-b from-transparent via-indigo-600/5 to-transparent">
        <div className="max-w-5xl mx-auto text-center">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }}>
            <motion.h2 variants={fadeUp} custom={0} className="text-3xl md:text-5xl font-black tracking-tight mb-4">
              Why Choose <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">Apex</span>
            </motion.h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
            {[
              { icon: Users, title: "White-Label Ready", desc: "Fully rebrandable. Your logo, your domain, your clients. They never see our name." },
              { icon: Sparkles, title: "AI-Native Platform", desc: "Gemini AI powers chatbots, ad copy, site generation, voice agents, and sentiment analysis." },
              { icon: CircleDollarSign, title: "Built-In Revenue Engine", desc: "Markup pricing on every SMS, call, AI generation, and domain. You profit on every transaction." },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeUp}
                custom={i}
              >
                <div className="text-center p-8 bg-white/[0.03] border border-white/10 rounded-2xl h-full hover:border-white/20 transition-colors">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 mb-5">
                    <item.icon size={28} className="text-indigo-400" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">{item.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{item.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="relative z-10 py-20 md:py-28 px-6">
        <div className="max-w-7xl mx-auto">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} className="text-center mb-16">
            <motion.div variants={fadeUp} custom={0}>
              <div className="inline-block px-4 py-1 rounded-full border border-red-500/50 bg-red-500/10 text-red-500 text-[10px] font-black uppercase tracking-[0.4em] mb-6 animate-pulse">
                Live Event: 30-Day Launch Blitz
              </div>
            </motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="text-4xl md:text-6xl font-black tracking-tighter mb-4" data-testid="text-pricing-title">
              Grandfathered <span className="bg-gradient-to-r from-cyan-400 via-purple-500 to-red-500 bg-clip-text text-transparent">For Life.</span>
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="text-slate-400 text-lg max-w-2xl mx-auto">
              Secure <span className="text-white font-bold">50% off all tiers</span> forever. If you stay active, your price never changes. Ever.
            </motion.p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {tiers.map((tier, i) => (
              <motion.div
                key={tier.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                data-testid={`card-pricing-${tier.id}`}
              >
                <div className={`relative group p-[1px] rounded-3xl bg-gradient-to-b ${tier.gradient} transition-all duration-500 hover:scale-[1.02]`}>
                  <div className="bg-[#080808] rounded-[23px] p-8 h-full flex flex-col relative overflow-hidden">
                    <div className={`absolute -top-24 -right-24 w-48 h-48 bg-gradient-to-br ${tier.gradient} opacity-10 blur-3xl group-hover:opacity-20 transition-opacity`} />

                    {tier.popular && (
                      <span className="absolute top-4 right-4 bg-cyan-500 text-black text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest">
                        Most Popular
                      </span>
                    )}

                    <h3 className="text-sm font-black text-gray-500 uppercase tracking-[0.3em] mb-2">{tier.name}</h3>
                    <div className="flex items-baseline gap-3 mb-4">
                      <span className="text-5xl font-black text-white">${tier.price}</span>
                      <span className="text-gray-500 line-through text-xl">${tier.originalPrice}</span>
                      <span className="text-cyan-500 font-mono text-xs">/mo</span>
                    </div>

                    <p className="text-gray-400 text-sm mb-8 leading-relaxed">{tier.description}</p>

                    <ul className="space-y-3 mb-10 flex-grow">
                      {tier.features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-sm text-gray-300">
                          <CheckCircle2 size={14} className="text-cyan-400 mt-0.5 shrink-0" /> {f}
                        </li>
                      ))}
                    </ul>

                    <a
                      href="/api/login"
                      className={`w-full py-4 rounded-xl font-black uppercase tracking-widest transition-all shadow-lg text-center block ${
                        tier.popular
                          ? "bg-white text-black hover:bg-cyan-400"
                          : "bg-transparent border border-white/20 text-white hover:bg-white/5"
                      }`}
                      data-testid={`button-pricing-${tier.id}`}
                    >
                      Start Free Trial
                    </a>
                    <p className="text-[9px] text-center text-gray-600 mt-4 uppercase tracking-widest">
                      60-day free trial included
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="flex flex-col items-center mt-12"
          >
            <div className="w-full max-w-md bg-white/5 h-1 rounded-full overflow-hidden mb-4">
              <motion.div
                className="bg-gradient-to-r from-cyan-500 to-purple-600 h-full"
                initial={{ width: 0 }}
                whileInView={{ width: `${100 - slotsLeft}%` }}
                viewport={{ once: true }}
                transition={{ duration: 1.5, ease: "easeOut" }}
              />
            </div>
            <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest" data-testid="text-slots">
              Limited Founders Slots: {slotsLeft} / 100 Remaining
            </p>
          </motion.div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="testimonials" className="relative z-10 py-20 px-6 bg-gradient-to-b from-transparent via-purple-600/5 to-transparent">
        <div className="max-w-6xl mx-auto">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} className="text-center mb-16">
            <motion.h2 variants={fadeUp} custom={0} className="text-3xl md:text-5xl font-black tracking-tight" data-testid="text-testimonials-title">
              Trusted by <span className="bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-transparent">Growth Leaders</span>
            </motion.h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {testimonials.map((t, i) => (
              <motion.div
                key={t.name}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeUp}
                custom={i}
              >
                <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 h-full hover:border-white/20 transition-colors">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold text-sm">
                      {t.avatar}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">{t.name}</p>
                      <p className="text-xs text-slate-500">{t.role}</p>
                    </div>
                    <div className="ml-auto flex gap-0.5">
                      {[...Array(5)].map((_, si) => (
                        <Star key={si} size={12} className="text-yellow-400 fill-yellow-400" />
                      ))}
                    </div>
                  </div>
                  <p className="text-sm text-slate-300 leading-relaxed italic">"{t.quote}"</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="relative z-10 py-20 md:py-28 px-6">
        <div className="max-w-3xl mx-auto">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} className="text-center mb-16">
            <motion.h2 variants={fadeUp} custom={0} className="text-3xl md:text-5xl font-black tracking-tight">
              Frequently Asked <span className="bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">Questions</span>
            </motion.h2>
          </motion.div>

          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <motion.div
                key={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeUp}
                custom={i}
              >
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full text-left bg-white/[0.03] border border-white/10 rounded-xl p-5 hover:bg-white/[0.06] transition-colors"
                  data-testid={`faq-${i}`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-white pr-4">{faq.q}</p>
                    {openFaq === i ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
                  </div>
                  {openFaq === i && (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className="text-sm text-slate-400 mt-3 leading-relaxed"
                    >
                      {faq.a}
                    </motion.p>
                  )}
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative z-10 py-20 md:py-28 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="bg-gradient-to-r from-indigo-600/20 via-purple-600/20 to-cyan-600/20 border border-white/10 rounded-3xl p-12 md:p-16 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-indigo-500/20 to-transparent rounded-full blur-3xl pointer-events-none" />
              <div className="absolute bottom-0 left-0 w-64 h-64 bg-gradient-to-tr from-purple-500/20 to-transparent rounded-full blur-3xl pointer-events-none" />

              <div className="relative z-10">
                <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4">
                  Ready to Build Your <span className="bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">Empire?</span>
                </h2>
                <p className="text-slate-400 text-lg mb-8 max-w-xl mx-auto">
                  Join founders who are automating their growth with AI. Start your 60-day free trial today.
                </p>
                <a
                  href="/api/login"
                  className="inline-flex items-center gap-2 px-10 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-500/25 text-lg hover:scale-105 active:scale-95"
                  data-testid="button-final-cta"
                >
                  Get Started Free <ArrowRight size={20} />
                </a>
                <div className="flex items-center justify-center gap-6 mt-6 text-xs text-slate-500">
                  <span className="flex items-center gap-1"><Shield size={12} /> No credit card</span>
                  <span className="flex items-center gap-1"><CheckCircle2 size={12} /> 60-day trial</span>
                  <span className="flex items-center gap-1"><Zap size={12} /> Cancel anytime</span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 py-12 px-6 border-t border-white/5">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <img src="/apex-logo.png" alt="Apex" className="w-6 h-6" />
                <span className="font-bold text-white text-sm">Apex Marketing Automations</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                The AI-powered command center for modern businesses. Manage communications, deploy AI agents, and automate growth.
              </p>
            </div>
            <div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-3">Product</h4>
              <div className="space-y-2 text-xs text-slate-500">
                <a href="#features" className="block hover:text-white transition-colors">Features</a>
                <a href="#pricing" className="block hover:text-white transition-colors">Pricing</a>
                <Link href="/demo" className="block hover:text-white transition-colors">Live Demo</Link>
              </div>
            </div>
            <div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-3">Use Cases</h4>
              <div className="space-y-2 text-xs text-slate-500">
                <span className="block">Marketing Agencies</span>
                <span className="block">Personal Injury Firms</span>
                <span className="block">Real Estate</span>
                <span className="block">Local Businesses</span>
              </div>
            </div>
            <div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-3">Legal</h4>
              <div className="space-y-2 text-xs text-slate-500">
                <span className="block">Privacy Policy</span>
                <span className="block">Terms of Service</span>
                <span className="block">Cookie Policy</span>
              </div>
            </div>
          </div>
          <div className="border-t border-white/5 pt-6 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-xs text-slate-600">&copy; {new Date().getFullYear()} Apex Marketing Automations. All rights reserved.</p>
            <a
              href="/api/login"
              className="text-indigo-400 hover:text-indigo-300 text-sm font-medium transition-colors"
              data-testid="link-footer-login"
            >
              Sign In &rarr;
            </a>
          </div>
        </div>
      </footer>
      <SalesChatbot niche="general" accentColor="#6366f1" />
    </div>
  );
}
