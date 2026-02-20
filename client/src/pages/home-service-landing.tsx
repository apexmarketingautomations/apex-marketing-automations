import { useState, useEffect, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Link } from "wouter";
import {
  ArrowRight, Zap, CheckCircle2, ChevronDown, ChevronUp,
  Wrench, Phone, MessageSquare, Bot, Globe,
  TrendingUp, Clock, Sparkles, Star, DollarSign, Play,
  MapPin, CalendarDays, BarChart3, Target,
  ShieldCheck, Hammer, Droplets, Flame, Plug, TreePine
} from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.08, duration: 0.5, ease: "easeOut" as const },
  }),
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

const industries = [
  { icon: Wrench, name: "Plumbing" },
  { icon: Flame, name: "HVAC" },
  { icon: Plug, name: "Electrical" },
  { icon: Hammer, name: "General Contracting" },
  { icon: Droplets, name: "Pressure Washing" },
  { icon: TreePine, name: "Landscaping" },
];

const painPoints = [
  { icon: Phone, title: "Missed Calls = Lost Jobs", desc: "You're on a roof or under a sink when the phone rings. 62% of missed calls never call back — they just hire the next company." },
  { icon: Clock, title: "Zero Follow-Up System", desc: "After the estimate, leads go cold. No automated reminders, no follow-up texts, no review requests. Money left on the table." },
  { icon: DollarSign, title: "Wasting Money on Ads", desc: "You're paying for Facebook and Google ads but can't track which ones actually generate booked jobs. Most leads slip through the cracks." },
  { icon: MapPin, title: "Reputation Is Everything", desc: "You have 50 happy customers but only 8 Google reviews. Meanwhile competitors with worse work have 200+ reviews and steal your leads." },
];

const features = [
  {
    icon: Phone,
    title: "AI Receptionist & Callback",
    desc: "Never miss a job call again. AI answers 24/7, qualifies the job type and urgency, gives estimates, and books the appointment on your calendar.",
    gradient: "from-orange-500 to-red-600",
    stat: "Zero missed calls",
  },
  {
    icon: MessageSquare,
    title: "Instant Lead Response",
    desc: "When a lead comes in from Google, Facebook, or your website, they get an instant text response. AI qualifies them and books the estimate automatically.",
    gradient: "from-cyan-500 to-blue-600",
    stat: "Under 30-second response",
  },
  {
    icon: Star,
    title: "5-Star Review Machine",
    desc: "After every completed job, automatically request reviews. Happy customers go to Google. Unhappy ones go to private feedback. Watch your rating soar.",
    gradient: "from-amber-500 to-yellow-600",
    stat: "4x more Google reviews",
  },
  {
    icon: Target,
    title: "Local Service Ads",
    desc: "Launch hyper-local Facebook and Instagram ads targeting homeowners in your service area. AI writes the ad copy and tracks every lead to booked job.",
    gradient: "from-pink-500 to-rose-600",
    stat: "42% lower cost per lead",
  },
  {
    icon: Globe,
    title: "Professional Website in 60s",
    desc: "Generate a stunning service website from a single prompt. Before/after galleries, service areas, booking forms, and AI chat — all built instantly.",
    gradient: "from-emerald-500 to-teal-600",
    stat: "Launch in under a minute",
  },
  {
    icon: BarChart3,
    title: "Job Pipeline & Tracking",
    desc: "Visual pipeline from lead to completed job. Track estimates sent, jobs booked, revenue per service type, and which ads are actually working.",
    gradient: "from-purple-500 to-indigo-600",
    stat: "Full business visibility",
  },
];

const workflows = [
  { trigger: "New Service Request", actions: ["AI Qualification", "Estimate Text", "Book on Calendar", "Crew Notification"], color: "orange" },
  { trigger: "Job Completed", actions: ["Send Invoice", "Request Review", "Route to Google/Private", "Thank You SMS"], color: "amber" },
  { trigger: "Estimate Not Booked (3 Days)", actions: ["Follow-Up Text", "AI Phone Call", "Discount Offer", "Update Pipeline"], color: "cyan" },
];

