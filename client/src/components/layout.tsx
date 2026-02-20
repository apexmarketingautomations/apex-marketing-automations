import { useState } from "react";
import { Link, useLocation } from "wouter";
import { MessageSquare, GitFork, Bot, Briefcase, LayoutTemplate, Globe, Megaphone, Phone, TrendingUp, Settings, ArrowLeft, Search, Rocket, Star, DollarSign, Link2, LogOut, Store, Users, Shield, CreditCard, ChevronDown, Plus, Building2, History, Satellite, Building, BarChart3, Kanban, CalendarDays, Mail, Palette, Webhook, FileBarChart, Instagram, Target, Lock, Plug, Activity, Menu, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { CommandMenu } from "@/components/command-menu";
import { SiteAssistant } from "@/components/site-assistant";
import { VibeSwitcher } from "@/components/vibe-switcher";
import { useAuth } from "@/hooks/use-auth";
import { useAccount } from "@/hooks/use-account";
import { BlitzBanner } from "@/components/blitz-banner";
import { NotificationBell } from "@/components/notification-bell";
import { LegacyStatusBadge } from "@/components/legacy-status";
import type { SubAccount } from "@shared/schema";
import { hasFeature } from "@shared/schema";

const navSections = [
  {
    label: "MODULES",
    items: [
      { href: "/", icon: TrendingUp, label: "Dashboard" },
      { href: "/inbox", icon: MessageSquare, label: "Unified Inbox" },
      { href: "/workflows", icon: GitFork, label: "Workflows", requiredFeature: "workflows" },
      { href: "/bot-trainer", icon: Bot, label: "Neural Trainer", requiredFeature: "ai_bots" },
      { href: "/onboarding", icon: Briefcase, label: "New Account" },
      { href: "/site-builder", icon: LayoutTemplate, label: "Site Architect" },
      { href: "/liquid", icon: Globe, label: "Liquid Website" },
      { href: "/ad-launcher", icon: Megaphone, label: "Growth Engine" },
      { href: "/voice-agent", icon: Phone, label: "Voice Agent", requiredFeature: "voice_agents" },
      { href: "/growth", icon: TrendingUp, label: "Growth Center" },
      { href: "/reputation", icon: Star, label: "Reputation" },
      { href: "/sentinel", icon: Satellite, label: "Sentinel", requiredFeature: "sentinel" },
      { href: "/property-radar", icon: Building, label: "Property Radar" },
      { href: "/website-integration", icon: Globe, label: "Website Integration" },
      { href: "/form-builder", icon: LayoutTemplate, label: "Form Builder" },
      { href: "/analytics", icon: BarChart3, label: "Analytics" },
      { href: "/pipeline", icon: Kanban, label: "Pipeline & CRM" },
      { href: "/calendar", icon: CalendarDays, label: "Calendar" },
      { href: "/email-campaigns", icon: Mail, label: "Email Campaigns", requiredFeature: "email_campaigns" },
    ],
  },
  {
    label: "META",
    items: [
      { href: "/meta-ads", icon: Target, label: "Ad Campaigns" },
      { href: "/meta-leads", icon: Users, label: "Lead Forms" },
      { href: "/instagram-inbox", icon: Instagram, label: "Instagram Inbox" },
    ],
  },
  {
    label: "PLATFORM",
    items: [
      { href: "/account-settings", icon: Settings, label: "Account Settings" },
      { href: "/command-center", icon: Shield, label: "Command Center", adminOnly: true },
      { href: "/snapshots", icon: History, label: "Snapshots" },
      { href: "/marketplace", icon: Store, label: "Marketplace" },
      { href: "/affiliate", icon: Users, label: "Affiliates" },
      { href: "/pricing", icon: CreditCard, label: "Plans & Pricing" },
      { href: "/billing", icon: DollarSign, label: "Usage & Billing" },
      { href: "/domains", icon: Link2, label: "Domains" },
      { href: "/integrations", icon: Plug, label: "Integrations" },
      { href: "/webhooks", icon: Webhook, label: "Webhooks", requiredFeature: "webhooks" },
      { href: "/webhook-events", icon: Activity, label: "Event Log" },
      { href: "/white-label", icon: Palette, label: "White Label", requiredFeature: "white_label" },
      { href: "/reports", icon: FileBarChart, label: "Reports" },
      { href: "/god-mode", icon: Rocket, label: "God Mode", adminOnly: true },
    ],
  },
];

function NavLink({ href, icon: Icon, label, isActive, isLocked }: { href: string; icon: any; label: string; isActive: boolean; isLocked?: boolean }) {
  if (isLocked) {
    return (
      <Link href={href} className="relative group block opacity-50" data-testid={`nav-link-${href.replace("/", "") || "home"}`}>
        <div className="flex items-center gap-3 p-3 px-4 transition-all text-slate-500">
          <Icon size={20} />
          <span className="font-medium text-sm tracking-wide">{label}</span>
          <Lock size={12} className="text-orange-400 ml-auto" />
        </div>
      </Link>
    );
  }

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
        <span className="font-medium text-sm tracking-wide">{label}</span>
      </div>
    </Link>
  );
}

