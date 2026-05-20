import { useEffect, useMemo, useRef, type JSX } from "react";
import { Link } from "wouter";
import "./landing.css";

/* ── hooks ────────────────────────────────────────────────────────────────── */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) el.classList.add("in"); }),
      { threshold: 0.15 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

function useTilt(maxDeg = 6) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2);
        const dy = (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2);
        el.style.transform = `perspective(1200px) rotateX(${(-dy * maxDeg).toFixed(2)}deg) rotateY(${(dx * maxDeg).toFixed(2)}deg)`;
      });
    };
    const onLeave = () => { el.style.transform = "perspective(1200px) rotateX(0) rotateY(0)"; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, [maxDeg]);
  return ref;
}

/* ── atmosphere ───────────────────────────────────────────────────────────── */
function Atmosphere({ count = 40, rays = 12 }: { count?: number; rays?: number }) {
  const particles = useMemo(() =>
    Array.from({ length: count }).map((_, i) => ({
      size: 2 + Math.random() * 8,
      left: Math.random() * 100,
      dur: 8 + Math.random() * 18,
      delay: Math.random() * -20,
      drift: (Math.random() - 0.5) * 80,
      opacity: 0.25 + Math.random() * 0.55,
      dist: -(120 + Math.random() * 80),
      k: i,
    })), [count]);

  const rayList = useMemo(() =>
    Array.from({ length: rays }).map((_, i) => ({
      left: (i / rays) * 100 + (Math.random() - 0.5) * 6,
      delay: (Math.random() * -7).toFixed(2),
      width: 1 + Math.random() * 2.5,
      k: i,
    })), [rays]);

  return (
    <>
      <div className="ap-rays" aria-hidden>
        {rayList.map((r) => (
          <span key={r.k} style={{ left: r.left + "%", width: r.width + "px", animationDelay: r.delay + "s" }} />
        ))}
      </div>
      <div className="ap-particles" aria-hidden>
        {particles.map((p) => (
          <span key={p.k} className="ap-particle" style={{
            left: p.left + "vw", width: p.size + "px", height: p.size + "px",
            animationDuration: p.dur + "s", animationDelay: p.delay + "s",
            ["--drift" as any]: p.drift + "px",
            ["--o" as any]: p.opacity,
            ["--dist" as any]: p.dist + "vh",
          }} />
        ))}
      </div>
      <div className="ap-fog" aria-hidden />
    </>
  );
}

/* ── nav ──────────────────────────────────────────────────────────────────── */
function Nav() {
  return (
    <nav className="ap-nav">
      <div className="ap-nav-links">
        {["Services", "Automation", "Results", "About"].map((it) => (
          <a key={it}>{it}</a>
        ))}
      </div>
      <div className="ap-nav-right">
        <Link href="/login" className="ap-btn-pill-ghost">Sign In</Link>
        <Link href="/login" className="ap-btn-pill-primary">Get Started</Link>
      </div>
    </nav>
  );
}

/* ── logo ─────────────────────────────────────────────────────────────────── */
function ApexLogo({ size = 96 }: { size?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div className="ap-sonar-wrap" style={{ width: size, height: size }}>
        <span className="ap-sonar-ring" />
        <span className="ap-sonar-ring r2" />
        <span className="ap-sonar-ring r3" />
        <svg className="ap-sonar-target" width={size} height={size} viewBox="0 0 80 80" aria-label="Apex">
          <defs>
            <linearGradient id="ap-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.4" stopColor="#a6ecff" />
              <stop offset="1" stopColor="#00b8d4" />
            </linearGradient>
            <linearGradient id="ap-inner" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="rgba(255,255,255,0.9)" />
              <stop offset="1" stopColor="rgba(0,229,255,0.3)" />
            </linearGradient>
          </defs>
          <path d="M40 4 L74 72 L52 72 L48 60 L32 60 L28 72 L6 72 Z M40 28 L34 50 L46 50 Z"
            fill="url(#ap-grad)" stroke="rgba(255,255,255,0.6)" strokeWidth="0.5" />
          <path d="M40 4 L48 26 L40 24 Z" fill="url(#ap-inner)" opacity="0.9" />
        </svg>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, marginTop: 8 }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 900, letterSpacing: "0.22em", color: "#e8f4ff", fontSize: Math.round(size * 0.7), lineHeight: 1, textShadow: "0 0 24px rgba(0,229,255,0.5)" }}>APEX</div>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, letterSpacing: "0.3em", color: "#7fe5ff", fontSize: Math.max(10, Math.round(size * 0.13)), textTransform: "uppercase", textShadow: "0 0 12px rgba(0,229,255,0.6)" }}>Marketing</div>
      </div>
    </div>
  );
}

