import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import {
  ArrowRight, Zap, CheckCircle2, ChevronDown, ChevronUp,
  Home, Users, Phone, MessageSquare, Bot, Globe,
  TrendingUp, Clock, Sparkles, Star, DollarSign, Play,
  MapPin, Building2, Key, CalendarDays, BarChart3, Target,
  Eye, Mail
} from "lucide-react";

function CountUp({ end, suffix = "", duration = 2000 }: { end: number; suffix?: string; duration?: number }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setInView(true); obs.disconnect(); } }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

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
  { icon: Clock, title: "Lost Leads", desc: "Buyers expect instant replies. Every minute of delay costs you deals — 78% of buyers go with the first agent who responds." },
  { icon: MapPin, title: "Scattered Listings", desc: "Managing leads from Zillow, Realtor.com, Facebook, and open houses across different apps is chaos." },
  { icon: DollarSign, title: "Expensive Tech Stack", desc: "CRM, dialer, email tool, website builder, chatbot — you're paying $600-1,500/mo for tools that barely talk to each other." },
  { icon: Eye, title: "No Follow-Up System", desc: "80% of sales happen after the 5th contact. Without automation, warm leads go cold while you're showing houses." },
];

const features = [
  {
    icon: Phone,
    title: "AI Voice Agent & Auto-Dialer",
    desc: "24/7 AI receptionist that qualifies buyers, books showings, and handles calls while you're at listings. Ghost SDR parallel dialer for prospecting.",
    gradient: "from-blue-500 to-indigo-600",
    stat: "Never miss a buyer call",
  },
  {
    icon: MessageSquare,
    title: "Omnichannel Lead Inbox",
    desc: "Every lead from every source — Zillow, Facebook, Instagram, your website, open houses — in one unified inbox with AI-powered responses.",
    gradient: "from-cyan-500 to-teal-600",
    stat: "3x faster response time",
  },
  {
    icon: Globe,
    title: "AI Property Landing Pages",
    desc: "Generate stunning single-property websites from a prompt. Embed virtual tours, lead capture forms, and AI chat widgets automatically.",
    gradient: "from-emerald-500 to-green-600",
    stat: "Launch listings in 60 seconds",
  },
  {
    icon: Bot,
    title: "Smart Lead Qualification",
    desc: "AI chatbot trained on your listings and market data. It qualifies buyers by budget, timeline, and preferences — then books showings on your calendar.",
    gradient: "from-purple-500 to-violet-600",
    stat: "85% of inquiries auto-qualified",
  },
  {
    icon: Target,
    title: "Facebook & Instagram Ads",
    desc: "Launch hyper-targeted ads for listings and open houses with AI-generated copy and creatives. Leads flow directly into your pipeline.",
    gradient: "from-pink-500 to-rose-600",
    stat: "42% lower cost per lead",
  },
  {
    icon: BarChart3,
    title: "Pipeline & Analytics",
    desc: "Visual deal pipeline from lead to close. Track days on market, conversion rates, commission projections, and source attribution.",
    gradient: "from-amber-500 to-orange-600",
    stat: "Full funnel visibility",
  },
];

const workflows = [
  { trigger: "New Zillow/Facebook Lead", actions: ["AI Text Intro", "Qualify Budget & Timeline", "Add to Pipeline", "Book Showing"], color: "cyan" },
  { trigger: "Open House Sign-In", actions: ["Auto-Add to CRM", "Send Property Packet", "3-Day Drip Sequence", "Agent Alert"], color: "purple" },
  { trigger: "Price Drop Alert", actions: ["Match to Saved Searches", "Personalized SMS Blast", "AI Follow-Up Call", "Update Listing Page"], color: "orange" },
];

