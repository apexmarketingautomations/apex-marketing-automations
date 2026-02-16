import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  MessageSquare, GitFork, Bot, LayoutTemplate, Megaphone, Phone, Star,
  DollarSign, Link2, Rocket, TrendingUp, Palette, Sparkles, ArrowRight,
  Zap, Users, CircleDollarSign
} from "lucide-react";

const tools = [
  {
    icon: MessageSquare,
    title: "Unified Inbox",
    subtitle: "Multi-Channel Messaging Hub",
    description: "Manage SMS, Instagram, WhatsApp, and Messenger conversations in one place. AI-powered sentiment analysis scores every message.",
    color: "cyan",
    gradient: "from-cyan-500 to-cyan-600",
    border: "border-cyan-500/30",
    bg: "bg-cyan-500/10",
    text: "text-cyan-400",
  },
  {
    icon: GitFork,
    title: "Workflow Builder",
    subtitle: "Visual Automation Engine",
    description: "Drag-and-drop automation flows with triggers, delays, conditions, and custom code execution. Automate follow-ups, nurture sequences, and alerts.",
    color: "purple",
    gradient: "from-purple-500 to-purple-600",
    border: "border-purple-500/30",
    bg: "bg-purple-500/10",
    text: "text-purple-400",
  },
  {
    icon: Bot,
    title: "Neural Trainer",
    subtitle: "AI Chatbot Training Lab",
    description: "Scrape any website, build a RAG knowledge base, and deploy an AI chatbot trained on your business data. Supports calendar booking via tool-calling.",
    color: "green",
    gradient: "from-green-500 to-green-600",
    border: "border-green-500/30",
    bg: "bg-green-500/10",
    text: "text-green-400",
  },
  {
    icon: LayoutTemplate,
    title: "Site Architect",
    subtitle: "AI-Powered Site Builder",
    description: "Generate full landing pages from a single prompt. 22 section types including Hero, Pricing, Booking, QR Codes, and Paywalls. Edit visually, save, and publish.",
    color: "orange",
    gradient: "from-orange-500 to-orange-600",
    border: "border-orange-500/30",
    bg: "bg-orange-500/10",
    text: "text-orange-400",
  },
  {
    icon: Megaphone,
    title: "Growth Engine",
    subtitle: "AI Ad Campaign Generator",
    description: "Create Facebook ad campaigns with AI-generated copy and DALL-E 3 visuals. Upload your own images or let AI generate them. Full audience targeting.",
    color: "pink",
    gradient: "from-pink-500 to-pink-600",
    border: "border-pink-500/30",
    bg: "bg-pink-500/10",
    text: "text-pink-400",
  },
  {
    icon: Phone,
    title: "Voice Agent",
    subtitle: "AI Voice Agent Deployment",
    description: "Deploy AI voice agents via Vapi with custom personas. Browser demo calls, outbound dialing, Power Dialer for batch campaigns. Real-time call logs with recordings.",
    color: "blue",
    gradient: "from-blue-500 to-blue-600",
    border: "border-blue-500/30",
    bg: "bg-blue-500/10",
    text: "text-blue-400",
  },
  {
    icon: Star,
    title: "Reputation Manager",
    subtitle: "Smart Review Buffer System",
    description: "Happy customers (4-5 stars) get routed to Google Reviews. Unhappy customers (1-3 stars) submit private feedback with instant SMS alerts to you. AI generates responses.",
    color: "yellow",
    gradient: "from-yellow-500 to-yellow-600",
    border: "border-yellow-500/30",
    bg: "bg-yellow-500/10",
    text: "text-yellow-400",
  },
  {
    icon: DollarSign,
    title: "Usage & Billing",
    subtitle: "Revenue Tracking Dashboard",
    description: "Track every SMS, voice minute, and AI generation with your markup. 2x on SMS, 1.5x on voice, flat rates on AI. Stripe meter integration for automatic invoicing.",
    color: "emerald",
    gradient: "from-emerald-500 to-emerald-600",
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
  },
  {
    icon: Link2,
    title: "Domains",
    subtitle: "Domain Registration Engine",
    description: "Search, purchase, and configure domains with your markup. Auto-link to your built sites with DNS and SSL management.",
    color: "indigo",
    gradient: "from-indigo-500 to-indigo-600",
    border: "border-indigo-500/30",
    bg: "bg-indigo-500/10",
    text: "text-indigo-400",
  },
  {
    icon: Rocket,
    title: "God Mode",
    subtitle: "One-Click Empire Builder",
    description: "Launch an entire business in 60 seconds. Auto-provisions phone number, deploys voice agent, trains AI bot, generates website, and creates workflows — all at once.",
    color: "red",
    gradient: "from-red-500 to-red-600",
    border: "border-red-500/30",
    bg: "bg-red-500/10",
    text: "text-red-400",
  },
  {
    icon: TrendingUp,
    title: "Growth Center",
    subtitle: "Performance Analytics Hub",
    description: "Monitor business growth metrics, lead tracking, and conversion analytics across all channels.",
    color: "teal",
    gradient: "from-teal-500 to-teal-600",
    border: "border-teal-500/30",
    bg: "bg-teal-500/10",
    text: "text-teal-400",
  },
  {
    icon: Palette,
    title: "Vibe Switcher",
    subtitle: "Customizable UI Theming",
    description: "6 theme options: Cyber Glass, Neon Nights, Gilded Rose, Emerald Dark, Solar Gold, Blood Moon. Instant visual customization.",
    color: "fuchsia",
    gradient: "from-fuchsia-500 via-pink-500 to-orange-500",
    border: "border-fuchsia-500/30",
    bg: "bg-fuchsia-500/10",
    text: "text-fuchsia-400",
  },
];

