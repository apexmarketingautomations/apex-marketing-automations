import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, Activity, BarChart3, Crown, Copy, Check, ArrowLeft, Flame } from "lucide-react";
import { useAccount } from "@/hooks/use-account";

type Tab = "fire" | "feed" | "stats" | "whales";

interface TipEvent {
  user: string;
  amount: number;
  totalTokens: number;
  goalProgress: number;
  topTipper: string;
  topTipAmount: number;
  tipCount: number;
  goalCount: number;
  at: number;
}

interface SessionState {
  isLive: boolean;
  totalTokens: number;
  goalTokens: number;
  goalProgress: number;
  tipCount: number;
  topTipper: string | null;
  topTipAmount: number;
  goalCount: number;
  commandsFired: number;
}

interface WhaleAlert {
  user: string;
  notes: string;
  at: number;
}

const COMMAND_CATEGORIES = [
  { key: "hype", label: "Hype", emoji: "🔥" },
  { key: "goal", label: "Goal push", emoji: "🎯" },
  { key: "vip", label: "VIP", emoji: "👑" },
  { key: "countdown", label: "Countdown", emoji: "⏳" },
  { key: "thank", label: "Thank you", emoji: "💖" },
  { key: "tease", label: "Tease", emoji: "😈" },
  { key: "reset", label: "Reset", emoji: "🔄" },
];

const COMMAND_MESSAGES: Record<string, string[]> = {
  hype: ["Let's gooo! Who's next?", "The energy is crazy tonight!", "Y'all are wild, I love it!", "Keep it coming!"],
  goal: ["So close to the goal!", "Who's gonna push us over?", "We need just a little more!", "Goal is RIGHT there!"],
  vip: ["Shout out to the real ones!", "VIPs in the building!", "My favorites are here tonight", "Big tipper just walked in!"],
  countdown: ["10... 9... 8...", "Countdown starting NOW", "Last chance before I count down!", "3... 2... 1... GO!"],
  thank: ["Thank you so much!", "You're the best, seriously", "I appreciate every single one of you", "That tip made my night!"],
  tease: ["Wouldn't you like to know...", "Maybe if the goal hits...", "I've got something special planned", "You'll just have to wait and see"],
  reset: ["New goal, new vibes!", "Fresh start, let's get it!", "Round two, who's ready?", "Reset and reload!"],
};

const COLORS = {
  bg: "#0A0A0C",
  accent: "#FF5C35",
  card: "#141418",
  cardBorder: "#1A1A20",
  textPrimary: "#F0EEE8",
  textSecondary: "#888888",
};