const testimonials = [
  {
    quote: "I used to miss 10+ calls a week while on jobs. Now AI answers every call, qualifies the job, and books it on my calendar. Revenue is up 40%.",
    name: "Mike Rodriguez",
    role: "Owner, Rodriguez Plumbing",
    metric: "40% revenue increase",
  },
  {
    quote: "We went from 23 to 147 Google reviews in 3 months. The automated review system is magic — customers get a text right after we finish the job.",
    name: "Jake Thompson",
    role: "Thompson HVAC Services",
    metric: "147 reviews in 3 months",
  },
  {
    quote: "The follow-up automation alone has booked me $30K+ in jobs that would've gone cold. One text reminded a customer about their kitchen remodel estimate.",
    name: "Sandra Chen",
    role: "Chen Home Renovations",
    metric: "$30K+ recovered revenue",
  },
  {
    quote: "I replaced Jobber, Housecall Pro, and my answering service. Saving $400/mo and the AI handles everything better than any of them did.",
    name: "Carlos Vega",
    role: "Vega Electrical",
    metric: "$400/mo saved",
  },
];

const comparisonTools = [
  { name: "Job Management CRM", them: "$149/mo", apex: "Included" },
  { name: "Answering Service", them: "$199/mo", apex: "Included" },
  { name: "Website Builder", them: "$79/mo", apex: "Included" },
  { name: "Review Management", them: "$89/mo", apex: "Included" },
  { name: "SMS & Email Marketing", them: "$59/mo", apex: "Included" },
  { name: "Online Booking System", them: "$49/mo", apex: "Included" },
  { name: "Facebook Ad Management", them: "$99/mo", apex: "Included" },
  { name: "AI Chatbot", them: "$79/mo", apex: "Included" },
];

const faqs = [
  { q: "What types of home service businesses does Apex work for?", a: "Plumbing, HVAC, electrical, roofing, landscaping, pressure washing, painting, general contracting, cleaning services, pest control, and more. If you run a service business that books jobs, Apex is built for you." },
  { q: "I'm not tech-savvy. Can I still use this?", a: "Absolutely. Apex is designed for business owners, not developers. Everything is visual — drag-and-drop, one-click setup, and AI handles the complicated stuff. If you can send a text message, you can use Apex." },
  { q: "How does the AI phone answering work?", a: "When a customer calls, our AI agent answers with your business name, asks about the service needed, checks urgency, gives basic pricing info if you set it up, and books the appointment on your calendar. You get a text notification with all the details." },
  { q: "Can it really get me more Google reviews?", a: "Yes. After you mark a job complete, the customer automatically gets a text with a review link. Happy customers are guided to Google. If someone indicates they're unhappy, they're routed to private feedback so you can resolve it first." },
  { q: "Will this replace my current field service software?", a: "For most small to mid-size service businesses, yes. Apex includes CRM, scheduling, pipeline management, invoicing integration, communication tools, and marketing — all in one platform." },
  { q: "Is there a free trial?", a: "Yes! Every plan includes a 60-day free trial with full access. No credit card required to start. Set up your entire system in 60 seconds and see results immediately." },
];

