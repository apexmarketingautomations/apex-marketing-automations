import { motion } from "framer-motion";
import { Phone, Mail, Globe, Download, MessageSquare, Zap, QrCode, Palette, Code2, Megaphone, Bot, Workflow, BarChart3, Smartphone, Shield, Mic } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import dantePhoto from "@assets/Image_25_1771984241816.jpeg";

const LINKS = [
  { icon: Phone, label: "Call Me", value: "(239) 492-2698", href: "tel:+12394922698", bg: "bg-green-500/10", text: "text-green-400" },
  { icon: MessageSquare, label: "Text Me", value: "Send a message", href: "sms:+12394922698", bg: "bg-blue-500/10", text: "text-blue-400" },
  { icon: Mail, label: "Email Me", value: "Dante@apexmarketingautomations.com", href: "mailto:Dante@apexmarketingautomations.com", bg: "bg-purple-500/10", text: "text-purple-400" },
  { icon: Globe, label: "Visit Website", value: "apexmarketingautomations.com", href: "https://apexmarketingautomations.com", bg: "bg-cyan-500/10", text: "text-cyan-400" },
];

const SKILLS = [
  { icon: Palette, label: "Graphic Design", color: "from-pink-500 to-rose-500" },
  { icon: Code2, label: "Software Engineering", color: "from-indigo-500 to-blue-500" },
  { icon: Code2, label: "Full-Stack Developer", color: "from-slate-500 to-zinc-500" },
  { icon: Globe, label: "Web Development", color: "from-cyan-500 to-teal-500" },
  { icon: Megaphone, label: "Digital Marketing", color: "from-orange-500 to-amber-500" },
  { icon: Bot, label: "AI & Automation", color: "from-purple-500 to-violet-500" },
  { icon: Mic, label: "Voice AI Agents", color: "from-emerald-500 to-green-500" },
  { icon: Workflow, label: "Workflow Automation", color: "from-blue-500 to-indigo-500" },
  { icon: BarChart3, label: "Analytics & CRM", color: "from-yellow-500 to-orange-500" },
  { icon: Smartphone, label: "SMS & Multi-Channel", color: "from-sky-500 to-blue-500" },
  { icon: Shield, label: "Sentinel Monitoring", color: "from-red-500 to-pink-500" },
];

const CARD_URL = "https://apexmarketingautomations.com/DanteS";

