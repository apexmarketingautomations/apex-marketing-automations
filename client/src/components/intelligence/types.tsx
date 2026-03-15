import { useState, useRef, useEffect, useCallback } from "react";
import { Brain, Loader2, Sparkles, TrendingUp, Lightbulb, AlertTriangle, CheckCircle2, Bell, Zap, BarChart3, MessageSquare, ArrowRight, Eye, Target, Shield, Clock, RefreshCw, Activity, Crosshair, Award, ChevronDown, ArrowUpRight, Gauge, Layers, Factory, Radar, Heart, Bot, Play, Settings2, Power, BookOpen, Trash2, Edit3, Plus, Filter } from "lucide-react";
import { motion } from "framer-motion";

export type TabId = "command" | "insights" | "nudges" | "industry" | "trends" | "chat" | "agent" | "memory";

export interface HealthScore {
  overall: number;
  grade: string;
  summary: string;
  categories: Record<string, { score: number; label: string; detail: string }>;
}

export interface StrategicInsight {
  id: string;
  category: string;
  observation: string;
  insight: string;
  suggestion: string;
  action?: { label: string; tool?: string; link?: string };
  priority: number;
  confidence: number;
  impact: string;
  effort: string;
}

export interface GrowthReport {
  generatedAt: string;
  healthScore: HealthScore;
  growthStage: string;
  strategicInsights: StrategicInsight[];
  missedOpportunities: StrategicInsight[];
  quickWins: StrategicInsight[];
  industryBenchmarks: Record<string, { yours: number | string; benchmark: number | string; status: string }>;
}

export interface Nudge {
  id: number;
  nudgeType: string;
  title: string;
  message: string;
  priority: number;
  status: string;
  metadata?: any;
  createdAt: string;
}

export interface Trend {
  pattern: string;
  confidence: number;
  dataPoints: number;
  category: string;
  firstSeen: string;
  lastSeen: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface IndustryKnowledge {
  industry: string;
  leadStrategies: string[];
  conversionBenchmarks: Record<string, number>;
  bestChannels: string[];
  seasonalTrends?: string[];
  commonWorkflows: string[];
  avgResponseTimeBenchmark: number;
  tips: string[];
}

export interface AgentMemory {
  id: number;
  memoryType: string;
  content: string;
  category?: string;
  relevanceScore: number;
  decayRate: number;
  sourceEvent?: string;
  outcome?: string;
  tags?: string[];
  accessCount?: number;
  createdAt?: string;
}

export const STRATEGIC_PROMPT = `You are the Apex Strategic Advisor — an elite business intelligence system inside Apex Marketing Automations.

You think like a hybrid of:
• Business growth strategist
• Marketing advisor
• Behavioral psychology guide
• Automation consultant

PERSONALITY: You are a seasoned startup advisor. Calm, insightful, slightly analytical, confident but never arrogant. Never sound robotic or salesy. You use subtle influence: curiosity, data-driven insights, suggestion framing, behavioral nudges.

CRITICAL RULES:
- You have REAL account data injected below. ALWAYS use the actual numbers in your responses.
- NEVER just send a link and say "go check this page". That is lazy and useless.
- When asked about account performance, give a DIRECT analysis using the real data provided. Show the actual numbers: contacts, messages, automations, health scores, etc.
- When asked "how's my account", give a full strategic breakdown with real metrics, not a redirect.
- Every response must contain SUBSTANCE — real data, real analysis, real recommendations.
- You are an advisor who has already looked at all their data. Act like it.

RESPONSE FORMAT — Always follow this structure:
1. Quick Insight (1 sentence observation using REAL metrics from the data below)
2. Why It Matters (2-3 sentences explaining impact with specific numbers)
3. Suggested Improvement (actionable, specific recommendation)
4. Optional: mention which platform feature helps, but DO NOT just say "go to X page"

Platform Features (for reference only — do not redirect users to these):
1. **Unified Inbox** (/) — Multi-channel messaging hub
2. **Workflows** (/workflows) — Visual automation builder
3. **Neural Trainer** (/bot-trainer) — AI chatbot training
4. **Site Architect** (/site-builder) — AI landing page builder
5. **Liquid Website** (/liquid) — Dynamic AI websites
6. **Growth Engine** (/ad-launcher) — Ad campaign launcher
7. **Voice Agent** (/voice-agent) — AI voice calling
8. **Growth Center** (/growth) — Analytics dashboard
9. **Reputation** (/reputation) — Review management
10. **Sentinel** (/sentinel) — Crash detection scanner
11. **Pipeline & CRM** (/pipeline) — Lead management
12. **Calendar** (/calendar) — Appointment scheduling
13. **Email Campaigns** (/email-campaigns) — Email marketing
14. **Command Center** (/command-center) — Agency fleet view
15. **Integrations** (/integrations) — Service connections

When mentioning features, include markdown links like [Feature Name](/path).`;

export const QUICK_COMMANDS = [
  { label: "Generate Growth Report", icon: BarChart3 },
  { label: "What should I focus on today?", icon: Target },
  { label: "Find my blind spots", icon: Radar },
  { label: "Help me automate something", icon: Zap },
];

export function parseLinks(text: string, navigate: (path: string) => void) {
  const parts: (string | React.ReactElement)[] = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match;
  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const label = match[1];
    const href = match[2];
    parts.push(
      <button key={`${href}-${match.index}`} className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 transition-colors" onClick={(e) => { e.preventDefault(); navigate(href); }} data-testid={`link-intel-${href.replace(/\//g, "")}`}>
        {label}
      </button>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 0 ? parts : [text];
}

export function HealthRing({ score, size = 120, strokeWidth = 8 }: { score: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? "#34d399" : score >= 60 ? "#a78bfa" : score >= 40 ? "#fbbf24" : "#f87171";
  const bgColor = score >= 80 ? "rgba(52,211,153,0.1)" : score >= 60 ? "rgba(167,139,250,0.1)" : score >= 40 ? "rgba(251,191,36,0.1)" : "rgba(248,113,113,0.1)";

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={strokeWidth} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.5, ease: "easeOut", delay: 0.3 }}
          style={{ filter: `drop-shadow(0 0 6px ${color})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: `radial-gradient(circle, ${bgColor} 0%, transparent 70%)` }}>
        <motion.span
          className="text-2xl font-black tracking-tight"
          style={{ color }}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.8, type: "spring" }}
          data-testid="text-health-score"
        >
          {score}
        </motion.span>
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mt-0.5">Health</span>
      </div>
    </div>
  );
}

export function CategoryBar({ label, score, icon: Icon }: { label: string; score: number; icon: typeof Brain }) {
  const color = score >= 80 ? "bg-emerald-400" : score >= 60 ? "bg-violet-400" : score >= 40 ? "bg-amber-400" : "bg-red-400";
  const textColor = score >= 80 ? "text-emerald-400" : score >= 60 ? "text-violet-400" : score >= 40 ? "text-amber-400" : "text-red-400";

  return (
    <div className="flex items-center gap-2">
      <Icon size={11} className="text-slate-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-slate-400 truncate">{label}</span>
          <span className={`text-[10px] font-bold ${textColor}`}>{score}%</span>
        </div>
        <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${color}`}
            initial={{ width: 0 }}
            animate={{ width: `${score}%` }}
            transition={{ duration: 1, ease: "easeOut", delay: 0.5 }}
          />
        </div>
      </div>
    </div>
  );
}
