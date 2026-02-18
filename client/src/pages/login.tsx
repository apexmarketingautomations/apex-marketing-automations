import { motion } from "framer-motion";
import { Sparkles, Zap, MessageSquare, Bot, Globe, Phone, BarChart3, ArrowRight } from "lucide-react";

const FEATURES = [
  { icon: MessageSquare, title: "Unified Inbox", desc: "SMS, Instagram, WhatsApp & Messenger in one place" },
  { icon: Bot, title: "AI Voice Agent", desc: "Deploy AI receptionists that handle calls 24/7" },
  { icon: Globe, title: "AI Site Builder", desc: "Generate stunning landing pages with one click" },
  { icon: Phone, title: "Smart Dialer", desc: "Power dial leads with AI-powered conversations" },
  { icon: BarChart3, title: "Usage & Billing", desc: "Track every SMS, call, and AI interaction" },
  { icon: Zap, title: "God Mode", desc: "One-click empire builder — deploy everything at once" },
];

export default function Login() {
  return (
    <div className="min-h-screen flex relative overflow-hidden" style={{ backgroundColor: "#030014" }}>
      <div className="absolute inset-0 bg-grid z-0 pointer-events-none" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-gradient-to-b from-indigo-600/20 via-purple-600/10 to-transparent rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-gradient-to-t from-cyan-600/10 to-transparent rounded-full blur-3xl pointer-events-none" />

      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative z-10">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 mb-8">
            <Sparkles size={12} /> APEX MARKETING AUTOMATIONS
          </div>
          <h1 className="text-5xl font-black text-white tracking-tight leading-tight mb-4" data-testid="text-login-title">
            Your AI-Powered
            <br />
            <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              Business Command Center
            </span>
          </h1>
          <p className="text-lg text-slate-400 max-w-md">
            Manage communications, deploy AI agents, build websites, and automate workflows — all from one platform.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="grid grid-cols-2 gap-3 mt-8"
        >
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.08 }}
              className="flex items-start gap-3 p-3 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
                <f.icon size={14} className="text-indigo-400" />
              </div>
              <div>
                <p className="text-xs font-bold text-white/80">{f.title}</p>
                <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">{f.desc}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>

        <p className="text-xs text-slate-600 mt-8">&copy; {new Date().getFullYear()} Apex Marketing Automations. All rights reserved.</p>
      </div>

      <div className="flex-1 flex items-center justify-center relative z-10 p-8">
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 mb-4">
              <Sparkles size={12} /> APEX MARKETING AUTOMATIONS
            </div>
            <h1 className="text-3xl font-black text-white tracking-tight">
              AI-Powered <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">Command Center</span>
            </h1>
          </div>

          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl shadow-indigo-500/5">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-white mb-2">Welcome</h2>
              <p className="text-sm text-slate-400">Sign in with your Google, Apple, or email account to get started</p>
            </div>

            <a
              href="/api/login"
              className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-3 text-sm shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:scale-[1.02] active:scale-[0.98]"
              data-testid="button-login"
            >
              Sign In
              <ArrowRight size={16} />
            </a>

            <div className="mt-6 flex items-center gap-3">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-slate-500">Supports</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            <div className="mt-4 flex justify-center gap-6">
              <div className="flex items-center gap-2 text-slate-400">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                <span className="text-xs">Google</span>
              </div>
              <div className="flex items-center gap-2 text-slate-400">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
                <span className="text-xs">Apple</span>
              </div>
              <div className="flex items-center gap-2 text-slate-400">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
                <span className="text-xs">Email</span>
              </div>
            </div>

            <p className="text-[10px] text-slate-600 text-center mt-6">
              Free forever plan. No credit card required.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
