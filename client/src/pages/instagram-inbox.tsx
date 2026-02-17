import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { useAccount } from "@/hooks/use-account";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Instagram, Send, RefreshCw, MessageCircle, ArrowLeft, User } from "lucide-react";
import { format } from "date-fns";

interface InstagramConversation {
  id: number;
  subAccountId: number;
  igUserId: string | null;
  igUsername: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  createdAt: string;
}

interface InstagramMessage {
  id: number;
  conversationId: number;
  direction: string;
  body: string;
  igMessageId: string | null;
  mediaUrl: string | null;
  createdAt: string;
}

interface MetaConfig {
  hasAccessToken: boolean;
  hasAdAccountId: boolean;
  hasPageId: boolean;
  hasAppId: boolean;
}

export default function InstagramInboxPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { activeAccountId } = useAccount();
  const subAccountId = activeAccountId || 1;
  const [selectedConversation, setSelectedConversation] = useState<InstagramConversation | null>(null);
  const [messageText, setMessageText] = useState("");

  const { data: conversations = [], isLoading } = useQuery<InstagramConversation[]>({
    queryKey: ["/api/meta/instagram/conversations", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/meta/instagram/conversations/${subAccountId}`);
      return res.json();
    },
  });

  const { data: messages = [] } = useQuery<InstagramMessage[]>({
    queryKey: ["/api/meta/instagram/messages", selectedConversation?.id],
    queryFn: async () => {
      if (!selectedConversation) return [];
      const res = await fetch(`/api/meta/instagram/messages/${selectedConversation.id}`);
      return res.json();
    },
    enabled: !!selectedConversation,
  });

  const { data: config } = useQuery<MetaConfig>({
    queryKey: ["/api/meta/config"],
    queryFn: async () => {
      const res = await fetch("/api/meta/config");
      return res.json();
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/meta/instagram/sync/${subAccountId}`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/meta/instagram/conversations"] });
      toast({ title: data.synced ? `Synced ${data.conversations} conversations` : "Sync skipped", description: data.message });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!selectedConversation) return;
      const res = await apiRequest("POST", "/api/meta/instagram/send", {
        conversationId: selectedConversation.id,
        body: messageText,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meta/instagram/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/meta/instagram/conversations"] });
      setMessageText("");
    },
  });

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="p-4 md:p-8 h-[calc(100vh-2rem)]">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          {selectedConversation && (
            <Button size="sm" variant="ghost" onClick={() => setSelectedConversation(null)} className="text-slate-400 md:hidden" data-testid="button-back">
              <ArrowLeft size={16} />
            </Button>
          )}
          <h1 className="text-3xl font-black text-white flex items-center gap-3" data-testid="text-instagram-inbox-title">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center">
              <Instagram size={20} className="text-white" />
            </div>
            Instagram Inbox
          </h1>
        </div>
        <Button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} variant="outline" className="border-pink-500/30 text-pink-400 hover:bg-pink-500/10" data-testid="button-sync-instagram">
          <RefreshCw size={16} className={`mr-2 ${syncMutation.isPending ? "animate-spin" : ""}`} />
          {syncMutation.isPending ? "Syncing..." : "Sync"}
        </Button>
      </div>

      {!config?.hasAccessToken && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 text-yellow-300 text-sm mb-4" data-testid="text-ig-warning">
          Meta API keys not configured. Add META_ACCESS_TOKEN and META_PAGE_ID to connect your Instagram account and sync messages.
        </div>
      )}

      <div className="flex gap-4 h-[calc(100%-120px)]">
        <div className={`w-full md:w-80 flex-shrink-0 bg-black/40 border border-white/10 rounded-xl overflow-hidden flex flex-col ${selectedConversation ? "hidden md:flex" : "flex"}`}>
          <div className="p-3 border-b border-white/10">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Conversations ({conversations.length})</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-6 text-center text-slate-500">Loading...</div>
            ) : conversations.length === 0 ? (
              <div className="p-6 text-center">
                <MessageCircle size={32} className="mx-auto text-slate-600 mb-2" />
                <p className="text-slate-400 text-sm">No conversations yet</p>
                <p className="text-slate-500 text-xs mt-1">Click Sync to pull messages from Instagram</p>
              </div>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => setSelectedConversation(conv)}
                  className={`w-full text-left p-4 border-b border-white/5 hover:bg-white/5 transition-colors ${selectedConversation?.id === conv.id ? "bg-purple-500/10 border-l-2 border-l-purple-500" : ""}`}
                  data-testid={`button-conversation-${conv.id}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                      {(conv.igUsername || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <p className="text-white font-semibold text-sm truncate">@{conv.igUsername || "unknown"}</p>
                        {conv.unreadCount > 0 && (
                          <Badge className="bg-pink-500 text-white text-xs h-5 min-w-[20px] flex items-center justify-center">{conv.unreadCount}</Badge>
                        )}
                      </div>
                      <p className="text-slate-400 text-xs truncate mt-0.5">{conv.lastMessage || "No messages"}</p>
                      {conv.lastMessageAt && (
                        <p className="text-slate-500 text-[10px] mt-0.5">{format(new Date(conv.lastMessageAt), "MMM d, h:mm a")}</p>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className={`flex-1 bg-black/40 border border-white/10 rounded-xl overflow-hidden flex flex-col ${selectedConversation ? "flex" : "hidden md:flex"}`}>
          {selectedConversation ? (
            <>
              <div className="p-4 border-b border-white/10 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center text-white font-bold text-xs">
                  {(selectedConversation.igUsername || "?").charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-white font-bold text-sm">@{selectedConversation.igUsername || "unknown"}</p>
                  <p className="text-slate-500 text-xs">Instagram Direct Message</p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                <AnimatePresence>
                  {messages.map((msg) => (
                    <motion.div key={msg.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[70%] p-3 rounded-2xl ${msg.direction === "outbound" ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white" : "bg-white/10 text-white"}`} data-testid={`message-${msg.id}`}>
                        <p className="text-sm">{msg.body}</p>
                        <p className="text-[10px] mt-1 opacity-60">{format(new Date(msg.createdAt), "h:mm a")}</p>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {messages.length === 0 && (
                  <div className="text-center py-10 text-slate-500 text-sm">No messages in this conversation</div>
                )}
              </div>

              <div className="p-4 border-t border-white/10">
                <form onSubmit={(e) => { e.preventDefault(); if (messageText.trim()) sendMutation.mutate(); }} className="flex gap-2">
                  <Input
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder="Type a message..."
                    className="bg-white/5 border-white/10 text-white flex-1"
                    data-testid="input-ig-message"
                  />
                  <Button type="submit" disabled={!messageText.trim() || sendMutation.isPending} className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700" data-testid="button-send-ig-message">
                    <Send size={16} />
                  </Button>
                </form>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Instagram size={48} className="mx-auto text-slate-600 mb-4" />
                <p className="text-slate-400 text-lg">Select a conversation</p>
                <p className="text-slate-500 text-sm mt-1">Choose a conversation from the list to view messages</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
