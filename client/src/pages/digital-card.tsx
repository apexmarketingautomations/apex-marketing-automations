import { motion } from "framer-motion";
import { Phone, Mail, Globe, Download, MessageSquare } from "lucide-react";

export default function DigitalCard() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: "#030014" }}>
      <div className="absolute inset-0 bg-grid z-0 pointer-events-none" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-gradient-to-b from-indigo-600/20 via-purple-600/10 to-transparent rounded-full blur-3xl pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6 }}
        className="relative z-10 w-full max-w-sm"
      >
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl overflow-hidden shadow-2xl shadow-indigo-500/10">
          <div className="h-28 bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 relative">
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIxIiBmaWxsPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMSkiLz48L3N2Zz4=')] opacity-50" />
          </div>

          <div className="px-6 pb-8 -mt-12">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.3, type: "spring", stiffness: 200 }}
              className="w-24 h-24 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 border-4 border-[#0a0520] flex items-center justify-center shadow-lg shadow-indigo-500/30 mb-4"
            >
              <span className="text-3xl font-black text-white">DS</span>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
              <h1 className="text-2xl font-black text-white" data-testid="text-card-name">Dante S.</h1>
              <p className="text-indigo-400 font-semibold text-sm mt-1">Founder & CEO</p>
              <p className="text-slate-400 text-xs mt-0.5">Apex Marketing Automations</p>
            </motion.div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="text-slate-400 text-xs mt-4 leading-relaxed"
            >
              AI-powered marketing automations that grow your business on autopilot. Unified inbox, voice agents, workflow builder, and more.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="mt-6 space-y-3"
            >
              <a
                href="tel:+12394922698"
                className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors group"
                data-testid="link-phone"
              >
                <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <Phone size={18} className="text-green-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Phone</p>
                  <p className="text-sm font-semibold text-white group-hover:text-green-400 transition-colors">(239) 492-2698</p>
                </div>
              </a>

              <a
                href="sms:+12394922698"
                className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors group"
                data-testid="link-text"
              >
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <MessageSquare size={18} className="text-blue-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Text</p>
                  <p className="text-sm font-semibold text-white group-hover:text-blue-400 transition-colors">Send a message</p>
                </div>
              </a>

              <a
                href="mailto:Dante@apexmarketingautomations.com"
                className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors group"
                data-testid="link-email"
              >
                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <Mail size={18} className="text-purple-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Email</p>
                  <p className="text-sm font-semibold text-white group-hover:text-purple-400 transition-colors">Dante@apexmarketingautomations.com</p>
                </div>
              </a>

              <a
                href="https://apexmarketingautomations.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors group"
                data-testid="link-website"
              >
                <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                  <Globe size={18} className="text-cyan-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Website</p>
                  <p className="text-sm font-semibold text-white group-hover:text-cyan-400 transition-colors">apexmarketingautomations.com</p>
                </div>
              </a>
            </motion.div>

            <motion.a
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8 }}
              href="/contact.vcf"
              className="mt-6 w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-3 text-sm shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:scale-[1.02] active:scale-[0.98] block"
              data-testid="button-save-contact"
            >
              <Download size={18} />
              Save Contact
            </motion.a>
          </div>
        </div>

        <p className="text-center text-[10px] text-slate-600 mt-6">
          Powered by Apex Marketing Automations
        </p>
      </motion.div>
    </div>
  );
}