export default function DigitalCard() {
  const [showQR, setShowQR] = useState(false);

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4 relative overflow-hidden bg-black">
      <div className="absolute inset-0">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-indigo-600/15 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-purple-600/15 rounded-full blur-[120px]" />
        <div className="absolute top-[40%] left-[50%] w-[300px] h-[300px] bg-cyan-600/10 rounded-full blur-[100px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-[420px]"
      >
        <div className="relative rounded-[28px] overflow-hidden" style={{ background: "linear-gradient(145deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 25px 60px -15px rgba(99, 102, 241, 0.2), 0 0 0 1px rgba(255,255,255,0.05) inset" }}>
          <div className="relative h-40 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500" />
            <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(circle at 20% 50%, rgba(255,255,255,0.1) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(255,255,255,0.08) 0%, transparent 40%)" }} />
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="absolute top-4 right-4 flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/20"
            >
              <Zap size={10} className="text-yellow-300" />
              <span className="text-[10px] font-bold text-white/90 tracking-wider uppercase">Apex</span>
            </motion.div>
          </div>

          <div className="px-7 pb-8 -mt-14">
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 180, damping: 15 }}
              className="relative"
            >
              <div className="w-[88px] h-[88px] rounded-[22px] p-[3px] bg-gradient-to-br from-indigo-400 via-purple-500 to-pink-500 shadow-xl shadow-purple-500/30">
                <img src={dantePhoto} alt="Dante S." className="w-full h-full rounded-[19px] object-cover object-top" />
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.35 }} className="mt-5">
              <h1 className="text-[28px] font-black text-white tracking-tight leading-none" data-testid="text-card-name">Dante S.</h1>
              <div className="flex items-center gap-2 mt-2">
                <div className="h-[2px] w-8 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full" />
                <p className="text-sm font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">Founder & CEO</p>
              </div>
              <p className="text-slate-500 text-xs mt-1 font-medium">Apex Marketing Automations</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.45 }}
              className="mt-5 p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06]"
            >
              <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-400 mb-2">About Me</p>
              <p className="text-slate-300 text-[13px] leading-relaxed">
                Full-stack creative and technologist. I design, build, and market AI-powered platforms that help businesses scale on autopilot. From pixel-perfect graphics to production-grade software, multi-channel marketing campaigns to autonomous voice agents — I turn ideas into systems that work around the clock.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-4"
            >
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3 px-1">What I Do</p>
              <div className="flex flex-wrap gap-2">
                {SKILLS.map((skill, i) => (
                  <motion.div
                    key={skill.label}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.55 + i * 0.04 }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-colors"
                  >
                    <div className={`w-4 h-4 rounded-md bg-gradient-to-br ${skill.color} flex items-center justify-center`}>
                      <skill.icon size={10} className="text-white" />
                    </div>
                    <span className="text-[11px] font-medium text-white/70">{skill.label}</span>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7 }}
              className="mt-6 space-y-2.5"
            >
              {LINKS.map((link, i) => (
                <motion.a
                  key={link.label}
                  href={link.href}
                  target={link.href.startsWith("http") ? "_blank" : undefined}
                  rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.75 + i * 0.08 }}
                  className="flex items-center gap-4 p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.08] hover:border-white/[0.12] transition-all duration-300 group cursor-pointer"
                  data-testid={`link-${link.label.toLowerCase().replace(' ', '-')}`}
                >
                  <div className={`w-11 h-11 rounded-xl ${link.bg} flex items-center justify-center group-hover:scale-110 transition-transform duration-300`}>
                    <link.icon size={20} className={link.text} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{link.label}</p>
                    <p className="text-sm font-medium text-white/80 group-hover:text-white transition-colors truncate">{link.value}</p>
                  </div>
                </motion.a>
              ))}
            </motion.div>

            <div className="mt-7 flex gap-2.5">
              <motion.a
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.1 }}
                href="/contact.vcf"
                className="flex-1 py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2.5 transition-all duration-300 hover:scale-[1.03] active:scale-[0.97] relative overflow-hidden group"
                style={{ background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%)", boxShadow: "0 10px 30px -5px rgba(99, 102, 241, 0.4)" }}
                data-testid="button-save-contact"
              >
                <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors duration-300" />
                <Download size={18} className="text-white relative z-10" />
                <span className="text-white relative z-10">Save Contact</span>
              </motion.a>

              <motion.button
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.15 }}
                onClick={() => setShowQR(!showQR)}
                className="w-14 h-14 rounded-2xl bg-white/[0.06] border border-white/[0.1] flex items-center justify-center hover:bg-white/[0.12] transition-all duration-300 hover:scale-105 active:scale-95 shrink-0"
                data-testid="button-show-qr"
              >
                <QrCode size={22} className="text-white/70" />
              </motion.button>
            </div>

            {showQR && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="mt-5 flex flex-col items-center"
              >
                <div className="p-4 bg-white rounded-2xl shadow-lg shadow-indigo-500/20">
                  <QRCodeSVG
                    value={CARD_URL}
                    size={180}
                    bgColor="#ffffff"
                    fgColor="#000000"
                    level="H"
                    includeMargin={false}
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-3 font-medium">Scan to share this card</p>
              </motion.div>
            )}
          </div>
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.3 }}
          className="text-center text-[10px] text-slate-700 mt-5 font-medium"
        >
          Powered by Apex Marketing Automations
        </motion.p>
      </motion.div>
    </div>
  );
}
