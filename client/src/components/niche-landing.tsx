import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, ChevronDown, ChevronUp, Sparkles, Star } from "lucide-react";
import type { LucideIcon } from "lucide-react";

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

export interface NichePainPoint {
  icon: LucideIcon;
  title: string;
  desc: string;
}

export interface NicheFeature {
  icon: LucideIcon;
  title: string;
  desc: string;
  gradient: string;
  stat: string;
}

export interface NicheStat {
  value: number;
  suffix: string;
  label: string;
}

export interface NicheTestimonial {
  quote: string;
  name: string;
  role: string;
}

export interface NicheFaq {
  q: string;
  a: string;
}

export interface NicheLandingConfig {
  slug: string;
  industry: string;
  tagline: string;
  headline: string;
  headlineAccent: string;
  subheadline: string;
  accentColor: string;
  accentGradient: string;
  painPoints: NichePainPoint[];
  features: NicheFeature[];
  stats: NicheStat[];
  testimonials: NicheTestimonial[];
  faqs: NicheFaq[];
  ctaText?: string;
}

const accentMap: Record<string, { text: string; bg: string; border: string; glow: string; gradient: string }> = {
  cyan: { text: "text-cyan-400", bg: "bg-cyan-500", border: "border-cyan-500/30", glow: "shadow-cyan-500/20", gradient: "from-cyan-500 to-blue-600" },
  blue: { text: "text-blue-400", bg: "bg-blue-500", border: "border-blue-500/30", glow: "shadow-blue-500/20", gradient: "from-blue-500 to-indigo-600" },
  emerald: { text: "text-emerald-400", bg: "bg-emerald-500", border: "border-emerald-500/30", glow: "shadow-emerald-500/20", gradient: "from-emerald-500 to-green-600" },
  purple: { text: "text-purple-400", bg: "bg-purple-500", border: "border-purple-500/30", glow: "shadow-purple-500/20", gradient: "from-purple-500 to-violet-600" },
  pink: { text: "text-pink-400", bg: "bg-pink-500", border: "border-pink-500/30", glow: "shadow-pink-500/20", gradient: "from-pink-500 to-rose-600" },
  amber: { text: "text-amber-400", bg: "bg-amber-500", border: "border-amber-500/30", glow: "shadow-amber-500/20", gradient: "from-amber-500 to-orange-600" },
  red: { text: "text-red-400", bg: "bg-red-500", border: "border-red-500/30", glow: "shadow-red-500/20", gradient: "from-red-500 to-rose-600" },
  indigo: { text: "text-indigo-400", bg: "bg-indigo-500", border: "border-indigo-500/30", glow: "shadow-indigo-500/20", gradient: "from-indigo-500 to-violet-600" },
  teal: { text: "text-teal-400", bg: "bg-teal-500", border: "border-teal-500/30", glow: "shadow-teal-500/20", gradient: "from-teal-500 to-cyan-600" },
  rose: { text: "text-rose-400", bg: "bg-rose-500", border: "border-rose-500/30", glow: "shadow-rose-500/20", gradient: "from-rose-500 to-pink-600" },
  orange: { text: "text-orange-400", bg: "bg-orange-500", border: "border-orange-500/30", glow: "shadow-orange-500/20", gradient: "from-orange-500 to-amber-600" },
  sky: { text: "text-sky-400", bg: "bg-sky-500", border: "border-sky-500/30", glow: "shadow-sky-500/20", gradient: "from-sky-500 to-blue-600" },
};

