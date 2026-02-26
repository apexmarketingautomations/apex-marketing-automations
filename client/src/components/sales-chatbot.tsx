import { useState, useRef, useEffect } from "react";
import { MessageSquare, X, Send, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";
import { useDraggable } from "@/hooks/use-draggable";

interface SalesChatbotProps {
  niche?: string;
  accentColor?: string;
}

export function SalesChatbot({ niche = "general", accentColor = "#6366f1" }: SalesChatbotProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: "bot", text: "Hey! I'm Aria, your Apex AI assistant. Got questions about how we can grow your business? Ask away!" }
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { offset, onPointerDown } = useDraggable();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const handleSend = async () => {
    if (!input.trim()) return;
    const userMsg = input;
    setMessages(prev => [...prev, { role: "user", text: userMsg }]);
    setInput("");
    setIsTyping(true);

    try {
      const response = await fetch("/api/sales-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          niche,
          conversationHistory: messages.slice(-10),
        }),
      });
      const data = await response.json();
      setMessages(prev => [...prev, { role: "bot", text: data.reply }]);
    } catch {
      setMessages(prev => [...prev, { role: "bot", text: "I'm having trouble connecting. Visit apexmarketingautomations.com or try again in a moment!" }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex flex-col items-end"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="mb-4 w-[360px] max-w-[90vw] rounded-2xl shadow-2xl overflow-hidden border border-white/10"
            style={{ background: "#0a0a1a" }}
          >
            <div
              className="h-5 flex items-center justify-center cursor-grab active:cursor-grabbing select-none"
              style={{ background: "rgba(255,255,255,0.03)" }}
              onMouseDown={onPointerDown as any}
              onTouchStart={onPointerDown as any}
              data-testid="sales-chat-drag-handle"
            >
              <div className="w-8 h-1 rounded-full bg-white/10" />
            </div>

            <div className="p-4 flex justify-between items-center" style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}88)` }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
                  <Sparkles size={18} className="text-white" />
                </div>
                <div>
                  <p className="text-white font-bold text-sm">Aria - Apex AI</p>
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                    <span className="text-white/70 text-[11px]">Online now</span>
                  </div>
                </div>
              </div>
              <button onClick={() => setIsOpen(false)} className="hover:bg-white/20 p-1.5 rounded-lg transition-colors" data-testid="button-sales-chat-close">
                <X size={18} className="text-white" />
              </button>
            </div>

            <div className="h-[320px] overflow-y-auto p-4 space-y-3" style={{ background: "#0d0d20" }} data-testid="sales-chat-messages">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] p-3 text-sm rounded-xl ${
                      m.role === 'user'
                        ? 'rounded-br-none text-white'
                        : 'bg-white/5 border border-white/10 text-slate-200 rounded-bl-none'
                    }`}
                    style={m.role === 'user' ? { backgroundColor: accentColor } : undefined}
                    data-testid={`sales-chat-message-${m.role}-${i}`}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-white/5 border border-white/10 text-slate-400 rounded-xl rounded-bl-none p-3 text-sm flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    Aria is typing...
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-3 border-t border-white/5 flex gap-2" style={{ background: "#080818" }}>
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask me anything..."
                className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-0 focus-visible:border-white/20"
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                data-testid="input-sales-chat-message"
              />
              <Button
                size="icon"
                onClick={handleSend}
                disabled={isTyping || !input.trim()}
                className="shrink-0"
                style={{ backgroundColor: accentColor }}
                data-testid="button-sales-chat-send"
              >
                <Send size={16} />
              </Button>
            </div>

            <div className="text-center py-2" style={{ background: "#060612" }}>
              <a href="/" className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">
                Powered by Apex Marketing Automations
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className="w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white transition-all"
        style={{
          backgroundColor: accentColor,
          boxShadow: `0 4px 20px ${accentColor}40`,
        }}
        data-testid="button-sales-chat-toggle"
      >
        {isOpen ? <X size={24} /> : <MessageSquare size={24} />}
      </motion.button>
    </div>
  );
}