const testimonials = [
  {
    quote: "I went from missing 40% of buyer calls to never missing one. The AI voice agent sounds just like a real assistant and books showings on my calendar.",
    name: "Jennifer Torres",
    role: "Luxury Real Estate Agent",
    metric: "Zero missed calls",
  },
  {
    quote: "God Mode set up my entire system in 60 seconds — phone number, AI bot trained on my listings, website, and follow-up workflows. Unreal.",
    name: "Michael Brooks",
    role: "Team Lead, RE/MAX",
    metric: "60s full setup",
  },
  {
    quote: "The automated open house follow-up alone has closed me 4 extra deals this quarter. Each lead gets a personalized drip sequence instantly.",
    name: "Ashley Nguyen",
    role: "Keller Williams Agent",
    metric: "4 extra deals/quarter",
  },
  {
    quote: "I replaced Follow Up Boss, Mailchimp, Calendly, and my website builder. Saving $800/mo and my pipeline is more organized than ever.",
    name: "Robert Hayes",
    role: "Independent Broker",
    metric: "$800/mo saved",
  },
];

const comparisonTools = [
  { name: "Real Estate CRM", them: "$149/mo", apex: "Included" },
  { name: "AI Dialer & Phone", them: "$199/mo", apex: "Included" },
  { name: "IDX Website Builder", them: "$99/mo", apex: "Included" },
  { name: "Email & SMS Drip", them: "$79/mo", apex: "Included" },
  { name: "AI Chatbot", them: "$149/mo", apex: "Included" },
  { name: "Social Media Ads", them: "$59/mo", apex: "Included" },
  { name: "Showing Scheduler", them: "$39/mo", apex: "Included" },
  { name: "Analytics Dashboard", them: "$49/mo", apex: "Included" },
];

const faqs = [
  { q: "Is this built specifically for real estate?", a: "Yes. Apex includes real estate-specific features like property landing pages, open house follow-ups, listing drip campaigns, buyer qualification workflows, and MLS-style pipeline management. It's built for agents, teams, and brokerages." },
  { q: "Can it replace my current CRM like Follow Up Boss?", a: "Absolutely. Apex includes a full CRM with contact management, deal pipeline, appointment scheduling, and automated follow-ups. Plus AI-powered features that most real estate CRMs don't offer." },
  { q: "How does the AI voice agent work for showings?", a: "When a buyer calls, the AI agent answers with your custom greeting, asks qualifying questions (budget, timeline, preferences), checks your calendar availability, and books the showing. You get a notification with all the details." },
  { q: "Can I use it for my team or brokerage?", a: "Yes. With Agency Pro or God Mode plans, you get unlimited sub-accounts — one for each agent on your team. Each has their own inbox, pipeline, and AI bot, while you get a command center overview." },
  { q: "Does it integrate with Zillow, Realtor.com, etc?", a: "Yes. Through webhooks and our integrations hub, leads from Zillow, Realtor.com, Facebook Marketplace, and other lead sources flow directly into your Apex inbox and pipeline." },
  { q: "Is there a free trial?", a: "Yes! Every plan includes a 60-day free trial with full access. No credit card required to start." },
];

