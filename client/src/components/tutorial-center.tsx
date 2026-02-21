import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "wouter";
import {
  GraduationCap, Sparkles, Send, Monitor, Eye,
  Plus, Save, Globe, CheckCircle2, ChevronRight, ChevronDown,
  ChevronUp, RotateCcw, X, Rocket,
  Brain, Phone, MessageSquare, BarChart, GitFork, Target, Plug, Star
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

interface TrackColors {
  iconBg: string;
  progressBar: string;
  activeBg: string;
  activeBorder: string;
  activeText: string;
  buttonBg: string;
  buttonHover: string;
  iconText: string;
}

interface LearningTrack {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ComponentType<any>;
  colors: TrackColors;
  milestones: TutorialMilestone[];
}

const TRACK_COLORS: Record<string, TrackColors> = {
  indigo: {
    iconBg: "rgba(99,102,241,0.2)",
    progressBar: "linear-gradient(to right, #6366f1, #a855f7)",
    activeBg: "rgba(99,102,241,0.1)",
    activeBorder: "rgba(99,102,241,0.2)",
    activeText: "#818cf8",
    buttonBg: "#4f46e5",
    buttonHover: "#6366f1",
    iconText: "#818cf8",
  },
  cyan: {
    iconBg: "rgba(6,182,212,0.2)",
    progressBar: "linear-gradient(to right, #06b6d4, #3b82f6)",
    activeBg: "rgba(6,182,212,0.1)",
    activeBorder: "rgba(6,182,212,0.2)",
    activeText: "#22d3ee",
    buttonBg: "#0891b2",
    buttonHover: "#06b6d4",
    iconText: "#22d3ee",
  },
  emerald: {
    iconBg: "rgba(16,185,129,0.2)",
    progressBar: "linear-gradient(to right, #10b981, #14b8a6)",
    activeBg: "rgba(16,185,129,0.1)",
    activeBorder: "rgba(16,185,129,0.2)",
    activeText: "#34d399",
    buttonBg: "#059669",
    buttonHover: "#10b981",
    iconText: "#34d399",
  },
};

const LEARNING_TRACKS: LearningTrack[] = [
  {
    id: "site-design",
    title: "Build Your Website",
    subtitle: "Create & publish a professional site with AI",
    icon: Globe,
    colors: TRACK_COLORS.indigo,
    milestones: [
      { id: "sd_describe", title: "Describe Your Website", description: "Open Site Architect and type a description of your website — mention your business, style, and sections.", icon: Send, route: "/site-builder", action: "Go to Site Architect" },
      { id: "sd_generate", title: "Generate with AI", description: "Click Generate or pick a template. The AI builds a full site with theme, content, and layout in seconds.", icon: Sparkles, route: "/site-builder", action: "Generate a Site" },
      { id: "sd_preview", title: "Preview & Check Mobile", description: "Scroll through the live preview. Switch to mobile view to make sure it looks great on all devices.", icon: Monitor, route: "/site-builder", action: "Preview Your Site" },
      { id: "sd_customize", title: "Customize in Edit Mode", description: "Turn on Edit Mode to drag sections, edit text, add blocks (testimonials, pricing, FAQ), and remove what you don't need.", icon: Eye, route: "/site-builder", action: "Enter Edit Mode" },
      { id: "sd_save", title: "Save Your Design", description: "Click Save and name it. This creates a version snapshot you can rollback to anytime.", icon: Save, route: "/site-builder", action: "Save Design" },
      { id: "sd_publish", title: "Publish Your Site", description: "Hit Publish to go live. Connect a custom domain from the Domains page for a professional URL.", icon: Globe, route: "/site-builder", action: "Publish" },
    ],
  },
  {
    id: "ai-setup",
    title: "Train Your AI",
    subtitle: "Set up AI chatbot & voice agent",
    icon: Brain,
    colors: TRACK_COLORS.cyan,
    milestones: [
      { id: "ai_url", title: "Add Your Website URL", description: "Go to Neural Trainer and paste your business website URL. The AI will scrape and learn everything about your business.", icon: Globe, route: "/bot-trainer", action: "Open Neural Trainer" },
      { id: "ai_persona", title: "Set Bot Persona", description: "Define your AI assistant's name, tone, and personality. Example: 'Friendly receptionist named Sarah.'", icon: Brain, route: "/bot-trainer", action: "Set Persona" },
      { id: "ai_train", title: "Start Training", description: "Click Start Training. The AI scrapes your site, builds a knowledge base, and becomes an expert on your business.", icon: Rocket, route: "/bot-trainer", action: "Start Training" },
      { id: "ai_test", title: "Test Your Bot", description: "Ask your trained bot questions — pricing, hours, services. Make sure it gives accurate, helpful answers.", icon: MessageSquare, route: "/bot-trainer", action: "Test Bot" },
      { id: "ai_voice", title: "Deploy Voice Agent", description: "Create an AI phone agent that answers calls, handles objections, and books appointments automatically.", icon: Phone, route: "/voice-agent", action: "Set Up Voice Agent" },
      { id: "ai_widget", title: "Embed Chat Widget", description: "Generate an embed code and add the chat widget to your website for 24/7 AI customer service.", icon: Plug, route: "/website-integration", action: "Get Embed Code" },
    ],
  },
  {
    id: "lead-management",
    title: "Manage Leads",
    subtitle: "Pipeline, deals & customer tracking",
    icon: Target,
    colors: TRACK_COLORS.emerald,
    milestones: [
      { id: "lm_dashboard", title: "Explore Your Dashboard", description: "Check your key metrics: leads, messages, contacts, and pipeline value. This is your daily command center.", icon: BarChart, route: "/dashboard", action: "Open Dashboard" },
      { id: "lm_pipeline", title: "Set Up Your Pipeline", description: "View your deal pipeline with stages like Lead, Contacted, Qualified, Proposal, and Won. Drag deals between stages.", icon: GitFork, route: "/pipeline", action: "Open Pipeline" },
      { id: "lm_inbox", title: "Check Unified Inbox", description: "View all customer conversations across SMS, Instagram, and email in one place. Reply from a single screen.", icon: MessageSquare, route: "/inbox", action: "Open Inbox" },
      { id: "lm_workflow", title: "Create a Workflow", description: "Build an automation: When a new lead comes in -> wait 5 min -> send welcome SMS -> follow up if no reply.", icon: GitFork, route: "/workflow-builder", action: "Build Workflow" },
      { id: "lm_reputation", title: "Set Up Reviews", description: "Connect Google Reviews and Trustpilot. Route positive reviews to public sites and handle negative ones privately.", icon: Star, route: "/reputation", action: "Set Up Reviews" },
      { id: "lm_integrations", title: "Connect Your Tools", description: "Link Google Calendar, Gmail, Sheets, and other services to sync your entire business in one platform.", icon: Plug, route: "/integrations", action: "Connect Tools" },
    ],
  },
];

const TRACK_PREFIX = "apex_track_";
const CENTER_DISMISSED_KEY = "apex_guide_center_dismissed";
const ALL_COMPLETE_KEY = "apex_guide_all_done";

function getTrackStatus(track: LearningTrack): Record<string, boolean> {
  const status: Record<string, boolean> = {};
  track.milestones.forEach((m) => {
    status[m.id] = localStorage.getItem(TRACK_PREFIX + m.id) === "true";
  });
  return status;
}

function getOverallProgress(): { completed: number; total: number } {
  let completed = 0;
  let total = 0;
  LEARNING_TRACKS.forEach((track) => {
    track.milestones.forEach((m) => {
      total++;
      if (localStorage.getItem(TRACK_PREFIX + m.id) === "true") completed++;
    });
  });
  return { completed, total };
}

export function markMilestoneComplete(milestoneId: string) {
  localStorage.setItem(TRACK_PREFIX + milestoneId, "true");
  const legacyId = milestoneId.replace(/^(sd_|ai_|lm_)/, "");
  localStorage.setItem("apex_milestone_" + legacyId, "true");
  window.dispatchEvent(new CustomEvent("milestone-update"));
}

export function resetAllMilestones() {
  LEARNING_TRACKS.forEach((track) => {
    track.milestones.forEach((m) => {
      localStorage.removeItem(TRACK_PREFIX + m.id);
    });
  });
  localStorage.removeItem(CENTER_DISMISSED_KEY);
  localStorage.removeItem(ALL_COMPLETE_KEY);
  localStorage.removeItem("apex_site_tutorial_completed");
  localStorage.removeItem("apex_tutorial_center_dismissed");
  localStorage.removeItem("apex_tutorial_center_all_done");
  window.dispatchEvent(new CustomEvent("milestone-update"));
}

function TrackCard({ track, onSelect }: { track: LearningTrack; onSelect: () => void }) {
  const status = getTrackStatus(track);
  const completedCount = Object.values(status).filter(Boolean).length;
  const totalCount = track.milestones.length;
  const progress = (completedCount / totalCount) * 100;
  const allDone = completedCount === totalCount;
  const Icon = track.icon;

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-3 rounded-xl border transition-all hover:bg-white/5 group ${
        allDone ? "bg-green-500/5 border-green-500/10" : "bg-white/[0.02] border-white/10 hover:border-white/20"
      }`}
      data-testid={`button-track-${track.id}`}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: allDone ? "rgba(34,197,94,0.2)" : track.colors.iconBg }}
        >
          {allDone ? <CheckCircle2 size={18} className="text-green-400" /> : <Icon size={18} className="text-white" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className={`text-sm font-semibold ${allDone ? "text-green-300" : "text-white"}`}>{track.title}</h4>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
              allDone ? "bg-green-500/10 text-green-400" : "bg-white/10 text-slate-400"
            }`}>{completedCount}/{totalCount}</span>
          </div>
          <p className="text-[11px] text-slate-500 truncate">{track.subtitle}</p>
        </div>
        <ChevronRight size={14} className="text-slate-600 group-hover:text-white transition-colors shrink-0" />
      </div>
      <div className="mt-2 h-1 bg-white/5 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: allDone ? "#22c55e" : track.colors.progressBar }}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
    </button>
  );
}