/* ── intel feed ───────────────────────────────────────────────────────────── */
const IF_DATA = [
  { type: "lead",   title: "New Lead — Roofing Co.",   loc: "Auto-qualified · High intent", ago: "1m" },
  { type: "email",  title: "Email Sequence Fired",      loc: "847 contacts · 68% open rate", ago: "3m" },
  { type: "social", title: "Reel Published",            loc: "Instagram · 2.4K reach",       ago: "6m" },
] as const;

const IF_ICONS: Record<string, JSX.Element> = {
  lead:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M6 22v-2a6 6 0 0 1 12 0v2"/></svg>,
  email:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>,
  social: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
};

function IntelFeed() {
  const tilt = useTilt(4);
  return (
    <div ref={tilt} className="ap-card">
      <div className="ap-card-head"><div className="ap-card-title">Feed</div><span className="ap-live-dot">Live</span></div>
      {IF_DATA.map((row, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: i === 0 ? "none" : "1px solid var(--line-1)" }}>
          <div style={{ width: 26, height: 26, borderRadius: 5, flexShrink: 0, background: "rgba(0,229,255,0.08)", border: "1px solid rgba(0,229,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-hi)" }}>
            <span style={{ width: 14, height: 14, display: "block" }}>{IF_ICONS[row.type]}</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-1)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.title}</div>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-3)" }}>{row.loc}</div>
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--fg-mute)", flexShrink: 0 }}>{row.ago} ago</div>
        </div>
      ))}
    </div>
  );
}

/* ── sparkline / leads card ───────────────────────────────────────────────── */
function Sparkline() {
  const data = [62,58,71,64,80,68,90,84,96,88,110,102,118];
  const max = Math.max(...data);
  const w = 240, h = 60;
  let d = "";
  data.forEach((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (v / max) * (h - 4) - 2;
    d += (i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1) + " ";
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 60, marginTop: 8 }}>
      <defs>
        <linearGradient id="ap-sparkfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#00e5ff" stopOpacity="0.45" />
          <stop offset="1" stopColor="#00e5ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={d + `L${w} ${h} L0 ${h} Z`} fill="url(#ap-sparkfill)" />
      <path d={d} fill="none" stroke="#00e5ff" strokeWidth="1.5" style={{ filter: "drop-shadow(0 0 6px rgba(0,229,255,0.6))" }} />
    </svg>
  );
}

function IncidentsCard() {
  const tilt = useTilt(4);
  return (
    <div ref={tilt} className="ap-card">
      <div className="ap-card-title">Leads This Month</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 8 }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 32, color: "var(--fg-1)", letterSpacing: "-0.02em" }}>3,847</span>
        <span style={{ fontFamily: "var(--font-heading)", fontSize: 11, color: "var(--signal-live)" }}>+22.4% vs last month</span>
      </div>
      <Sparkline />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--fg-mute)" }}>
        <span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span>
      </div>
    </div>
  );
}

