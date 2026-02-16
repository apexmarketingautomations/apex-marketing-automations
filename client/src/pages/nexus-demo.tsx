import { useRef } from "react";
import { motion, useScroll, useTransform, useSpring, useInView } from "framer-motion";
import { Link } from "wouter";
import {
  Inbox, GitBranch, Mic, Shield, BarChart3, Globe,
  Rocket, ArrowRight, Zap, Users, Bot, Phone,
  ChevronDown, Star, Sparkles, Play, Brain, Megaphone,
  TrendingUp, Building, DollarSign, Camera, FileText,
  Home, Share2, Crosshair, Search
} from "lucide-react";

import screenInbox from "@/assets/demo/screen-inbox.png";
import screenWorkflows from "@/assets/demo/screen-workflows.png";
import screenVoice from "@/assets/demo/screen-voice.png";
import screenSentinel from "@/assets/demo/screen-sentinel.png";
import screenCommand from "@/assets/demo/screen-command.png";
import screenWebsite from "@/assets/demo/screen-website.png";
import screenMobile from "@/assets/demo/screen-mobile.png";
import screenBotTrainer from "@/assets/demo/screen-bot-trainer.png";
import screenOnboarding from "@/assets/demo/screen-onboarding.png";
import screenSiteBuilder from "@/assets/demo/screen-site-builder.png";
import screenAdLauncher from "@/assets/demo/screen-ad-launcher.png";
import screenGrowth from "@/assets/demo/screen-growth.png";
import screenReputation from "@/assets/demo/screen-reputation.png";
import screenDomains from "@/assets/demo/screen-domains.png";
import screenGodMode from "@/assets/demo/screen-god-mode.png";
import screenMarketplace from "@/assets/demo/screen-marketplace.png";
import screenAffiliate from "@/assets/demo/screen-affiliate.png";
import screenSnapshots from "@/assets/demo/screen-snapshots.png";
import screenPropertyRadar from "@/assets/demo/screen-property-radar.png";
import screenFormBuilder from "@/assets/demo/screen-form-builder.png";
import screenPricing from "@/assets/demo/screen-pricing.png";
import screenBilling from "@/assets/demo/screen-billing.png";
import demoVideo from "@/assets/demo/nexus-demo-video.mp4";

function LaptopFrame({ image, className = "" }: { image: string; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <div className="relative rounded-xl overflow-hidden shadow-2xl shadow-black/50 border border-white/10 bg-[#1a1a2e]">
        <div className="flex items-center gap-1.5 px-4 py-2.5 bg-[#0d0d1a] border-b border-white/5">
          <div className="w-3 h-3 rounded-full bg-red-500/80" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
          <div className="w-3 h-3 rounded-full bg-green-500/80" />
          <div className="flex-1 mx-8">
            <div className="h-5 bg-white/5 rounded-full max-w-xs mx-auto" />
          </div>
        </div>
        <img src={image} alt="Platform screenshot" className="w-full block" loading="lazy" />
      </div>
      <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-[60%] h-3 bg-gradient-to-b from-[#2a2a3e] to-[#1a1a2e] rounded-b-lg border-x border-b border-white/5" />
    </div>
  );
}

function PhoneFrame({ image, className = "" }: { image: string; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <div className="relative rounded-[2rem] overflow-hidden shadow-2xl shadow-black/60 border-2 border-white/10 bg-[#0d0d1a] p-1.5">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-6 bg-[#0d0d1a] rounded-b-2xl z-10" />
        <div className="rounded-[1.5rem] overflow-hidden">
          <img src={image} alt="Mobile app" className="w-full block" loading="lazy" />
        </div>
      </div>
    </div>
  );
}

function FloatingCard({ icon: Icon, label, value, color, delay = 0 }: {
  icon: React.ElementType; label: string; value: string; color: string; delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.9 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.6, delay }}
      viewport={{ once: true }}
      className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-4 shadow-xl"
    >
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-xl bg-gradient-to-br ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-xs text-white/50 uppercase tracking-wider">{label}</p>
          <p className="text-xl font-bold text-white">{value}</p>
        </div>
      </div>
    </motion.div>
  );
}

interface BrollSectionProps {
  title: string;
  subtitle: string;
  description: string;
  image: string;
  icon: React.ElementType;
  color: string;
  gradient: string;
  stats: { icon: React.ElementType; label: string; value: string; color: string }[];
  reverse?: boolean;
  index: number;
}