function TrackDetail({ track, onBack }: { track: LearningTrack; onBack: () => void }) {
  const [status, setStatus] = useState(() => getTrackStatus(track));

  useEffect(() => {
    const handler = () => setStatus(getTrackStatus(track));
    window.addEventListener("milestone-update", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("milestone-update", handler);
      window.removeEventListener("storage", handler);
    };
  }, [track]);

  const completedCount = Object.values(status).filter(Boolean).length;
  const totalCount = track.milestones.length;
  const TrackIcon = track.icon;
  const c = track.colors;

  return (
    <div className="px-4 pb-4">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-slate-500 hover:text-white transition-colors mb-3" data-testid="button-track-back">
        <ChevronDown size={12} className="rotate-90" /> All Tracks
      </button>
      <div className="flex items-center gap-2 mb-3">
        <TrackIcon size={16} style={{ color: c.iconText }} />
        <h4 className="text-white font-bold text-sm">{track.title}</h4>
        <span className="text-[10px] text-slate-400 bg-white/10 px-1.5 py-0.5 rounded-full">{completedCount}/{totalCount}</span>
      </div>
      <div className="space-y-1.5">
        {track.milestones.map((milestone, idx) => {
          const isComplete = status[milestone.id];
          const isNext = !isComplete && Object.values(status).filter(Boolean).length === idx;
          const Icon = milestone.icon;
          return (
            <div
              key={milestone.id}
              className="flex items-start gap-3 p-3 rounded-xl transition-all"
              style={{
                background: isComplete ? "rgba(34,197,94,0.05)" : isNext ? c.activeBg : "rgba(255,255,255,0.02)",
                border: `1px solid ${isComplete ? "rgba(34,197,94,0.1)" : isNext ? c.activeBorder : "rgba(255,255,255,0.05)"}`,
              }}
              data-testid={`milestone-${milestone.id}`}
            >
              <div className="flex-shrink-0 mt-0.5">
                {isComplete ? (
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(34,197,94,0.2)" }}>
                    <CheckCircle2 size={16} className="text-green-400" />
                  </div>
                ) : (
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: isNext ? c.iconBg : "rgba(255,255,255,0.05)" }}>
                    <span className="text-xs font-bold" style={{ color: isNext ? c.activeText : "#64748b" }}>{idx + 1}</span>
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Icon size={14} style={{ color: isComplete ? "#34d399" : isNext ? c.activeText : "#64748b" }} />
                  <h4 className={`text-sm font-semibold ${isComplete ? "text-green-300 line-through opacity-70" : isNext ? "text-white" : "text-slate-500"}`}>
                    {milestone.title}
                  </h4>
                </div>
                <p className={`text-xs mt-1 leading-relaxed ${isNext ? "text-slate-400" : "text-slate-600"}`}>
                  {milestone.description}
                </p>
              </div>
              {isNext && milestone.route && (
                <Link href={milestone.route}>
                  <Button
                    size="sm"
                    className="text-xs h-7 px-3 shrink-0 text-white"
                    style={{ background: c.buttonBg }}
                    data-testid={`button-milestone-${milestone.id}`}
                  >
                    {milestone.action} <ChevronRight size={12} className="ml-1" />
                  </Button>
                </Link>
              )}
              {!isNext && !isComplete && (
                <button onClick={() => markMilestoneComplete(milestone.id)} className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors shrink-0 mt-1" data-testid={`button-skip-${milestone.id}`}>
                  Skip
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TutorialCenter() {
  const [expanded, setExpanded] = useState(true);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(CENTER_DISMISSED_KEY) === "true");
  const [selectedTrack, setSelectedTrack] = useState<LearningTrack | null>(null);
  const [overall, setOverall] = useState(getOverallProgress);

  useEffect(() => {
    const handler = () => setOverall(getOverallProgress());
    window.addEventListener("milestone-update", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("milestone-update", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const progress = (overall.completed / overall.total) * 100;
  const allDone = overall.completed === overall.total;

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

  if (allDone && localStorage.getItem(ALL_COMPLETE_KEY) === "true") return null;

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
              {allDone ? "All Tracks Complete!" : "Getting Started Guide"}
              {!allDone && <span className="text-[10px] text-indigo-400 font-bold bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full">{overall.completed}/{overall.total}</span>}
            </h3>
            <p className="text-slate-500 text-xs mt-0.5">
              {allDone ? "You've mastered the platform. Nice work!" : "3 learning tracks to get you up and running"}
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
            {selectedTrack ? (
              <TrackDetail track={selectedTrack} onBack={() => setSelectedTrack(null)} />
            ) : (
              <div className="px-4 pb-4 space-y-2">
                {LEARNING_TRACKS.map((track) => (
                  <TrackCard key={track.id} track={track} onSelect={() => setSelectedTrack(track)} />
                ))}

                {allDone && (
                  <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-4">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-sm font-semibold mb-3">
                      <CheckCircle2 size={16} /> All Tracks Complete
                    </div>
                    <p className="text-slate-500 text-xs">You've mastered every learning track. You're ready to run your business on autopilot.</p>
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
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function TutorialCenterCompact() {
  const [overall, setOverall] = useState(getOverallProgress);

  useEffect(() => {
    const handler = () => setOverall(getOverallProgress());
    window.addEventListener("milestone-update", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("milestone-update", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  if (overall.completed === overall.total) return null;

  const nextTrack = LEARNING_TRACKS.find((track) => {
    const status = getTrackStatus(track);
    return Object.values(status).some((v) => !v);
  });
  if (!nextTrack) return null;

  const nextStatus = getTrackStatus(nextTrack);
  const nextMilestone = nextTrack.milestones.find((m) => !nextStatus[m.id]);
  if (!nextMilestone) return null;

  const NextIcon = nextMilestone.icon;

  return (
    <Link href={nextMilestone.route || "/dashboard"}>
      <div
        className="flex items-center gap-3 p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/15 transition-all cursor-pointer group"
        data-testid="tutorial-center-compact"
      >
        <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center shrink-0">
          <NextIcon size={16} className="text-indigo-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white truncate">Next: {nextMilestone.title}</p>
          <p className="text-[10px] text-slate-500">{overall.completed}/{overall.total} steps done</p>
        </div>
        <ChevronRight size={14} className="text-indigo-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
      </div>
    </Link>
  );
}