/* ── donut / traffic card ─────────────────────────────────────────────────── */
const TC_CATS = [
  { name: "Organic Social", pct: 38, color: "#00e5ff" },
  { name: "Paid Ads",       pct: 27, color: "#7fe5ff" },
  { name: "Email",          pct: 21, color: "#4ade80" },
  { name: "SEO / Organic",  pct: 9,  color: "#fbbf24" },
  { name: "Referral",       pct: 5,  color: "#5c7a8e" },
];

function Donut() {
  const r = 32, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width="82" height="82" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(125,229,255,0.08)" strokeWidth="8" />
      {TC_CATS.map((cat, i) => {
        const dash = (cat.pct / 100) * c;
        const offset = -acc;
        acc += dash;
        return <circle key={i} cx="50" cy="50" r={r} fill="none" stroke={cat.color} strokeWidth="8" strokeLinecap="butt" strokeDasharray={`${dash} ${c}`} strokeDashoffset={offset} transform="rotate(-90 50 50)" style={{ filter: `drop-shadow(0 0 4px ${cat.color}aa)` }} />;
      })}
    </svg>
  );
}

function TopCategoriesCard() {
  const tilt = useTilt(4);
  return (
    <div ref={tilt} className="ap-card">
      <div className="ap-card-title">Traffic Sources</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
        <Donut />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {TC_CATS.map((cat, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--font-body)", fontSize: 10 }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: cat.color, boxShadow: `0 0 5px ${cat.color}`, flexShrink: 0 }} />
              <span style={{ flex: 1, color: "var(--fg-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cat.name}</span>
              <span style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 10 }}>{cat.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── intel map ────────────────────────────────────────────────────────────── */
const FL_PATH = "M 28 50 L 52 47 L 80 48 L 105 50 L 122 48 L 138 50 L 152 54 L 165 60 L 172 70 L 178 84 L 182 100 L 185 118 L 184 136 L 178 152 L 168 164 L 154 172 L 138 174 L 124 168 L 118 158 L 114 144 L 110 128 L 106 112 L 100 96 L 92 84 L 80 76 L 65 72 L 52 70 L 40 66 L 32 60 Z";
const PINGS = [
  { x: 122, y: 58,  name: "ORLANDO",    hot: false },
  { x: 110, y: 80,  name: "TAMPA",      hot: false },
  { x: 132, y: 110, name: "FORT MYERS", hot: true  },
  { x: 158, y: 168, name: "MIAMI",      hot: false },
];

function IntelMap() {
  const tilt = useTilt(4);
  return (
    <div ref={tilt} className="ap-card">
      <div className="ap-card-head"><div className="ap-card-title">Active Territory</div><span className="ap-live-dot">Live</span></div>
      <svg viewBox="0 0 200 200" style={{ width: "100%", height: 200 }}>
        <defs>
          <linearGradient id="ap-fl-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="rgba(0,229,255,0.18)" />
            <stop offset="1" stopColor="rgba(0,229,255,0.05)" />
          </linearGradient>
          <pattern id="ap-grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M10 0 L0 0 0 10" fill="none" stroke="rgba(125,229,255,0.08)" strokeWidth="0.4" />
          </pattern>
        </defs>
        <rect width="200" height="200" fill="url(#ap-grid)" />
        <path d={FL_PATH} fill="url(#ap-fl-grad)" stroke="rgba(0,229,255,0.55)" strokeWidth="0.8" style={{ filter: "drop-shadow(0 0 6px rgba(0,229,255,0.4))" }} />
        {PINGS.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="3" fill={p.hot ? "#ff4d6d" : "#00e5ff"} style={{ filter: `drop-shadow(0 0 6px ${p.hot ? "#ff4d6d" : "#00e5ff"})` }}>
              <animate attributeName="r" values="3;5;3" dur="2s" repeatCount="indefinite" begin={`${i * 0.3}s`} />
            </circle>
            <circle cx={p.x} cy={p.y} r="3" fill="none" stroke={p.hot ? "#ff4d6d" : "#00e5ff"} strokeWidth="0.6" opacity="0.5">
              <animate attributeName="r" values="3;14;3" dur="2s" repeatCount="indefinite" begin={`${i * 0.3}s`} />
              <animate attributeName="opacity" values="0.6;0;0.6" dur="2s" repeatCount="indefinite" begin={`${i * 0.3}s`} />
            </circle>
            <text x={p.x + (p.x > 150 ? -6 : 8)} y={p.y + 1.5} fontFamily="var(--font-heading)" fontSize="5" letterSpacing="0.2em" textAnchor={p.x > 150 ? "end" : "start"} fill="#c4dbe8">{p.name}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/* ── ai signal ────────────────────────────────────────────────────────────── */
const AI_ROWS = [
  { name: "Conversion Rate", val: 847, frac: 0.94 },
  { name: "High Intent",     val: 632, frac: 0.78 },
  { name: "Qualified",       val: 421, frac: 0.61 },
];

function AISignal() {
  const tilt = useTilt(4);
  const r = 30, c = 2 * Math.PI * r, pct = 0.89;
  return (
    <div ref={tilt} className="ap-card">
      <div className="ap-card-title">AI Performance Score</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
        <div style={{ position: "relative", width: 74, height: 74, flexShrink: 0 }}>
          <svg width="74" height="74" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(125,229,255,0.12)" strokeWidth="6" />
            <circle cx="40" cy="40" r={r} fill="none" stroke="#00e5ff" strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform="rotate(-90 40 40)" style={{ filter: "drop-shadow(0 0 6px rgba(0,229,255,0.7))" }} />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 22, color: "var(--fg-1)", lineHeight: 1 }}>94</span>
            <span style={{ fontFamily: "var(--font-heading)", fontSize: 6, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--fg-3)", marginTop: 2 }}>ELITE</span>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {AI_ROWS.map((row, i) => (
            <div key={i}>
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-2)", marginBottom: 2 }}>
                <span>{row.name}</span>
                <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, color: "var(--fg-1)", fontSize: 11 }}>{row.val}</span>
              </div>
              <div style={{ height: 3, background: "rgba(125,229,255,0.08)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: (row.frac * 100) + "%", height: "100%", background: "linear-gradient(90deg,#00e5ff,#7fe5ff)", boxShadow: "0 0 6px rgba(0,229,255,0.6)" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── automation card ──────────────────────────────────────────────────────── */
const AT_FLOWS = [
  { name: "Content Scheduler", running: true },
  { name: "Lead Nurturing",    running: true },
  { name: "AI Ad Optimizer",   running: true },
];

function AutomationCard() {
  const tilt = useTilt(4);
  return (
    <div ref={tilt} className="ap-card">
      <div className="ap-card-title">Automation Engine</div>
      <div style={{ fontFamily: "var(--font-heading)", fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--fg-mute)", marginTop: 4, marginBottom: 8 }}>ACTIVE WORKFLOWS</div>
      {AT_FLOWS.map((f, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: i === 0 ? "none" : "1px solid var(--line-1)" }}>
          <span style={{ flex: 1, fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-1)" }}>{f.name}</span>
          <span style={{ fontFamily: "var(--font-heading)", fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--signal-live)", display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 5, height: 5, borderRadius: 99, background: "var(--signal-live)", boxShadow: "0 0 6px var(--signal-live)" }} />
            Running
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── stat strip ───────────────────────────────────────────────────────────── */
const SS_STATS = [
  { val: "3,847",  lbl: "LEADS GENERATED" },
  { val: "3.2M",   lbl: "REACH THIS MONTH" },
  { val: "68%",    lbl: "AVG OPEN RATE" },
  { val: "4.2x",   lbl: "AVERAGE ROAS" },
  { val: "99.98%", lbl: "ALWAYS ON" },
];

const IcnUsers = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
const IcnShield = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/></svg>;
const IcnZap = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"/></svg>;
const IcnTarget = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>;
const IcnCheck = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>;
const SS_ICONS = [IcnUsers, IcnShield, IcnZap, IcnTarget, IcnCheck];

function StatStrip() {
  return (
    <div className="ap-stat-strip">
      {SS_STATS.map((s, i) => {
        const Icon = SS_ICONS[i];
        return (
          <div key={i} className="ap-stat">
            <div className="ap-stat-icon"><span style={{ width: 18, height: 18, display: "block" }}><Icon /></span></div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span className="ap-stat-val">{s.val}</span>
              <span className="ap-stat-lbl">{s.lbl}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── hero ─────────────────────────────────────────────────────────────────── */
function Hero() {
  const megRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = setInterval(() => {
      if (!megRef.current) return;
      megRef.current.classList.add("bite-active");
      setTimeout(() => megRef.current?.classList.remove("bite-active"), 1800);
    }, 14000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="ap-hero">
      <div ref={megRef} className="ap-meg" aria-hidden>
        <img className="ap-meg-photo" src="/apex-hero-reference.jpeg" alt="" />
      </div>

      <aside className="ap-rail ap-rail-left">
        <IntelFeed />
        <IncidentsCard />
        <TopCategoriesCard />
      </aside>

      <div className="ap-stage">
        <div className="ap-hero-center">
          <ApexLogo size={88} />
          <h1 className="ap-tagline">Most agencies talk. We automate.</h1>
          <p className="ap-sub">Apex builds the AI-powered marketing engine behind your business — lead gen, content, email, paid ads — all running on autopilot while you focus on what you actually do.</p>
          <div className="ap-ctas">
            <Link href="/login" className="ap-btn ap-btn-primary">See What We Build →</Link>
            <Link href="/login" className="ap-btn ap-btn-secondary">Book a Call</Link>
          </div>
        </div>
      </div>

      <aside className="ap-rail ap-rail-right">
        <IntelMap />
        <AISignal />
        <AutomationCard />
      </aside>

      <StatStrip />
    </section>
  );
}

/* ── bubble orbs ──────────────────────────────────────────────────────────── */
function BubbleOrbs({ count = 22 }: { count?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouse = useRef({ x: -9999, y: -9999 });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const resize = () => {
      canvas.width = canvas.offsetWidth * devicePixelRatio;
      canvas.height = canvas.offsetHeight * devicePixelRatio;
      ctx.setTransform(1,0,0,1,0,0);
      ctx.scale(devicePixelRatio, devicePixelRatio);
    };
    resize();
    const ro = new ResizeObserver(() => { ctx.setTransform(1,0,0,1,0,0); resize(); });
    ro.observe(canvas);
    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    window.addEventListener("mousemove", onMove);
    const W = () => canvas.offsetWidth, H = () => canvas.offsetHeight;
    const orbs = Array.from({ length: count }, () => ({
      x: Math.random() * W(), y: Math.random() * H(),
      r: 18 + Math.random() * 56,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35 - 0.08,
      alpha: 0.28 + Math.random() * 0.38,
      hue: 182 + Math.random() * 24,
    }));
    let raf: number;
    const draw = () => {
      const w = W(), h = H();
      ctx.clearRect(0, 0, w, h);
      const mx = mouse.current.x, my = mouse.current.y;
      orbs.forEach((o) => {
        const dx = o.x - mx, dy = o.y - my;
        const d = Math.sqrt(dx * dx + dy * dy);
        const repel = 160;
        if (d < repel && d > 0.5) { const f = ((repel - d) / repel) * 0.9; o.vx += (dx / d) * f * 0.12; o.vy += (dy / d) * f * 0.12; }
        o.vx *= 0.974; o.vy *= 0.974; o.vy -= 0.004;
        const spd = Math.sqrt(o.vx * o.vx + o.vy * o.vy);
        if (spd > 3.5) { o.vx = (o.vx / spd) * 3.5; o.vy = (o.vy / spd) * 3.5; }
        o.x += o.vx; o.y += o.vy;
        if (o.x < -o.r * 2) o.x = w + o.r;
        if (o.x > w + o.r * 2) o.x = -o.r;
        if (o.y < -o.r * 2) o.y = h + o.r;
        if (o.y > h + o.r * 2) o.y = -o.r;
        ctx.save();
        ctx.shadowBlur = 28; ctx.shadowColor = `hsla(${o.hue},100%,68%,${o.alpha * 0.7})`;
        const body = ctx.createRadialGradient(o.x, o.y, o.r * 0.1, o.x, o.y, o.r);
        body.addColorStop(0, `hsla(${o.hue},90%,80%,${o.alpha * 0.06})`);
        body.addColorStop(0.65, `hsla(${o.hue},100%,62%,${o.alpha * 0.08})`);
        body.addColorStop(1, `hsla(${o.hue},100%,55%,${o.alpha * 0.28})`);
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fillStyle = body; ctx.fill();
        ctx.shadowBlur = 0;
        const rim = ctx.createLinearGradient(o.x - o.r, o.y - o.r, o.x + o.r, o.y + o.r);
        rim.addColorStop(0, `hsla(${o.hue},100%,92%,${o.alpha * 0.9})`);
        rim.addColorStop(0.45, `hsla(${o.hue},100%,75%,${o.alpha * 0.5})`);
        rim.addColorStop(1, `hsla(${o.hue},80%,55%,${o.alpha * 0.15})`);
        ctx.strokeStyle = rim; ctx.lineWidth = 1.2; ctx.stroke();
        const hiR = o.r * 0.42, hiX = o.x - o.r * 0.32, hiY = o.y - o.r * 0.32;
        const spec = ctx.createRadialGradient(hiX, hiY, 0, hiX, hiY, hiR);
        spec.addColorStop(0, `rgba(255,255,255,${o.alpha * 0.72})`);
        spec.addColorStop(0.5, `rgba(255,255,255,${o.alpha * 0.18})`);
        spec.addColorStop(1, "rgba(255,255,255,0)");
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r * 0.88, 0, Math.PI * 2); ctx.clip();
        ctx.beginPath(); ctx.arc(hiX, hiY, hiR, 0, Math.PI * 2); ctx.fillStyle = spec; ctx.fill();
        ctx.restore();
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener("mousemove", onMove); };
  }, [count]);

  return <canvas ref={canvasRef} className="ap-orbs-canvas" />;
}

/* ── feature cards ────────────────────────────────────────────────────────── */
const FEATURES = [
  { title: "First mover advantage.", body: "When a prospect is ready to buy, you're already in their inbox. Our AI watches intent signals across the web and triggers outreach before your competitors wake up.", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"/></svg> },
  { title: "Content that converts.", body: "We don't post for the algorithm. Every piece of content we build is engineered to move people toward a decision — not just rack up impressions.", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> },
  { title: "Your market. Your leads.", body: "Tell us who you serve and where. We build hyper-targeted campaigns for your exact audience — not generic ads thrown at a zip code and hoped for.", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg> },
  { title: "Set it. Watch it run.", body: "Connect your CRM, inbox, and ad accounts. Our automation layer ties it all together so leads flow in and nurture sequences fire — without you lifting a finger.", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg> },
  { title: "Know your numbers.", body: "Real-time dashboards, campaign analytics, ROAS tracking — you know exactly what's working and what's not before you spend another dollar on ads.", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h3l3-9 4 18 3-9h7"/></svg> },
  { title: "We stay in it with you.", body: "No 6-month contracts and disappearing acts. We're embedded in your business — adjusting, optimizing, and reporting every week until the numbers move.", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/></svg> },
];

function FeatureCard({ icon, title, body, delay }: { icon: JSX.Element; title: string; body: string; delay: number }) {
  const ref = useReveal();
  return (
    <div ref={ref} className="ap-feature ap-reveal" style={{ transitionDelay: `${delay}ms` }}>
      <div className="ap-ficon">{icon}</div>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

/* ── deep sections ────────────────────────────────────────────────────────── */
function DeepSections() {
  const s1 = useReveal(), s2 = useReveal(), s3 = useReveal();
  const sub1 = useReveal(), sub2 = useReveal(), sub3 = useReveal();
  const eye1 = useReveal(), eye2 = useReveal(), eye3 = useReveal();
  const statsBox = useReveal(), ctas = useReveal();

  return (
    <div className="ap-orbs-wrap">
      <BubbleOrbs count={22} />

      <section className="ap-section">
        <div ref={eye1} className="ap-eyebrow ap-reveal">WHAT WE BUILD</div>
        <h2 ref={s1} className="ap-reveal">Every business deserves a <em>marketing engine</em>. Not just a marketing agency.</h2>
        <p ref={sub1} className="ap-sub-center ap-reveal">You're good at what you do. What you don't need is to become a marketing expert on top of it. That's what we're here for — we build the system, you run the business.</p>
        <div className="ap-feature-grid">
          {FEATURES.map((f, i) => <FeatureCard key={i} icon={f.icon} title={f.title} body={f.body} delay={i * 80} />)}
        </div>
      </section>

      <section className="ap-section" style={{ paddingTop: 80 }}>
        <div ref={eye2} className="ap-eyebrow ap-reveal">WHILE YOU WORK</div>
        <h2 ref={s2} className="ap-reveal">You're busy <em>running it</em>. We'll watch for what's next.</h2>
        <p ref={sub2} className="ap-sub-center ap-reveal">Every county in Florida. Every accident report, court filing, and property record. Every minute of every day. Looking for the one that's worth your call.</p>
        <div ref={statsBox} className="ap-reveal" style={{ marginTop: 64, padding: "40px 32px", background: "rgba(8,24,44,0.55)", backdropFilter: "blur(20px) saturate(140%)", border: "1px solid var(--line-2)", borderRadius: 18, boxShadow: "0 12px 48px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 32 }}>
          {[{ v: "67", l: "COUNTIES COVERED" }, { v: "23K+", l: "RECORDS PER DAY" }, { v: "2.7 SEC", l: "AVG ALERT TIME" }, { v: "$0", l: "EXTRA HEADCOUNT" }].map((s, i) => (
            <div key={i} style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 56, color: "var(--fg-1)", letterSpacing: "-0.02em", lineHeight: 1, textShadow: "0 0 24px rgba(0,229,255,0.3)" }}>{s.v}</div>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--fg-3)", marginTop: 10 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="ap-section" style={{ paddingTop: 80, paddingBottom: 80 }}>
        <div ref={eye3} className="ap-eyebrow ap-reveal">WHEN YOU'RE READY</div>
        <h2 ref={s3} className="ap-reveal">Pick up the phone <em>before they do</em>.</h2>
        <p ref={sub3} className="ap-sub-center ap-reveal">Your competition is already making calls. Waiting usually costs more than moving. Two weeks from today, you could be hearing about leads you would have never known existed.</p>
        <div ref={ctas} className="ap-reveal" style={{ display: "flex", justifyContent: "center", gap: 14, marginTop: 8 }}>
          <Link href="/login" className="ap-btn ap-btn-primary">Get Started →</Link>
          <Link href="/login" className="ap-btn ap-btn-secondary">Talk to Someone</Link>
        </div>
      </section>
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────────── */
export default function LandingPage() {
  return (
    <div className="apex-page">
      <div className="ap-page">
        <Atmosphere count={50} rays={14} />
        <Nav />
        <Hero />
        <DeepSections />
        <footer className="ap-footer">
          <div className="ap-footer-word">APEX</div>
          <div className="ap-footer-copy">© 2026 Apex Marketing Automations · Built for the people who actually do the work.</div>
        </footer>
      </div>
    </div>
  );
}