export default function HomeServiceLanding() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div className="min-h-screen text-white overflow-x-hidden" style={{ backgroundColor: "#030014" }} data-testid="home-service-landing">
      <div className="fixed inset-0 pointer-events-none" style={{
        backgroundImage: "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(249,115,22,0.12), transparent)",
      }} />

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#030014]/80 backdrop-blur-2xl border-b border-white/[0.06]" data-testid="nav-bar">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center">
              <Wrench size={16} className="text-white" />
            </div>
            <span className="font-black text-white tracking-tight text-lg">APEX</span>
            <span className="text-[10px] font-medium text-orange-400 tracking-[0.2em] uppercase hidden sm:block">for Home Services</span>
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
            <a href="/api/login" className="px-5 py-2.5 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-orange-500/20 hover:shadow-orange-500/40" data-testid="button-nav-get-started">
              Get Started Free
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-28 pb-16 md:pt-40 md:pb-28 px-6">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[800px] bg-gradient-to-b from-orange-600/15 via-amber-600/10 to-transparent rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-5xl mx-auto text-center">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }}>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold border border-orange-500/30 bg-orange-500/10 text-orange-300 mb-8" data-testid="badge-hero">
              <Wrench size={14} /> Built for Plumbers, HVAC, Electricians & More
            </div>
          </motion.div>

          <motion.h1 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-black tracking-tight leading-[0.95] mb-6" data-testid="text-hero-title">
            <span className="block text-white">Never Miss</span>
            <span className="block bg-gradient-to-r from-orange-400 via-amber-400 to-yellow-400 bg-clip-text text-transparent">
              Another Job Call
            </span>
          </motion.h1>

          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="text-base sm:text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed" data-testid="text-hero-subtitle">
            AI answers your phone 24/7, books jobs, follows up on estimates, and gets you 5-star reviews — while you're on the job site.
          </motion.p>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a href="/api/login" className="w-full sm:w-auto px-10 py-4 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white font-bold rounded-2xl transition-all shadow-lg shadow-orange-500/25 text-lg flex items-center justify-center gap-2 hover:scale-[1.03] active:scale-[0.98]" data-testid="button-hero-cta">
              Start Your Free Trial <ArrowRight size={20} />
            </a>
            <Link href="/demo" className="w-full sm:w-auto px-10 py-4 border border-white/10 hover:border-white/20 bg-white/[0.03] hover:bg-white/[0.06] text-white font-bold rounded-2xl transition-all text-lg flex items-center justify-center gap-2" data-testid="button-hero-demo">
              <Play size={18} /> See It In Action
            </Link>
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} className="flex items-center justify-center gap-6 mt-8 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-green-500" /> No credit card</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-green-500" /> 60-day trial</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-green-500" /> Cancel anytime</span>
          </motion.div>
        </div>

        {/* Industry Badges */}
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }} className="relative z-10 max-w-3xl mx-auto mt-14">
          <p className="text-center text-xs text-slate-500 uppercase tracking-widest mb-5">Works for every trade</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {industries.map((ind) => (
              <div key={ind.name} className="flex items-center gap-2 px-4 py-2 bg-white/[0.03] border border-white/[0.06] rounded-full">
                <ind.icon size={14} className="text-orange-400" />
                <span className="text-xs font-medium text-slate-300">{ind.name}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Stats */}
        <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.85 }} className="relative z-10 max-w-4xl mx-auto mt-14">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { value: 62, suffix: "%", label: "Missed Calls Never Return" },
              { value: 4, suffix: "x", label: "More Google Reviews" },
              { value: 60, suffix: "s", label: "Full System Setup" },
              { value: 400, suffix: "+", label: "Monthly Savings" },
            ].map((s, i) => (
              <div key={s.label} className="text-center p-5 bg-white/[0.03] border border-white/[0.06] rounded-2xl" data-testid={`stat-${i}`}>
                <div className="text-2xl md:text-3xl font-black text-white"><CountUp end={s.value} suffix={s.suffix} /></div>
                <div className="text-[11px] text-slate-500 mt-1 uppercase tracking-wider">{s.label}</div>
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Problem */}
      <section id="problem" className="relative z-10 py-20 md:py-28 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }} className="text-center mb-16">
            <motion.div variants={fadeUp} custom={0}>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold border border-red-500/30 bg-red-500/10 text-red-400 mb-4">THE PROBLEM</div>
            </motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="text-3xl md:text-5xl font-black tracking-tight mb-4" data-testid="text-problem-title">
              Great Work. <span className="bg-gradient-to-r from-red-400 to-orange-400 bg-clip-text text-transparent">Terrible Follow-Up.</span>
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="text-slate-400 max-w-2xl mx-auto text-lg">
              You're the best at what you do. But when you're on the job, calls go to voicemail, estimates go cold, and reviews never get asked for.
            </motion.p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {painPoints.map((p, i) => (
              <motion.div key={p.title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }} data-testid={`card-pain-${i}`}>
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
          </div>

          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mt-12 text-center">
            <div className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-orange-500/10 to-amber-500/10 border border-orange-500/20">
              <ArrowRight size={16} className="text-orange-400" />
              <span className="text-sm font-medium text-orange-300">Your AI-powered office manager that works while you work.</span>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative z-10 py-20 md:py-28 px-6 bg-gradient-to-b from-transparent via-orange-600/[0.03] to-transparent">
        <div className="max-w-7xl mx-auto">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }} className="text-center mb-16">
            <motion.div variants={fadeUp} custom={0}>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold border border-orange-500/30 bg-orange-500/10 text-orange-300 mb-4">THE SOLUTION</div>
            </motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="text-3xl md:text-5xl font-black tracking-tight mb-4" data-testid="text-features-title">
              Your AI Office Manager <span className="bg-gradient-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent">That Never Sleeps</span>
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="text-slate-400 max-w-2xl mx-auto text-lg">
              Everything you need to book more jobs, get more reviews, and grow your business — without hiring office staff.
            </motion.p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f, i) => (
              <motion.div key={f.title} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-30px" }} transition={{ delay: i * 0.08 }} data-testid={`card-feature-${i}`}>
                <div className="group h-full bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.12] rounded-2xl p-6 transition-all duration-300 hover:bg-white/[0.05]">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.gradient} flex items-center justify-center mb-5 shadow-lg`}>
                    <f.icon size={22} className="text-white" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">{f.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed mb-4">{f.desc}</p>
                  <div className="flex items-center gap-2 text-xs font-semibold text-orange-400">
                    <TrendingUp size={14} />{f.stat}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Workflows */}
      <section className="relative z-10 py-20 md:py-28 px-6">
        <div className="max-w-5xl mx-auto">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }} className="text-center mb-16">
            <motion.div variants={fadeUp} custom={0}>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold border border-amber-500/30 bg-amber-500/10 text-amber-300 mb-4">AUTOMATIONS</div>
            </motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="text-3xl md:text-5xl font-black tracking-tight mb-4" data-testid="text-workflows-title">
              Runs Your Business <span className="bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">While You Work</span>
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="text-slate-400 max-w-2xl mx-auto text-lg">
              Pre-built automations for service businesses. From first call to 5-star review — on autopilot.
            </motion.p>
          </motion.div>

          <div className="space-y-5">
            {workflows.map((wf, i) => {
              const colors: Record<string, { border: string; bg: string; text: string }> = {
                orange: { border: "border-orange-500/20", bg: "bg-orange-500/10", text: "text-orange-400" },
                amber: { border: "border-amber-500/20", bg: "bg-amber-500/10", text: "text-amber-400" },
                cyan: { border: "border-cyan-500/20", bg: "bg-cyan-500/10", text: "text-cyan-400" },
              };
              const c = colors[wf.color];
              return (
                <motion.div key={wf.trigger} initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.15 }} className={`p-5 bg-white/[0.02] border ${c.border} rounded-2xl`} data-testid={`workflow-${i}`}>
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
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="proof" className="relative z-10 py-20 md:py-28 px-6 bg-gradient-to-b from-transparent via-orange-600/[0.04] to-transparent">
        <div className="max-w-6xl mx-auto">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }} className="text-center mb-16">
            <motion.div variants={fadeUp} custom={0}>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold border border-amber-500/30 bg-amber-500/10 text-amber-300 mb-4">RESULTS</div>
            </motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="text-3xl md:text-5xl font-black tracking-tight mb-4" data-testid="text-proof-title">
              Service Pros Are <span className="bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">Booking More</span> With Apex
            </motion.h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {testimonials.map((t, i) => (
              <motion.div key={t.name} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }} data-testid={`card-testimonial-${i}`}>
                <div className="h-full p-6 bg-white/[0.03] border border-white/[0.06] rounded-2xl hover:border-white/[0.12] transition-colors">
                  <div className="flex items-center gap-1 mb-4">
                    {[...Array(5)].map((_, j) => (<Star key={j} size={14} className="text-amber-400 fill-amber-400" />))}
                  </div>
                  <p className="text-sm text-slate-300 leading-relaxed mb-5 italic">"{t.quote}"</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center text-sm font-bold text-white">{t.name.charAt(0)}</div>
                      <div>
                        <div className="text-sm font-semibold text-white">{t.name}</div>
                        <div className="text-xs text-slate-500">{t.role}</div>
                      </div>
                    </div>
                    <div className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-full">{t.metric}</div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Comparison */}
      <section id="pricing" className="relative z-10 py-20 md:py-28 px-6">
        <div className="max-w-4xl mx-auto">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }} className="text-center mb-16">
            <motion.div variants={fadeUp} custom={0}>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold border border-orange-500/30 bg-orange-500/10 text-orange-300 mb-4">SAVE $400+/mo</div>
            </motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="text-3xl md:text-5xl font-black tracking-tight mb-4" data-testid="text-pricing-title">
              Replace <span className="bg-gradient-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent">Your Entire Stack</span>
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="text-slate-400 max-w-xl mx-auto text-lg">
              Stop paying for 8 different tools. Get everything in one platform starting at $48/mo.
            </motion.p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="overflow-hidden rounded-2xl border border-white/[0.08]">
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
              <div className="text-lg font-black text-red-400 text-center">$802/mo</div>
              <div className="text-lg font-black text-emerald-400 text-center">$48/mo</div>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mt-10 text-center">
            <a href="/api/login" className="inline-flex items-center gap-2 px-10 py-4 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white font-bold rounded-2xl transition-all shadow-lg shadow-orange-500/25 text-lg hover:scale-[1.03] active:scale-[0.98]" data-testid="button-pricing-cta">
              Start Booking More Jobs <ArrowRight size={20} />
            </a>
            <p className="text-xs text-slate-500 mt-4">60-day free trial. No credit card required.</p>
          </motion.div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="relative z-10 py-20 md:py-28 px-6 bg-gradient-to-b from-transparent via-orange-600/[0.03] to-transparent">
        <div className="max-w-3xl mx-auto">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }} className="text-center mb-16">
            <motion.h2 variants={fadeUp} custom={0} className="text-3xl md:text-5xl font-black tracking-tight mb-4" data-testid="text-faq-title">Frequently Asked Questions</motion.h2>
          </motion.div>

          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 15 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.06 }} data-testid={`faq-${i}`}>
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full text-left p-5 bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.12] rounded-2xl transition-all" data-testid={`button-faq-${i}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white pr-4">{faq.q}</span>
                    {openFaq === i ? <ChevronUp size={18} className="text-slate-400 shrink-0" /> : <ChevronDown size={18} className="text-slate-400 shrink-0" />}
                  </div>
                  {openFaq === i && (
                    <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="text-sm text-slate-400 mt-3 leading-relaxed">{faq.a}</motion.p>
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
          <div className="relative p-10 md:p-16 rounded-3xl overflow-hidden border border-orange-500/20">
            <div className="absolute inset-0 bg-gradient-to-br from-orange-600/20 via-amber-600/10 to-yellow-600/10" />
            <div className="absolute inset-0 bg-[#030014]/70" />
            <div className="relative z-10">
              <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-3xl md:text-5xl font-black tracking-tight mb-4" data-testid="text-final-cta">
                Ready to <span className="bg-gradient-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent">Book More Jobs</span>?
              </motion.h2>
              <motion.p initial={{ opacity: 0, y: 15 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }} className="text-slate-400 text-lg max-w-xl mx-auto mb-8">
                Join thousands of service pros who let AI handle the phone, the follow-up, and the reviews.
              </motion.p>
              <motion.div initial={{ opacity: 0, y: 15 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 }} className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <a href="/api/login" className="w-full sm:w-auto px-10 py-4 bg-white text-black font-bold rounded-2xl transition-all text-lg flex items-center justify-center gap-2 hover:bg-orange-100 hover:scale-[1.03] active:scale-[0.98]" data-testid="button-final-cta">
                  Get Started Free <ArrowRight size={20} />
                </a>
                <Link href="/demo" className="w-full sm:w-auto px-10 py-4 border border-white/20 hover:border-white/30 text-white font-bold rounded-2xl transition-all text-lg flex items-center justify-center gap-2" data-testid="button-final-demo">
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
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center"><Wrench size={14} className="text-white" /></div>
            <span className="font-bold text-white text-sm">APEX</span>
            <span className="text-[10px] text-slate-500">for Home Services</span>
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
