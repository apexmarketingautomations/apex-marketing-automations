import { Link, useLocation } from "wouter";
import { MessageSquare, GitFork, Bot, Briefcase, LayoutTemplate, Globe, Megaphone, Phone, TrendingUp, Settings, ArrowLeft, Search, Rocket, Star, DollarSign, Link2 } from "lucide-react";
import { motion } from "framer-motion";
import { CommandMenu } from "@/components/command-menu";
import { VibeSwitcher } from "@/components/vibe-switcher";

const navItems = [
  { href: "/", icon: MessageSquare, label: "Unified Inbox" },
  { href: "/workflows", icon: GitFork, label: "Workflows" },
  { href: "/bot-trainer", icon: Bot, label: "Neural Trainer" },
  { href: "/onboarding", icon: Briefcase, label: "New Account" },
  { href: "/site-builder", icon: LayoutTemplate, label: "Site Architect" },
  { href: "/liquid", icon: Globe, label: "Liquid Website" },
  { href: "/ad-launcher", icon: Megaphone, label: "Growth Engine" },
  { href: "/voice-agent", icon: Phone, label: "Voice Agent" },
  { href: "/growth", icon: TrendingUp, label: "Growth Center" },
  { href: "/reputation", icon: Star, label: "Reputation" },
  { href: "/billing", icon: DollarSign, label: "Usage & Billing" },
  { href: "/domains", icon: Link2, label: "Domains" },
  { href: "/god-mode", icon: Rocket, label: "God Mode" },
];

function NavLink({ href, icon: Icon, label, isActive }: { href: string; icon: any; label: string; isActive: boolean }) {
  return (
    <Link href={href} className="relative group block" data-testid={`nav-link-${href.replace("/", "") || "home"}`}>
      {isActive && (
        <motion.div
          layoutId="activeTab"
          className="absolute inset-0 bg-indigo-500/10 border-l-2 border-indigo-500 rounded-r-lg"
          transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
        />
      )}
      <div className={`flex items-center gap-3 p-3 px-4 transition-all ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-white'}`}>
        <Icon size={20} className={isActive ? 'text-indigo-400 drop-shadow-[0_0_8px_rgba(129,140,248,0.5)]' : ''} />
        <span className="font-medium text-sm tracking-wide hidden md:block">{label}</span>
      </div>
    </Link>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="flex min-h-screen text-white font-sans selection:bg-indigo-500/30" style={{ backgroundColor: 'var(--vibe-bg, #030014)' }}>
      <div className="fixed inset-0 bg-grid z-0 pointer-events-none" />
      <div className="fixed top-0 left-0 w-full h-[500px] bg-gradient-to-b from-indigo-900/10 to-transparent pointer-events-none z-0" />

      <aside className="w-16 md:w-72 glass-panel flex flex-col z-20 fixed top-0 left-0 h-screen overflow-y-auto">
        <div className="p-4 md:p-6 pb-6 md:pb-8">
          <div className="flex items-center gap-2 mb-1">
            <img src="/apex-logo.png" alt="Apex Marketing Animation" className="w-8 h-8 object-contain" />
            <h1 className="text-lg font-bold tracking-tight text-white hidden md:block leading-tight">
              APEX <span className="font-light text-indigo-400 text-xs block -mt-0.5">MARKETING ANIMATION</span>
            </h1>
          </div>
        </div>

        <div className="px-2 md:px-4 mb-2">
          <button
            onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-slate-400 hover:text-white text-sm"
            data-testid="button-command-menu"
          >
            <Search size={14} />
            <span className="hidden md:inline flex-1 text-left">Search...</span>
            <span className="hidden md:flex items-center gap-0.5 text-[10px] text-slate-600 border border-white/10 px-1.5 py-0.5 rounded">
              <span>⌘</span>K
            </span>
          </button>
        </div>

        <div className="flex-1 space-y-1 pr-0 md:pr-4 overflow-y-auto">
          <div className="px-4 md:px-6 text-xs font-bold text-slate-600 mb-2 mt-4 tracking-wider hidden md:block">MODULES</div>
          {navItems.map((item) => (
            <NavLink key={item.href} {...item} isActive={location === item.href} />
          ))}
        </div>

        <div className="px-2 md:px-4 mb-2">
          <VibeSwitcher />
        </div>

        <div className="p-4 border-t border-white/5 bg-black/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-slate-700 to-slate-600 border border-white/10 shrink-0" />
            <div className="hidden md:block">
              <div className="text-sm font-bold text-white">Admin User</div>
              <div className="text-xs text-green-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                System Online
              </div>
            </div>
            <Settings size={16} className="ml-auto text-slate-500 hover:text-white cursor-pointer hidden md:block" />
          </div>
        </div>
      </aside>

      <main className="flex-1 ml-16 md:ml-72 relative z-10 flex flex-col min-h-screen">
        {location !== "/" && (
          <div className="px-6 pt-4 pb-0">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors group"
              data-testid="button-back"
            >
              <ArrowLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" />
              Back to Home
            </Link>
          </div>
        )}
        {children}
      </main>

      <CommandMenu />
    </div>
  );
}
