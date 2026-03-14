import { useState, useRef, useEffect, useCallback } from "react";
import { Brain, X, Send, Loader2, Sparkles, TrendingUp, TrendingDown, Lightbulb, AlertTriangle, CheckCircle2, ChevronRight, Bell, Zap, BarChart3, MessageSquare, ArrowRight, Eye, Target, Shield, Clock, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "@/hooks/use-account";

type TabId = "insights" | "nudges" | "chat" | "trends";

interface Insight {
  id: string;
  category: "opportunity" | "warning" | "optimization" | "milestone";
  title: string;
  message: string;
  confidence: number;
  priority: number;
  actionable: boolean;
  suggestedTool?: string;
  dataBacking: Record<string, any>;
}

interface Nudge {
  id: number;
  nudgeType: string;
  title: string;
  message: string;
  priority: number;
  status: string;
  metadata?: any;
  createdAt: string;
}

interface Trend {
  pattern: string;
  confidence: number;
  dataPoints: number;
  category: string;
  firstSeen: string;
  lastSeen: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM_PROMPT = `You are Apex Intelligence, the AI command layer inside Apex Marketing Automations. You know every feature and can guide users through the platform with precision.

Platform Features & Navigation:

1. **Unified Inbox** (/) — Multi-channel messaging hub
2. **Workflows** (/workflows) — Visual automation builder
3. **Neural Trainer** (/bot-trainer) — AI chatbot training
4. **Form Builder** (/form-builder) — AI-generated forms
5. **Site Architect** (/site-builder) — AI landing page builder
6. **Liquid Website** (/liquid) — Dynamic AI websites
7. **Growth Engine** (/ad-launcher) — Ad campaign launcher
8. **Voice Agent** (/voice-agent) — AI voice calling
9. **Growth Center** (/growth) — Analytics dashboard
10. **Reputation** (/reputation) — Review management
11. **Sentinel** (/sentinel) — Crash detection scanner
12. **Pipeline & CRM** (/pipeline) — Lead management
13. **Calendar** (/calendar) — Appointment scheduling
14. **Email Campaigns** (/email-campaigns) — Email marketing
15. **Command Center** (/command-center) — Agency fleet view
16. **Integrations** (/integrations) — Service connections

When mentioning features, include markdown links like [Feature Name](/path).

Be concise, strategic, and data-driven. You represent premium intelligence.`;

const QUICK_PROMPTS = [
  { label: "What should I focus on?", icon: Target },
  { label: "How's my account performing?", icon: BarChart3 },
  { label: "Help me set up automations", icon: Zap },
];

function getCategoryConfig(category: string) {
  switch (category) {
    case "warning": return { icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", glow: "shadow-amber-500/5" };
    case "opportunity": return { icon: Lightbulb, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", glow: "shadow-emerald-500/5" };
    case "optimization": return { icon: Zap, color: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/20", glow: "shadow-violet-500/5" };
    case "milestone": return { icon: CheckCircle2, color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20", glow: "shadow-cyan-500/5" };
    default: return { icon: Eye, color: "text-slate-400", bg: "bg-slate-500/10", border: "border-slate-500/20", glow: "shadow-slate-500/5" };
  }
}

function getTrendIcon(category: string) {
  switch (category) {
    case "engagement": return TrendingUp;
    case "conversion": return Target;
    case "system": return Shield;
    case "channel": return MessageSquare;
    default: return BarChart3;
  }
}

function parseLinks(text: string, navigate: (path: string) => void) {
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

function InsightsTab({ subAccountId }: { subAccountId: number }) {
  const { data, isLoading, refetch } = useQuery<{ insights: Insight[] }>({
    queryKey: ["/api/operator/cognitive/insights", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/operator/cognitive/insights/${subAccountId}`);
      if (!res.ok) throw new Error("Failed to fetch insights");
      return res.json();
    },
    enabled: !!subAccountId,
    staleTime: 60000,
  });

  const insights = data?.insights || [];

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="insights-loading">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 mx-auto rounded-xl bg-violet-500/10 flex items-center justify-center">
            <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
          </div>
          <p className="text-xs text-slate-500">Analyzing your account...</p>
        </div>
      </div>
    );
  }

  if (insights.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6" data-testid="insights-empty">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 mx-auto rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6 text-emerald-400" />
          </div>
          <p className="text-sm font-medium text-white">Looking good!</p>
          <p className="text-xs text-slate-500">No critical insights right now. Your setup is solid.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2" data-testid="insights-list">
      <div className="flex items-center justify-between px-1 mb-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{insights.length} Insight{insights.length !== 1 ? "s" : ""}</p>
        <button onClick={() => refetch()} className="p-1 rounded hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors" data-testid="button-refresh-insights">
          <RefreshCw size={12} />
        </button>
      </div>
      {insights.map((insight, i) => {
        const config = getCategoryConfig(insight.category);
        const Icon = config.icon;
        return (
          <motion.div
            key={insight.id || i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className={`group p-3 rounded-xl border ${config.border} ${config.bg} ${config.glow} shadow-lg backdrop-blur-sm hover:shadow-xl transition-all cursor-default`}
            data-testid={`insight-card-${insight.category}-${i}`}
          >
            <div className="flex items-start gap-2.5">
              <div className={`w-7 h-7 rounded-lg ${config.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                <Icon size={14} className={config.color} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-white truncate">{insight.title}</p>
                  <span className={`text-[9px] font-bold uppercase tracking-wider ${config.color} shrink-0`}>
                    {Math.round(insight.confidence * 100)}%
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{insight.message}</p>
                {insight.actionable && insight.suggestedTool && (
                  <div className="mt-2 flex items-center gap-1.5 text-[10px] text-cyan-400 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                    <Zap size={10} />
                    Action available
                    <ChevronRight size={10} />
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function NudgesTab({ subAccountId }: { subAccountId: number }) {
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery<{ nudges: Nudge[] }>({
    queryKey: ["/api/operator/cognitive/nudges/pending", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/operator/cognitive/nudges/${subAccountId}/pending`);
      if (!res.ok) throw new Error("Failed to fetch nudges");
      return res.json();
    },
    enabled: !!subAccountId,
    staleTime: 60000,
  });

  const dismissMutation = useMutation({
    mutationFn: async (nudgeId: number) => {
      const res = await fetch(`/api/operator/cognitive/nudges/${nudgeId}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subAccountId }),
      });
      if (!res.ok) throw new Error("Failed to dismiss");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/operator/cognitive/nudges/pending", subAccountId] });
    },
  });

  const actMutation = useMutation({
    mutationFn: async (nudgeId: number) => {
      const res = await fetch(`/api/operator/cognitive/nudges/${nudgeId}/act`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subAccountId }),
      });
      if (!res.ok) throw new Error("Failed to act");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/operator/cognitive/nudges/pending", subAccountId] });
    },
  });

  const nudges = data?.nudges || [];

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="nudges-loading">
        <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
      </div>
    );
  }

  if (nudges.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6" data-testid="nudges-empty">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 mx-auto rounded-xl bg-violet-500/10 flex items-center justify-center">
            <Bell className="w-6 h-6 text-violet-400" />
          </div>
          <p className="text-sm font-medium text-white">All clear</p>
          <p className="text-xs text-slate-500">No active nudges. I'll notify you when I spot something.</p>
          <button onClick={() => refetch()} className="text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1 mx-auto" data-testid="button-generate-nudges">
            <RefreshCw size={10} />
            Check for new nudges
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2" data-testid="nudges-list">
      <div className="flex items-center justify-between px-1 mb-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{nudges.length} Active</p>
        <button onClick={() => refetch()} className="p-1 rounded hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors" data-testid="button-refresh-nudges">
          <RefreshCw size={12} />
        </button>
      </div>
      {nudges.map((nudge, i) => (
        <motion.div
          key={nudge.id}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.06 }}
          className="p-3 rounded-xl bg-gradient-to-r from-violet-500/5 to-cyan-500/5 border border-violet-500/15 hover:border-violet-500/30 transition-all"
          data-testid={`nudge-card-${nudge.id}`}
        >
          <div className="flex items-start gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-violet-500/15 flex items-center justify-center shrink-0 mt-0.5">
              <Lightbulb size={14} className="text-violet-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white">{nudge.title}</p>
              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{nudge.message}</p>
              <div className="flex items-center gap-2 mt-2.5">
                <button
                  onClick={() => actMutation.mutate(nudge.id)}
                  disabled={actMutation.isPending}
                  className="px-2.5 py-1 rounded-md bg-cyan-500/15 border border-cyan-500/30 text-[10px] font-semibold text-cyan-400 hover:bg-cyan-500/25 transition-colors disabled:opacity-50"
                  data-testid={`button-nudge-act-${nudge.id}`}
                >
                  Take Action
                </button>
                <button
                  onClick={() => dismissMutation.mutate(nudge.id)}
                  disabled={dismissMutation.isPending}
                  className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-[10px] text-slate-500 hover:text-slate-300 hover:bg-white/10 transition-colors disabled:opacity-50"
                  data-testid={`button-nudge-dismiss-${nudge.id}`}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function TrendsTab({ subAccountId }: { subAccountId: number }) {
  const { data, isLoading, refetch } = useQuery<{ trends: Trend[] }>({
    queryKey: ["/api/operator/cognitive/trends", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/operator/cognitive/trends/${subAccountId}`);
      if (!res.ok) throw new Error("Failed to fetch trends");
      return res.json();
    },
    enabled: !!subAccountId,
    staleTime: 120000,
  });

  const trends = data?.trends || [];

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="trends-loading">
        <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
      </div>
    );
  }

  if (trends.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6" data-testid="trends-empty">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 mx-auto rounded-xl bg-cyan-500/10 flex items-center justify-center">
            <BarChart3 className="w-6 h-6 text-cyan-400" />
          </div>
          <p className="text-sm font-medium text-white">Building your baseline</p>
          <p className="text-xs text-slate-500">I need more data to detect patterns. Keep using the platform and I'll surface trends as they emerge.</p>
          <button onClick={() => refetch()} className="text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1 mx-auto" data-testid="button-scan-trends">
            <RefreshCw size={10} />
            Scan now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2" data-testid="trends-list">
      <div className="flex items-center justify-between px-1 mb-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{trends.length} Pattern{trends.length !== 1 ? "s" : ""}</p>
        <button onClick={() => refetch()} className="p-1 rounded hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors" data-testid="button-refresh-trends">
          <RefreshCw size={12} />
        </button>
      </div>
      {trends.map((trend, i) => {
        const TrendIcon = getTrendIcon(trend.category);
        const isPositive = trend.pattern.toLowerCase().includes("increas") || trend.pattern.toLowerCase().includes("accelerat") || trend.pattern.toLowerCase().includes("growth");
        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-white/10 transition-all"
            data-testid={`trend-card-${i}`}
          >
            <div className="flex items-start gap-2.5">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${isPositive ? "bg-emerald-500/10" : "bg-amber-500/10"}`}>
                <TrendIcon size={14} className={isPositive ? "text-emerald-400" : "text-amber-400"} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-slate-300 leading-relaxed">{trend.pattern}</p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-[9px] text-slate-600 flex items-center gap-1">
                    <Target size={8} />
                    {Math.round(trend.confidence * 100)}% confidence
                  </span>
                  <span className="text-[9px] text-slate-600 flex items-center gap-1">
                    <BarChart3 size={8} />
                    {trend.dataPoints} data points
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function ChatTab({ subAccountId }: { subAccountId: number }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "I'm Apex Intelligence. I can analyze your account, recommend strategies, and guide you through any feature. What would you like to know?" },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, setLocation] = useLocation();

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, isLoading, scrollToBottom]);
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 200); }, []);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    const userMessage: ChatMessage = { role: "user", content: text.trim() };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setIsLoading(true);

    try {
      const history = updatedMessages.map(m => ({ role: m.role, content: m.content }));
      const response = await fetch("/api/bot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text.trim(), persona: SYSTEM_PROMPT, conversationHistory: history }),
      });
      const data = await response.json();
      setMessages(prev => [...prev, { role: "assistant", content: data.reply }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Connection issue. Please try again in a moment." }]);
    } finally {
      setIsLoading(false);
    }

    try {
      await fetch("/api/operator/cognitive/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subAccountId, action: "last_interaction", value: new Date().toISOString() }),
      });
    } catch {}
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="chat-tab">
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5" style={{ minHeight: 0 }}>
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[88%] p-3 text-[11px] rounded-xl whitespace-pre-wrap leading-relaxed ${
                m.role === "user"
                  ? "bg-gradient-to-br from-violet-500/20 to-cyan-500/15 text-white rounded-br-sm border border-violet-500/20"
                  : "bg-white/[0.03] text-slate-300 rounded-bl-sm border border-white/[0.06]"
              }`}
              data-testid={`intel-message-${m.role}-${i}`}
            >
              {m.role === "assistant" ? parseLinks(m.content, setLocation) : m.content}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white/[0.03] border border-white/[0.06] text-slate-500 rounded-xl rounded-bl-sm p-3 text-[11px] flex items-center gap-2">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              Processing
            </div>
          </div>
        )}

        {messages.length === 1 && !isLoading && (
          <div className="space-y-1.5 pt-1">
            {QUICK_PROMPTS.map(({ label, icon: QIcon }) => (
              <button
                key={label}
                onClick={() => sendMessage(label)}
                className="w-full text-left p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.06] text-[11px] text-slate-400 hover:bg-gradient-to-r hover:from-violet-500/10 hover:to-cyan-500/10 hover:border-violet-500/20 hover:text-white transition-all flex items-center gap-2.5 group"
                data-testid={`button-quick-${label.replace(/\s+/g, "-").toLowerCase()}`}
              >
                <QIcon size={13} className="text-slate-600 group-hover:text-violet-400 transition-colors shrink-0" />
                {label}
                <ArrowRight size={10} className="ml-auto opacity-0 group-hover:opacity-100 text-cyan-400 transition-opacity" />
              </button>
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="p-2.5 border-t border-white/[0.06] flex gap-2">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
          placeholder="Ask anything..."
          className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 text-[11px] text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500/40 transition-colors"
          disabled={isLoading}
          data-testid="input-intel-message"
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={isLoading || !input.trim()}
          className="p-2 rounded-lg bg-gradient-to-br from-violet-500/20 to-cyan-500/20 border border-violet-500/25 text-violet-400 hover:from-violet-500/30 hover:to-cyan-500/30 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          data-testid="button-intel-send"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

const TABS: { id: TabId; label: string; icon: typeof Brain }[] = [
  { id: "insights", label: "Insights", icon: Lightbulb },
  { id: "nudges", label: "Nudges", icon: Bell },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "trends", label: "Trends", icon: TrendingUp },
];

export function ApexIntelligence() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("insights");
  const { activeAccountId } = useAccount();
  const subAccountId = activeAccountId;

  const { data: nudgeData } = useQuery<{ nudges: any[] }>({
    queryKey: ["/api/operator/cognitive/nudges/pending", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/operator/cognitive/nudges/${subAccountId}/pending`);
      if (!res.ok) return { nudges: [] };
      return res.json();
    },
    enabled: !!subAccountId && !isOpen,
    staleTime: 120000,
    refetchInterval: 300000,
  });

  const nudgeCount = nudgeData?.nudges?.length || 0;

  return (
    <div className="fixed bottom-6 left-6 z-50 flex flex-col items-start">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="mb-4 w-[380px] max-w-[92vw] rounded-2xl overflow-hidden flex flex-col"
            style={{
              height: "560px",
              background: "linear-gradient(180deg, rgba(10,10,26,0.98) 0%, rgba(8,8,22,0.99) 100%)",
              boxShadow: "0 0 0 1px rgba(139,92,246,0.15), 0 25px 50px -12px rgba(0,0,0,0.8), 0 0 80px rgba(139,92,246,0.08), 0 0 120px rgba(6,182,212,0.04)",
              backdropFilter: "blur(24px)",
            }}
            data-testid="panel-apex-intelligence"
          >
            <div className="relative px-4 pt-4 pb-3">
              <div className="absolute inset-0 bg-gradient-to-r from-violet-600/8 via-transparent to-cyan-600/8" />
              <div className="relative flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500/20 to-cyan-500/15 flex items-center justify-center border border-violet-500/20">
                      <Brain size={18} className="text-violet-400" />
                    </div>
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#0a0a1a]" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white tracking-tight leading-none">Apex Intelligence</p>
                    <p className="text-[10px] text-violet-400/70 mt-0.5 font-medium tracking-wide">COGNITIVE ENGINE v1</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-slate-500 hover:text-white"
                  data-testid="button-intel-close"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="relative flex mt-3 gap-0.5 bg-white/[0.02] rounded-lg p-0.5 border border-white/[0.04]">
                {TABS.map(tab => {
                  const isActive = activeTab === tab.id;
                  const TabIcon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`relative flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[10px] font-semibold tracking-wide transition-all ${
                        isActive
                          ? "text-white"
                          : "text-slate-500 hover:text-slate-300"
                      }`}
                      data-testid={`tab-intel-${tab.id}`}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="activeTab"
                          className="absolute inset-0 rounded-md bg-gradient-to-r from-violet-500/15 to-cyan-500/15 border border-violet-500/20"
                          transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                        />
                      )}
                      <span className="relative flex items-center gap-1.5">
                        <TabIcon size={11} />
                        {tab.label}
                        {tab.id === "nudges" && nudgeCount > 0 && (
                          <span className="w-4 h-4 rounded-full bg-violet-500 text-white text-[8px] font-bold flex items-center justify-center">{nudgeCount}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="h-px bg-gradient-to-r from-transparent via-violet-500/20 to-transparent" />

            <div className="flex-1 flex flex-col overflow-hidden">
              {!subAccountId ? (
                <div className="flex-1 flex items-center justify-center p-6">
                  <div className="text-center space-y-2">
                    <Shield size={24} className="mx-auto text-slate-600" />
                    <p className="text-xs text-slate-500">Select an account to activate intelligence</p>
                  </div>
                </div>
              ) : (
                <>
                  {activeTab === "insights" && <InsightsTab subAccountId={subAccountId} />}
                  {activeTab === "nudges" && <NudgesTab subAccountId={subAccountId} />}
                  {activeTab === "chat" && <ChatTab subAccountId={subAccountId} />}
                  {activeTab === "trends" && <TrendsTab subAccountId={subAccountId} />}
                </>
              )}
            </div>

            <div className="h-px bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
            <div className="px-3 py-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[9px] text-slate-600 font-medium">Powered by Apex Cognitive Engine</span>
              </div>
              <span className="text-[9px] text-slate-700">{subAccountId ? `#${subAccountId}` : ""}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className="group relative w-20 h-20 rounded-3xl flex items-center justify-center transition-all"
        style={{
          background: isOpen
            ? "linear-gradient(135deg, rgba(139,92,246,0.2), rgba(6,182,212,0.15))"
            : "linear-gradient(135deg, rgba(10,10,26,0.95), rgba(15,15,35,0.95))",
          boxShadow: isOpen
            ? "0 0 0 1px rgba(139,92,246,0.3), 0 8px 32px rgba(139,92,246,0.15)"
            : "0 0 0 1px rgba(139,92,246,0.15), 0 12px 40px rgba(0,0,0,0.5), 0 0 80px rgba(139,92,246,0.1), 0 0 120px rgba(139,92,246,0.05)",
          backdropFilter: "blur(16px)",
        }}
        data-testid="button-intel-toggle"
      >
        <AnimatePresence mode="wait">
          {isOpen ? (
            <motion.div key="close" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.15 }}>
              <X size={32} className="text-violet-400" />
            </motion.div>
          ) : (
            <motion.div
              key="brain"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: [1, 1.15, 1], opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ scale: { duration: 2, repeat: Infinity, ease: "easeInOut" }, opacity: { duration: 0.15 } }}
              className="relative"
              style={{ filter: "drop-shadow(0 0 12px rgba(139,92,246,0.5))" }}
            >
              <Brain size={40} className="text-violet-400 group-hover:text-violet-300 transition-colors" />
              {nudgeCount > 0 && (
                <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-violet-500 text-white text-[9px] font-bold flex items-center justify-center shadow-lg shadow-violet-500/40">
                  {nudgeCount > 9 ? "9+" : nudgeCount}
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {!isOpen && (
          <>
            <span className="absolute inset-0 rounded-3xl border border-violet-500/20 opacity-0 group-hover:opacity-100 transition-opacity" />
            <span className="absolute inset-[-4px] rounded-[22px] border border-violet-400/15 animate-pulse" />
            <span className="absolute inset-[-8px] rounded-[26px] border border-violet-400/5 animate-pulse" style={{ animationDelay: "0.5s" }} />
          </>
        )}
      </motion.button>
    </div>
  );
}