const differentiators = [
  {
    icon: Users,
    title: "White-Label Ready",
    description: "Fully customizable for your brand. Each sub-account operates independently.",
  },
  {
    icon: Sparkles,
    title: "AI-Native",
    description: "OpenAI GPT-4 powers everything from chatbots to ad copy to site generation.",
  },
  {
    icon: CircleDollarSign,
    title: "Revenue Engine",
    description: "Built-in markup pricing on every service. You profit on every SMS, call, and domain.",
  },
];

const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.5 },
  }),
};

export default function Welcome() {
  return (
    <div className="min-h-screen text-white" style={{ backgroundColor: "#030014" }}>
      <div className="fixed inset-0 bg-grid z-0 pointer-events-none" />

      <section className="relative overflow-hidden py-24 md:py-36 px-6" data-testid="section-hero">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[800px] bg-gradient-to-b from-indigo-600/25 via-purple-600/15 to-transparent rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-gradient-to-tr from-cyan-600/10 to-transparent rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-gradient-to-tl from-purple-600/10 to-transparent rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-5xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-xs font-bold border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 mb-8" data-testid="badge-hero">
              <Zap size={14} /> AI-POWERED COMMAND CENTER
            </div>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="text-5xl md:text-7xl lg:text-8xl font-black tracking-tight leading-none mb-6"
            data-testid="text-hero-title"
          >
            <span className="block">APEX</span>
            <span className="block bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
              MARKETING ANIMATION
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-10"
            data-testid="text-hero-subtitle"
          >
            The AI-Powered Command Center for Modern Businesses
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.5 }}
          >
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-500/25 text-lg"
              data-testid="button-get-started"
            >
              Get Started <ArrowRight size={20} />
            </Link>
          </motion.div>
        </div>
      </section>

      <section className="relative z-10 py-20 px-6" data-testid="section-tools">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            className="text-center mb-16"
          >
            <motion.div variants={fadeUp} custom={0}>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-white/10 bg-white/5 text-slate-400 mb-4">
                12 POWERFUL MODULES
              </div>
            </motion.div>
            <motion.h2
              variants={fadeUp}
              custom={1}
              className="text-3xl md:text-5xl font-black tracking-tight"
              data-testid="text-tools-title"
            >
              Everything You Need to{" "}
              <span className="bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
                Dominate
              </span>
            </motion.h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {tools.map((tool, i) => (
              <motion.div
                key={tool.title}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-50px" }}
                variants={fadeUp}
                custom={i}
                data-testid={`card-tool-${tool.title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div className={`group h-full bg-white/[0.03] backdrop-blur-sm border ${tool.border} rounded-2xl p-6 hover:bg-white/[0.06] transition-all duration-300`}>
                  <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl ${tool.bg} mb-4`}>
                    <tool.icon size={24} className={tool.text} />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-1" data-testid={`text-tool-title-${i}`}>{tool.title}</h3>
                  <p className={`text-xs font-semibold ${tool.text} mb-3`}>{tool.subtitle}</p>
                  <p className="text-sm text-slate-400 leading-relaxed">{tool.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 py-20 px-6" data-testid="section-differentiators">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            className="text-center mb-16"
          >
            <motion.h2
              variants={fadeUp}
              custom={0}
              className="text-3xl md:text-5xl font-black tracking-tight"
              data-testid="text-differentiators-title"
            >
              Why{" "}
              <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                Apex
              </span>
            </motion.h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {differentiators.map((item, i) => (
              <motion.div
                key={item.title}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-50px" }}
                variants={fadeUp}
                custom={i}
                data-testid={`card-differentiator-${i}`}
              >
                <div className="text-center p-8 bg-white/[0.03] backdrop-blur-sm border border-white/10 rounded-2xl h-full">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 mb-5">
                    <item.icon size={28} className="text-indigo-400" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">{item.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{item.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <footer className="relative z-10 py-12 px-6 border-t border-white/5" data-testid="section-footer">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-slate-600 text-sm mb-4">Powered by Apex Marketing Animation</p>
          <Link
            href="/login"
            className="text-indigo-400 hover:text-indigo-300 text-sm font-medium transition-colors"
            data-testid="link-footer-login"
          >
            Sign In →
          </Link>
        </div>
      </footer>
    </div>
  );
}
