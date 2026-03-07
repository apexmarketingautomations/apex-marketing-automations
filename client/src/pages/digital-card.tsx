import { motion, useScroll, useTransform } from "framer-motion";
import { Phone, Mail, Globe, Download, MessageSquare, Zap, QrCode, Palette, Code2, Megaphone, Bot, Workflow, BarChart3, Smartphone, Shield, Mic, Play, ChevronDown, ArrowUpRight, Star } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState, useEffect, useRef } from "react";
const dantePhoto = "/dante-photo.jpeg";

const LINKS = [
  { icon: Phone, label: "Call Me", value: "(239) 492-2698", href: "tel:+12394922698", bg: "bg-green-500/10", text: "text-green-400" },
  { icon: MessageSquare, label: "Text Me", value: "Send a message", href: "sms:+12394922698", bg: "bg-blue-500/10", text: "text-blue-400" },
  { icon: Mail, label: "Email Me", value: "Dante@apexmarketingautomations.com", href: "mailto:Dante@apexmarketingautomations.com", bg: "bg-purple-500/10", text: "text-purple-400" },
  { icon: Globe, label: "Visit Website", value: "apexmarketingautomations.com", href: "/", bg: "bg-cyan-500/10", text: "text-cyan-400" },
  { icon: Star, label: "Leave a Review", value: "Rate us on Google", href: "https://g.page/r/CY4EJ5F_Kli-EAI/review", bg: "bg-yellow-500/10", text: "text-yellow-400" },
];

const SKILLS = [
  { icon: Palette, label: "Graphic Design", color: "from-pink-500 to-rose-500", href: "/niche-directory", desc: "Brand identities, landing pages, and visual systems for 17+ industries" },
  { icon: Code2, label: "Software Engineering", color: "from-indigo-500 to-blue-500", href: "/demo", desc: "Full SaaS platform built from scratch — auth, billing, APIs, and real-time data" },
  { icon: Code2, label: "Full-Stack Developer", color: "from-slate-500 to-zinc-500", href: "/demo", desc: "React + TypeScript frontend, Node.js + Express backend, PostgreSQL database" },
  { icon: Globe, label: "Web Development", color: "from-cyan-500 to-teal-500", href: "/site-builder", desc: "AI-powered site builder that generates complete websites from a single prompt" },
  { icon: Megaphone, label: "Digital Marketing", color: "from-orange-500 to-amber-500", href: "/ad-launcher", desc: "Meta Ads launcher with geofence targeting, audience builder, and ROI tracking" },
  { icon: Bot, label: "AI & Automation", color: "from-purple-500 to-violet-500", href: "/bot-trainer", desc: "Train AI chatbots on any website — RAG pipeline with tool-calling and memory" },
  { icon: Mic, label: "Voice AI Agents", color: "from-emerald-500 to-green-500", href: "/voice-agent", desc: "Deploy AI receptionists that answer calls, book appointments, and qualify leads 24/7" },
  { icon: Workflow, label: "Workflow Automation", color: "from-blue-500 to-indigo-500", href: "/workflow-builder", desc: "Visual drag-and-drop workflow builder with triggers, conditions, and AI actions" },
  { icon: BarChart3, label: "Analytics & CRM", color: "from-yellow-500 to-orange-500", href: "/pipeline", desc: "Pipeline management, deal tracking, contact CRM, and conversion analytics" },
  { icon: Smartphone, label: "SMS & Multi-Channel", color: "from-sky-500 to-blue-500", href: "/inbox", desc: "Unified inbox for SMS, Instagram DMs, and WhatsApp with AI auto-reply" },
  { icon: Shield, label: "Sentinel Monitoring", color: "from-red-500 to-pink-500", href: "/sentinel", desc: "Real-time crash detection scanner that finds broken business websites via geofence" },
];

const STATS = [
  { label: "Industries Served", value: 17, suffix: "+" },
  { label: "AI Bots Deployed", value: 50, suffix: "+" },
  { label: "Workflows Built", value: 200, suffix: "+" },
  { label: "Lines of Code", value: 45, suffix: "K" },
];

const CARD_URL = `${window.location.origin}/DanteS`;