export function NicheLanding({ config }: { config: NicheLandingConfig }) {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const colors = accentMap[config.accentColor] || accentMap.cyan;
  const funnelUrl = `/${config.slug}/funnel`;

  return (
    <div className="min-h-screen bg-neutral-950 text-white overflow-x-hidden">
      <nav className="fixed top-0 w-full z-50 bg-black/60 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/">
            <span className="text-lg font-black tracking-tight cursor-pointer" data-testid="link-logo">
              <span className={colors.text}>APEX</span> <span className="text-white/60">for {config.industry}</span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/pricing">
              <span className="text-sm text-slate-400 hover:text-white transition-colors cursor-pointer" data-testid="link-pricing">Pricing</span>
            </Link>
            <Link href={funnelUrl}>
              <span className={`inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-gradient-to-r ${colors.gradient} text-white text-sm font-bold hover:opacity-90 transition-opacity cursor-pointer`} data-testid="button-get-started">
                Get Started <ArrowRight size={14} />
              </span>
            </Link>
          </div>
        </div>
      </nav>

      <section className="pt-32 pb-20 px-6 relative" data-testid="section-hero">
        <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-gradient-to-b ${colors.gradient} opacity-[0.08] rounded-full blur-3xl pointer-events-none`} />
        <div className="max-w-5xl mx-auto text-center relative z-10">
          <div>
            <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border ${colors.border} ${colors.text} bg-white/5 mb-6`}>
              <Sparkles size={12} /> {config.tagline}
            </div>
          </div>
          <h1 className="text-5xl md:text-7xl font-black tracking-tight leading-[1.1] mb-6" data-testid="text-hero-headline">
            {config.headline}{" "}
            <span className={`bg-gradient-to-r ${colors.gradient} bg-clip-text text-transparent`}>{config.headlineAccent}</span>
          </h1>
          <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-8">
            {config.subheadline}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href={funnelUrl}>
              <span className={`inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-gradient-to-r ${colors.gradient} text-white font-bold text-lg hover:opacity-90 transition-all shadow-lg ${colors.glow} cursor-pointer`} data-testid="button-hero-cta">
                {config.ctaText || "Start Free Trial"} <ArrowRight size={18} />
              </span>
            </Link>
            <Link href="/demo">
              <span className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl border border-white/10 bg-white/5 text-white font-bold text-lg hover:bg-white/10 transition-all cursor-pointer" data-testid="button-hero-demo">
                Watch Demo
              </span>
            </Link>
          </div>
        </div>
      </section>

      <section className="py-16 px-6 border-y border-white/5 bg-white/[0.01]" data-testid="section-stats">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {config.stats.map((stat, i) => (
            <div key={i}>
              <p className={`text-4xl md:text-5xl font-black ${colors.text}`}><CountUp end={stat.value} suffix={stat.suffix} /></p>
              <p className="text-sm text-slate-500 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-20 px-6" data-testid="section-pain-points">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-black mb-3">Sound Familiar?</h2>
            <p className="text-slate-400 max-w-xl mx-auto">These problems cost {config.industry.toLowerCase()} businesses thousands every month</p>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {config.painPoints.map((p, i) => (
              <div key={i} className="flex gap-4 p-5 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/10 transition-colors" data-testid={`card-pain-${i}`}>
                <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
                  <p.icon size={20} className="text-red-400" />
                </div>
                <div>
                  <h3 className="font-bold text-white mb-1">{p.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{p.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-6 bg-white/[0.01]" data-testid="section-features">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-black mb-3">Everything You Need to Dominate</h2>
            <p className="text-slate-400 max-w-xl mx-auto">AI-powered tools built specifically for {config.industry.toLowerCase()}</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {config.features.map((f, i) => (
              <div key={i} className="p-6 rounded-xl bg-black/40 border border-white/5 hover:border-white/15 transition-all group" data-testid={`card-feature-${i}`}>
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.gradient} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                  <f.icon size={22} className="text-white" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">{f.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed mb-3">{f.desc}</p>
                <p className={`text-xs font-bold ${colors.text}`}>{f.stat}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-6" data-testid="section-testimonials">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-black mb-3">Trusted by {config.industry}</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {config.testimonials.map((t, i) => (
              <div key={i} className="p-6 rounded-xl bg-white/[0.03] border border-white/5" data-testid={`card-testimonial-${i}`}>
                <div className="flex gap-1 mb-3">
                  {[...Array(5)].map((_, j) => <Star key={j} size={14} className="text-amber-400 fill-amber-400" />)}
                </div>
                <p className="text-sm text-slate-300 italic mb-4">"{t.quote}"</p>
                <div>
                  <p className="text-sm font-bold text-white">{t.name}</p>
                  <p className="text-xs text-slate-500">{t.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-6 bg-white/[0.01]" data-testid="section-faq">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-black mb-3">Frequently Asked Questions</h2>
          </div>
          <div className="space-y-3">
            {config.faqs.map((faq, i) => (
              <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden" data-testid={`faq-${i}`}>
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full flex items-center justify-between p-5 text-left hover:bg-white/[0.02] transition-colors">
                  <span className="font-bold text-sm text-white pr-4">{faq.q}</span>
                  {openFaq === i ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
                </button>
                {openFaq === i && <div className="px-5 pb-5 text-sm text-slate-400 leading-relaxed">{faq.a}</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-6" data-testid="section-cta">
        <div className="max-w-4xl mx-auto text-center">
          <div>
            <h2 className="text-4xl md:text-5xl font-black mb-4">
              Ready to Transform Your <span className={`bg-gradient-to-r ${colors.gradient} bg-clip-text text-transparent`}>{config.industry}</span> Business?
            </h2>
            <p className="text-lg text-slate-400 mb-8 max-w-xl mx-auto">Join hundreds of {config.industry.toLowerCase()} professionals already using Apex to grow faster with AI.</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href={funnelUrl}>
                <span className={`inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-gradient-to-r ${colors.gradient} text-white font-bold text-lg hover:opacity-90 transition-all shadow-lg ${colors.glow} cursor-pointer`} data-testid="button-cta-start">
                  {config.ctaText || "Start Free Trial"} <ArrowRight size={18} />
                </span>
              </Link>
              <Link href="/pricing">
                <span className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl border border-white/10 text-white font-bold text-lg hover:bg-white/5 transition-all cursor-pointer" data-testid="button-cta-pricing">
                  View Pricing
                </span>
              </Link>
            </div>
            <div className="flex items-center justify-center gap-6 mt-6">
              {["No credit card required", "Free forever plan", "Cancel anytime"].map((t) => (
                <span key={t} className="flex items-center gap-1 text-xs text-slate-500"><CheckCircle2 size={12} className={colors.text} /> {t}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="py-8 px-6 border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-slate-600">&copy; {new Date().getFullYear()} Apex Marketing Automations. All rights reserved.</p>
          <div className="flex gap-6">
            <Link href="/"><span className="text-xs text-slate-500 hover:text-white transition-colors cursor-pointer">Home</span></Link>
            <Link href="/pricing"><span className="text-xs text-slate-500 hover:text-white transition-colors cursor-pointer">Pricing</span></Link>
            <Link href="/demo"><span className="text-xs text-slate-500 hover:text-white transition-colors cursor-pointer">Demo</span></Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
