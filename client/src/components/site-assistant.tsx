import { useState, useRef, useEffect, useCallback } from "react";
import { Bot, X, Send, Loader2, Sparkles, Brain } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { useAccount } from "@/hooks/use-account";
import { useStreamingResponse } from "@/hooks/use-streaming";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ActivityStep {
  id: string;
  label: string;
  status: "running" | "complete";
}

interface ToolResult {
  tool: string;
  data: any;
}

const QUICK_ACTIONS = [
  "Scan my setup — what's missing?",
  "Help me create a workflow",
  "What should I fix first?",
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
        "I'm Apex Intelligence — your autonomous platform operator. I don't just explain things, I execute them.\n\nI can scan your setup, create contacts, build pipelines, configure integrations, launch automations, and more.\n\nTell me what you need done.",
    },
  ]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [location, setLocation] = useLocation();
  const { activeAccountId } = useAccount();
  const { text: streamingText, isStreaming, startStream } = useStreamingResponse();
  const [activitySteps, setActivitySteps] = useState<ActivityStep[]>([]);
  const [toolResults, setToolResults] = useState<ToolResult[]>([]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isStreaming, streamingText, scrollToBottom]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isStreaming) return;

    const userMessage: ChatMessage = { role: "user", content: text.trim() };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setActivitySteps([]);
    setToolResults([]);

    const subAccountId = activeAccountId || 1;

    try {
      const history = updatedMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      await startStream("/api/bot/chat/agent-stream", {
        message: text.trim(),
        conversationHistory: history,
        currentPath: location,
        subAccountId,
      }, {
        onDone: (fullText) => {
          setMessages(prev => [...prev, { role: "assistant", content: fullText }]);
          setActivitySteps([]);
        },
        onError: (err) => {
          const errorMessage = typeof err === 'string' ? err : (err?.message || String(err) || "Unknown");
          setMessages(prev => [...prev, { role: "assistant", content: `Connection issue. Error: ${errorMessage}\n\nPlease try again.` }]);
          setActivitySteps([]);
          setToolResults([]);
        },
        onStep: (step) => {
          setActivitySteps(prev => {
            const existing = prev.find(s => s.id === step.stepId);
            if (existing) {
              return prev.map(s => s.id === step.stepId ? { ...s, status: step.status as "running" | "complete" } : s);
            }
            return [...prev, { id: step.stepId, label: step.label, status: step.status as "running" | "complete" }];
          });
        },
        onAction: (action) => {
          if (action.action === "navigate" && action.path) {
            setLocation(action.path);
          }
        },
        onResult: (data) => {
          if (data.toolName && data.result) {
            setToolResults(prev => [...prev, { tool: data.toolName, data: data.result }]);
          }
        },
      });
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Connection issue. Please try again in a moment.",
        },
      ]);
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
            className="mb-4 w-[380px] bg-slate-900/95 backdrop-blur-xl rounded-2xl shadow-2xl overflow-hidden border border-violet-500/30"
            style={{ height: "540px" }}
            data-testid="panel-site-assistant"
          >
            <div className="p-4 flex justify-between items-center border-b border-violet-500/20 bg-slate-800/50">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/25 to-cyan-500/20 flex items-center justify-center border border-violet-500/25">
                  <Brain size={18} className="text-violet-400" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white leading-none">
                    Apex Intelligence
                  </p>
                  <p className="text-[10px] text-violet-400 flex items-center gap-1 mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Autonomous Operator
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
              style={{ height: "calc(540px - 130px)" }}
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
                        ? "bg-violet-500/20 text-white rounded-br-none border border-violet-500/30"
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

              {isStreaming && streamingText && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] p-3 text-sm rounded-xl whitespace-pre-wrap bg-white/5 text-slate-200 rounded-bl-none border border-white/10">
                    {parseMessageContent(streamingText, setLocation)}
                    <span className="inline-block w-1.5 h-3.5 bg-violet-400 animate-pulse ml-0.5 align-middle rounded-sm" />
                  </div>
                </div>
              )}

              {isStreaming && !streamingText && activitySteps.length === 0 && (
                <div className="flex justify-start">
                  <div className="bg-white/5 border border-white/10 text-slate-400 rounded-xl rounded-bl-none p-3 text-sm flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin text-violet-400" />
                    Working on it...
                  </div>
                </div>
              )}

              {activitySteps.length > 0 && (
                <div className="flex justify-start">
                  <div className="bg-white/5 border border-white/10 text-slate-400 rounded-xl rounded-bl-none p-3 text-sm space-y-2">
                    {activitySteps.map((step) => (
                      <div key={step.id} className="flex items-center gap-2">
                        {step.status === "running" ? (
                          <div className="w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <div className="w-3 h-3 rounded-full bg-green-500/30 flex items-center justify-center text-green-400 text-[8px]">✓</div>
                        )}
                        <span className={step.status === "complete" ? "text-slate-500 text-xs" : "text-slate-300 text-xs"}>{step.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {toolResults.length > 0 && (
                <div className="flex justify-start">
                  <div className="bg-white/5 border border-white/10 text-slate-400 rounded-xl rounded-bl-none p-2.5 text-xs max-w-[85%]">
                    {toolResults.map((tr, i) => (
                      <div key={i} className="mb-2 last:mb-0">
                        <div className="text-violet-400 font-medium mb-1">✓ {tr.tool}</div>
                        {tr.data.success && tr.data.data && (
                          <div className="text-slate-500 space-y-0.5">
                            {Object.entries(tr.data.data).slice(0, 4).map(([key, value]) => (
                              <div key={key} className="truncate">
                                <span className="text-slate-600">{key}:</span> {typeof value === 'object' ? JSON.stringify(value).slice(0, 50) : String(value).slice(0, 50)}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {messages.length === 1 && !isStreaming && (
                <div className="space-y-2 pt-2">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">
                    Quick Actions
                  </p>
                  {QUICK_ACTIONS.map((action) => (
                    <button
                      key={action}
                      onClick={() => sendMessage(action)}
                      className="w-full text-left p-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-violet-500/10 hover:border-violet-500/30 hover:text-white transition-all flex items-center gap-2"
                      data-testid={`button-quick-action-${action.replace(/\s+/g, "-").toLowerCase()}`}
                    >
                      <Sparkles size={14} className="text-violet-400 shrink-0" />
                      {action}
                    </button>
                  ))}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <div className="p-3 border-t border-violet-500/20 bg-slate-800/30 flex gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Tell me what to do..."
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50 transition-colors"
                disabled={isStreaming}
                data-testid="input-assistant-message"
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={isStreaming || !input.trim()}
                className="p-2 rounded-lg bg-violet-500/20 border border-violet-500/30 text-violet-400 hover:bg-violet-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
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
        className="w-14 h-14 rounded-full shadow-lg flex items-center justify-center bg-slate-900/95 backdrop-blur-xl border border-violet-500/30 text-violet-400 hover:bg-slate-800 transition-colors relative"
        style={{
          boxShadow: "0 0 20px rgba(139, 92, 246, 0.2), 0 0 40px rgba(139, 92, 246, 0.1)",
        }}
        data-testid="button-assistant-toggle"
      >
        {isOpen ? (
          <X size={24} />
        ) : (
          <>
            <Brain size={24} />
            <span className="absolute inset-0 rounded-full border-2 border-violet-400/40 animate-ping" />
          </>
        )}
      </motion.button>
    </div>
  );
}
