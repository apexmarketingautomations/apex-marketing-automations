import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { SalesChatbot } from "@/components/sales-chatbot";
import {
  MessageSquare, GitFork, Bot, LayoutTemplate, Megaphone, Phone, Star,
  DollarSign, Link2, Rocket, TrendingUp, Palette, Sparkles, ArrowRight,
  Zap, Users, CircleDollarSign, Shield, CheckCircle2, ChevronDown, ChevronUp,
  BarChart3, Globe, Instagram, Target, Mail, Kanban, CalendarDays, Webhook,
  FileBarChart, Building2, Satellite, Brain, MapPin, FormInput, Layers,
  GitBranch, Workflow, Eye, Activity, Lock, Send, MessageCircle, FileText,
  Heart, Briefcase, Home, Stethoscope, Scale, Dumbbell, Camera, Car,
  Utensils, Scissors, GraduationCap, Wrench, ShoppingBag
} from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.06, duration: 0.5 },
  }),
};

const toolGroups = [
  {
    category: "Apex Intelligence",
    tagline: "An autonomous AI operator that runs the entire platform for you.",
    tools: [
      { icon: Brain, title: "Apex Intelligence", desc: "Autonomous AI operator — gives commands across the entire platform. Create contacts, launch campaigns, send messages, train bots. Just ask.", color: "violet" },
      { icon: Eye, title: "Real-Time Action Feed", desc: "Watch every action your AI takes in real time. Full audit trail across CRM, messaging, ads, and workflows.", color: "cyan" },
      { icon: Activity, title: "System Health Monitor", desc: "Live integrity scoring, fake-completion detection, and automatic learning from every outcome.", color: "emerald" },
      { icon: Bot, title: "Custom AI Bots", desc: "Train chatbots on any website with multi-page crawling. Deploy across SMS, IG, WhatsApp, FB, Telegram, and your site.", color: "green" },
    ],
  },
  {
    category: "Unified Communications",
    tagline: "Every conversation, every channel, in one inbox.",
    tools: [
      { icon: MessageSquare, title: "Unified Inbox", desc: "SMS, Instagram, WhatsApp, Facebook Messenger, Telegram & email — all in one AI-scored thread view.", color: "cyan" },
      { icon: Phone, title: "AI Voice Agent", desc: "24/7 AI receptionists with custom personas. Books appointments, answers questions, qualifies leads.", color: "blue" },
      { icon: Instagram, title: "Instagram DM Manager", desc: "Real-time IG conversations, comment-to-DM bots, story replies, automated qualification.", color: "fuchsia" },
      { icon: MessageCircle, title: "Meta Messaging Suite", desc: "Next-gen WhatsApp, Messenger & Instagram with template approvals, broadcast lists, and automation.", color: "sky" },
      { icon: Mail, title: "Email Campaigns", desc: "Drag-and-drop builder, templates, scheduling, segmentation, open/click tracking & A/B testing.", color: "rose" },
      { icon: Send, title: "SMS & MMS Marketing", desc: "Twilio-powered bulk messaging with opt-out compliance, link tracking, and AI-generated copy.", color: "pink" },
    ],
  },
  {
    category: "Marketing & Growth",
    tagline: "AI-powered ads, content, and lead generation.",
    tools: [
      { icon: Target, title: "Meta Ad Manager", desc: "Facebook & Instagram campaigns with AI copy, creative generation, audience targeting, and live analytics.", color: "sky" },
      { icon: Megaphone, title: "AI Ad Studio", desc: "Generate ads, headlines, and creative from one prompt. Powered by GPT-4o and Gemini.", color: "pink" },
      { icon: Satellite, title: "Apex Sentinel", desc: "Real-time incident scanning for personal injury, accident, and high-intent lead generation.", color: "amber" },
      { icon: MapPin, title: "Geofencing", desc: "Trigger ads, SMS, and workflows when prospects enter target locations. Hyper-local targeting.", color: "orange" },
      { icon: GitBranch, title: "A/B Testing", desc: "Split-test landing pages, ads, subject lines, and bot personas. Auto-promote winners.", color: "indigo" },
      { icon: FileText, title: "Content Planner", desc: "Generate, schedule, and publish posts across Instagram, Facebook, and LinkedIn from one calendar.", color: "rose" },
    ],
  },
  {
    category: "CRM, Pipeline & Booking",
    tagline: "Manage every lead, deal, and appointment in one place.",
    tools: [
      { icon: Kanban, title: "Visual CRM Pipeline", desc: "Drag-and-drop deal stages, conversion tracking, automated stage triggers, and revenue forecasting.", color: "indigo" },
      { icon: Users, title: "Contact Database", desc: "Tags, segments, geocoded addresses, opt-out tracking, custom fields, and bulk import.", color: "cyan" },
      { icon: CalendarDays, title: "Calendar & Booking", desc: "Multi-calendar scheduling, Google Calendar sync, automated reminders, and round-robin assignment.", color: "emerald" },
      { icon: FormInput, title: "Form Builder", desc: "Drag-and-drop lead capture forms with conditional logic, hidden fields, and webhook triggers.", color: "lime" },
      { icon: Star, title: "Reputation Manager", desc: "Smart review routing — happy clients to Google, unhappy ones to private feedback for recovery.", color: "yellow" },
    ],
  },
  {
    category: "Workflows & Automation",
    tagline: "Visual builders that run your business while you sleep.",
    tools: [
      { icon: Workflow, title: "Workflow Builder", desc: "Visual automation engine with triggers, delays, conditions, branching, and 50+ action blocks.", color: "purple" },
      { icon: Rocket, title: "God Mode", desc: "Launch an entire business in 60 seconds — phone number, AI agent, site, workflows, and pipeline.", color: "red" },
      { icon: Layers, title: "Funnel Builder", desc: "Multi-step lead funnels with upsells, downsells, and automated follow-up sequences.", color: "violet" },
      { icon: LayoutTemplate, title: "AI Site Builder", desc: "Generate full landing pages from a single prompt. 22 section types, mobile-optimized, hosted free.", color: "orange" },
      { icon: GitFork, title: "Snapshot Cloning", desc: "Save entire account setups (workflows, bots, sites, pipelines) as snapshots and deploy in one click.", color: "teal" },
    ],
  },
  {
    category: "Agency & White-Label",
    tagline: "Built for operators who run multiple businesses or clients.",
    tools: [
      { icon: Building2, title: "Multi-Tenant Sub-Accounts", desc: "Unlimited isolated workspaces — one for each client. Full data separation, role-based access.", color: "indigo" },
      { icon: Palette, title: "Full White-Label", desc: "Your brand, your domain, your colors, your login page. Clients never see Apex anywhere.", color: "violet" },
      { icon: Briefcase, title: "Agency Command Center", desc: "Manage every client account from one dashboard. Bulk actions, cross-account analytics, billing.", color: "blue" },
      { icon: ShoppingBag, title: "Snapshot Marketplace", desc: "Sell your snapshots to other agencies. Earn revenue on templates, workflows, and AI bots.", color: "emerald" },
      { icon: Heart, title: "Affiliate Program", desc: "Built-in referral tracking, payout dashboard, and tiered commissions. Grow with partners.", color: "rose" },
    ],
  },
  {
    category: "Platform & Integrations",
    tagline: "Real-time analytics, full APIs, and rock-solid foundations.",
    tools: [
      { icon: BarChart3, title: "Real-Time Analytics", desc: "Live dashboards for messages, AI usage, conversions, revenue, pipeline velocity, and ROI.", color: "lime" },
      { icon: Webhook, title: "Webhooks & Public API", desc: "Connect to Zapier, Make.com, n8n, or anything custom. Full REST API with API key auth.", color: "slate" },
      { icon: Globe, title: "Website Integration", desc: "Embed AI chatbots, lead forms, and tracking pixels on any site. WordPress, Shopify, custom — all supported.", color: "teal" },
      { icon: CircleDollarSign, title: "Stripe Billing & Credits", desc: "Built-in subscription billing, AI credits ledger, usage-based markup on every SMS/call/AI call.", color: "amber" },
      { icon: Lock, title: "Enterprise Security", desc: "Multi-factor auth, role-based permissions, full audit logs, encrypted secrets, and CSRF protection.", color: "cyan" },
    ],
  },
];

