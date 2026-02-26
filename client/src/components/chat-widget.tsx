import { useState, useRef, useEffect } from "react";
import { MessageSquare, X, Send, Loader2, GripHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";
import { useDraggable } from "@/hooks/use-draggable";

export function ChatWidget({ primaryColor = "#D4AF37" }: { primaryColor?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: "bot", text: "Hi there! Can I help you book an appointment?" }
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
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          conversationHistory: messages,
        }),
      });

      const data = await response.json();
      setMessages(prev => [...prev, { role: "bot", text: data.reply }]);
    } catch {
      setMessages(prev => [...prev, { role: "bot", text: "Let me connect you with our team." }]);
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
            className="mb-4 w-[350px] bg-white rounded-2xl shadow-2xl overflow-hidden border border-neutral-200"
          >
            <div
              className="h-5 flex items-center justify-center cursor-grab active:cursor-grabbing select-none bg-neutral-100 border-b border-neutral-200"
              onMouseDown={onPointerDown as any}
              onTouchStart={onPointerDown as any}
              data-testid="chat-drag-handle"
            >
              <GripHorizontal size={12} className="text-neutral-400" />
            </div>
            <div className="p-4 flex justify-between items-center text-white" style={{ backgroundColor: primaryColor }}>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                <span className="font-bold text-sm">Assistant Online</span>
              </div>
              <button onClick={() => setIsOpen(false)} className="hover:bg-white/20 p-1 rounded" data-testid="button-chat-close">
                <X size={18} />
              </button>
            </div>

            <div className="h-[300px] overflow-y-auto p-4 bg-neutral-50 space-y-3" data-testid="chat-messages">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] p-3 text-sm rounded-xl ${
                      m.role === 'user'
                        ? 'bg-neutral-900 text-white rounded-br-none'
                        : 'bg-white border border-neutral-200 text-neutral-800 rounded-bl-none shadow-sm'
                    }`}
                    data-testid={`chat-message-${m.role}-${i}`}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-white border border-neutral-200 text-neutral-500 rounded-xl rounded-bl-none shadow-sm p-3 text-sm flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    Typing...
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-3 bg-white border-t border-neutral-100 flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type a message..."
                className="border-neutral-200 focus-visible:ring-0"
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                data-testid="input-chat-message"
              />
              <Button size="icon" onClick={handleSend} disabled={isTyping || !input.trim()} style={{ backgroundColor: primaryColor }} data-testid="button-chat-send">
                <Send size={16} />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className="w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white transition-colors"
        style={{ backgroundColor: primaryColor }}
        data-testid="button-chat-toggle"
      >
        {isOpen ? <X size={24} /> : <MessageSquare size={24} />}
      </motion.button>
    </div>
  );
}
