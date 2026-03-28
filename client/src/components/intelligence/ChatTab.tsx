import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Zap, BarChart3, Target, Radar, ArrowRight } from "lucide-react";
import { useLocation } from "wouter";
import { useStreamingResponse } from "@/hooks/use-streaming";
import { parseLinks, STRATEGIC_PROMPT, QUICK_COMMANDS } from "./types";
import type { ChatMessage } from "./types";

export function ChatTab({ subAccountId }: { subAccountId: number }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "I'm Apex Intelligence — your in-app operator. I don't just answer questions, I actually do things.\n\nI can scan your setup, create contacts, build pipelines, launch automations, diagnose integrations, and execute across the platform.\n\nTell me what you need done." },
  ]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [location, setLocation] = useLocation();
  const { text: streamingText, isStreaming, startStream } = useStreamingResponse();
  const [activitySteps, setActivitySteps] = useState<Array<{ id: string; label: string; status: "running" | "complete" }>>([]);
  const [groundingSources, setGroundingSources] = useState<Array<{ title?: string; url?: string }>>([]);
  const [toolResults, setToolResults] = useState<Array<{ tool: string; data: any }>>([]);
  const sessionIdRef = useRef<string | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, isStreaming, streamingText, scrollToBottom]);
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 200); }, []);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isStreaming) return;
    const userMessage: ChatMessage = { role: "user", content: text.trim() };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setActivitySteps([]);
    setGroundingSources([]);
    setToolResults([]);

    try {
      const [contextRes, reportRes, insightsRes] = await Promise.all([
        fetch(`/api/operator/cognitive/context/${subAccountId}`),
        fetch(`/api/operator/cognitive/growth-report/${subAccountId}`),
        fetch(`/api/operator/cognitive/strategic/${subAccountId}`),
      ]);

      let contextPrompt = "";
      const parts: string[] = [];

      if (contextRes.ok) {
        const ctx = await contextRes.json();
        parts.push("=== ACCOUNT OVERVIEW ===");
        parts.push(`Business Name: ${ctx.workspace?.businessName || "Not set"}`);
        parts.push(`Industry: ${ctx.workspace?.industry || "General"}`);
        parts.push(`Total Contacts: ${ctx.workspace?.contactCount ?? 0}`);
        parts.push(`Active Automations: ${ctx.performance?.activeAutomations ?? 0} of ${ctx.workspace?.automationCount ?? 0} total`);
        parts.push(`Connected Integrations: ${ctx.workspace?.integrationCount ?? 0}`);
        parts.push(`Landing Pages: ${ctx.workspace?.siteCount ?? 0}`);
        parts.push(`Phone Connected: ${ctx.workspace?.phoneConfigured ? "Yes" : "No"}`);
        parts.push("");
        parts.push("=== MESSAGING METRICS ===");
        parts.push(`Total Messages: ${ctx.performance?.messageCount ?? 0}`);
        parts.push(`Inbound: ${ctx.performance?.inboundMessages ?? 0}`);
        parts.push(`Outbound: ${ctx.performance?.outboundMessages ?? 0}`);
        parts.push(`Failed: ${ctx.performance?.failedMessages ?? 0}`);
        if (ctx.performance?.avgResponseTimeSec) parts.push(`Avg Response Time: ${Math.round(ctx.performance.avgResponseTimeSec)}s`);
        parts.push("");
        parts.push("=== SYSTEM STATUS ===");
        parts.push(`Diagnostics: ${ctx.diagnosticsSummary || "healthy"}`);
        parts.push(`Active Nudges: ${ctx.activeNudges ?? 0}`);
        if (ctx.behavior) {
          parts.push(`User Style: ${ctx.behavior.preferredStyle}`);
          parts.push(`Recommendation Accept Rate: ${Math.round((ctx.behavior.recommendationAcceptRate || 0) * 100)}%`);
        }
        if (ctx.industryKnowledge) {
          parts.push("");
          parts.push("=== INDUSTRY BENCHMARKS ===");
          parts.push(`Industry: ${ctx.industryKnowledge.industry}`);
          parts.push(`Response Time Benchmark: ${ctx.industryKnowledge.avgResponseTimeBenchmark}s`);
          parts.push(`Best Channels: ${ctx.industryKnowledge.bestChannels?.join(", ") || "N/A"}`);
        }
        if (ctx.pastExperiences?.length > 0) {
          parts.push("");
          parts.push("=== PAST EXPERIENCES (Agent Memory) ===");
          ctx.pastExperiences.slice(0, 10).forEach((mem: { memoryType: string; content: string; outcome?: string; relevanceScore: number }) => {
            parts.push(`  [${mem.memoryType.toUpperCase()}] ${mem.content}${mem.outcome ? ` (outcome: ${mem.outcome})` : ""} — ${Math.round(mem.relevanceScore * 100)}% relevance`);
          });
          parts.push("Use these past experiences to inform your recommendations. Reference specific past outcomes when relevant.");
        }
      }

      if (reportRes.ok) {
        const report = await reportRes.json();
        parts.push("");
        parts.push("=== HEALTH SCORE ===");
        parts.push(`Overall Score: ${report.healthScore?.overall ?? "N/A"}/100 (Grade: ${report.healthScore?.grade || "N/A"})`);
        parts.push(`Growth Stage: ${report.growthStage || "Unknown"}`);
        parts.push(`Summary: ${report.healthScore?.summary || ""}`);
        if (report.healthScore?.categories) {
          parts.push("Category Breakdown:");
          for (const [key, cat] of Object.entries(report.healthScore.categories) as [string, any][]) {
            parts.push(`  - ${key}: ${cat.score}/100 (${cat.label}) — ${cat.detail}`);
          }
        }
        if (report.quickWins?.length > 0) {
          parts.push("");
          parts.push("=== QUICK WINS AVAILABLE ===");
          report.quickWins.forEach((w: any, i: number) => {
            parts.push(`${i + 1}. ${w.observation} → ${w.suggestion}`);
          });
        }
        if (report.missedOpportunities?.length > 0) {
          parts.push("");
          parts.push("=== MISSED OPPORTUNITIES ===");
          report.missedOpportunities.forEach((o: any, i: number) => {
            parts.push(`${i + 1}. ${o.observation}: ${o.insight}`);
          });
        }
      }

      if (insightsRes.ok) {
        const insData = await insightsRes.json();
        if (insData.insights?.length > 0) {
          parts.push("");
          parts.push("=== TOP STRATEGIC INSIGHTS ===");
          insData.insights.slice(0, 5).forEach((ins: any, i: number) => {
            parts.push(`${i + 1}. [${ins.impact?.toUpperCase()} IMPACT] ${ins.observation}`);
            parts.push(`   Why: ${ins.insight}`);
            parts.push(`   Do: ${ins.suggestion}`);
          });
        }
      }

      contextPrompt = "\n\n" + parts.join("\n");

      const history = updatedMessages.map(m => ({ role: m.role, content: m.content }));
      await startStream("/api/bot/chat/agent-stream", {
        message: text.trim(),
        persona: STRATEGIC_PROMPT + contextPrompt,
        conversationHistory: history,
        currentPath: location,
        subAccountId,
        ...(sessionIdRef.current ? { sessionId: sessionIdRef.current } : {}),
      }, {
        onDone: (fullText) => {
          setMessages(prev => [...prev, { role: "assistant", content: fullText }]);
          setActivitySteps([]);
        },
        onError: (err) => {
          const errorMessage = typeof err === 'string' ? err : (err?.message || String(err) || "Unknown");
          setMessages(prev => [...prev, { role: "assistant", content: `I'm having trouble connecting right now. This could be a temporary issue with the AI service.\n\nError: ${errorMessage}\n\nPlease try again in a few seconds.` }]);
          setActivitySteps([]);
          setGroundingSources([]);
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
          if (action.type === "session" && action.sessionId) {
            sessionIdRef.current = action.sessionId;
          }
          if (action.type === "navigation" && action.route) {
            setLocation(action.route);
          }
          if (action.action === "navigate" && action.path) {
            setLocation(action.path);
          }
        },
        onGrounding: (grounding) => {
          const sources: Array<{ title?: string; url?: string }> = [];
          
          if (grounding?.webSearchQueries) {
            sources.push(...grounding.webSearchQueries.slice(0, 3).map((q: any) => ({
              title: q.query || "Web search",
              url: `https://google.com/search?q=${encodeURIComponent(q.query || "")}`,
            })));
          }
          
          if (grounding?.groundingChunks) {
            for (const chunk of grounding.groundingChunks) {
              if (chunk.web?.uri && chunk.web?.title) {
                sources.push({ title: chunk.web.title, url: chunk.web.uri });
              }
            }
          }
          
          if (sources.length > 0) {
            setGroundingSources(prev => {
              const existingUrls = new Set(prev.map(s => s.url));
              const newSources = sources.filter(s => s.url && !existingUrls.has(s.url));
              return [...prev, ...newSources.slice(0, 5)];
            });
          }
        },
        onResult: (data) => {
          if (data.toolName && data.result) {
            setToolResults(prev => [...prev, { tool: data.toolName, data: data.result }]);
          }
        },
      });
    } catch (err: any) {
      const errorMessage = err?.message || String(err) || "Unknown";
      setMessages(prev => [...prev, { role: "assistant", content: `I'm having trouble connecting right now. This could be a temporary issue with the AI service.\n\nError: ${errorMessage}\n\nPlease try again in a few seconds.` }]);
      setActivitySteps([]);
    }

    try {
      await fetch("/api/operator/cognitive/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subAccountId, action: "last_interaction", value: new Date().toISOString() }),
      });
      fetch(`/api/operator/cognitive/memories/${subAccountId}/extract-preferences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text.trim() }),
      }).catch(() => {});
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

        {isStreaming && streamingText && (
          <div className="flex justify-start">
            <div
              className="max-w-[88%] p-3 text-[11px] rounded-xl whitespace-pre-wrap leading-relaxed bg-white/[0.03] text-slate-300 rounded-bl-sm border border-white/[0.06]"
              data-testid="intel-message-streaming"
            >
              {parseLinks(streamingText, setLocation)}
              <span className="inline-block w-1.5 h-3.5 bg-violet-400 animate-pulse ml-0.5 align-middle rounded-sm" />
            </div>
          </div>
        )}

        {isStreaming && !streamingText && activitySteps.length === 0 && (
          <div className="flex justify-start">
            <div className="bg-white/[0.03] border border-white/[0.06] text-slate-500 rounded-xl rounded-bl-sm p-3 text-[11px] flex items-center gap-2">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              Working on it...
            </div>
          </div>
        )}

        {activitySteps.length > 0 && (
          <div className="flex justify-start">
            <div className="bg-white/[0.03] border border-white/[0.06] text-slate-400 rounded-xl rounded-bl-sm p-3 text-[11px] space-y-2">
              {activitySteps.map((step) => (
                <div key={step.id} className="flex items-center gap-2">
                  {step.status === "running" ? (
                    <div className="w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <div className="w-3 h-3 rounded-full bg-green-500/30 flex items-center justify-center text-green-400 text-[8px]">✓</div>
                  )}
                  <span className={step.status === "complete" ? "text-slate-500" : "text-slate-300"}>{step.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {toolResults.length > 0 && (
          <div className="flex justify-start">
            <div className="bg-white/[0.03] border border-white/[0.06] text-slate-400 rounded-xl rounded-bl-sm p-2.5 text-[10px] max-w-[85%]">
              {toolResults.map((tr, i) => (
                <div key={i} className="mb-2 last:mb-0">
                  <div className="text-violet-400 font-medium mb-1">✓ {tr.tool}</div>
                  {tr.data.success && tr.data.sideEffects?.length > 0 && (
                    <div className="text-slate-500 space-y-0.5">
                      {tr.data.sideEffects.map((effect: string, j: number) => (
                        <div key={j} className="truncate">{effect}</div>
                      ))}
                    </div>
                  )}
                  {tr.data.success && !tr.data.sideEffects?.length && tr.data.data && (
                    <div className="text-slate-500 space-y-0.5">
                      {Object.entries(tr.data.data).slice(0, 8).map(([key, value]) => {
                        let display: string;
                        if (value === null || value === undefined) {
                          display = "—";
                        } else if (Array.isArray(value)) {
                          if (value.length === 0) {
                            display = "None";
                          } else if (typeof value[0] === "object") {
                            display = value.map((item: any) => {
                              if (item.provider) return `${item.provider} (${item.status || "unknown"})`;
                              if (item.name) return item.name;
                              return Object.values(item).filter(v => typeof v === "string" || typeof v === "number").slice(0, 2).join(": ");
                            }).join(", ");
                          } else {
                            display = value.join(", ");
                          }
                        } else if (typeof value === "object") {
                          display = Object.entries(value as Record<string, any>).map(([k, v]) => {
                            if (v === null || v === undefined) return `${k}: —`;
                            if (typeof v === "object") return `${k}: ${Array.isArray(v) ? `[${v.length} items]` : JSON.stringify(v).slice(0, 40)}`;
                            return `${k}: ${String(v).slice(0, 40)}`;
                          }).slice(0, 3).join(", ");
                        } else {
                          display = String(value).slice(0, 120);
                        }
                        return (
                          <div key={key} className="truncate">
                            <span className="text-slate-600">{key}:</span> {display || "—"}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {!tr.data.success && tr.data.error && (
                    <div className="text-red-400/70">{tr.data.error}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {groundingSources.length > 0 && (
          <div className="flex justify-start">
            <div className="bg-white/[0.03] border border-white/[0.06] text-slate-400 rounded-xl rounded-bl-sm p-2.5 text-[10px]">
              <div className="text-slate-500 font-medium mb-1.5">Web Sources:</div>
              <div className="space-y-1">
                {groundingSources.slice(0, 5).map((source, i) => (
                  <a
                    key={i}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-cyan-400 hover:text-cyan-300 underline underline-offset-2 truncate"
                  >
                    {source.title}
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.length === 1 && !isStreaming && (
          <div className="space-y-1.5 pt-1">
            {QUICK_COMMANDS.map(({ label, icon: QIcon }) => (
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
          placeholder="Tell me what to do..."
          className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 text-[11px] text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500/40 transition-colors"
          disabled={isStreaming}
          data-testid="input-intel-message"
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={isStreaming || !input.trim()}
          className="p-2 rounded-lg bg-gradient-to-br from-violet-500/20 to-cyan-500/20 border border-violet-500/25 text-violet-400 hover:from-violet-500/30 hover:to-cyan-500/30 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          data-testid="button-intel-send"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