function AccountSwitcher({ accounts }: { accounts: SubAccount[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [, setLocation] = useLocation();
  const { activeAccountId, setActiveAccountId } = useAccount();

  const current = accounts.find(a => a.id === activeAccountId) || accounts[0];

  return (
    <div className="relative px-2 md:px-4 mb-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-3 bg-white/5 border border-cyan-500/30 p-2 rounded-lg hover:bg-white/10 transition-all shadow-[0_0_15px_rgba(0,243,255,0.05)]"
        data-testid="button-account-switcher"
      >
        <div className="w-8 h-8 rounded bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center font-black text-black text-xs flex-shrink-0">
          {current ? current.name.substring(0, 2).toUpperCase() : "AP"}
        </div>
        <div className="text-left hidden md:block flex-1 min-w-0">
          <p className="text-[10px] text-cyan-400 font-bold uppercase tracking-widest leading-none">Sub-Account</p>
          <p className="text-white text-sm font-bold truncate">{current?.name || "All Accounts"}</p>
        </div>
        <ChevronDown size={14} className={`text-gray-500 hidden md:block transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="absolute top-full left-2 right-2 md:left-4 md:right-4 mt-1 bg-black/90 backdrop-blur-2xl border border-white/10 rounded-xl overflow-hidden z-50"
          >
            <div className="max-h-48 overflow-y-auto">
              {accounts.map((account) => (
                <button
                  key={account.id}
                  className={`w-full text-left p-3 hover:bg-cyan-500/10 flex items-center gap-3 border-b border-white/5 last:border-0 ${account.id === current?.id ? "bg-cyan-500/10" : ""}`}
                  onClick={() => { setActiveAccountId(account.id); setIsOpen(false); }}
                  data-testid={`button-switch-account-${account.id}`}
                >
                  <div className="w-6 h-6 rounded bg-white/10 text-[10px] flex items-center justify-center text-white font-bold flex-shrink-0">
                    {account.name.substring(0, 2).toUpperCase()}
                  </div>
                  <span className="text-white text-sm truncate">{account.name}</span>
                </button>
              ))}
            </div>
            <button
              className="w-full p-3 text-center text-xs text-cyan-400 font-bold border-t border-white/10 hover:bg-white/5 flex items-center justify-center gap-1"
              onClick={() => { setIsOpen(false); setLocation("/onboarding"); }}
              data-testid="button-create-new-account"
            >
              <Plus size={12} /> CREATE NEW ACCOUNT
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: accounts = [] } = useQuery<SubAccount[]>({
    queryKey: ["/api/accounts"],
  });

  const { activeAccountId } = useAccount();
  const currentAccount = accounts.find(a => a.id === activeAccountId) || accounts[0];
  const isUserAdmin = (user as any)?.isAdmin === "true";
  const accountPlan = isUserAdmin ? 'enterprise' : ((currentAccount as any)?.plan || 'starter');

  const renderNavContent = (onNavClick?: () => void) => (
    <>
      <div className="p-4 md:p-6 pb-3 md:pb-4">
        <div className="flex items-center gap-2 mb-1">
          <img src="/apex-logo.png" alt="Apex Marketing Automations" className="w-8 h-8 object-contain" />
          <h1 className="text-lg font-bold tracking-tight text-white leading-tight">
            APEX <span className="font-light text-indigo-400 text-xs block -mt-0.5">MARKETING AUTOMATIONS</span>
          </h1>
        </div>
      </div>

      {accounts.length > 0 && <AccountSwitcher accounts={accounts} />}
      <LegacyStatusBadge />

      <div className="px-4 mb-2 flex items-center gap-2">
        <button
          onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
          className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-slate-400 hover:text-white text-sm"
          data-testid="button-command-menu"
        >
          <Search size={14} />
          <span className="flex-1 text-left">Search...</span>
          <span className="flex items-center gap-0.5 text-[10px] text-slate-600 border border-white/10 px-1.5 py-0.5 rounded">
            <span>⌘</span>K
          </span>
        </button>
        <NotificationBell />
      </div>

      <div className="flex-1 space-y-1 pr-4 overflow-y-auto" onClick={onNavClick}>
        {navSections.map((section) => {
          const visibleItems = section.items;
          if (visibleItems.length === 0) return null;
          return (
            <div key={section.label}>
              <div className="px-6 text-xs font-bold text-slate-600 mb-2 mt-4 tracking-wider">{section.label}</div>
              {visibleItems.map((item) => (
                <NavLink key={item.href} {...item} isActive={location === item.href} isLocked={(item as any).requiredFeature ? !hasFeature(accountPlan, (item as any).requiredFeature) : false} />
              ))}
            </div>
          );
        })}
      </div>

      {user && (
        <div className="px-4 mb-2">
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-400">
            <span className="truncate">{user.email}</span>
          </div>
          <button onClick={() => { logout(); onNavClick?.(); }} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-colors" data-testid="button-logout">
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>
      )}

      <div className="px-4 mb-2">
        <VibeSwitcher />
      </div>

      <div className="p-4 border-t border-white/5 bg-black/20">
        <div className="flex items-center gap-3">
          {user?.profileImageUrl ? (
            <img src={user.profileImageUrl} alt="" className="w-10 h-10 rounded-full border border-white/10 shrink-0 object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-slate-700 to-slate-600 border border-white/10 shrink-0" />
          )}
          <div>
            <div className="text-sm font-bold text-white">{user?.firstName || user?.email || "Admin User"}</div>
            <div className="text-xs flex items-center gap-2">
              <span className="text-green-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Online
              </span>
              {(user as any)?.isAdmin === "true" && (
                <span className="px-1.5 py-0.5 rounded bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 text-indigo-300 text-[9px] font-bold tracking-wider uppercase">Admin</span>
              )}
            </div>
          </div>
          <Link href="/account-settings" data-testid="button-settings-gear" onClick={onNavClick}>
            <Settings size={16} className="ml-auto text-slate-500 hover:text-white cursor-pointer" />
          </Link>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen text-white font-sans selection:bg-indigo-500/30" style={{ backgroundColor: 'var(--vibe-bg, #030014)' }}>
      <div className="fixed inset-0 bg-grid z-0 pointer-events-none" />
      <div className="fixed top-0 left-0 w-full h-[500px] bg-gradient-to-b from-indigo-900/10 to-transparent pointer-events-none z-0" />

      <div className="md:hidden fixed top-0 left-0 right-0 z-30 bg-black/90 backdrop-blur-xl border-b border-white/10 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setSidebarOpen(true)} className="p-1" data-testid="button-mobile-menu">
            <Menu size={24} className="text-white" />
          </button>
          <span className="text-lg font-bold text-white">APEX</span>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <VibeSwitcher />
        </div>
      </div>

      <aside className="hidden md:flex w-72 glass-panel flex-col z-20 fixed top-0 left-0 h-screen overflow-y-auto">
        {renderNavContent()}
      </aside>

      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.aside
              initial={{ x: -288 }}
              animate={{ x: 0 }}
              exit={{ x: -288 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed top-0 left-0 w-72 h-screen glass-panel flex flex-col z-50 overflow-y-auto md:hidden"
            >
              <div className="flex items-center justify-between p-4">
                <span className="text-lg font-bold text-white">APEX</span>
                <button onClick={() => setSidebarOpen(false)} className="p-1" data-testid="button-close-mobile-menu">
                  <X size={20} className="text-white" />
                </button>
              </div>
              {renderNavContent(() => setSidebarOpen(false))}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <main className="flex-1 ml-0 md:ml-72 pt-16 md:pt-0 relative z-10 flex flex-col min-h-screen">
        <BlitzBanner />
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
      <SiteAssistant />
    </div>
  );
}