function BrollSection({ title, subtitle, description, image, icon: Icon, color, gradient, stats, reverse, index }: BrollSectionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [80, -80]);
  const rotateY = useTransform(scrollYProgress, [0, 0.5, 1], reverse ? [8, 0, -5] : [-8, 0, 5]);
  const rotateX = useTransform(scrollYProgress, [0, 0.5, 1], [5, 0, -3]);
  const scale = useTransform(scrollYProgress, [0, 0.4, 0.6, 1], [0.85, 1, 1, 0.9]);
  const springY = useSpring(y, { stiffness: 50, damping: 20 });

  return (
    <section ref={ref} className="relative py-32 overflow-hidden" data-testid={`demo-section-${index}`}>
      <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-20`} />
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(3)].map((_, i) => (
          <motion.div
            key={i}
            className={`absolute w-96 h-96 rounded-full bg-gradient-to-br ${color} opacity-5 blur-3xl`}
            style={{ left: `${20 + i * 30}%`, top: `${10 + i * 20}%` }}
            animate={{ y: [0, -30, 0], x: [0, 20, 0] }}
            transition={{ duration: 8 + i * 2, repeat: Infinity, ease: "easeInOut" }}
          />
        ))}
      </div>

      <div className={`max-w-7xl mx-auto px-6 flex flex-col ${reverse ? 'lg:flex-row-reverse' : 'lg:flex-row'} items-center gap-16 relative z-10`}>
        <motion.div
          className="flex-1 space-y-6"
          initial={{ opacity: 0, x: reverse ? 60 : -60 }}
          animate={isInView ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 0.8 }}
        >
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl bg-gradient-to-br ${color}`}>
              <Icon className="w-6 h-6 text-white" />
            </div>
            <span className="text-sm font-semibold tracking-wider uppercase text-white/40">{subtitle}</span>
          </div>
          <h2 className="text-4xl lg:text-5xl font-bold text-white leading-tight">{title}</h2>
          <p className="text-lg text-white/60 leading-relaxed max-w-lg">{description}</p>
          <div className="grid grid-cols-2 gap-4 pt-4">
            {stats.map((stat, i) => (
              <FloatingCard key={i} {...stat} delay={i * 0.15} />
            ))}
          </div>
        </motion.div>

        <motion.div className="flex-1 relative" style={{ perspective: 1200 }}>
          <motion.div style={{ rotateY, rotateX, scale, y: springY }}>
            <LaptopFrame image={image} />
          </motion.div>
          <div className="absolute -inset-8 bg-gradient-radial from-transparent to-[#0a0a1a]/80 pointer-events-none rounded-3xl" />
        </motion.div>
      </div>
    </section>
  );
}