const tools = toolGroups.flatMap(g => g.tools);

const industries = [
  { icon: Stethoscope, name: "Med Spas & Aesthetic", path: "/medspa" },
  { icon: Scale, name: "Personal Injury Lawyers", path: "/lawyers" },
  { icon: Home, name: "Real Estate", path: "/realtors" },
  { icon: Wrench, name: "Home Services", path: "/home-services" },
  { icon: Dumbbell, name: "Gyms & Fitness", path: "/gym" },
  { icon: Heart, name: "Chiropractors", path: "/chiropractors" },
  { icon: Camera, name: "Photographers", path: "/photography" },
  { icon: Car, name: "Auto Dealerships", path: "/auto-dealers" },
  { icon: Briefcase, name: "Coaches & Consultants", path: "/coaches" },
  { icon: Utensils, name: "Restaurants", path: "/restaurants" },
  { icon: Stethoscope, name: "Dental Practices", path: "/dentists" },
  { icon: ShoppingBag, name: "E-Commerce Brands", path: "/ecommerce" },
  { icon: Shield, name: "Insurance Agencies", path: "/insurance" },
  { icon: Heart, name: "Pet Services", path: "/pet-services" },
  { icon: Star, name: "Wedding Vendors", path: "/wedding" },
  { icon: Megaphone, name: "Marketing Agencies", path: "/marketers" },
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

const faqs = [
  { q: "Is there a free trial?", a: "Yes! Every plan comes with a 60-day free trial. You get full access to all features in your tier with no credit card required to start." },
  { q: "What happens after the Blitz pricing ends?", a: "If you sign up during the 30-day Blitz window, your price is locked forever. As long as your subscription stays active, you'll never pay more than your launch price." },
  { q: "Can I switch plans later?", a: "Absolutely. You can upgrade or downgrade at any time. If you upgrade, you'll get prorated credit for your current billing cycle." },
  { q: "What is a sub-account?", a: "A sub-account is a separate workspace for a client or business. Each has its own inbox, contacts, workflows, and AI bots. Agency Pro and God Mode include unlimited sub-accounts." },
  { q: "Do I need coding skills?", a: "Not at all. Everything is drag-and-drop or AI-generated. From websites to workflows to chatbots — no code required." },
  { q: "How does usage billing work?", a: "Your plan includes AI credits. SMS, voice minutes, and AI generations are billed at transparent rates with your margin built in. You profit on every interaction your clients make." },
];

const stats = [
  { label: "Built-In Tools", value: "35+" },
  { label: "Industries Supported", value: "16" },
  { label: "Communication Channels", value: "8" },
  { label: "Average Tools Replaced", value: "12" },
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
            <a href="#apex-intelligence" className="hover:text-white transition-colors">Intelligence</a>
            <a href="#industries" className="hover:text-white transition-colors">Industries</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
            <Link href="/demo" className="hover:text-white transition-colors">Live Demo</Link>
          </div>
          <a
            href="/login"
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
            className="text-4xl md:text-6xl lg:text-7xl font-black tracking-tight leading-[1.05] mb-6"
            data-testid="text-hero-title"
          >
            <span className="block">AI marketing that</span>
            <span className="block bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
              actually gets the work done.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-lg md:text-xl text-slate-300 max-w-2xl mx-auto mb-8"
            data-testid="text-hero-subtitle"
          >
            Apex helps you capture leads, follow up automatically, book more appointments, and run your marketing from one place — without juggling five different tools.
          </motion.p>

          <motion.ul
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="max-w-xl mx-auto mb-10 space-y-2 text-left"
            data-testid="list-hero-bullets"
          >
            {[
              "Automate follow-ups, campaigns, and lead management",
              "Keep every conversation, contact, and task in one system",
              "Built for real businesses that want results, not more software",
            ].map((bullet, idx) => (
              <li
                key={idx}
                className="flex items-start gap-3 text-slate-300 text-base md:text-lg"
                data-testid={`text-hero-bullet-${idx}`}
              >
                <CheckCircle2 size={20} className="text-cyan-400 shrink-0 mt-0.5" />
                <span>{bullet}</span>
              </li>
            ))}
          </motion.ul>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <a
              href="/login"
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
                The Full Platform — 35+ Tools
              </div>
            </motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="text-3xl md:text-5xl font-black tracking-tight" data-testid="text-features-title">
              The entire stack. <span className="bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">Already built.</span>
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="text-slate-300 mt-4 max-w-2xl mx-auto text-base md:text-lg">
              35+ tools across 7 categories — replacing GoHighLevel, HubSpot, Twilio Flex, Vapi, Manychat, Calendly, Mailchimp, Zapier and a dozen others. All under one login, one bill, one AI brain.
            </motion.p>
          </motion.div>

          <div className="space-y-14">
            {toolGroups.map((group, gi) => (
              <motion.div
                key={group.category}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-50px" }}
                data-testid={`group-${group.category.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <motion.div variants={fadeUp} custom={0} className="mb-6 flex items-end justify-between flex-wrap gap-2">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-400 mb-2">
                      {String(gi + 1).padStart(2, "0")} / {String(toolGroups.length).padStart(2, "0")}
                    </div>
                    <h3 className="text-2xl md:text-3xl font-black text-white tracking-tight">{group.category}</h3>
                  </div>
                  <p className="text-sm text-slate-400 max-w-md text-right">{group.tagline}</p>
                </motion.div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {group.tools.map((tool, i) => {
                    const c = colorMap[tool.color] || colorMap.cyan;
                    return (
                      <motion.div
                        key={tool.title}
                        variants={fadeUp}
                        custom={i + 1}
                        data-testid={`card-feature-${tool.title.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <div className={`group h-full bg-white/[0.03] border ${c.border} rounded-2xl p-5 hover:bg-white/[0.06] hover:border-white/20 transition-all duration-300`}>
                          <div className="flex items-start gap-4">
                            <div className={`w-11 h-11 rounded-xl ${c.bg} flex items-center justify-center shrink-0`}>
                              <tool.icon size={22} className={c.text} />
                            </div>
                            <div>
                              <h4 className="text-base font-bold text-white mb-1.5">{tool.title}</h4>
                              <p className="text-xs text-slate-400 leading-relaxed">{tool.desc}</p>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Industries */}
      <section id="industries" className="relative z-10 py-20 md:py-28 px-6 bg-gradient-to-b from-transparent via-cyan-600/5 to-transparent">
        <div className="max-w-6xl mx-auto">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} className="text-center mb-12">
            <motion.div variants={fadeUp} custom={0}>
              <div className="inline-block px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.3em] text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 mb-4">
                Pre-Built Templates Included
              </div>
            </motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="text-3xl md:text-5xl font-black tracking-tight" data-testid="text-industries-title">
              Built for <span className="bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-transparent">your industry</span>
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="text-slate-400 mt-4 max-w-2xl mx-auto">
              16 ready-to-deploy industry templates with pre-built funnels, AI bot personas, follow-up sequences, and ad creative. Pick yours and launch in minutes.
            </motion.p>
          </motion.div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {industries.map((ind, i) => (
              <motion.a
                key={ind.name}
                href={ind.path}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-30px" }}
                variants={fadeUp}
                custom={i}
                className="group flex items-center gap-3 p-4 bg-white/[0.03] border border-white/10 hover:border-cyan-500/40 hover:bg-white/[0.06] rounded-xl transition-all"
                data-testid={`link-industry-${ind.name.toLowerCase().replace(/\s+/g, "-").replace(/&/g, "and")}`}
              >
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500/20 to-cyan-500/20 border border-indigo-500/20 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                  <ind.icon size={16} className="text-indigo-400" />
                </div>
                <span className="text-sm font-semibold text-slate-200 group-hover:text-white transition-colors leading-tight">{ind.name}</span>
              </motion.a>
            ))}
          </div>

          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-center text-xs text-slate-500 mt-8"
          >
            Don't see your industry? Apex works for any business — and the AI Site Builder generates a custom funnel from a single prompt.
          </motion.p>
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
                      href="/login"
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

      {/* Apex Intelligence Spotlight */}
      <section id="apex-intelligence" className="relative z-10 py-20 md:py-28 px-6 bg-gradient-to-b from-transparent via-violet-600/10 to-transparent">
        <div className="max-w-6xl mx-auto">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} className="text-center mb-12">
            <motion.div variants={fadeUp} custom={0}>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.3em] text-violet-300 bg-violet-500/10 border border-violet-500/30 mb-4">
                <Brain size={12} /> The Brain Behind It All
              </div>
            </motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="text-3xl md:text-5xl font-black tracking-tight mb-4" data-testid="text-intelligence-title">
              Meet <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-cyan-400 bg-clip-text text-transparent">Apex Intelligence</span>
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="text-slate-300 text-lg max-w-3xl mx-auto leading-relaxed">
              An autonomous AI operator that runs your entire platform. Tell it what you want — it executes across CRM, ads, messaging, workflows, calendar, and reviews. Every action is logged, scored, and verifiable.
            </motion.p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              { icon: MessageCircle, title: "Just talk to it", desc: '"Send a follow-up to every lead from yesterday who didn\'t book." It does it. Then shows you the receipts.' },
              { icon: Workflow, title: "Cross-platform execution", desc: "One command can fire ads, create contacts, build workflows, and send messages — across every connected channel." },
              { icon: Eye, title: "Full transparency", desc: "Every API call, every error, every outcome is captured. No hidden actions. No black-box behavior." },
              { icon: Activity, title: "Self-correcting", desc: "Detects fake completions, missing dependencies, and broken integrations. Tells you what to fix and how." },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeUp}
                custom={i}
                data-testid={`card-intelligence-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div className="h-full p-6 rounded-2xl bg-gradient-to-br from-violet-500/10 to-fuchsia-500/5 border border-violet-500/20 hover:border-violet-500/40 transition-colors">
                  <div className="flex items-start gap-4">
                    <div className="w-11 h-11 rounded-xl bg-violet-500/20 flex items-center justify-center shrink-0">
                      <item.icon size={22} className="text-violet-300" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white mb-2">{item.title}</h3>
                      <p className="text-sm text-slate-400 leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mt-12 text-center"
          >
            <div className="inline-flex flex-wrap items-center justify-center gap-2 text-xs text-slate-400">
              <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">9 tool families</span>
              <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">76 policy rules</span>
              <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">105 module events tracked</span>
              <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">Universal audit trail</span>
            </div>
          </motion.div>
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
                  href="/login"
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
              <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-3">Industries</h4>
              <div className="space-y-2 text-xs text-slate-500">
                <a href="/medspa" className="block hover:text-white transition-colors">Med Spas</a>
                <a href="/lawyers" className="block hover:text-white transition-colors">Personal Injury</a>
                <a href="/realtors" className="block hover:text-white transition-colors">Real Estate</a>
                <a href="/marketers" className="block hover:text-white transition-colors">Marketing Agencies</a>
                <a href="#industries" className="block hover:text-white transition-colors">View all 16 →</a>
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
            <div className="flex items-center gap-4">
              <a href="/privacy" className="text-slate-500 hover:text-slate-300 text-xs transition-colors" data-testid="link-footer-privacy">Privacy Policy</a>
              <a href="/terms" className="text-slate-500 hover:text-slate-300 text-xs transition-colors" data-testid="link-footer-terms">Terms of Service</a>
              <a
                href="/login"
                className="text-indigo-400 hover:text-indigo-300 text-sm font-medium transition-colors"
                data-testid="link-footer-login"
              >
                Sign In &rarr;
              </a>
            </div>
          </div>
        </div>
      </footer>
      <SalesChatbot niche="general" accentColor="#6366f1" />
    </div>
  );
}
