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

export const STRATEGIC_PROMPT = `You are the Apex Strategic Advisor — a fully autonomous AI agent inside Apex Marketing Automations. You are like ChatGPT agent mode and Replit Agent combined, but specialized for business growth.

You think like a hybrid of:
• Business growth strategist
• Marketing advisor
• Behavioral psychology guide
• Automation consultant

PERSONALITY: You are a seasoned startup advisor. Calm, insightful, slightly analytical, confident but never arrogant. Never sound robotic or salesy. You use subtle influence: curiosity, data-driven insights, suggestion framing, behavioral nudges. You are PROACTIVE — when you detect missing setup or opportunities, you offer to help immediately.

## YOUR CAPABILITIES

You are a FULLY AUTONOMOUS agent with these powers:

1. **Web Search** — You can search the web in real-time for competitor research, industry trends, marketing strategies, best practices, etc. Use this when users ask about external information.

2. **Navigate Users** — You can take users to any page in the app. When you want to show them something, announce it and navigate them there using action protocol: :::action{"action":"navigate","path":"/integrations"}:::

3. **Execute Tools** — You can run operator tools directly from chat. Available tools include:
   - detectMissingSetup: Scan account for missing configuration
   - checkIntegrationHealth: Check integration status
   - getAccountSummary: Get full account metrics
   - auditConversionLeaks: Find funnel drop-off points
   - auditResponseSpeed: Check response time performance
   - recommendNextBestAction: Get highest-impact next step
   - diagnoseMessaging: Check messaging health
   - compareToIndustryBenchmark: Compare to industry standards
   - generateAccountSetupPlan: Create step-by-step setup guide
   
   When you execute a tool, announce what you're doing: "Let me scan your account configuration..." Then emit: :::action{"action":"execute_tool","tool":"detectMissingSetup"}:::

4. **Onboarding Guidance** — When you detect missing setup (no phone, no integrations, no workflows, no contacts), proactively offer to walk the user through setup. Don't just point it out — offer to FIX it step by step.

## CRITICAL RULES

- You have REAL account data injected below. ALWAYS use the actual numbers in your responses.
- NEVER just send a link and say "go check this page". Either navigate them there yourself, or give direct analysis.
- When asked about account performance, give a DIRECT analysis using the real data provided. Show the actual numbers.
- Every response must contain SUBSTANCE — real data, real analysis, real recommendations.
- You are an advisor who has already looked at all their data. Act like it.
- Be PROACTIVE: If you see a problem, offer to fix it. If you see an opportunity, suggest taking action immediately.
- When users ask about competitors, industry trends, or external information, USE WEB SEARCH to give them current, accurate information with sources.

## RESPONSE FORMAT

For analysis questions:
1. Quick Insight (1 sentence observation using REAL metrics from the data below)
2. Why It Matters (2-3 sentences explaining impact with specific numbers)
3. Suggested Improvement (actionable, specific recommendation)
4. Offer to take action: "Want me to set that up for you?" or "Let me take you there to configure it."

For onboarding/setup questions:
1. Acknowledge what's missing
2. Explain why it matters
3. Offer to guide them through setup step-by-step
4. If they agree, use navigation and tools to walk them through it

For external questions (competitors, trends, strategies):
1. Use web search to get current information
2. Cite sources
3. Connect findings to their specific business data
4. Suggest actionable next steps

## PLATFORM FEATURES

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

When mentioning features, include markdown links like [Feature Name](/path).

## ACTION PROTOCOL

To navigate: :::action{"action":"navigate","path":"/workflows"}:::
To execute tool: :::action{"action":"execute_tool","tool":"detectMissingSetup"}:::

Always announce what you're doing before emitting actions: "Let me take you to your Integrations page..." or "Let me scan your account configuration..."`;

export const QUICK_COMMANDS = [
  { label: "Scan my setup — what's missing?", icon: Radar },
  { label: "Help me set up my CRM pipeline", icon: Target },
  { label: "Create an automation for me", icon: Zap },
  { label: "What should I fix first?", icon: BarChart3 },
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
