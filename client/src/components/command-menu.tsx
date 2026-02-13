import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  MessageSquare,
  GitFork,
  Bot,
  Briefcase,
  LayoutTemplate,
  Globe,
  Megaphone,
  Phone,
  TrendingUp,
  Search,
  Zap,
  LogOut,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";

const NAV_COMMANDS = [
  { href: "/", icon: MessageSquare, label: "Unified Inbox" },
  { href: "/workflows", icon: GitFork, label: "Workflows" },
  { href: "/bot-trainer", icon: Bot, label: "Neural Trainer" },
  { href: "/onboarding", icon: Briefcase, label: "New Account" },
  { href: "/site-builder", icon: LayoutTemplate, label: "Site Architect" },
  { href: "/liquid", icon: Globe, label: "Liquid Website" },
  { href: "/ad-launcher", icon: Megaphone, label: "Growth Engine" },
  { href: "/voice-agent", icon: Phone, label: "Voice Agent" },
  { href: "/growth", icon: TrendingUp, label: "Growth Center" },
];

const ACTION_COMMANDS = [
  { id: "new-workflow", icon: Zap, label: "Create New Workflow...", action: "/workflows" },
  { id: "train-bot", icon: Bot, label: "Train New Bot...", action: "/bot-trainer" },
  { id: "build-site", icon: LayoutTemplate, label: "Build New Site...", action: "/site-builder" },
  { id: "deploy-agent", icon: Phone, label: "Deploy Voice Agent...", action: "/voice-agent" },
  { id: "launch-ad", icon: Megaphone, label: "Launch Ad Campaign...", action: "/ad-launcher" },
];

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "/" && !open && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open]);

  const run = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[9999] flex items-start justify-center pt-[20vh] p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
          data-testid="command-menu-overlay"
        >
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.15 }}
            className="relative w-full max-w-lg overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0a] shadow-2xl shadow-indigo-500/20"
            data-testid="command-menu-dialog"
          >
            <Command className="w-full">
              <div className="flex items-center border-b border-white/10 px-3">
                <Search className="mr-2 h-5 w-5 text-slate-500" />
                <CommandInput
                  placeholder="Type a command or search..."
                  className="w-full bg-transparent py-4 text-sm text-white placeholder:text-slate-500 focus:outline-none border-0 ring-0 h-12"
                  data-testid="command-menu-input"
                />
                <button
                  onClick={() => setOpen(false)}
                  className="text-[10px] text-slate-500 border border-white/10 px-1.5 py-0.5 rounded hover:bg-white/5 transition-colors shrink-0"
                >
                  ESC
                </button>
              </div>

              <CommandList className="max-h-[300px] overflow-y-auto p-2">
                <CommandEmpty className="py-6 text-center text-sm text-slate-500">
                  No results found.
                </CommandEmpty>

                <CommandGroup heading="Go To">
                  {NAV_COMMANDS.map((cmd) => (
                    <CommandItem
                      key={cmd.href}
                      onSelect={() => run(cmd.href)}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-3 text-sm text-slate-300 transition-colors aria-selected:bg-white/10 aria-selected:text-white"
                      data-testid={`command-nav-${cmd.href.replace("/", "") || "home"}`}
                    >
                      <cmd.icon size={16} className="text-slate-500" />
                      {cmd.label}
                    </CommandItem>
                  ))}
                </CommandGroup>

                <CommandSeparator className="my-2 bg-white/10" />

                <CommandGroup heading="Actions">
                  {ACTION_COMMANDS.map((cmd) => (
                    <CommandItem
                      key={cmd.id}
                      onSelect={() => run(cmd.action)}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-3 text-sm text-slate-300 transition-colors aria-selected:bg-white/10 aria-selected:text-white"
                      data-testid={`command-action-${cmd.id}`}
                    >
                      <cmd.icon size={16} className="text-indigo-400" />
                      {cmd.label}
                    </CommandItem>
                  ))}
                </CommandGroup>

                <CommandSeparator className="my-2 bg-white/10" />

                <CommandItem
                  onSelect={() => setOpen(false)}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-3 text-sm text-red-400 transition-colors aria-selected:bg-white/10 aria-selected:text-red-300"
                  data-testid="command-action-logout"
                >
                  <LogOut size={16} className="text-red-500" />
                  Log Out
                </CommandItem>
              </CommandList>
            </Command>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
