import { useState, useEffect, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Link } from "wouter";
import {
  ArrowRight, Zap, CheckCircle2, ChevronDown, ChevronUp,
  BarChart3, Target, Mail, Bot, MessageSquare, Phone,
  GitFork, Rocket, Globe, Users, TrendingUp, Clock,
  Sparkles, Shield, Star, DollarSign, Play, X,
  MousePointer, Send, Brain, Layers, PieChart, Eye
} from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.08, duration: 0.5, ease: "easeOut" },
  }),
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

function CountUp({ end, suffix = "", duration = 2000 }: { end: number; suffix?: string; duration?: number }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });

  useEffect(() => {
    if (!inView) return;
    let start = 0;
    const step = end / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= end) { setCount(end); clearInterval(timer); }
      else setCount(Math.floor(start));
    }, 16);
    return () => clearInterval(timer);
  }, [inView, end, duration]);

  return <span ref={ref}>{count}{suffix}</span>;
}

const painPoints = [
  { icon: Layers, title: "Too Many Tools", desc: "You're juggling 6-8 different platforms just to run basic campaigns. Each with its own login, pricing, and learning curve." },
  { icon: Clock, title: "Hours Wasted Daily", desc: "Manual follow-ups, copy-pasting between apps, and rebuilding the same workflows over and over." },
  { icon: DollarSign, title: "Bleeding Budget", desc: "Paying $500-2,000/mo across multiple subscriptions when 80% of features overlap." },
  { icon: Eye, title: "No Unified View", desc: "Campaign data lives in silos. You can't see the full picture without exporting spreadsheets." },
];

const features = [
  {
    icon: MessageSquare,
    title: "Unified Omnichannel Inbox",
    desc: "SMS, Instagram DMs, email, and WhatsApp in one inbox. AI scores every conversation and suggests replies in real time.",
    gradient: "from-cyan-500 to-blue-600",
    stat: "3x faster response time",
  },
  {
    icon: Bot,
    title: "AI Chatbot & Voice Agent",
    desc: "Train bots on your client's website content. Deploy 24/7 AI receptionists that book appointments and qualify leads automatically.",
    gradient: "from-purple-500 to-indigo-600",
    stat: "85% of inquiries handled by AI",
  },
  {
    icon: GitFork,
    title: "Visual Workflow Automations",
    desc: "Drag-and-drop automation builder with triggers, conditions, delays, and multi-channel actions. No code required.",
    gradient: "from-orange-500 to-red-600",
    stat: "Save 15+ hours/week",
  },
  {
    icon: Target,
    title: "Meta Ads & Lead Capture",
    desc: "Launch Facebook & Instagram ad campaigns with AI-generated copy and creatives. Leads flow directly into your CRM pipeline.",
    gradient: "from-pink-500 to-rose-600",
    stat: "42% lower cost per lead",
  },
  {
    icon: Globe,
    title: "AI Site & Funnel Builder",
    desc: "Generate full landing pages from a single prompt. 22 section types, responsive design, embedded chat widgets, and form builders.",
    gradient: "from-emerald-500 to-teal-600",
    stat: "Launch sites in under 60 seconds",
  },
  {
    icon: BarChart3,
    title: "Real-Time Analytics Dashboard",
    desc: "Track ROI, conversion rates, pipeline value, ad performance, and message volume with beautiful interactive charts.",
    gradient: "from-amber-500 to-orange-600",
    stat: "Full-funnel visibility",
  },
];

const workflows = [
  { trigger: "New Lead Captured", actions: ["AI Qualification", "Add to Pipeline", "Send SMS Intro", "Book Appointment"], color: "cyan" },
  { trigger: "Missed Call Detected", actions: ["AI Voice Callback", "SMS Follow-Up", "Slack Notification", "Log to CRM"], color: "purple" },
  { trigger: "Review Request Sent", actions: ["Wait 2 Hours", "Check Response", "Route to Google/Private", "Thank You SMS"], color: "orange" },
];

