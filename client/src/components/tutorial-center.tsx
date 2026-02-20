import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link, useLocation } from "wouter";
import {
  GraduationCap, Sparkles, Send, Palette, Monitor, Smartphone, Eye,
  GripVertical, Plus, Save, Globe, CheckCircle2, ChevronRight, ChevronDown,
  ChevronUp, RotateCcw, X, Play, Rocket, BookOpen
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface TutorialMilestone {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<any>;
  route?: string;
  storageKey?: string;
  action?: string;
}

const SITE_DESIGN_MILESTONES: TutorialMilestone[] = [
  {
    id: "describe",
    title: "Describe Your Website",
    description: "Open the Site Architect and type a description of the website you want — mention your business, style, and sections.",
    icon: Send,
    route: "/site-builder",
    storageKey: "apex_milestone_describe",
    action: "Go to Site Architect",
  },
  {
    id: "generate",
    title: "Generate with AI",
    description: "Click Generate or pick a template. The AI creates a full multi-section site with theme, content, and layout in seconds.",
    icon: Sparkles,
    route: "/site-builder",
    storageKey: "apex_milestone_generate",
    action: "Generate a Site",
  },
  {
    id: "preview",
    title: "Preview & Check Mobile",
    description: "Scroll through the live preview. Switch to mobile view to make sure everything looks great on phones and tablets.",
    icon: Monitor,
    route: "/site-builder",
    storageKey: "apex_milestone_preview",
    action: "Preview Your Site",
  },
  {
    id: "customize",
    title: "Customize in Edit Mode",
    description: "Turn on Edit Mode to drag sections, edit text, add new blocks (testimonials, pricing, FAQ), and delete what you don't need.",
    icon: Eye,
    route: "/site-builder",
    storageKey: "apex_milestone_customize",
    action: "Enter Edit Mode",
  },
  {
    id: "save",
    title: "Save Your Design",
    description: "Click Save and give it a name. This creates a version snapshot you can go back to anytime from My Designs.",
    icon: Save,
    route: "/site-builder",
    storageKey: "apex_milestone_save",
    action: "Save Design",
  },
  {
    id: "publish",
    title: "Publish Your Site",
    description: "Hit Publish to make your site live. Connect a custom domain from the Domains page for a professional URL.",
    icon: Globe,
    route: "/site-builder",
    storageKey: "apex_milestone_publish",
    action: "Publish",
  },
];

const STORAGE_KEY_PREFIX = "apex_milestone_";
const CENTER_DISMISSED_KEY = "apex_tutorial_center_dismissed";
const ALL_COMPLETE_KEY = "apex_tutorial_center_all_done";

function getMilestoneStatus(): Record<string, boolean> {
  const status: Record<string, boolean> = {};
  SITE_DESIGN_MILESTONES.forEach((m) => {
    status[m.id] = localStorage.getItem(STORAGE_KEY_PREFIX + m.id) === "true";
  });
  return status;
}

export function markMilestoneComplete(milestoneId: string) {
  localStorage.setItem(STORAGE_KEY_PREFIX + milestoneId, "true");
  window.dispatchEvent(new CustomEvent("milestone-update"));
}

export function resetAllMilestones() {
  SITE_DESIGN_MILESTONES.forEach((m) => {
    localStorage.removeItem(STORAGE_KEY_PREFIX + m.id);
  });
  localStorage.removeItem(CENTER_DISMISSED_KEY);
  localStorage.removeItem(ALL_COMPLETE_KEY);
  localStorage.removeItem("apex_site_tutorial_completed");
  window.dispatchEvent(new CustomEvent("milestone-update"));
}

export function TutorialCenter() {
  const [, navigate] = useLocation();
  const [milestoneStatus, setMilestoneStatus] = useState(getMilestoneStatus);
  const [expanded, setExpanded] = useState(true);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(CENTER_DISMISSED_KEY) === "true");

  useEffect(() => {
    const handler = () => setMilestoneStatus(getMilestoneStatus());
    window.addEventListener("milestone-update", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("milestone-update", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const completedCount = Object.values(milestoneStatus).filter(Boolean).length;
  const totalCount = SITE_DESIGN_MILESTONES.length;
  const progress = (completedCount / totalCount) * 100;
  const allDone = completedCount === totalCount;

  if (dismissed && !allDone) {
    return (
      <button
        onClick={() => { setDismissed(false); localStorage.removeItem(CENTER_DISMISSED_KEY); }}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-xl shadow-indigo-500/30 flex items-center justify-center hover:scale-110 transition-transform"
        data-testid="button-reopen-tutorial-center"
      >
        <GraduationCap size={24} />
      </button>
    );
  }

  if (allDone && localStorage.getItem(ALL_COMPLETE_KEY) === "true") {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-indigo-500/5 to-purple-500/5 border border-indigo-500/20 rounded-2xl overflow-hidden"
      data-testid="tutorial-center"
    >
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => setExpanded(!expanded)}
        data-testid="button-toggle-tutorial-center"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center">
            {allDone ? <CheckCircle2 size={20} className="text-green-400" /> : <GraduationCap size={20} className="text-indigo-400" />}
          </div>
          <div>
            <h3 className="text-white font-bold text-sm flex items-center gap-2">
              {allDone ? "Site Design Complete!" : "Design Your First Website"}
              {!allDone && <span className="text-[10px] text-indigo-400 font-bold bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full">{completedCount}/{totalCount}</span>}
            </h3>
            <p className="text-slate-500 text-xs mt-0.5">
              {allDone ? "You've completed all the steps. Nice work!" : "Follow these steps to build and launch your site"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!allDone && (
            <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden hidden sm:block">
              <motion.div
                className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); if (allDone) { localStorage.setItem(ALL_COMPLETE_KEY, "true"); setDismissed(true); } else { setDismissed(true); localStorage.setItem(CENTER_DISMISSED_KEY, "true"); } }}
            className="text-slate-500 hover:text-white p-1 transition-colors"
            data-testid="button-dismiss-tutorial-center"
          >
            <X size={14} />
          </button>
          {expanded ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="px-4 pb-4 space-y-1.5">
              {SITE_DESIGN_MILESTONES.map((milestone, idx) => {
                const isComplete = milestoneStatus[milestone.id];
                const isNext = !isComplete && Object.values(milestoneStatus).filter(Boolean).length === idx;
                const Icon = milestone.icon;

                return (
                  <div
                    key={milestone.id}
                    className={`flex items-start gap-3 p-3 rounded-xl transition-all ${
                      isComplete
                        ? "bg-green-500/5 border border-green-500/10"
                        : isNext
                        ? "bg-indigo-500/10 border border-indigo-500/20"
                        : "bg-white/[0.02] border border-white/5"
                    }`}
                    data-testid={`milestone-${milestone.id}`}
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      {isComplete ? (
                        <div className="w-7 h-7 rounded-lg bg-green-500/20 flex items-center justify-center">
                          <CheckCircle2 size={16} className="text-green-400" />
                        </div>
                      ) : (
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${isNext ? "bg-indigo-500/20" : "bg-white/5"}`}>
                          <span className={`text-xs font-bold ${isNext ? "text-indigo-400" : "text-slate-600"}`}>{idx + 1}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Icon size={14} className={isComplete ? "text-green-400" : isNext ? "text-indigo-400" : "text-slate-600"} />
                        <h4 className={`text-sm font-semibold ${isComplete ? "text-green-300 line-through opacity-70" : isNext ? "text-white" : "text-slate-500"}`}>
                          {milestone.title}
                        </h4>
                      </div>
                      {(isNext || (!isComplete && expanded)) && (
                        <p className={`text-xs mt-1 leading-relaxed ${isNext ? "text-slate-400" : "text-slate-600"}`}>
                          {milestone.description}
                        </p>
                      )}
                    </div>
                    {isNext && milestone.route && (
                      <Link href={milestone.route}>
                        <Button
                          size="sm"
                          className="bg-indigo-600 hover:bg-indigo-500 text-xs h-7 px-3 shrink-0"
                          data-testid={`button-milestone-${milestone.id}`}
                        >
                          {milestone.action} <ChevronRight size={12} className="ml-1" />
                        </Button>
                      </Link>
                    )}
                    {!isNext && !isComplete && (
                      <button
                        onClick={() => markMilestoneComplete(milestone.id)}
                        className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors shrink-0 mt-1"
                        data-testid={`button-skip-${milestone.id}`}
                      >
                        Skip
                      </button>
                    )}
                  </div>
                );
              })}

              {allDone && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-center py-4"
                >
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-sm font-semibold mb-3">
                    <CheckCircle2 size={16} /> All Steps Complete
                  </div>
                  <p className="text-slate-500 text-xs">Your site design journey is complete. Explore other tools like the Bot Trainer and Workflow Builder.</p>
                </motion.div>
              )}

              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => resetAllMilestones()}
                  className="flex items-center gap-1 text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
                  data-testid="button-reset-milestones"
                >
                  <RotateCcw size={10} /> Reset Progress
                </button>
                <Link href="/site-builder">
                  <button
                    className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors"
                    data-testid="button-open-site-builder"
                  >
                    <Rocket size={10} /> Open Site Architect
                  </button>
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function TutorialCenterCompact() {
  const [milestoneStatus, setMilestoneStatus] = useState(getMilestoneStatus);

  useEffect(() => {
    const handler = () => setMilestoneStatus(getMilestoneStatus());
    window.addEventListener("milestone-update", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("milestone-update", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const completedCount = Object.values(milestoneStatus).filter(Boolean).length;
  const totalCount = SITE_DESIGN_MILESTONES.length;
  const allDone = completedCount === totalCount;

  if (allDone) return null;

  const nextMilestone = SITE_DESIGN_MILESTONES.find((m) => !milestoneStatus[m.id]);
  if (!nextMilestone) return null;

  const NextIcon = nextMilestone.icon;

  return (
    <Link href="/site-builder">
      <div
        className="flex items-center gap-3 p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/15 transition-all cursor-pointer group"
        data-testid="tutorial-center-compact"
      >
        <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center shrink-0">
          <NextIcon size={16} className="text-indigo-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white truncate">Next: {nextMilestone.title}</p>
          <p className="text-[10px] text-slate-500">{completedCount}/{totalCount} steps done</p>
        </div>
        <ChevronRight size={14} className="text-indigo-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
      </div>
    </Link>
  );
}