const SECTIONS: Omit<BrollSectionProps, 'index'>[] = [
  {
    title: "Unified Command Inbox",
    subtitle: "Multi-Channel Messaging",
    description: "Every SMS, Instagram DM, email, and WhatsApp message in one real-time feed. AI auto-replies handle the conversation while you focus on closing deals.",
    image: screenInbox,
    icon: Inbox,
    color: "from-blue-500 to-cyan-500",
    gradient: "from-blue-950/50 to-transparent",
    stats: [
      { icon: Zap, label: "Response Time", value: "<2s", color: "from-blue-500 to-cyan-500" },
      { icon: Bot, label: "AI Handled", value: "87%", color: "from-purple-500 to-pink-500" },
      { icon: Users, label: "Conversations", value: "2.4K", color: "from-emerald-500 to-teal-500" },
      { icon: Star, label: "Satisfaction", value: "4.9★", color: "from-amber-500 to-orange-500" },
    ],
  },
  {
    title: "Visual Workflow Engine",
    subtitle: "Drag & Drop Automation",
    description: "Build complex automation flows with triggers, delays, conditions, and actions. Or let AI generate entire workflows from a single prompt.",
    image: screenWorkflows,
    icon: GitBranch,
    color: "from-purple-500 to-violet-500",
    gradient: "from-purple-950/50 to-transparent",
    reverse: true,
    stats: [
      { icon: GitBranch, label: "Active Flows", value: "156", color: "from-purple-500 to-violet-500" },
      { icon: Zap, label: "Triggers/Day", value: "8.2K", color: "from-yellow-500 to-orange-500" },
      { icon: Bot, label: "AI Generated", value: "64%", color: "from-blue-500 to-cyan-500" },
      { icon: Star, label: "Success Rate", value: "99.2%", color: "from-emerald-500 to-teal-500" },
    ],
  },
  {
    title: "Neural Trainer",
    subtitle: "AI Bot Training",
    description: "Train AI chatbots on any website. Scrape content, build a RAG knowledge base, and deploy a custom persona that answers questions 24/7.",
    image: screenBotTrainer,
    icon: Brain,
    color: "from-pink-500 to-rose-500",
    gradient: "from-pink-950/50 to-transparent",
    stats: [
      { icon: Brain, label: "Bots Trained", value: "312", color: "from-pink-500 to-rose-500" },
      { icon: Zap, label: "Pages Scraped", value: "48K", color: "from-yellow-500 to-orange-500" },
      { icon: Bot, label: "Accuracy", value: "96%", color: "from-blue-500 to-cyan-500" },
      { icon: Star, label: "Avg Rating", value: "4.8★", color: "from-emerald-500 to-teal-500" },
    ],
  },
  {
    title: "AI Voice Agents",
    subtitle: "24/7 Phone Intelligence",
    description: "Deploy AI-powered phone agents that handle inbound calls, make outbound dials, overcome objections, and book appointments — all with natural conversation.",
    image: screenVoice,
    icon: Mic,
    color: "from-emerald-500 to-teal-500",
    gradient: "from-emerald-950/50 to-transparent",
    reverse: true,
    stats: [
      { icon: Phone, label: "Calls Handled", value: "12K", color: "from-emerald-500 to-teal-500" },
      { icon: Users, label: "Booked Appts", value: "847", color: "from-blue-500 to-cyan-500" },
      { icon: Mic, label: "Avg Duration", value: "3m 24s", color: "from-purple-500 to-pink-500" },
      { icon: Star, label: "Conv. Rate", value: "34%", color: "from-amber-500 to-orange-500" },
    ],
  },
  {
    title: "Growth Engine",
    subtitle: "AI Ad Campaigns",
    description: "Describe your ideal campaign and AI generates targeting, copy, creative concepts, and budget allocation. Launch ads across platforms in seconds.",
    image: screenAdLauncher,
    icon: Megaphone,
    color: "from-orange-500 to-red-500",
    gradient: "from-orange-950/50 to-transparent",
    stats: [
      { icon: Megaphone, label: "Campaigns", value: "1.8K", color: "from-orange-500 to-red-500" },
      { icon: DollarSign, label: "Ad Spend", value: "$340K", color: "from-emerald-500 to-teal-500" },
      { icon: TrendingUp, label: "Avg ROAS", value: "4.2x", color: "from-blue-500 to-cyan-500" },
      { icon: Users, label: "Leads", value: "23K", color: "from-purple-500 to-pink-500" },
    ],
  },
  {
    title: "Site Architect",
    subtitle: "AI Website Builder",
    description: "Generate full client websites with AI. Choose templates, customize content, and publish — all without touching code.",
    image: screenSiteBuilder,
    icon: Globe,
    color: "from-violet-500 to-purple-500",
    gradient: "from-violet-950/50 to-transparent",
    reverse: true,
    stats: [
      { icon: Globe, label: "Sites Built", value: "567", color: "from-violet-500 to-purple-500" },
      { icon: Zap, label: "Build Time", value: "<30s", color: "from-yellow-500 to-orange-500" },
      { icon: Star, label: "Uptime", value: "99.9%", color: "from-emerald-500 to-teal-500" },
      { icon: Users, label: "Visitors/Mo", value: "1.2M", color: "from-blue-500 to-cyan-500" },
    ],
  },
  {
    title: "Apex Sentinel",
    subtitle: "Real-Time Incident Scanner",
    description: "Monitor accident feeds in real-time, detect incidents by severity, and deploy geofenced ad campaigns within minutes. Built for personal injury law firms.",
    image: screenSentinel,
    icon: Shield,
    color: "from-red-500 to-rose-500",
    gradient: "from-red-950/50 to-transparent",
    stats: [
      { icon: Shield, label: "Incidents/Day", value: "47", color: "from-red-500 to-rose-500" },
      { icon: Zap, label: "Avg Deploy", value: "<5min", color: "from-yellow-500 to-orange-500" },
      { icon: Users, label: "Leads Captured", value: "1.2K", color: "from-blue-500 to-cyan-500" },
      { icon: Star, label: "ROI", value: "340%", color: "from-emerald-500 to-teal-500" },
    ],
  },
  {
    title: "Property Radar",
    subtitle: "Wholesale Deal Finder",
    description: "Scan neighborhoods for distressed properties, pre-foreclosures, and off-market deals. Auto-generate skip-traced contact lists and outreach campaigns.",
    image: screenPropertyRadar,
    icon: Search,
    color: "from-lime-500 to-green-500",
    gradient: "from-lime-950/50 to-transparent",
    reverse: true,
    stats: [
      { icon: Home, label: "Properties", value: "8.4K", color: "from-lime-500 to-green-500" },
      { icon: Search, label: "Leads Found", value: "2.1K", color: "from-blue-500 to-cyan-500" },
      { icon: DollarSign, label: "Deal Value", value: "$4.7M", color: "from-amber-500 to-orange-500" },
      { icon: Zap, label: "Response", value: "92%", color: "from-purple-500 to-pink-500" },
    ],
  },
  {
    title: "Website Integration",
    subtitle: "Connect & Train",
    description: "Connect client websites, train AI chatbots on their content, and deploy embeddable chat widgets. Every site gets its own AI brain.",
    image: screenWebsite,
    icon: Globe,
    color: "from-cyan-500 to-blue-500",
    gradient: "from-cyan-950/50 to-transparent",
    stats: [
      { icon: Globe, label: "Sites Connected", value: "234", color: "from-cyan-500 to-blue-500" },
      { icon: Bot, label: "Chats/Day", value: "5.6K", color: "from-purple-500 to-pink-500" },
      { icon: Zap, label: "Avg Response", value: "0.8s", color: "from-emerald-500 to-teal-500" },
      { icon: Star, label: "Resolution", value: "92%", color: "from-amber-500 to-orange-500" },
    ],
  },
  {
    title: "AI Form Builder",
    subtitle: "Smart Data Collection",
    description: "Generate industry-specific forms with AI. Intake forms, surveys, and lead capture — all customized for your client's vertical.",
    image: screenFormBuilder,
    icon: FileText,
    color: "from-indigo-500 to-blue-500",
    gradient: "from-indigo-950/50 to-transparent",
    reverse: true,
    stats: [
      { icon: FileText, label: "Forms Built", value: "1.4K", color: "from-indigo-500 to-blue-500" },
      { icon: Users, label: "Submissions", value: "89K", color: "from-emerald-500 to-teal-500" },
      { icon: Zap, label: "Completion", value: "78%", color: "from-yellow-500 to-orange-500" },
      { icon: Star, label: "Conversion", value: "34%", color: "from-purple-500 to-pink-500" },
    ],
  },
  {
    title: "Reputation Manager",
    subtitle: "Review Intelligence",
    description: "Monitor reviews across platforms, generate AI responses, and send review request campaigns. Turn happy clients into 5-star advocates.",
    image: screenReputation,
    icon: Star,
    color: "from-yellow-500 to-amber-500",
    gradient: "from-yellow-950/50 to-transparent",
    stats: [
      { icon: Star, label: "Avg Rating", value: "4.9★", color: "from-yellow-500 to-amber-500" },
      { icon: Users, label: "Reviews", value: "3.2K", color: "from-blue-500 to-cyan-500" },
      { icon: Zap, label: "Response Time", value: "<1hr", color: "from-emerald-500 to-teal-500" },
      { icon: TrendingUp, label: "Growth", value: "+127%", color: "from-purple-500 to-pink-500" },
    ],
  },
  {
    title: "Agency Command Center",
    subtitle: "The War Room",
    description: "Full fleet health monitoring, production pipeline visualization, revenue tracking, and real-time KPIs across every sub-account in your agency.",
    image: screenCommand,
    icon: BarChart3,
    color: "from-amber-500 to-orange-500",
    gradient: "from-amber-950/50 to-transparent",
    reverse: true,
    stats: [
      { icon: BarChart3, label: "Monthly Rev", value: "$142K", color: "from-amber-500 to-orange-500" },
      { icon: Users, label: "Active Accts", value: "89", color: "from-blue-500 to-cyan-500" },
      { icon: Zap, label: "Pipeline Value", value: "$2.1M", color: "from-emerald-500 to-teal-500" },
      { icon: Star, label: "Churn Rate", value: "1.8%", color: "from-purple-500 to-pink-500" },
    ],
  },
  {
    title: "Growth Center",
    subtitle: "Analytics & Insights",
    description: "Track performance metrics, analyze trends, and identify growth opportunities across all your client accounts from a single view.",
    image: screenGrowth,
    icon: TrendingUp,
    color: "from-teal-500 to-cyan-500",
    gradient: "from-teal-950/50 to-transparent",
    stats: [
      { icon: TrendingUp, label: "Growth Rate", value: "+43%", color: "from-teal-500 to-cyan-500" },
      { icon: Users, label: "Active Users", value: "12K", color: "from-blue-500 to-cyan-500" },
      { icon: DollarSign, label: "Revenue", value: "$89K", color: "from-emerald-500 to-teal-500" },
      { icon: Zap, label: "Engagement", value: "94%", color: "from-purple-500 to-pink-500" },
    ],
  },
  {
    title: "Snapshot Marketplace",
    subtitle: "Template Economy",
    description: "Browse, publish, and fork proven account configurations. Share your best setups with the community or clone winning blueprints in one click.",
    image: screenMarketplace,
    icon: Share2,
    color: "from-fuchsia-500 to-pink-500",
    gradient: "from-fuchsia-950/50 to-transparent",
    reverse: true,
    stats: [
      { icon: Share2, label: "Templates", value: "450+", color: "from-fuchsia-500 to-pink-500" },
      { icon: Users, label: "Downloads", value: "12K", color: "from-blue-500 to-cyan-500" },
      { icon: Star, label: "Top Rated", value: "4.9★", color: "from-amber-500 to-orange-500" },
      { icon: DollarSign, label: "Revenue", value: "$34K", color: "from-emerald-500 to-teal-500" },
    ],
  },
  {
    title: "Snapshot Manager",
    subtitle: "Version Control",
    description: "Create checkpoints, rollback configurations, and manage version history across all your sub-accounts. Never lose a working setup again.",
    image: screenSnapshots,
    icon: Camera,
    color: "from-sky-500 to-blue-500",
    gradient: "from-sky-950/50 to-transparent",
    stats: [
      { icon: Camera, label: "Snapshots", value: "2.8K", color: "from-sky-500 to-blue-500" },
      { icon: Zap, label: "Restores", value: "340", color: "from-yellow-500 to-orange-500" },
      { icon: Star, label: "Uptime", value: "99.9%", color: "from-emerald-500 to-teal-500" },
      { icon: Users, label: "Protected", value: "89", color: "from-purple-500 to-pink-500" },
    ],
  },
  {
    title: "Affiliate Dashboard",
    subtitle: "Referral Revenue",
    description: "Earn 30-50% commissions on every referral. Track your links, monitor conversions, and watch your passive income grow.",
    image: screenAffiliate,
    icon: DollarSign,
    color: "from-green-500 to-emerald-500",
    gradient: "from-green-950/50 to-transparent",
    reverse: true,
    stats: [
      { icon: DollarSign, label: "Earned", value: "$24K", color: "from-green-500 to-emerald-500" },
      { icon: Users, label: "Referrals", value: "156", color: "from-blue-500 to-cyan-500" },
      { icon: TrendingUp, label: "Conv. Rate", value: "12%", color: "from-amber-500 to-orange-500" },
      { icon: Star, label: "Tier", value: "Gold", color: "from-purple-500 to-pink-500" },
    ],
  },
  {
    title: "God Mode",
    subtitle: "One-Click Empire",
    description: "Build an entire client operation in one click — account, phone number, voice agent, trained bot, website, and missed-call workflow. All automated.",
    image: screenGodMode,
    icon: Rocket,
    color: "from-violet-600 to-fuchsia-600",
    gradient: "from-violet-950/50 to-transparent",
    stats: [
      { icon: Rocket, label: "Empires Built", value: "234", color: "from-violet-600 to-fuchsia-600" },
      { icon: Zap, label: "Setup Time", value: "<60s", color: "from-yellow-500 to-orange-500" },
      { icon: Bot, label: "Auto-Config", value: "100%", color: "from-blue-500 to-cyan-500" },
      { icon: Star, label: "Success", value: "99%", color: "from-emerald-500 to-teal-500" },
    ],
  },
  {
    title: "Domain Manager",
    subtitle: "Custom Domains",
    description: "Search, purchase, and configure custom domains for your client websites. Full DNS management and SSL provisioning built right in.",
    image: screenDomains,
    icon: Globe,
    color: "from-slate-400 to-zinc-500",
    gradient: "from-slate-950/50 to-transparent",
    reverse: true,
    stats: [
      { icon: Globe, label: "Domains", value: "189", color: "from-slate-400 to-zinc-500" },
      { icon: Zap, label: "SSL Active", value: "100%", color: "from-emerald-500 to-teal-500" },
      { icon: Star, label: "Uptime", value: "99.99%", color: "from-blue-500 to-cyan-500" },
      { icon: DollarSign, label: "Avg Cost", value: "$12/yr", color: "from-amber-500 to-orange-500" },
    ],
  },
  {
    title: "Account Onboarding",
    subtitle: "Instant Provisioning",
    description: "Create new client accounts in seconds with industry-specific blueprints. Pre-built pipeline stages, custom fields, and message templates — ready to go.",
    image: screenOnboarding,
    icon: Building,
    color: "from-rose-500 to-pink-500",
    gradient: "from-rose-950/50 to-transparent",
    stats: [
      { icon: Building, label: "Accounts", value: "450+", color: "from-rose-500 to-pink-500" },
      { icon: Zap, label: "Setup Time", value: "<10s", color: "from-yellow-500 to-orange-500" },
      { icon: Users, label: "Industries", value: "20+", color: "from-blue-500 to-cyan-500" },
      { icon: Star, label: "Satisfaction", value: "98%", color: "from-emerald-500 to-teal-500" },
    ],
  },
];