const testimonials = [
  {
    quote: "We replaced HubSpot, Calendly, ManyChat, and our phone system with Apex. Saving $1,200/mo and getting better results.",
    name: "Jessica Park",
    role: "Digital Marketing Agency",
    metric: "$1,200/mo saved",
  },
  {
    quote: "The AI voice agent books 3x more appointments than our human receptionist did. Clients can't tell it's AI.",
    name: "Marcus Chen",
    role: "Med Spa Marketing",
    metric: "3x more bookings",
  },
  {
    quote: "God Mode lets me onboard a new client in 60 seconds. Phone number, website, workflows, AI bot — all deployed instantly.",
    name: "David Ramirez",
    role: "Growth Agency Owner",
    metric: "60s client setup",
  },
  {
    quote: "Sentinel catches leads from local incidents before anyone else. We went from 5 to 40 personal injury leads per month.",
    name: "Sarah Williams",
    role: "Legal Marketing",
    metric: "8x more leads",
  },
];

const comparisonTools = [
  { name: "CRM & Pipeline", them: "$99/mo", apex: "Included" },
  { name: "SMS & Email Inbox", them: "$79/mo", apex: "Included" },
  { name: "AI Chatbot", them: "$149/mo", apex: "Included" },
  { name: "Landing Page Builder", them: "$97/mo", apex: "Included" },
  { name: "Workflow Automations", them: "$49/mo", apex: "Included" },
  { name: "Social Media Inbox", them: "$59/mo", apex: "Included" },
  { name: "Voice AI / Phone System", them: "$199/mo", apex: "Included" },
  { name: "Analytics & Reporting", them: "$79/mo", apex: "Included" },
];

const faqs = [
  { q: "Who is Apex built for?", a: "Marketing agencies, freelance marketers, consultants, and any business that needs to manage client communications, run campaigns, and automate follow-ups. Whether you're a solo marketer or running a 50-person agency, Apex scales with you." },
  { q: "Do I need technical skills?", a: "Zero coding required. Everything is visual — drag-and-drop workflows, prompt-based site generation, one-click bot training, and pre-built templates for every industry." },
  { q: "Can I white-label Apex for my agency?", a: "Absolutely. On the God Mode plan, you get full white-labeling — your logo, your domain, your colors. Your clients will never see the Apex brand." },
  { q: "How does the AI bot training work?", a: "Just paste your client's website URL. Our AI scrapes the content, builds a knowledge base, and deploys a chatbot that can answer questions, book appointments, and qualify leads — all trained on their specific business." },
  { q: "What integrations are available?", a: "Native integrations with Google Calendar, Gmail, Google Sheets, Slack, Zapier, Stripe, Twilio, Meta Ads, and more. Plus webhooks to connect virtually anything." },
  { q: "Is there a free trial?", a: "Yes! Every plan includes a 60-day free trial with full access to all features in your tier. No credit card required to start." },
];

