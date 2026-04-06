import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link, useLocation } from "wouter";
import {
  Rocket, Globe, Brain, Target, ChevronRight, Sparkles, X, ArrowRight
} from "lucide-react";
import { Button } from "@/components/ui/button";

const WELCOME_SEEN_KEY = "apex_welcome_seen";

const TRACKS = [
  {
    id: "site-design",
    title: "Build Your Website",
    description: "Create a professional site with AI in under 2 minutes",
    icon: Globe,
    gradient: "from-indigo-500 to-purple-500",
    route: "/site-builder",
  },
  {
    id: "ai-setup",
    title: "Train Your AI Assistant",
    description: "Set up a chatbot and voice agent for your business",
    icon: Brain,
    gradient: "from-cyan-500 to-blue-500",
    route: "/bot-trainer",
  },
  {
    id: "lead-management",
    title: "Manage Your Leads",
    description: "Pipeline, inbox, workflows, and reputation tracking",
    icon: Target,
    gradient: "from-emerald-500 to-teal-500",
    route: "/dashboard",
  },
];

export function WelcomeModal() {
  const [show, setShow] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    const seen = localStorage.getItem(WELCOME_SEEN_KEY);
    if (seen) return;

    const checkAccounts = async () => {
      try {
        const res = await fetch("/api/accounts", { credentials: "include" });
        if (res.ok) {
          const accounts = await res.json();
          if (Array.isArray(accounts) && accounts.length > 0) {
            localStorage.setItem(WELCOME_SEEN_KEY, "true");
            return;
          }
        }
      } catch {}
      const timer = setTimeout(() => setShow(true), 2000);
      return () => clearTimeout(timer);
    };
    checkAccounts();
  }, []);

  const dismiss = () => {
    localStorage.setItem(WELCOME_SEEN_KEY, "true");
    setShow(false);
  };

  const selectTrack = (route: string) => {
    localStorage.setItem(WELCOME_SEEN_KEY, "true");
    setShow(false);
    navigate(route);
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9998] flex items-center justify-center p-4"
          data-testid="welcome-modal"
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={dismiss} />
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="relative w-full max-w-lg bg-neutral-950 border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="absolute top-0 left-0 right-0 h-40 bg-gradient-to-b from-indigo-500/10 to-transparent pointer-events-none" />

            <button onClick={dismiss} className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors z-10" data-testid="button-dismiss-welcome">
              <X size={18} />
            </button>

            <div className="relative p-6 pb-2 text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: "spring", damping: 15 }}
                className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center"
              >
                <Rocket size={28} className="text-indigo-400" />
              </motion.div>

              <h2 className="text-xl font-bold text-white mb-2" data-testid="text-welcome-title">
                Welcome to Apex
              </h2>
              <p className="text-sm text-slate-400 max-w-sm mx-auto">
                Your all-in-one platform for AI-powered business automation. Pick a track to get started, or explore on your own.
              </p>
            </div>

            <div className="p-6 pt-4 space-y-2">
              {TRACKS.map((track, i) => {
                const Icon = track.icon;
                return (
                  <motion.button
                    key={track.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 + i * 0.1 }}
                    onClick={() => selectTrack(track.route)}
                    className="w-full flex items-center gap-4 p-4 rounded-xl border border-white/10 bg-white/[0.02] hover:bg-white/5 hover:border-white/20 transition-all group text-left"
                    data-testid={`button-welcome-${track.id}`}
                  >
                    <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${track.gradient} flex items-center justify-center shrink-0 opacity-80 group-hover:opacity-100 transition-opacity`}>
                      <Icon size={20} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-white group-hover:text-white/90">{track.title}</h3>
                      <p className="text-xs text-slate-500 mt-0.5">{track.description}</p>
                    </div>
                    <ArrowRight size={16} className="text-slate-600 group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0" />
                  </motion.button>
                );
              })}
            </div>

            <div className="px-6 pb-6 flex items-center justify-between">
              <button onClick={dismiss} className="text-xs text-slate-600 hover:text-slate-400 transition-colors" data-testid="button-skip-welcome">
                I'll explore on my own
              </button>
              <div className="flex items-center gap-1 text-[10px] text-slate-600">
                <Sparkles size={10} className="text-indigo-500" />
                Guided tutorials available on every page
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