export default function NexusDemo() {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress: heroScroll } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroY = useTransform(heroScroll, [0, 1], [0, 200]);
  const heroOpacity = useTransform(heroScroll, [0, 0.6], [1, 0]);
  const heroScale = useTransform(heroScroll, [0, 0.6], [1, 0.85]);
  const laptopRotateX = useTransform(heroScroll, [0, 0.5], [12, 0]);
  const laptopRotateY = useTransform(heroScroll, [0, 0.5], [-5, 0]);
  const phoneRotateY = useTransform(heroScroll, [0, 0.5], [15, 0]);
  const phoneY = useTransform(heroScroll, [0, 0.5], [40, 0]);

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-white overflow-x-hidden" data-testid="demo-page">
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-[#0a0a1a]/70 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg font-bold bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">Nexus</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/pricing" className="text-sm text-white/50 hover:text-white transition-colors" data-testid="link-pricing">Pricing</Link>
            <Link href="/login" data-testid="link-login">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="px-5 py-2 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-sm font-semibold text-white shadow-lg shadow-violet-500/25"
              >
                Get Started
              </motion.button>
            </Link>
          </div>
        </div>
      </nav>

      <section ref={heroRef} className="relative min-h-screen flex items-center justify-center pt-16 overflow-hidden" data-testid="demo-hero">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(120,80,255,0.15),transparent_70%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,80,180,0.1),transparent_60%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(80,200,255,0.08),transparent_60%)]" />
          {[...Array(40)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute w-1 h-1 rounded-full bg-white/20"
              style={{ left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%` }}
              animate={{ opacity: [0.1, 0.6, 0.1], scale: [1, 1.5, 1] }}
              transition={{ duration: 2 + Math.random() * 3, repeat: Infinity, delay: Math.random() * 2 }}
            />
          ))}
        </div>

        <motion.div className="relative z-10 max-w-7xl mx-auto px-6 text-center" style={{ y: heroY, opacity: heroOpacity, scale: heroScale }}>
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="mb-6"
          >
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm text-white/60">
              <Rocket className="w-4 h-4 text-violet-400" />
              The AI-Powered Agency OS
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="text-5xl md:text-7xl lg:text-8xl font-bold mb-6 leading-[0.95]"
          >
            <span className="bg-gradient-to-r from-white via-white to-white/40 bg-clip-text text-transparent">Run Your</span>
            <br />
            <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-cyan-400 bg-clip-text text-transparent">Entire Empire</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="text-xl md:text-2xl text-white/40 max-w-2xl mx-auto mb-12"
          >
            One platform. Every channel. AI everywhere.
            <br className="hidden md:block" />
            From inbox to invoice, Nexus handles it all.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="flex items-center justify-center gap-4 mb-20"
          >
            <Link href="/login" data-testid="button-hero-start">
              <motion.button
                whileHover={{ scale: 1.05, boxShadow: "0 0 40px rgba(120,80,255,0.4)" }}
                whileTap={{ scale: 0.95 }}
                className="px-8 py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-lg font-bold shadow-2xl shadow-violet-500/30 flex items-center gap-2"
              >
                Start Free Trial <ArrowRight className="w-5 h-5" />
              </motion.button>
            </Link>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="px-8 py-4 rounded-2xl bg-white/5 border border-white/10 text-lg font-semibold text-white/80 flex items-center gap-2 backdrop-blur-sm"
              data-testid="button-hero-demo"
            >
              <Play className="w-5 h-5" /> Watch Demo
            </motion.button>
          </motion.div>

          <div className="relative max-w-5xl mx-auto" style={{ perspective: 1500 }}>
            <motion.div
              initial={{ opacity: 0, y: 80 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 0.5 }}
              style={{ rotateX: laptopRotateX, rotateY: laptopRotateY }}
              className="relative z-10"
            >
              <div className="relative rounded-xl overflow-hidden shadow-2xl shadow-black/50 border border-white/10 bg-[#1a1a2e]">
                <div className="flex items-center gap-1.5 px-4 py-2.5 bg-[#0d0d1a] border-b border-white/5">
                  <div className="w-3 h-3 rounded-full bg-red-500/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                  <div className="w-3 h-3 rounded-full bg-green-500/80" />
                  <div className="flex-1 mx-8">
                    <div className="h-5 bg-white/5 rounded-full max-w-xs mx-auto" />
                  </div>
                </div>
                <video
                  src={demoVideo}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="w-full block"
                  data-testid="demo-hero-video"
                />
              </div>
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-[60%] h-3 bg-gradient-to-b from-[#2a2a3e] to-[#1a1a2e] rounded-b-lg border-x border-b border-white/5" />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 80, y: 60 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              transition={{ duration: 1, delay: 0.8 }}
              style={{ rotateY: phoneRotateY, y: phoneY }}
              className="absolute -right-8 md:right-4 bottom-0 w-32 md:w-44 z-20"
            >
              <PhoneFrame image={screenMobile} />
            </motion.div>

            <div className="absolute -inset-20 bg-gradient-radial from-transparent via-transparent to-[#0a0a1a] pointer-events-none z-30" />
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.5 }}
            className="mt-16"
          >
            <motion.div
              animate={{ y: [0, 8, 0] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <ChevronDown className="w-8 h-8 text-white/20 mx-auto" />
            </motion.div>
          </motion.div>
        </motion.div>
      </section>

      <div className="relative">
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-white/5 to-transparent" />
        {SECTIONS.map((section, i) => (
          <BrollSection key={i} {...section} index={i} />
        ))}
      </div>

      <section className="relative py-40 overflow-hidden" data-testid="demo-cta">
        <div className="absolute inset-0 bg-gradient-to-t from-violet-950/30 via-transparent to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(120,80,255,0.2),transparent_70%)]" />

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="relative z-10 max-w-3xl mx-auto px-6 text-center"
        >
          <h2 className="text-4xl md:text-6xl font-bold mb-6">
            <span className="bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">Ready to Launch?</span>
          </h2>
          <p className="text-xl text-white/40 mb-10 max-w-xl mx-auto">
            Join 500+ agencies already using Nexus to automate their operations and scale without limits.
          </p>
          <Link href="/pricing" data-testid="button-cta-pricing">
            <motion.button
              whileHover={{ scale: 1.05, boxShadow: "0 0 60px rgba(120,80,255,0.5)" }}
              whileTap={{ scale: 0.95 }}
              className="px-10 py-5 rounded-2xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-600 text-xl font-bold shadow-2xl shadow-violet-500/40 flex items-center gap-3 mx-auto"
            >
              Start Your 60-Day Free Trial <ArrowRight className="w-6 h-6" />
            </motion.button>
          </Link>
        </motion.div>
      </section>

      <footer className="border-t border-white/5 py-12">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
              <Sparkles className="w-3 h-3 text-white" />
            </div>
            <span className="text-sm text-white/40">Nexus Agency OS</span>
          </div>
          <p className="text-sm text-white/20">Built for agencies that refuse to settle.</p>
        </div>
      </footer>
    </div>
  );
}