function AnimatedCounter({ value, suffix }: { value: number; suffix: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !started) setStarted(true); },
      { threshold: 0.5 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;
    const duration = 1500;
    const steps = 40;
    const increment = value / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += increment;
      if (current >= value) {
        setCount(value);
        clearInterval(timer);
      } else {
        setCount(Math.floor(current));
      }
    }, duration / steps);
    return () => clearInterval(timer);
  }, [started, value]);

  return <div ref={ref} className="text-2xl font-black text-white">{count}{suffix}</div>;
}

function FloatingParticles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: 30 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 rounded-full"
          style={{
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            background: `hsl(${220 + Math.random() * 80}, 70%, ${50 + Math.random() * 30}%)`,
          }}
          animate={{
            y: [0, -30 - Math.random() * 50, 0],
            x: [0, (Math.random() - 0.5) * 40, 0],
            opacity: [0, 0.6, 0],
            scale: [0, 1 + Math.random(), 0],
          }}
          transition={{
            duration: 3 + Math.random() * 4,
            repeat: Infinity,
            delay: Math.random() * 5,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

export default function DigitalCard() {
  const [showQR, setShowQR] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: containerRef });
  const heroScale = useTransform(scrollYProgress, [0, 0.2], [1, 0.95]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.3], [1, 0]);

  return (
    <div ref={containerRef} className="min-h-screen bg-black relative">
      <FloatingParticles />

      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[600px] h-[600px] bg-indigo-600/15 rounded-full blur-[120px]" />
        <div className="absolute bottom-[20%] right-[-10%] w-[500px] h-[500px] bg-purple-600/12 rounded-full blur-[120px]" />
        <div className="absolute top-[50%] left-[30%] w-[400px] h-[400px] bg-cyan-600/8 rounded-full blur-[100px]" />
      </div>

      <motion.div style={{ scale: heroScale, opacity: heroOpacity }} className="relative z-10">
        <div className="relative h-[70vh] min-h-[500px] max-h-[700px] overflow-hidden flex items-end">
          <div className="absolute inset-0">
            <img src={dantePhoto} alt="Dante S." className="w-full h-full object-cover object-top" />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-900/30 to-purple-900/20" />
          </div>

          <div className="relative z-10 p-8 pb-12 w-full">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/20 mb-4"
            >
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[11px] font-bold text-white/90 tracking-wider uppercase">Available for Projects</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="text-5xl font-black text-white tracking-tight leading-[1.1]"
              data-testid="text-card-name"
            >
              Dante S.
            </motion.h1>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="flex items-center gap-3 mt-3"
            >
              <div className="h-[2px] w-10 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full" />
              <p className="text-lg font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                Founder & CEO
              </p>
            </motion.div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="text-slate-400 text-sm mt-1 font-medium"
            >
              Apex Marketing Automations
            </motion.p>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8 }}
              className="flex justify-center mt-8"
            >
              <ChevronDown size={20} className="text-white/30 animate-bounce" />
            </motion.div>
          </div>
        </div>
      </motion.div>

      <div className="relative z-10 px-5 max-w-[480px] mx-auto -mt-4">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="grid grid-cols-4 gap-2 mb-8"
        >
          {STATS.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="text-center p-3 rounded-2xl bg-white/[0.04] border border-white/[0.08] backdrop-blur-sm"
            >
              <AnimatedCounter value={stat.value} suffix={stat.suffix} />
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mt-1">{stat.label}</p>
            </motion.div>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="p-5 rounded-2xl bg-white/[0.04] border border-white/[0.08] backdrop-blur-sm mb-6"
        >
          <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-400 mb-3">About Me</p>
          <p className="text-slate-300 text-[14px] leading-relaxed">
            Full-stack creative and technologist. I design, build, and market AI-powered platforms that help businesses scale on autopilot.
          </p>
          <p className="text-slate-400 text-[13px] leading-relaxed mt-3">
            From pixel-perfect graphics to production-grade software, multi-channel marketing campaigns to autonomous voice agents — I turn ideas into systems that work around the clock.
          </p>
        </motion.div>

        <motion.a
          href="/demo"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-6 w-full py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-3 relative overflow-hidden group block"
          style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(139,92,246,0.15) 100%)", border: "1px solid rgba(99,102,241,0.3)" }}
          data-testid="button-watch-demo"
        >
          <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
            <Play size={18} className="text-indigo-400 ml-0.5" />
          </div>
          <div className="text-left">
            <p className="text-white font-bold text-sm">Watch Live Demo</p>
            <p className="text-indigo-400/70 text-[11px]">See the full platform in action</p>
          </div>
          <ArrowUpRight size={16} className="text-indigo-400/50 ml-auto mr-2" />
        </motion.a>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mb-6"
        >
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3 px-1">What I Build</p>
          <div className="space-y-2">
            {SKILLS.map((skill, i) => (
              <motion.a
                key={skill.label}
                href={skill.href}
                initial={{ opacity: 0, x: -15 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.03 }}
                className="flex items-start gap-3 p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.08] hover:border-white/[0.15] transition-all duration-300 group cursor-pointer block"
                data-testid={`skill-${skill.label.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${skill.color} flex items-center justify-center shrink-0 group-hover:scale-110 group-hover:shadow-lg transition-all duration-300`}>
                  <skill.icon size={18} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-bold text-white/90 group-hover:text-white transition-colors">{skill.label}</p>
                    <ArrowUpRight size={12} className="text-white/0 group-hover:text-white/40 transition-all" />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{skill.desc}</p>
                </div>
              </motion.a>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-6 p-5 rounded-2xl relative overflow-hidden"
          style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(168,85,247,0.08) 100%)", border: "1px solid rgba(99,102,241,0.15)" }}
        >
          <div className="absolute top-3 left-5 text-4xl text-indigo-500/20 font-serif">"</div>
          <p className="text-slate-300 text-[14px] leading-relaxed italic mt-4 px-2">
            I don't just build software — I build revenue machines. Every feature is designed to generate leads, close deals, and save time. If it doesn't make money, it doesn't ship.
          </p>
          <div className="flex items-center gap-3 mt-4 px-2">
            <div className="w-8 h-8 rounded-full overflow-hidden border border-indigo-500/30">
              <img src={dantePhoto} alt="Dante" className="w-full h-full object-cover object-top" />
            </div>
            <div>
              <p className="text-xs font-bold text-white/80">Dante S.</p>
              <p className="text-[10px] text-indigo-400/60">Founder, Apex Marketing Automations</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-6"
        >
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3 px-1">Get In Touch</p>
          <div className="space-y-2.5">
            {LINKS.map((link, i) => (
              <motion.a
                key={link.label}
                href={link.href}
                target={link.href.startsWith("http") ? "_blank" : undefined}
                rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className="flex items-center gap-4 p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.08] hover:border-white/[0.12] transition-all duration-300 group cursor-pointer"
                data-testid={`link-${link.label.toLowerCase().replace(' ', '-')}`}
              >
                <div className={`w-12 h-12 rounded-xl ${link.bg} flex items-center justify-center group-hover:scale-110 transition-transform duration-300`}>
                  <link.icon size={22} className={link.text} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{link.label}</p>
                  <p className="text-sm font-medium text-white/80 group-hover:text-white transition-colors truncate">{link.value}</p>
                </div>
              </motion.a>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="flex gap-2.5 mb-4"
        >
          <a
            href="/contact.vcf"
            className="flex-1 py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2.5 transition-all duration-300 hover:scale-[1.03] active:scale-[0.97] relative overflow-hidden group"
            style={{ background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%)", boxShadow: "0 10px 30px -5px rgba(99, 102, 241, 0.4)" }}
            data-testid="button-save-contact"
          >
            <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors duration-300" />
            <Download size={18} className="text-white relative z-10" />
            <span className="text-white relative z-10">Save Contact</span>
          </a>

          <button
            onClick={() => setShowQR(!showQR)}
            className="w-14 h-14 rounded-2xl bg-white/[0.06] border border-white/[0.1] flex items-center justify-center hover:bg-white/[0.12] transition-all duration-300 hover:scale-105 active:scale-95 shrink-0"
            data-testid="button-show-qr"
          >
            <QrCode size={22} className="text-white/70" />
          </button>
        </motion.div>

        {showQR && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="mb-6 flex flex-col items-center"
          >
            <div className="p-5 bg-white rounded-2xl shadow-lg shadow-indigo-500/20">
              <QRCodeSVG
                value={CARD_URL}
                size={200}
                bgColor="#ffffff"
                fgColor="#000000"
                level="H"
                includeMargin={false}
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-3 font-medium">Scan to share this card</p>
          </motion.div>
        )}

        <a href="/cards" className="block text-center text-[10px] text-slate-700 pb-8 pt-2 font-medium hover:text-cyan-400 transition-colors">
          Powered by Apex Marketing Automations — Get Your Own Card
        </a>
      </div>
    </div>
  );
}
