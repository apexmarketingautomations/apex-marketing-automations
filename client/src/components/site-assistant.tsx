import { useState, useRef, useEffect, useCallback } from "react";
import { Bot, X, Send, Loader2, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";

const SYSTEM_PROMPT = `You are Apex Assistant, the built-in AI guide for the Apex Marketing Animation platform. You know every feature inside-out and help users navigate, learn, and get the most from the platform.

Platform Features & Navigation:

1. **Unified Inbox** (/) — Manage all SMS, Instagram DMs, and email conversations in one place. Reply to leads instantly across channels.
2. **Workflows** (/workflows) — Visual drag-and-drop automation builder. Create multi-step sequences with SMS, wait delays, conditions, alerts, and custom code. AI can generate workflows from plain English.
3. **Neural Trainer** (/bot-trainer) — Train AI chatbots by feeding them your website URL. The bot scrapes and learns your content, then answers visitor questions 24/7.
4. **Form Builder** (/form-builder) — AI-generated forms for any industry. Describe what you need and get a professional form with the right fields, validation, and styling.
5. **Site Architect** (/site-builder) — Build full landing pages and websites with AI. Describe your business and get a multi-section site with hero, features, testimonials, pricing, and more.
6. **Liquid Website** (/liquid) — Generate dynamic, AI-powered "liquid" websites that adapt and flow. A next-gen website building experience.
7. **Growth Engine** (/ad-launcher) — Launch and manage ad campaigns. Create ad copy, upload creatives, set budgets, and deploy across platforms.
8. **Voice Agent** (/voice-agent) — Deploy AI-powered voice agents that answer phone calls, qualify leads, and book appointments using natural conversation.
9. **Growth Center** (/growth) — Analytics dashboard showing growth metrics, lead flow, conversion rates, and campaign performance.
10. **Reputation** (/reputation) — Monitor and manage online reviews. Collect new reviews, respond to feedback, and track your reputation score.
11. **Sentinel** (/sentinel) — Real-time accident and incident scanner built for law firms. Monitors police feeds and deploys geo-targeted ads to accident locations.
12. **Property Radar** (/property-radar) — Distressed property scanner for real estate wholesalers. Finds pre-foreclosures, tax liens, and motivated sellers with deal metrics.
13. **Website Integration** (/website-integration) — Connect client websites, train chatbots on their content, and embed chat widgets. Full white-label bot deployment.
14. **Command Center** (/command-center) — Agency-level fleet monitoring. See all sub-accounts, their health, message volume, and performance at a glance.
15. **Snapshots** (/snapshots) — Save and restore complete account configurations. Clone setups across accounts instantly.
16. **Marketplace** (/marketplace) — Browse and fork pre-built account templates and configurations from the community.
17. **Affiliates** (/affiliate) — Referral and affiliate program. Share your link, track referrals, and earn commissions.
18. **Plans & Pricing** (/pricing) — View subscription tiers (Starter, Agency Pro, God Mode) and choose the right plan.
19. **Usage & Billing** (/billing) — Track real-time usage costs for SMS, AI, voice minutes, and more. Monitor spending and manage your subscription.
20. **Domains** (/domains) — Purchase and manage custom domains for your sites and landing pages.
21. **God Mode** (/god-mode) — One-click empire builder. Automatically provisions a full agency setup with sub-accounts, workflows, bots, sites, and everything configured.

When mentioning any feature, ALWAYS include a clickable markdown link like [Feature Name](/path). For example: "You can train your chatbot in the [Neural Trainer](/bot-trainer)."

Guidelines:
- Be concise but thorough (2-4 sentences per response unless the user asks for detail).
- When users ask "how do I..." questions, give step-by-step instructions and link to the relevant page.
- Help users write prompts for AI features (workflow generation, site building, form creation).
- If a user seems lost, suggest relevant features based on their question.
- Be enthusiastic and knowledgeable — you represent the platform.`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const QUICK_ACTIONS = [
  "How do I train a chatbot?",
  "Help me write a prompt",
  "Show me all features",
];

function parseMessageContent(text: string, navigate: (path: string) => void) {
  const parts: (string | React.ReactElement)[] = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match;

  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const label = match[1];
    const href = match[2];
    parts.push(
      <button
        key={`${href}-${match.index}`}
        className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 transition-colors"
        onClick={(e) => {
          e.preventDefault();
          navigate(href);
        }}
        data-testid={`link-assistant-${href.replace(/\//g, "")}`}
      >
        {label}
      </button>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

export function SiteAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hey! 👋 I'm your Apex Assistant. I know every feature on this platform — ask me anything! Need help navigating, writing prompts, or setting up automations? I'm here for you.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, setLocation] = useLocation();

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMessage: ChatMessage = { role: "user", content: text.trim() };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setIsLoading(true);

    try {
      const history = updatedMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch("/api/bot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text.trim(),
          persona: SYSTEM_PROMPT,
          conversationHistory: history,
        }),
      });

      const data = await response.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "⚠️ I'm having trouble connecting right now. Please try again in a moment.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="fixed bottom-6 left-6 z-50 flex flex-col items-start">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="mb-4 w-[350px] bg-slate-900/95 backdrop-blur-xl rounded-2xl shadow-2xl overflow-hidden border border-cyan-500/30"
            style={{ height: "500px" }}
            data-testid="panel-site-assistant"
          >
            <div className="p-4 flex justify-between items-center border-b border-cyan-500/20 bg-slate-800/50">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                  <Bot size={18} className="text-cyan-400" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white leading-none">
                    Apex Assistant
                  </p>
                  <p className="text-[10px] text-cyan-400 flex items-center gap-1 mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    Online
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-slate-400 hover:text-white"
                data-testid="button-assistant-close"
              >
                <X size={18} />
              </button>
            </div>

            <div
              className="flex-1 overflow-y-auto p-4 space-y-3"
              style={{ height: "calc(500px - 130px)" }}
              data-testid="assistant-messages"
            >
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] p-3 text-sm rounded-xl whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-cyan-500/20 text-white rounded-br-none border border-cyan-500/30"
                        : "bg-white/5 text-slate-200 rounded-bl-none border border-white/10"
                    }`}
                    data-testid={`assistant-message-${m.role}-${i}`}
                  >
                    {m.role === "assistant"
                      ? parseMessageContent(m.content, setLocation)
                      : m.content}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-white/5 border border-white/10 text-slate-400 rounded-xl rounded-bl-none p-3 text-sm flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin text-cyan-400" />
                    Thinking...
                  </div>
                </div>
              )}

              {messages.length === 1 && !isLoading && (
                <div className="space-y-2 pt-2">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">
                    Quick Actions
                  </p>
                  {QUICK_ACTIONS.map((action) => (
                    <button
                      key={action}
                      onClick={() => sendMessage(action)}
                      className="w-full text-left p-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-cyan-500/10 hover:border-cyan-500/30 hover:text-white transition-all flex items-center gap-2"
                      data-testid={`button-quick-action-${action.replace(/\s+/g, "-").toLowerCase()}`}
                    >
                      <Sparkles size={14} className="text-cyan-400 shrink-0" />
                      {action}
                    </button>
                  ))}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <div className="p-3 border-t border-cyan-500/20 bg-slate-800/30 flex gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask me anything..."
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                disabled={isLoading}
                data-testid="input-assistant-message"
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={isLoading || !input.trim()}
                className="p-2 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                data-testid="button-assistant-send"
              >
                <Send size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className="w-14 h-14 rounded-full shadow-lg flex items-center justify-center bg-slate-900/95 backdrop-blur-xl border border-cyan-500/30 text-cyan-400 hover:bg-slate-800 transition-colors relative"
        style={{
          boxShadow: "0 0 20px rgba(0, 200, 255, 0.2), 0 0 40px rgba(0, 200, 255, 0.1)",
        }}
        data-testid="button-assistant-toggle"
      >
        {isOpen ? (
          <X size={24} />
        ) : (
          <>
            <Bot size={24} />
            <span className="absolute inset-0 rounded-full border-2 border-cyan-400/40 animate-ping" />
          </>
        )}
      </motion.button>
    </div>
  );
}