export default function RealtorsLanding() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div className="min-h-screen text-white overflow-x-hidden" style={{ backgroundColor: "#030014" }} data-testid="realtors-landing">
      <div className="fixed inset-0 pointer-events-none" style={{
        backgroundImage: "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(16,185,129,0.12), transparent)",
      }} />

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#030014]/80 backdrop-blur-2xl border-b border-white/[0.06]" data-testid="nav-bar">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <Home size={16} className="text-white" />
            </div>
            <span className="font-black text-white tracking-tight text-lg">APEX</span>
            <span className="text-[10px] font-medium text-emerald-400 tracking-[0.2em] uppercase hidden sm:block">for Realtors</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm text-slate-400">
            <a href="#problem" className="hover:text-white transition-colors">The Problem</a>
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#proof" className="hover:text-white transition-colors">Results</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/demo" className="hidden sm:flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:text-white transition-colors">
              <Play size={14} /> Live Demo
            </Link>
            <a href="/api/login" className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40" data-testid="button-nav-get-started">
              Get Started Free
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-28 pb-16 md:pt-40 md:pb-28 px-6">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[800px] bg-gradient-to-b from-emerald-600/15 via-teal-600/10 to-transparent rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-5xl mx-auto text-center">
          <div>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 mb-8" data-testid="badge-hero">
              <Key size={14} /> Built Specifically for Real Estate Professionals
            </div>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-black tracking-tight leading-[0.95] mb-6" data-testid="text-hero-title">
            <span className="block text-white">Close More Deals</span>
            <span className="block bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 bg-clip-text text-transparent">
              While Showing Houses
            </span>
          </h1>

          <p className="text-base sm:text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed" data-testid="text-hero-subtitle">
            AI answers your calls, qualifies buyers, books showings, and follows up with every lead — so you never lose a deal to a faster agent again.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a href="/api/login" className="w-full sm:w-auto px-10 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-2xl transition-all shadow-lg shadow-emerald-500/25 text-lg flex items-center justify-center gap-2 hover:scale-[1.03] active:scale-[0.98]" data-testid="button-hero-cta">
              Start Your Free Trial <ArrowRight size={20} />
            </a>
            <Link href="/demo" className="w-full sm:w-auto px-10 py-4 border border-white/10 hover:border-white/20 bg-white/[0.03] hover:bg-white/[0.06] text-white font-bold rounded-2xl transition-all text-lg flex items-center justify-center gap-2" data-testid="button-hero-demo">
              <Play size={18} /> See It In Action
            </Link>
          </div>

          <div className="flex items-center justify-center gap-6 mt-8 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-green-500" /> No credit card</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-green-500" /> 60-day trial</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-green-500" /> Cancel anytime</span>
          </div>
        </div>

        <div className="relative z-10 max-w-4xl mx-auto mt-16 md:mt-24">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { value: 78, suffix: "%", label: "Buyers Choose First Responder" },
              { value: 85, suffix: "%", label: "Inquiries Auto-Qualified" },
              { value: 60, suffix: "s", label: "Full System Setup" },
              { value: 800, suffix: "+", label: "Monthly Savings" },
            ].map((s, i) => (
              <div key={s.label} className="text-center p-5 bg-white/[0.03] border border-white/[0.06] rounded-2xl" data-testid={`stat-${i}`}>
                <div className="text-2xl md:text-3xl font-black text-white"><CountUp end={s.value} suffix={s.suffix} /></div>
                <div className="text-[11px] text-slate-500 mt-1 uppercase tracking-wider">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Problem */}
      <section id="problem" className="relative z-10 py-20 md:py-28 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold border border-red-500/30 bg-red-500/10 text-red-400 mb-4">THE PROBLEM</div>
            </div>
            <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4" data-testid="text-problem-title">
              Agents Are <span className="bg-gradient-to-r from-red-400 to-orange-400 bg-clip-text text-transparent">Losing Deals</span> to Speed
            </h2>
            <p className="text-slate-400 max-w-2xl mx-auto text-lg">
              In real estate, the fastest agent wins. But you can't answer calls, follow up, and show houses at the same time.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {painPoints.map((p, i) => (
              <div key={p.title} data-testid={`card-pain-${i}`}>
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
              </div>
            ))}
          </div>

          <div className="mt-12 text-center">
            <div className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/20">
              <ArrowRight size={16} className="text-emerald-400" />
              <span className="text-sm font-medium text-emerald-300">There's a better way. Your AI-powered real estate command center.</span>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative z-10 py-20 md:py-28 px-6 bg-gradient-to-b from-transparent via-emerald-600/[0.03] to-transparent">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 mb-4">THE SOLUTION</div>
            </div>
            <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4" data-testid="text-features-title">
              Your AI Real Estate <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">Command Center</span>
            </h2>
            <p className="text-slate-400 max-w-2xl mx-auto text-lg">
              Everything you need to capture, qualify, nurture, and close — while AI handles the rest.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f, i) => (
              <div key={f.title} data-testid={`card-feature-${i}`}>
                <div className="group h-full bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.12] rounded-2xl p-6 transition-all duration-300 hover:bg-white/[0.05]">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.gradient} flex items-center justify-center mb-5 shadow-lg`}>
                    <f.icon size={22} className="text-white" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">{f.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed mb-4">{f.desc}</p>
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                    <TrendingUp size={14} />{f.stat}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Workflows */}
      <section className="relative z-10 py-20 md:py-28 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold border border-teal-500/30 bg-teal-500/10 text-teal-300 mb-4">AUTOMATIONS</div>
            </div>
            <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4" data-testid="text-workflows-title">
              Automate Your <span className="bg-gradient-to-r from-teal-400 to-emerald-400 bg-clip-text text-transparent">Entire Pipeline</span>
            </h2>
            <p className="text-slate-400 max-w-2xl mx-auto text-lg">
              Pre-built real estate workflows that run 24/7. From lead capture to closing — on autopilot.
            </p>
          </div>

          <div className="space-y-5">
            {workflows.map((wf, i) => {
              const colors: Record<string, { border: string; bg: string; text: string }> = {
                cyan: { border: "border-cyan-500/20", bg: "bg-cyan-500/10", text: "text-cyan-400" },
                purple: { border: "border-purple-500/20", bg: "bg-purple-500/10", text: "text-purple-400" },
                orange: { border: "border-orange-500/20", bg: "bg-orange-500/10", text: "text-orange-400" },
              };
              const c = colors[wf.color];
              return (
                <div key={wf.trigger} className={`p-5 bg-white/[0.02] border ${c.border} rounded-2xl`} data-testid={`workflow-${i}`}>
                  <div className="flex flex-col md:flex-row md:items-center gap-4">
                    <div className={`flex items-center gap-3 shrink-0 px-4 py-2.5 rounded-xl ${c.bg}`}>
                      <Zap size={16} className={c.text} />
                      <span className={`text-sm font-bold ${c.text}`}>{wf.trigger}</span>
                    </div>
                    <div className="hidden md:block"><ArrowRight size={18} className="text-slate-600" /></div>
                    <div className="flex flex-wrap gap-2 flex-1">
                      {wf.actions.map((action, j) => (
                        <div key={action} className="flex items-center gap-2">
                          {j > 0 && <div className="w-4 border-t border-dashed border-slate-700 hidden sm:block" />}
                          <span className="px-3 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded-lg text-xs text-slate-300 font-medium">{action}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="proof" className="relative z-10 py-20 md:py-28 px-6 bg-gradient-to-b from-transparent via-emerald-600/[0.04] to-transparent">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold border border-amber-500/30 bg-amber-500/10 text-amber-300 mb-4">RESULTS</div>
            </div>
            <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4" data-testid="text-proof-title">
              Agents Are <span className="bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">Closing More</span> With Apex
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {testimonials.map((t, i) => (
              <div key={t.name} data-testid={`card-testimonial-${i}`}>
                <div className="h-full p-6 bg-white/[0.03] border border-white/[0.06] rounded-2xl hover:border-white/[0.12] transition-colors">
                  <div className="flex items-center gap-1 mb-4">
                    {[...Array(5)].map((_, j) => (<Star key={j} size={14} className="text-amber-400 fill-amber-400" />))}
                  </div>
                  <p className="text-sm text-slate-300 leading-relaxed mb-5 italic">"{t.quote}"</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-sm font-bold text-white">{t.name.charAt(0)}</div>
                      <div>
                        <div className="text-sm font-semibold text-white">{t.name}</div>
                        <div className="text-xs text-slate-500">{t.role}</div>
                      </div>
                    </div>
                    <div className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-full">{t.metric}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Comparison */}
      <section id="pricing" className="relative z-10 py-20 md:py-28 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 mb-4">SAVE $800+/mo</div>
            </div>
            <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4" data-testid="text-pricing-title">
              Replace <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">Your Entire Stack</span>
            </h2>
            <p className="text-slate-400 max-w-xl mx-auto text-lg">
              Stop paying for 8 real estate tools. Get everything in one platform starting at $48/mo.
            </p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/[0.08]">
            <div className="grid grid-cols-3 bg-white/[0.04] p-4 border-b border-white/[0.08]">
              <div className="text-sm font-bold text-slate-400">Feature</div>
              <div className="text-sm font-bold text-red-400 text-center">Other Tools</div>
              <div className="text-sm font-bold text-emerald-400 text-center">Apex</div>
            </div>
            {comparisonTools.map((row, i) => (
              <div key={row.name} className={`grid grid-cols-3 p-4 ${i % 2 === 0 ? "bg-white/[0.02]" : ""} border-b border-white/[0.04] last:border-0`} data-testid={`row-compare-${i}`}>
                <div className="text-sm text-slate-300">{row.name}</div>
                <div className="text-sm text-red-400/70 text-center line-through">{row.them}</div>
                <div className="text-sm text-emerald-400 text-center font-semibold flex items-center justify-center gap-1.5"><CheckCircle2 size={14} /> {row.apex}</div>
              </div>
            ))}
            <div className="grid grid-cols-3 p-4 bg-white/[0.04] border-t border-white/[0.08]">
              <div className="text-sm font-bold text-white">Total Monthly Cost</div>
              <div className="text-lg font-black text-red-400 text-center">$822/mo</div>
              <div className="text-lg font-black text-emerald-400 text-center">$48/mo</div>
            </div>
          </div>

          <div className="mt-10 text-center">
            <a href="/api/login" className="inline-flex items-center gap-2 px-10 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-2xl transition-all shadow-lg shadow-emerald-500/25 text-lg hover:scale-[1.03] active:scale-[0.98]" data-testid="button-pricing-cta">
              Start Closing More Deals <ArrowRight size={20} />
            </a>
            <p className="text-xs text-slate-500 mt-4">60-day free trial. No credit card required.</p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="relative z-10 py-20 md:py-28 px-6 bg-gradient-to-b from-transparent via-emerald-600/[0.03] to-transparent">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4" data-testid="text-faq-title">Frequently Asked Questions</h2>
          </div>

          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <div key={i} data-testid={`faq-${i}`}>
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full text-left p-5 bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.12] rounded-2xl transition-all" data-testid={`button-faq-${i}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white pr-4">{faq.q}</span>
                    {openFaq === i ? <ChevronUp size={18} className="text-slate-400 shrink-0" /> : <ChevronDown size={18} className="text-slate-400 shrink-0" />}
                  </div>
                  {openFaq === i && (
                    <p className="text-sm text-slate-400 mt-3 leading-relaxed">{faq.a}</p>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative z-10 py-20 md:py-28 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="relative p-10 md:p-16 rounded-3xl overflow-hidden border border-emerald-500/20">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-600/20 via-teal-600/10 to-cyan-600/10" />
            <div className="absolute inset-0 bg-[#030014]/70" />
            <div className="relative z-10">
              <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4" data-testid="text-final-cta">
                Ready to <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">Sell Smarter</span>?
              </h2>
              <p className="text-slate-400 text-lg max-w-xl mx-auto mb-8">
                Join top-producing agents who let AI handle the busywork while they focus on closing.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <a href="/api/login" className="w-full sm:w-auto px-10 py-4 bg-white text-black font-bold rounded-2xl transition-all text-lg flex items-center justify-center gap-2 hover:bg-emerald-100 hover:scale-[1.03] active:scale-[0.98]" data-testid="button-final-cta">
                  Get Started Free <ArrowRight size={20} />
                </a>
                <Link href="/demo" className="w-full sm:w-auto px-10 py-4 border border-white/20 hover:border-white/30 text-white font-bold rounded-2xl transition-all text-lg flex items-center justify-center gap-2" data-testid="button-final-demo">
                  <Play size={18} /> See Live Demo
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/[0.06] py-12 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center"><Home size={14} className="text-white" /></div>
            <span className="font-bold text-white text-sm">APEX</span>
            <span className="text-[10px] text-slate-500">for Realtors</span>
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