export default function MarketersLanding() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div className="min-h-screen text-white overflow-x-hidden" style={{ backgroundColor: "#030014" }} data-testid="marketers-landing">
      <div className="fixed inset-0 pointer-events-none" style={{
        backgroundImage: "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(99,102,241,0.15), transparent)",
      }} />

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#030014]/80 backdrop-blur-2xl border-b border-white/[0.06]" data-testid="nav-bar">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Zap size={16} className="text-white" />
            </div>
            <span className="font-black text-white tracking-tight text-lg">APEX</span>
            <span className="text-[10px] font-medium text-indigo-400 tracking-[0.2em] uppercase hidden sm:block">for Marketers</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm text-slate-400">
            <a href="#problem" className="hover:text-white transition-colors" data-testid="link-nav-problem">The Problem</a>
            <a href="#features" className="hover:text-white transition-colors" data-testid="link-nav-features">Features</a>
            <a href="#proof" className="hover:text-white transition-colors" data-testid="link-nav-proof">Results</a>
            <a href="#pricing" className="hover:text-white transition-colors" data-testid="link-nav-pricing">Pricing</a>
            <a href="#faq" className="hover:text-white transition-colors" data-testid="link-nav-faq">FAQ</a>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/demo"
              className="hidden sm:flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:text-white transition-colors"
              data-testid="link-nav-demo"
            >
              <Play size={14} /> Live Demo
            </Link>
            <a
              href="/api/login"
              className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/40"
              data-testid="button-nav-get-started"
            >
              Get Started Free
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-28 pb-16 md:pt-40 md:pb-28 px-6">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[800px] bg-gradient-to-b from-indigo-600/20 via-purple-600/10 to-transparent rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-40 right-0 w-[400px] h-[400px] bg-gradient-to-bl from-cyan-600/10 to-transparent rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-5xl mx-auto text-center">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }}>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 mb-8" data-testid="badge-hero">
              <Sparkles size={14} /> Built Specifically for Marketing Professionals
            </div>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-black tracking-tight leading-[0.95] mb-6"
            data-testid="text-hero-title"
          >
            <span className="block text-white">Stop Juggling</span>
            <span className="block bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
              Start Dominating
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.5 }}
            className="text-base sm:text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed"
            data-testid="text-hero-subtitle"
          >
            One AI-powered platform replaces your CRM, inbox, dialer, site builder, ad manager, and chatbot tools.
            Save thousands per month. Close more deals. Work less.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <a
              href="/api/login"
              className="w-full sm:w-auto px-10 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold rounded-2xl transition-all shadow-lg shadow-indigo-500/25 text-lg flex items-center justify-center gap-2 hover:scale-[1.03] active:scale-[0.98]"
              data-testid="button-hero-cta"
            >
              Start Your Free Trial <ArrowRight size={20} />
            </a>
            <Link
              href="/demo"
              className="w-full sm:w-auto px-10 py-4 border border-white/10 hover:border-white/20 bg-white/[0.03] hover:bg-white/[0.06] text-white font-bold rounded-2xl transition-all text-lg flex items-center justify-center gap-2"
              data-testid="button-hero-demo"
            >
              <Play size={18} /> Watch It In Action
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="flex items-center justify-center gap-6 mt-8 text-xs text-slate-500"
          >
            <span className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-green-500" /> No credit card</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-green-500" /> 60-day trial</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-green-500" /> Cancel anytime</span>
          </motion.div>
        </div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.6 }}
          className="relative z-10 max-w-4xl mx-auto mt-16 md:mt-24"
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { value: 18, suffix: "+", label: "AI-Powered Tools" },
              { value: 73, suffix: "%", label: "Cost Savings" },
              { value: 60, suffix: "s", label: "Avg. Setup Time" },
              { value: 15, suffix: "+", label: "Hours Saved / Week" },
            ].map((s, i) => (
              <div key={s.label} className="text-center p-5 bg-white/[0.03] border border-white/[0.06] rounded-2xl" data-testid={`stat-${i}`}>
                <div className="text-2xl md:text-3xl font-black text-white"><CountUp end={s.value} suffix={s.suffix} /></div>
                <div className="text-[11px] text-slate-500 mt-1 uppercase tracking-wider">{s.label}</div>
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Problem Section */}
      <section id="problem" className="relative z-10 py-20 md:py-28 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }} className="text-center mb-16">
            <motion.div variants={fadeUp} custom={0}>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold border border-red-500/30 bg-red-500/10 text-red-400 mb-4">
                THE PROBLEM
              </div>
            </motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="text-3xl md:text-5xl font-black tracking-tight mb-4" data-testid="text-problem-title">
              Marketers Are <span className="bg-gradient-to-r from-red-400 to-orange-400 bg-clip-text text-transparent">Drowning</span> in Tools
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="text-slate-400 max-w-2xl mx-auto text-lg">
              The average marketing team uses 8+ different platforms. That's 8 logins, 8 invoices, and zero integration.
            </motion.p>
          </motion.div>

          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger} className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {painPoints.map((p, i) => (
              <motion.div key={p.title} variants={fadeUp} custom={i} data-testid={`card-pain-${i}`}>
                <div className="group p-6 bg-white/[0.02] border border-red-500/10 hover:border-red-500/20 rounded-2xl transition-all h-full">
                  <div className="flex items-start gap-4">
                    <div className="w-11 h-11 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
                      <p.icon size={22} className="text-red-400" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white mb-2">{p.title}</h3>
                      <p className="text-sm text-slate-400 leading-relaxed">{p.desc}</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mt-12 text-center"
          >
            <div className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-500/20">
              <ArrowRight size={16} className="text-indigo-400" />
              <span className="text-sm font-medium text-indigo-300">There's a better way. One platform. Everything you need.</span>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative z-10 py-20 md:py-28 px-6 bg-gradient-to-b from-transparent via-indigo-600/[0.03] to-transparent">
        <div className="max-w-7xl mx-auto">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }} className="text-center mb-16">
            <motion.div variants={fadeUp} custom={0}>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 mb-4">
                THE SOLUTION
              </div>
            </motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="text-3xl md:text-5xl font-black tracking-tight mb-4" data-testid="text-features-title">
              Everything Marketers Need <span className="bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">In One Place</span>
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="text-slate-400 max-w-2xl mx-auto text-lg">
              18 AI-powered modules designed from the ground up for marketing teams and agencies.
            </motion.p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-30px" }}
                transition={{ delay: i * 0.08 }}
                data-testid={`card-feature-${i}`}
              >
                <div className="group h-full bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.12] rounded-2xl p-6 transition-all duration-300 hover:bg-white/[0.05]">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.gradient} flex items-center justify-center mb-5 shadow-lg`}>
                    <f.icon size={22} className="text-white" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">{f.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed mb-4">{f.desc}</p>
                  <div className="flex items-center gap-2 text-xs font-semibold text-indigo-400">
                    <TrendingUp size={14} />
                    {f.stat}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Workflow Preview */}
      <section className="relative z-10 py-20 md:py-28 px-6">
        <div className="max-w-5xl mx-auto">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }} className="text-center mb-16">
            <motion.div variants={fadeUp} custom={0}>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold border border-purple-500/30 bg-purple-500/10 text-purple-300 mb-4">
                AUTOMATIONS
              </div>
            </motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="text-3xl md:text-5xl font-black tracking-tight mb-4" data-testid="text-workflows-title">
              Automate Your <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">Entire Funnel</span>
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="text-slate-400 max-w-2xl mx-auto text-lg">
              Pre-built workflow templates that run 24/7. From lead capture to close — on autopilot.
            </motion.p>
          </motion.div>

          <div className="space-y-5">
            {workflows.map((wf, i) => {
              const colors: Record<string, { border: string; bg: string; text: string; dot: string }> = {
                cyan: { border: "border-cyan-500/20", bg: "bg-cyan-500/10", text: "text-cyan-400", dot: "bg-cyan-500" },
                purple: { border: "border-purple-500/20", bg: "bg-purple-500/10", text: "text-purple-400", dot: "bg-purple-500" },
                orange: { border: "border-orange-500/20", bg: "bg-orange-500/10", text: "text-orange-400", dot: "bg-orange-500" },
              };
              const c = colors[wf.color];
              return (
                <motion.div
                  key={wf.trigger}
                  initial={{ opacity: 0, x: -30 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.15 }}
                  className={`p-5 bg-white/[0.02] border ${c.border} rounded-2xl`}
                  data-testid={`workflow-${i}`}
                >
                  <div className="flex flex-col md:flex-row md:items-center gap-4">
                    <div className={`flex items-center gap-3 shrink-0 px-4 py-2.5 rounded-xl ${c.bg}`}>
                      <Zap size={16} className={c.text} />
                      <span className={`text-sm font-bold ${c.text}`}>{wf.trigger}</span>
                    </div>
                    <div className="hidden md:block">
                      <ArrowRight size={18} className="text-slate-600" />
                    </div>
                    <div className="flex flex-wrap gap-2 flex-1">
                      {wf.actions.map((action, j) => (
                        <div key={action} className="flex items-center gap-2">
                          {j > 0 && <div className="w-4 border-t border-dashed border-slate-700 hidden sm:block" />}
                          <span className="px-3 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded-lg text-xs text-slate-300 font-medium">
                            {action}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section id="proof" className="relative z-10 py-20 md:py-28 px-6 bg-gradient-to-b from-transparent via-purple-600/[0.04] to-transparent">
        <div className="max-w-6xl mx-auto">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }} className="text-center mb-16">
            <motion.div variants={fadeUp} custom={0}>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold border border-amber-500/30 bg-amber-500/10 text-amber-300 mb-4">
                RESULTS
              </div>
            </motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="text-3xl md:text-5xl font-black tracking-tight mb-4" data-testid="text-proof-title">
              Marketers Are <span className="bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">Winning</span> With Apex
            </motion.h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {testimonials.map((t, i) => (
              <motion.div
                key={t.name}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                data-testid={`card-testimonial-${i}`}
              >
                <div className="h-full p-6 bg-white/[0.03] border border-white/[0.06] rounded-2xl hover:border-white/[0.12] transition-colors">
                  <div className="flex items-center gap-1 mb-4">
                    {[...Array(5)].map((_, j) => (
                      <Star key={j} size={14} className="text-amber-400 fill-amber-400" />
                    ))}
                  </div>
                  <p className="text-sm text-slate-300 leading-relaxed mb-5 italic">"{t.quote}"</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-sm font-bold text-white">
                        {t.name.charAt(0)}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white">{t.name}</div>
                        <div className="text-xs text-slate-500">{t.role}</div>
                      </div>
                    </div>
                    <div className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-full">
                      {t.metric}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Cost Comparison */}
      <section id="pricing" className="relative z-10 py-20 md:py-28 px-6">
        <div className="max-w-4xl mx-auto">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }} className="text-center mb-16">
            <motion.div variants={fadeUp} custom={0}>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 mb-4">
                SAVE $800+/mo
              </div>
            </motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="text-3xl md:text-5xl font-black tracking-tight mb-4" data-testid="text-pricing-title">
              Replace <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">8 Tools</span> With One
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="text-slate-400 max-w-xl mx-auto text-lg">
              Stop paying for overlap. Get everything in a single subscription starting at $48/mo.
            </motion.p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="overflow-hidden rounded-2xl border border-white/[0.08]"
          >
            <div className="grid grid-cols-3 bg-white/[0.04] p-4 border-b border-white/[0.08]">
              <div className="text-sm font-bold text-slate-400">Feature</div>
              <div className="text-sm font-bold text-red-400 text-center">Other Tools</div>
              <div className="text-sm font-bold text-emerald-400 text-center">Apex</div>
            </div>
            {comparisonTools.map((row, i) => (
              <div key={row.name} className={`grid grid-cols-3 p-4 ${i % 2 === 0 ? "bg-white/[0.02]" : ""} border-b border-white/[0.04] last:border-0`} data-testid={`row-compare-${i}`}>
                <div className="text-sm text-slate-300">{row.name}</div>
                <div className="text-sm text-red-400/70 text-center line-through">{row.them}</div>
                <div className="text-sm text-emerald-400 text-center font-semibold flex items-center justify-center gap-1.5">
                  <CheckCircle2 size={14} /> {row.apex}
                </div>
              </div>
            ))}
            <div className="grid grid-cols-3 p-4 bg-white/[0.04] border-t border-white/[0.08]">
              <div className="text-sm font-bold text-white">Total Monthly Cost</div>
              <div className="text-lg font-black text-red-400 text-center">$810/mo</div>
              <div className="text-lg font-black text-emerald-400 text-center">$48/mo</div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mt-10 text-center"
          >
            <a
              href="/api/login"
              className="inline-flex items-center gap-2 px-10 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold rounded-2xl transition-all shadow-lg shadow-indigo-500/25 text-lg hover:scale-[1.03] active:scale-[0.98]"
              data-testid="button-pricing-cta"
            >
              Start Saving Today <ArrowRight size={20} />
            </a>
            <p className="text-xs text-slate-500 mt-4">60-day free trial. No credit card required.</p>
          </motion.div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="relative z-10 py-20 md:py-28 px-6 bg-gradient-to-b from-transparent via-indigo-600/[0.03] to-transparent">
        <div className="max-w-3xl mx-auto">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }} className="text-center mb-16">
            <motion.h2 variants={fadeUp} custom={0} className="text-3xl md:text-5xl font-black tracking-tight mb-4" data-testid="text-faq-title">
              Frequently Asked Questions
            </motion.h2>
          </motion.div>

          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06 }}
                data-testid={`faq-${i}`}
              >
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full text-left p-5 bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.12] rounded-2xl transition-all"
                  data-testid={`button-faq-${i}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white pr-4">{faq.q}</span>
                    {openFaq === i ? <ChevronUp size={18} className="text-slate-400 shrink-0" /> : <ChevronDown size={18} className="text-slate-400 shrink-0" />}
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
          <div className="relative p-10 md:p-16 rounded-3xl overflow-hidden border border-indigo-500/20">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/20 via-purple-600/10 to-cyan-600/10" />
            <div className="absolute inset-0 bg-[#030014]/70" />

            <div className="relative z-10">
              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="text-3xl md:text-5xl font-black tracking-tight mb-4"
                data-testid="text-final-cta"
              >
                Ready to <span className="bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">10x</span> Your Marketing?
              </motion.h2>
              <motion.p
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 }}
                className="text-slate-400 text-lg max-w-xl mx-auto mb-8"
              >
                Join thousands of marketers who stopped paying for 8 tools and started growing with one.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.2 }}
                className="flex flex-col sm:flex-row items-center justify-center gap-4"
              >
                <a
                  href="/api/login"
                  className="w-full sm:w-auto px-10 py-4 bg-white text-black font-bold rounded-2xl transition-all text-lg flex items-center justify-center gap-2 hover:bg-indigo-100 hover:scale-[1.03] active:scale-[0.98]"
                  data-testid="button-final-cta"
                >
                  Get Started Free <ArrowRight size={20} />
                </a>
                <Link
                  href="/demo"
                  className="w-full sm:w-auto px-10 py-4 border border-white/20 hover:border-white/30 text-white font-bold rounded-2xl transition-all text-lg flex items-center justify-center gap-2"
                  data-testid="button-final-demo"
                >
                  <Play size={18} /> See Live Demo
                </Link>
              </motion.div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/[0.06] py-12 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Zap size={14} className="text-white" />
            </div>
            <span className="font-bold text-white text-sm">APEX</span>
            <span className="text-[10px] text-slate-500">for Marketers</span>
          </div>
          <div className="flex items-center gap-8 text-xs text-slate-500">
            <Link href="/pricing" className="hover:text-white transition-colors">Pricing</Link>
            <Link href="/demo" className="hover:text-white transition-colors">Demo</Link>
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
          </div>
          <p className="text-xs text-slate-600">&copy; {new Date().getFullYear()} Apex Marketing Automations</p>
        </div>
      </footer>
    </div>
  );
}