export default function RoomOS() {
  const { activeAccountId } = useAccount();
  const params = new URLSearchParams(window.location.search);
  const subAccountId = activeAccountId || parseInt(params.get("account") || "22");
  const [tab, setTab] = useState<Tab>("fire");
  const [tips, setTips] = useState<TipEvent[]>([]);
  const [session, setSession] = useState<SessionState>({
    isLive: false, totalTokens: 0, goalTokens: 500, goalProgress: 0,
    tipCount: 0, topTipper: null, topTipAmount: 0, goalCount: 0, commandsFired: 0,
  });
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [whaleAlert, setWhaleAlert] = useState<WhaleAlert | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!subAccountId) return;

    const es = new EventSource(`/api/chaturbate/stream?subAccountId=${subAccountId}`);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "roomos:session_state") {
          setSession(prev => ({ ...prev, ...data }));
        } else if (data.type === "roomos:tip") {
          setTips(prev => [{ ...data, at: Date.now() }, ...prev].slice(0, 100));
          setSession(prev => ({
            ...prev,
            totalTokens: data.totalTokens,
            goalProgress: data.goalProgress,
            tipCount: data.tipCount,
            topTipper: data.topTipper,
            topTipAmount: data.topTipAmount,
            goalCount: data.goalCount,
            isLive: true,
          }));
        } else if (data.type === "roomos:suggestion") {
          setSuggestion(data.text);
        } else if (data.type === "roomos:whale_alert") {
          setWhaleAlert({ user: data.user, notes: data.notes, at: Date.now() });
          setTimeout(() => setWhaleAlert(null), 8000);
        } else if (data.type === "roomos:broadcast_start") {
          setSession(prev => ({ ...prev, isLive: true, totalTokens: 0, tipCount: 0, goalProgress: 0, goalCount: 0, topTipper: null, topTipAmount: 0 }));
          setTips([]);
        } else if (data.type === "roomos:broadcast_end") {
          setSession(prev => ({ ...prev, isLive: false }));
        } else if (data.type === "roomos:goal_complete") {
          setSession(prev => ({ ...prev, goalCount: data.goalNumber }));
        }
      } catch {}
    };

    return () => { es.close(); eventSourceRef.current = null; };
  }, [subAccountId]);

  const fireCommand = useCallback(async (category: string, text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    } catch {}

    if (subAccountId) {
      fetch("/api/chaturbate/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subAccountId, category, messageText: text }),
      }).catch(() => {});
    }
  }, [subAccountId]);

  const goalTokens = session.goalTokens || 500;
  const tokensRemaining = Math.max(0, goalTokens - session.totalTokens);
  const nearGoal = tokensRemaining <= 50 && tokensRemaining > 0;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: COLORS.bg, color: COLORS.textPrimary }}>
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5" style={{ color: COLORS.accent }} />
            <h1 className="text-lg font-bold" data-testid="text-roomos-title">roomOS</h1>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${session.isLive ? "bg-red-500/20 text-red-400" : "bg-gray-500/20 text-gray-400"}`}
              data-testid="status-live-indicator"
            >
              {session.isLive ? "● LIVE" : "○ OFFLINE"}
            </span>
          </div>
        </div>

        <motion.div
          className="rounded-lg p-3 mb-3"
          style={{ background: COLORS.card, border: `1px solid ${COLORS.cardBorder}` }}
          data-testid="goal-bar"
          animate={nearGoal ? { borderColor: ["#1A1A20", "#FF5C35", "#1A1A20"] } : {}}
          transition={nearGoal ? { duration: 1, repeat: Infinity } : {}}
        >
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span style={{ color: COLORS.textSecondary }}>Goal Progress</span>
            <span className="font-mono font-bold" style={{ color: COLORS.accent }}>
              {session.totalTokens} / {goalTokens}
            </span>
          </div>
          <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ background: "#1A1A20" }}>
            <motion.div
              className="h-full rounded-full"
              style={{ background: `linear-gradient(90deg, ${COLORS.accent}, #FF8C35)` }}
              animate={{ width: `${Math.min(100, session.goalProgress)}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 15 }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] mt-1.5" style={{ color: COLORS.textSecondary }}>
            <span>{session.goalProgress}%</span>
            <span>{tokensRemaining > 0 ? `${tokensRemaining} to go` : "Goal reached!"}</span>
            {session.topTipper && <span>👑 {session.topTipper}</span>}
          </div>
        </motion.div>
      </div>

      <AnimatePresence>
        {whaleAlert && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mx-4 mb-2 rounded-lg overflow-hidden"
            data-testid="whale-alert-banner"
          >
            <div className="p-3 flex items-center gap-2" style={{ background: "linear-gradient(135deg, #7C3AED, #9333EA)" }}>
              <Crown className="w-5 h-5 text-yellow-300" />
              <div>
                <span className="font-bold text-white">{whaleAlert.user}</span>
                <span className="text-purple-200 text-sm ml-2">just entered the room!</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex border-b mx-4" style={{ borderColor: COLORS.cardBorder }}>
        {([
          { key: "fire" as Tab, icon: Flame, label: "Fire" },
          { key: "feed" as Tab, icon: Activity, label: "Feed" },
          { key: "stats" as Tab, icon: BarChart3, label: "Stats" },
          { key: "whales" as Tab, icon: Crown, label: "Whales" },
        ]).map(t => (
          <button
            key={t.key}
            data-testid={`tab-${t.key}`}
            onClick={() => setTab(t.key)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors"
            style={{
              color: tab === t.key ? COLORS.accent : COLORS.textSecondary,
              borderBottom: tab === t.key ? `2px solid ${COLORS.accent}` : "2px solid transparent",
            }}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {tab === "fire" && (
          <FireTab
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
            fireCommand={fireCommand}
            copiedIdx={copiedIdx}
          />
        )}
        {tab === "feed" && <FeedTab tips={tips} suggestion={suggestion} />}
        {tab === "stats" && <StatsTab session={session} subAccountId={subAccountId} />}
        {tab === "whales" && <WhalesTab subAccountId={subAccountId} />}
      </div>
    </div>
  );
}

function FireTab({ selectedCategory, setSelectedCategory, fireCommand, copiedIdx }: {
  selectedCategory: string | null;
  setSelectedCategory: (c: string | null) => void;
  fireCommand: (category: string, text: string, idx: number) => void;
  copiedIdx: number | null;
}) {
  if (selectedCategory) {
    const messages = COMMAND_MESSAGES[selectedCategory] || [];
    const cat = COMMAND_CATEGORIES.find(c => c.key === selectedCategory);
    return (
      <div>
        <button
          data-testid="button-back-categories"
          onClick={() => setSelectedCategory(null)}
          className="flex items-center gap-1.5 text-sm mb-4 transition-colors hover:opacity-80"
          style={{ color: COLORS.textSecondary }}
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h3 className="text-sm font-bold mb-3">{cat?.emoji} {cat?.label}</h3>
        <div className="space-y-2">
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-center justify-between rounded-lg p-3"
              style={{ background: COLORS.card, border: `1px solid ${COLORS.cardBorder}` }}
            >
              <span className="text-sm flex-1 mr-3">{msg}</span>
              <button
                data-testid={`button-fire-${selectedCategory}-${i}`}
                onClick={() => fireCommand(selectedCategory, msg, i)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                style={{
                  background: copiedIdx === i ? "#22C55E" : COLORS.accent,
                  color: "#fff",
                }}
              >
                {copiedIdx === i ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copiedIdx === i ? "Copied" : "Fire"}
              </button>
            </motion.div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {COMMAND_CATEGORIES.map(cat => (
        <motion.button
          key={cat.key}
          data-testid={`button-category-${cat.key}`}
          whileTap={{ scale: 0.95 }}
          onClick={() => setSelectedCategory(cat.key)}
          className="rounded-lg p-4 text-center transition-colors"
          style={{ background: COLORS.card, border: `1px solid ${COLORS.cardBorder}` }}
        >
          <span className="text-2xl block mb-1">{cat.emoji}</span>
          <span className="text-xs font-medium">{cat.label}</span>
        </motion.button>
      ))}
    </div>
  );
}

function FeedTab({ tips, suggestion }: { tips: TipEvent[]; suggestion: string | null }) {
  return (
    <div>
      <AnimatePresence>
        {suggestion && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="rounded-lg p-3 mb-3 flex items-start gap-2"
            style={{ background: "rgba(255, 92, 53, 0.1)", border: `1px solid rgba(255, 92, 53, 0.3)` }}
            data-testid="ai-suggestion-banner"
          >
            <Zap className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: COLORS.accent }} />
            <div>
              <span className="text-[10px] font-medium block mb-0.5" style={{ color: COLORS.accent }}>AI SUGGESTION</span>
              <span className="text-sm">{suggestion}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {tips.length === 0 ? (
        <div className="text-center py-12" style={{ color: COLORS.textSecondary }}>
          <Activity className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Waiting for tips...</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {tips.map((tip, i) => {
            const isLarge = tip.amount >= 100;
            const isMedium = tip.amount >= 25;
            return (
              <motion.div
                key={`${tip.user}-${tip.at}-${i}`}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center justify-between rounded-lg px-3 py-2"
                style={{
                  background: isLarge ? "rgba(255, 150, 50, 0.1)" : isMedium ? "rgba(245, 158, 11, 0.08)" : COLORS.card,
                  border: `1px solid ${isLarge ? "rgba(255, 150, 50, 0.3)" : isMedium ? "rgba(245, 158, 11, 0.2)" : COLORS.cardBorder}`,
                }}
                data-testid={`tip-event-${i}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${isLarge ? "text-orange-400" : isMedium ? "text-amber-400" : "text-gray-400"}`}>
                    {tip.amount}
                  </span>
                  <span className="text-sm">{tip.user}</span>
                </div>
                <span className="text-[10px]" style={{ color: COLORS.textSecondary }}>
                  {formatTimeAgo(tip.at)}
                </span>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatsTab({ session, subAccountId }: { session: SessionState; subAccountId?: number }) {
  const { data: sessions } = useQuery({
    queryKey: ["/api/chaturbate/sessions", subAccountId],
    queryFn: () => fetch(`/api/chaturbate/sessions/${subAccountId}`).then(r => r.json()),
    enabled: !!subAccountId,
    refetchInterval: 30000,
  });

  const metrics = [
    { label: "Session Tokens", value: session.totalTokens, icon: "💰" },
    { label: "Goals Hit", value: session.goalCount, icon: "🎯" },
    { label: "Tips Received", value: session.tipCount, icon: "🎉" },
    { label: "Top Tip", value: session.topTipAmount, icon: "👑" },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {metrics.map(m => (
          <div
            key={m.label}
            className="rounded-lg p-3"
            style={{ background: COLORS.card, border: `1px solid ${COLORS.cardBorder}` }}
            data-testid={`stat-${m.label.toLowerCase().replace(/\s/g, "-")}`}
          >
            <span className="text-lg block mb-0.5">{m.icon}</span>
            <span className="text-xl font-bold block">{m.value}</span>
            <span className="text-[10px]" style={{ color: COLORS.textSecondary }}>{m.label}</span>
          </div>
        ))}
      </div>

      <h3 className="text-xs font-medium mb-2" style={{ color: COLORS.textSecondary }}>SESSION HISTORY</h3>
      <div className="space-y-1.5">
        {(sessions || []).map((s: any) => (
          <div
            key={s.id}
            className="rounded-lg px-3 py-2 flex items-center justify-between"
            style={{ background: COLORS.card, border: `1px solid ${COLORS.cardBorder}` }}
            data-testid={`session-history-${s.id}`}
          >
            <div>
              <span className="text-sm font-medium">{s.totalTokens || 0} tokens</span>
              <span className="text-[10px] ml-2" style={{ color: COLORS.textSecondary }}>
                {s.tipCount || 0} tips · {s.goalCount || 0} goals
              </span>
            </div>
            <span className="text-[10px]" style={{ color: COLORS.textSecondary }}>
              {new Date(s.sessionDate).toLocaleDateString()}
            </span>
          </div>
        ))}
        {(!sessions || sessions.length === 0) && (
          <p className="text-sm text-center py-6" style={{ color: COLORS.textSecondary }}>No sessions yet</p>
        )}
      </div>
    </div>
  );
}

function WhalesTab({ subAccountId }: { subAccountId?: number }) {
  const { data: whales } = useQuery({
    queryKey: ["/api/chaturbate/whales", subAccountId],
    queryFn: () => fetch(`/api/chaturbate/whales/${subAccountId}`).then(r => r.json()),
    enabled: !!subAccountId,
  });

  const rankStyles = [
    { bg: "rgba(255, 215, 0, 0.1)", border: "rgba(255, 215, 0, 0.3)", badge: "🥇" },
    { bg: "rgba(192, 192, 192, 0.1)", border: "rgba(192, 192, 192, 0.3)", badge: "🥈" },
    { bg: "rgba(205, 127, 50, 0.1)", border: "rgba(205, 127, 50, 0.3)", badge: "🥉" },
  ];

  return (
    <div>
      <h3 className="text-xs font-medium mb-3" style={{ color: COLORS.textSecondary }}>TOP TIPPERS — LIFETIME</h3>
      <div className="space-y-1.5">
        {(whales || []).map((w: any, i: number) => {
          const style = i < 3 ? rankStyles[i] : null;
          return (
            <div
              key={w.id}
              className="rounded-lg px-3 py-2.5 flex items-center gap-3"
              style={{
                background: style?.bg || COLORS.card,
                border: `1px solid ${style?.border || COLORS.cardBorder}`,
              }}
              data-testid={`whale-${w.id}`}
            >
              <span className="text-lg w-6 text-center">{style?.badge || `#${i + 1}`}</span>
              <div className="flex-1">
                <span className="text-sm font-medium block">{w.firstName}</span>
                <span className="text-[10px]" style={{ color: COLORS.textSecondary }}>{w.notes || "CB tipper"}</span>
              </div>
            </div>
          );
        })}
        {(!whales || whales.length === 0) && (
          <p className="text-sm text-center py-6" style={{ color: COLORS.textSecondary }}>No tippers tracked yet</p>
        )}
      </div>
    </div>
  );
}

function formatTimeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}
