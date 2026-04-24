import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { format, isToday, isYesterday } from "date-fns";
import {
  Send, Phone, User, MessageSquare, Loader2, Instagram,
  MessageCircle, Bot, Facebook, RefreshCw, Search, ArrowLeft,
  CheckCheck, Filter, BarChart3, ThumbsUp, ThumbsDown, Minus,
  HelpCircle, ShieldAlert, Clock, CheckCircle2, Heart, Smile,
  Frown, Angry, Check, X, MoreHorizontal, ChevronDown, Settings, Mail, Plus
} from "lucide-react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "@/hooks/use-account";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import type { SubAccount, Message, CommentAutoReply } from "@shared/schema";

type ChannelFilter = "all" | "sms" | "facebook" | "instagram" | "whatsapp" | "telegram" | "email";

const CHANNELS: { key: ChannelFilter; label: string; icon: typeof Phone; color: string; bg: string }[] = [
  { key: "all", label: "All", icon: MessageSquare, color: "text-slate-300", bg: "bg-white/10" },
  { key: "facebook", label: "Facebook", icon: Facebook, color: "text-blue-400", bg: "bg-blue-600" },
  { key: "instagram", label: "Instagram", icon: Instagram, color: "text-pink-400", bg: "bg-pink-600" },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, color: "text-green-400", bg: "bg-green-600" },
  { key: "sms", label: "SMS", icon: Phone, color: "text-emerald-400", bg: "bg-emerald-600" },
  { key: "telegram", label: "Telegram", icon: Send, color: "text-sky-400", bg: "bg-sky-600" },
  { key: "email", label: "Email", icon: Mail, color: "text-amber-400", bg: "bg-amber-600" },
];

function formatTime(date: Date) {
  if (isToday(date)) return format(date, "h:mm a");
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMM d");
}

function isSocialId(phone: string, channel: string) {
  return (channel === "facebook" || channel === "instagram" || channel === "telegram") && /^\d{5,20}$/.test(phone);
}

function displayName(phone: string, ch: string, first?: string, last?: string) {
  if (first && !first.startsWith("FB User") && !first.startsWith("IG User") && !first.startsWith("IG ") && !first.startsWith("TG User")) {
    return `${first}${last ? ` ${last}` : ""}`;
  }
  if (ch === "facebook") return `FB ...${phone.slice(-4)}`;
  if (ch === "instagram") return `IG ...${phone.slice(-4)}`;
  if (ch === "telegram") return `TG ...${phone.slice(-4)}`;
  if (ch === "whatsapp") return phone;
  if (ch === "email") return phone;
  return phone;
}

function avatarInitial(phone: string, ch: string, first?: string) {
  if (first && !first.startsWith("FB") && !first.startsWith("IG") && !first.startsWith("TG")) return first.charAt(0).toUpperCase();
  if (ch === "facebook") return "F";
  if (ch === "instagram") return "I";
  if (ch === "telegram") return "T";
  if (ch === "whatsapp") return "W";
  if (ch === "email") return (phone.charAt(0) || "@").toUpperCase();
  return phone.charAt(phone.length - 1) || "?";
}

function channelBg(ch: string) {
  const m: Record<string, string> = {
    facebook: "bg-blue-600", instagram: "bg-gradient-to-tr from-purple-600 to-pink-500",
    whatsapp: "bg-green-600", sms: "bg-emerald-600", "vapi-sms": "bg-purple-600", telegram: "bg-sky-600",
    email: "bg-amber-600",
  };
  return m[ch] || "bg-slate-600";
}

function useSSE(subAccountId: number | undefined, onMessage: (msg: any) => void) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const seenIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!subAccountId) return;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout>;
    let retryCount = 0;
    let disposed = false;

    function connect() {
      if (disposed) return;
      es = new EventSource(`/api/inbox/stream/${subAccountId}`);

      es.onopen = () => {
        retryCount = 0;
      };

      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === "new_message" && data.message) {
            const dedupKey = data.message.messageSid || data.message.id || `${data.message.contactPhone}_${data.message.body}_${data.message.createdAt}`;
            if (seenIdsRef.current.has(dedupKey)) return;
            seenIdsRef.current.add(dedupKey);
            if (seenIdsRef.current.size > 500) {
              const arr = Array.from(seenIdsRef.current);
              seenIdsRef.current = new Set(arr.slice(arr.length - 300));
            }
            onMessageRef.current(data.message);
          }
        } catch {}
      };

      es.onerror = () => {
        es?.close();
        if (disposed) return;
        retryCount++;
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
        retryTimer = setTimeout(connect, delay);
      };
    }
    connect();

    return () => {
      disposed = true;
      es?.close();
      clearTimeout(retryTimer);
    };
  }, [subAccountId]);
}

interface CommentStats {
  total: number; replied: number; skipped: number; failed: number; disabled: number;
  byPlatform: { facebook: number; instagram: number };
  bySentiment: { positive: number; negative: number; neutral: number; question: number; spam: number };
}

const SENTIMENTS: Record<string, { label: string; cls: string; Icon: typeof ThumbsUp }> = {
  positive: { label: "Positive", cls: "text-green-400 bg-green-400/10 border-green-400/20", Icon: ThumbsUp },
  negative: { label: "Negative", cls: "text-red-400 bg-red-400/10 border-red-400/20", Icon: ThumbsDown },
  neutral: { label: "Neutral", cls: "text-slate-400 bg-slate-400/10 border-slate-400/20", Icon: Minus },
  question: { label: "Question", cls: "text-blue-400 bg-blue-400/10 border-blue-400/20", Icon: HelpCircle },
  spam: { label: "Spam", cls: "text-amber-400 bg-amber-400/10 border-amber-400/20", Icon: ShieldAlert },
};

const STATUS_COLORS: Record<string, string> = {
  replied: "text-green-400 bg-green-400/10 border-green-400/20",
  skipped: "text-slate-400 bg-slate-400/10 border-slate-400/20",
  failed: "text-red-400 bg-red-400/10 border-red-400/20",
  pending: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  disabled: "text-slate-500 bg-slate-500/10 border-slate-500/20",
};

const REACTIONS = [
  { emoji: "👍", label: "Like", type: "LIKE" },
  { emoji: "❤️", label: "Love", type: "LOVE" },
  { emoji: "😂", label: "Haha", type: "HAHA" },
  { emoji: "😮", label: "Wow", type: "WOW" },
  { emoji: "😢", label: "Sad", type: "SAD" },
  { emoji: "😡", label: "Angry", type: "ANGRY" },
];

function CommentsView({ subAccountId }: { subAccountId?: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [platformFilter, setPlatformFilter] = useState("all");
  const [sentimentFilter, setSentimentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [reactingTo, setReactingTo] = useState<number | null>(null);

  const qp = new URLSearchParams();
  if (platformFilter !== "all") qp.set("platform", platformFilter);
  if (sentimentFilter !== "all") qp.set("sentiment", sentimentFilter);
  if (statusFilter !== "all") qp.set("status", statusFilter);
  qp.set("limit", "200");

  const { data: replies = [], isLoading } = useQuery<CommentAutoReply[]>({
    queryKey: ["/api/comment-bot/replies", subAccountId, platformFilter, sentimentFilter, statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/comment-bot/replies?${qp.toString()}`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
    enabled: !!subAccountId,
    staleTime: 15_000,
    refetchInterval: 15_000,
  });

  const { data: stats } = useQuery<CommentStats>({
    queryKey: ["/api/comment-bot/stats", subAccountId],
    queryFn: async () => {
      const res = await fetch("/api/comment-bot/stats", { credentials: "include" });
      return res.ok ? res.json() : null;
    },
    enabled: !!subAccountId,
    staleTime: 15_000,
  });

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === replies.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(replies.map(r => r.id)));
    }
  };

  const replyMutation = useMutation({
    mutationFn: async ({ commentId, text }: { commentId: number; text: string }) => {
      const comment = replies.find(r => r.id === commentId);
      if (!comment) throw new Error("Comment not found");
      const res = await fetch("/api/comment-bot/manual-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ commentId: comment.commentId, replyText: text, platform: comment.platform }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Reply failed");
      }
      return res.json();
    },
    onSuccess: () => {
      setReplyingTo(null);
      setReplyText("");
      queryClient.invalidateQueries({ queryKey: ["/api/comment-bot/replies"] });
      toast({ title: "Reply sent" });
    },
    onError: (err: Error) => {
      toast({ title: "Reply failed", description: err.message, variant: "destructive" });
    },
  });

  const reactMutation = useMutation({
    mutationFn: async ({ commentIds, reactionType }: { commentIds: number[]; reactionType: string }) => {
      const results = [];
      for (const id of commentIds) {
        const comment = replies.find(r => r.id === id);
        if (!comment) continue;
        try {
          const res = await fetch("/api/comment-bot/react", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ commentId: comment.commentId, reactionType, platform: comment.platform }),
          });
          results.push({ id, ok: res.ok });
        } catch {
          results.push({ id, ok: false });
        }
      }
      return results;
    },
    onSuccess: (results) => {
      const ok = results.filter(r => r.ok).length;
      setSelectedIds(new Set());
      setReactingTo(null);
      toast({ title: `Reacted to ${ok} comment${ok !== 1 ? "s" : ""}` });
    },
  });

  const allSelected = replies.length > 0 && selectedIds.size === replies.length;
  const hasSelection = selectedIds.size > 0;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 mr-2">
          {(["all", "facebook", "instagram"] as const).map(p => (
            <button
              key={p}
              onClick={() => setPlatformFilter(p)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all ${
                platformFilter === p ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300 hover:bg-white/5"
              }`}
              data-testid={`filter-platform-${p}`}
            >
              {p === "all" ? "All" : p === "facebook" ? "Facebook" : "Instagram"}
            </button>
          ))}
        </div>
        <Select value={sentimentFilter} onValueChange={setSentimentFilter}>
          <SelectTrigger className="h-7 w-[100px] text-xs bg-transparent border-white/10" data-testid="filter-sentiment">
            <SelectValue placeholder="Sentiment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {Object.entries(SENTIMENTS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-7 w-[90px] text-xs bg-transparent border-white/10" data-testid="filter-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="replied">Replied</SelectItem>
            <SelectItem value="skipped">Skipped</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
        {stats && (
          <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
            <span>{stats.total} total</span>
            <span className="text-green-400">{stats.replied} replied</span>
          </div>
        )}
      </div>

      {hasSelection && (
        <div className="px-3 py-2 border-b border-white/5 bg-purple-900/20 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-purple-300 font-medium">{selectedIds.size} selected</span>
          <button onClick={selectAll} className="text-[11px] text-purple-400 hover:text-purple-300 underline" data-testid="button-select-all">
            {allSelected ? "Deselect all" : "Select all"}
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            {REACTIONS.map(r => (
              <button
                key={r.type}
                onClick={() => reactMutation.mutate({ commentIds: Array.from(selectedIds), reactionType: r.type })}
                className="h-7 w-7 rounded hover:bg-white/10 flex items-center justify-center text-sm transition-all"
                title={r.label}
                data-testid={`bulk-react-${r.type.toLowerCase()}`}
              >
                {r.emoji}
              </button>
            ))}
          </div>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-slate-400 hover:text-white p-1"
            data-testid="button-clear-selection"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto" data-testid="comments-list">
        <div className="p-3 space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-slate-600" />
            </div>
          ) : replies.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate-500">
              <MessageSquare className="h-8 w-8 mb-2 opacity-20" />
              <p className="text-xs">No comments found</p>
            </div>
          ) : (
            replies.map((reply) => {
              const sent = SENTIMENTS[reply.sentiment || "neutral"] || SENTIMENTS.neutral;
              const stCls = STATUS_COLORS[reply.status] || STATUS_COLORS.pending;
              const SentIcon = sent.Icon;
              const isSelected = selectedIds.has(reply.id);
              const isReplying = replyingTo === reply.id;

              return (
                <div
                  key={reply.id}
                  className={`rounded-lg border p-3 space-y-2 transition-all ${
                    isSelected ? "border-purple-500/50 bg-purple-900/10" : "border-white/5 bg-white/[0.02]"
                  }`}
                  data-testid={`comment-entry-${reply.id}`}
                >
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleSelect(reply.id)}
                      className={`h-4 w-4 rounded border flex items-center justify-center flex-shrink-0 transition-all ${
                        isSelected ? "bg-purple-600 border-purple-600" : "border-white/20 hover:border-white/40"
                      }`}
                      data-testid={`checkbox-comment-${reply.id}`}
                    >
                      {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
                    </button>
                    {reply.platform === "facebook" ? (
                      <Facebook className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                    ) : (
                      <Instagram className="h-3.5 w-3.5 text-pink-500 flex-shrink-0" />
                    )}
                    <span className="text-sm font-medium text-slate-200 truncate flex-1" data-testid={`commenter-name-${reply.id}`}>
                      {reply.commenterName || "Unknown"}
                    </span>
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 gap-0.5 border ${sent.cls}`}>
                      <SentIcon className="h-2.5 w-2.5" />{sent.label}
                    </Badge>
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 border ${stCls}`}>
                      {reply.status}
                    </Badge>
                  </div>

                  <div className="rounded bg-white/5 px-3 py-2">
                    <p className="text-sm text-slate-300" data-testid={`comment-text-${reply.id}`}>{reply.commentText}</p>
                  </div>

                  {reply.replyText && (
                    <div className="flex items-start gap-2 pl-3 border-l-2 border-purple-500/30">
                      <Bot className="h-3 w-3 text-purple-400 mt-1 flex-shrink-0" />
                      <p className="text-xs text-slate-400" data-testid={`reply-text-${reply.id}`}>{reply.replyText}</p>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[10px] text-slate-600" data-testid={`comment-time-${reply.id}`}>
                      {format(new Date(reply.createdAt), "MMM d, h:mm a")}
                    </span>
                    <div className="flex-1" />
                    <div className="flex items-center gap-0.5">
                      {REACTIONS.slice(0, 3).map(r => (
                        <button
                          key={r.type}
                          onClick={() => reactMutation.mutate({ commentIds: [reply.id], reactionType: r.type })}
                          className="h-6 w-6 rounded hover:bg-white/10 flex items-center justify-center text-xs"
                          title={r.label}
                          data-testid={`react-${r.type.toLowerCase()}-${reply.id}`}
                        >
                          {r.emoji}
                        </button>
                      ))}
                      <button
                        onClick={() => setReactingTo(reactingTo === reply.id ? null : reply.id)}
                        className="h-6 w-6 rounded hover:bg-white/10 flex items-center justify-center"
                        data-testid={`react-more-${reply.id}`}
                      >
                        <MoreHorizontal className="h-3 w-3 text-slate-500" />
                      </button>
                    </div>
                    <button
                      onClick={() => { setReplyingTo(isReplying ? null : reply.id); setReplyText(""); }}
                      className="text-[11px] text-purple-400 hover:text-purple-300 font-medium"
                      data-testid={`button-reply-comment-${reply.id}`}
                    >
                      Reply
                    </button>
                  </div>

                  {reactingTo === reply.id && (
                    <div className="flex items-center gap-1 pt-1 pl-6">
                      {REACTIONS.map(r => (
                        <button
                          key={r.type}
                          onClick={() => {
                            reactMutation.mutate({ commentIds: [reply.id], reactionType: r.type });
                            setReactingTo(null);
                          }}
                          className="h-8 w-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-base transition-transform hover:scale-125"
                          title={r.label}
                        >
                          {r.emoji}
                        </button>
                      ))}
                    </div>
                  )}

                  {isReplying && (
                    <div className="flex items-center gap-2 pt-1">
                      <Input
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder="Write a reply..."
                        className="h-8 text-xs bg-white/5 border-white/10 text-slate-200 flex-1"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && replyText.trim()) {
                            replyMutation.mutate({ commentId: reply.id, text: replyText });
                          }
                        }}
                        data-testid={`input-reply-${reply.id}`}
                      />
                      <Button
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => replyMutation.mutate({ commentId: reply.id, text: replyText })}
                        disabled={!replyText.trim() || replyMutation.isPending}
                        data-testid={`button-send-reply-${reply.id}`}
                      >
                        {replyMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                      </Button>
                      <button onClick={() => setReplyingTo(null)} className="text-slate-500 hover:text-white">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default function SmsDashboard() {
  const { activeAccountId } = useAccount();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const threadContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const [inboxTab, setInboxTab] = useState("messages");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedConv, setSelectedConv] = useState<{ contactPhone: string; channel: string } | null>(null);
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const [liveMessages, setLiveMessages] = useState<Message[]>([]);

  const numericAccountId = activeAccountId ?? undefined;

  const { data: accounts = [] } = useQuery<SubAccount[]>({ queryKey: ["/api/accounts"] });
  const currentAccount = accounts.find(a => a.id === activeAccountId);

  const [messageBody, setMessageBody] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [sendChannel, setSendChannel] = useState<string>("facebook");

  useEffect(() => {
    setSelectedConv(null);
    setMobileShowThread(false);
    setLiveMessages([]);
    setMessageBody("");
    setChannelFilter("all");
  }, [activeAccountId]);

  const { data: serverMessages = [], isLoading: messagesLoading, dataUpdatedAt } = useQuery<Message[]>({
    queryKey: ["/api/messages", numericAccountId],
    queryFn: () => api.getMessages(numericAccountId!),
    enabled: !!numericAccountId,
    refetchInterval: 30_000,
    staleTime: 0,
  });

  const { data: threadData = [] } = useQuery<{ contactPhone: string; channel: string; contactFirstName?: string; contactLastName?: string }[]>({
    queryKey: ["/api/conversations", numericAccountId],
    queryFn: () => api.getConversationThreads(numericAccountId!),
    enabled: !!numericAccountId,
    refetchInterval: 30_000,
    staleTime: 2000,
  });

  useEffect(() => {
    setLiveMessages([]);
  }, [dataUpdatedAt]);

  useSSE(numericAccountId, useCallback((msg: any) => {
    setLiveMessages(prev => [...prev, {
      ...msg,
      id: Date.now() + Math.random(),
      createdAt: msg.createdAt || new Date().toISOString(),
    } as Message]);
  }, []));

  const contactNameMap = useMemo(() => {
    const map = new Map<string, { firstName?: string; lastName?: string }>();
    for (const t of threadData) {
      map.set(`${t.contactPhone}__${t.channel}`, { firstName: t.contactFirstName, lastName: t.contactLastName });
    }
    return map;
  }, [threadData]);

  const allMessages = useMemo(() => {
    const merged = [...serverMessages];
    for (const lm of liveMessages) {
      const isDup = merged.some(m =>
        m.contactPhone === lm.contactPhone && m.body === lm.body && m.direction === lm.direction &&
        Math.abs(new Date(m.createdAt).getTime() - new Date(lm.createdAt).getTime()) < 5000
      );
      if (!isDup) merged.push(lm);
    }
    return merged;
  }, [serverMessages, liveMessages]);

  const conversations = useMemo(() => {
    const convMap = new Map<string, {
      contactPhone: string; channel: string; lastMessage: string;
      lastTime: Date; unread: number; firstName?: string; lastName?: string;
    }>();
    for (const msg of allMessages) {
      const ch = msg.channel || "sms";
      const key = `${msg.contactPhone}__${ch}`;
      const existing = convMap.get(key);
      const msgTime = new Date(msg.createdAt);
      const names = contactNameMap.get(key);
      if (!existing || msgTime > existing.lastTime) {
        convMap.set(key, {
          contactPhone: msg.contactPhone, channel: ch,
          lastMessage: (msg.body || "").slice(0, 80), lastTime: msgTime,
          unread: (existing?.unread || 0) + (msg.direction === "inbound" && msg.status !== "read" ? 1 : 0),
          firstName: names?.firstName, lastName: names?.lastName,
        });
      } else if (msg.direction === "inbound" && msg.status !== "read") {
        existing.unread += 1;
      }
    }
    let result = Array.from(convMap.values());
    if (channelFilter !== "all") result = result.filter(c => c.channel === channelFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c =>
        displayName(c.contactPhone, c.channel, c.firstName, c.lastName).toLowerCase().includes(q) ||
        c.lastMessage.toLowerCase().includes(q)
      );
    }
    return result.sort((a, b) => b.lastTime.getTime() - a.lastTime.getTime());
  }, [allMessages, contactNameMap, channelFilter, searchQuery]);

  const threadMessages = useMemo(() => {
    if (!selectedConv) return [];
    return allMessages
      .filter(m => m.contactPhone === selectedConv.contactPhone && (m.channel || "sms") === selectedConv.channel)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [allMessages, selectedConv]);

  const selectConv = useCallback((conv: { contactPhone: string; channel: string }) => {
    setSelectedConv(conv);
    setMobileShowThread(true);
    setSendChannel(conv.channel);
    setEmailSubject("");
  }, []);

  const handleNewEmail = useCallback(() => {
    const recipient = window.prompt("Recipient email address:");
    if (!recipient) return;
    const trimmed = recipient.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast({ variant: "destructive", title: "Invalid email", description: "Please enter a valid email address." });
      return;
    }
    selectConv({ contactPhone: trimmed.toLowerCase(), channel: "email" });
  }, [selectConv, toast]);

  useEffect(() => {
    if (!selectedConv && conversations.length > 0) {
      selectConv(conversations[0]);
      setMobileShowThread(false);
    }
  }, [conversations.length]);

  const convKey = selectedConv ? `${selectedConv.contactPhone}__${selectedConv.channel}` : "";

  const handleThreadScroll = useCallback(() => {
    const el = threadContainerRef.current;
    if (!el) return;
    const threshold = 80;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollIntoView({ behavior: "auto" });
    isNearBottomRef.current = true;
  }, [convKey]);

  useEffect(() => {
    if (isNearBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [threadMessages.length]);

  const [isSending, setIsSending] = useState(false);

  const syncMut = useMutation({
    mutationFn: async () => {
      if (!numericAccountId) throw new Error("No account");
      const res = await fetch(`/api/sync-dms/${numericAccountId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxPages: 15 }), credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Sync failed");
      return res.json();
    },
    onSuccess: (d: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      toast({ title: "Sync complete", description: `${d.totalMessagesSynced} msgs, ${d.contactsCreated} contacts` });
    },
    onError: (e: Error) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  async function handleSend() {
    if (!activeAccountId || !selectedConv || !messageBody.trim()) return;
    if (sendChannel === "email" && !emailSubject.trim()) {
      toast({ variant: "destructive", title: "Subject required", description: "Please enter a subject for your email." });
      return;
    }
    setIsSending(true);
    const optimisticBody = messageBody;
    const optimisticSubject = emailSubject;
    const optimisticRow: Message = {
      id: -Date.now(),
      subAccountId: activeAccountId,
      direction: "outbound",
      body: sendChannel === "email" ? `${optimisticSubject}\n\n${optimisticBody}` : optimisticBody,
      status: "sending",
      createdAt: new Date(),
      contactPhone: selectedConv.contactPhone,
      channel: sendChannel,
      messageSid: null,
      threadId: null,
      traceId: null,
      pageId: null,
      senderId: null,
      errorMessage: null,
    };
    setLiveMessages(prev => [...prev, optimisticRow]);
    try {
      let res: Response;
      if (sendChannel === "email") {
        res = await fetch("/api/messages/email", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({
            subAccountId: activeAccountId,
            toEmail: selectedConv.contactPhone,
            subject: optimisticSubject,
            body: optimisticBody,
          }),
        });
      } else {
        res = await fetch("/api/messages/send", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({
            subAccountId: activeAccountId, contactPhone: selectedConv.contactPhone,
            body: optimisticBody, channel: sendChannel, direction: "outbound", status: "sent",
          }),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.reason || "Send failed");
      queryClient.invalidateQueries({ queryKey: ["/api/messages", numericAccountId] });
      setMessageBody("");
      setEmailSubject("");
      toast({ title: "Sent" });
    } catch (err: any) {
      setLiveMessages(prev => prev.filter(m => m.id !== optimisticRow.id));
      const msg = typeof err?.message === "string" ? err.message : "Send failed";
      const friendly = msg === "not_configured"
        ? "Email is not configured for this account. Add a SendGrid API key in Integrations."
        : msg;
      toast({ variant: "destructive", title: "Send failed", description: friendly });
    } finally { setIsSending(false); }
  }

  const selNames = selectedConv ? contactNameMap.get(`${selectedConv.contactPhone}__${selectedConv.channel}`) : undefined;
  const selDisplayName = selectedConv ? displayName(selectedConv.contactPhone, selectedConv.channel, selNames?.firstName, selNames?.lastName) : "";
  const selInitial = selectedConv ? avatarInitial(selectedConv.contactPhone, selectedConv.channel, selNames?.firstName) : "";

  const channelCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0, facebook: 0, instagram: 0, sms: 0, whatsapp: 0, telegram: 0, email: 0 };
    const seen = new Set<string>();
    for (const msg of allMessages) {
      const ch = msg.channel || "sms";
      const key = `${msg.contactPhone}__${ch}`;
      if (!seen.has(key)) { seen.add(key); counts.all++; if (counts[ch] !== undefined) counts[ch]++; }
    }
    return counts;
  }, [allMessages]);

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col bg-[#0a0a16]">
      <Tabs value={inboxTab} onValueChange={setInboxTab} className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 h-12 border-b border-white/5 bg-[#0d0d1a] flex-shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold text-white">Inbox</h1>
            {currentAccount && <span className="text-[11px] text-slate-500 hidden sm:inline">{currentAccount.name}</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <TabsList className="bg-white/5 border border-white/10 p-0.5 h-7" data-testid="inbox-tab-list">
              <TabsTrigger value="messages" className="text-[11px] h-6 px-2.5 data-[state=active]:bg-white/10 data-[state=active]:text-white" data-testid="tab-messages">Messages</TabsTrigger>
              <TabsTrigger value="comments" className="text-[11px] h-6 px-2.5 data-[state=active]:bg-white/10 data-[state=active]:text-white" data-testid="tab-comments">Comments</TabsTrigger>
            </TabsList>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-slate-400 hover:text-white"
              onClick={handleNewEmail} data-testid="button-new-email" title="New email">
              <Mail className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-slate-400 hover:text-white"
              onClick={() => syncMut.mutate()} disabled={syncMut.isPending} data-testid="button-sync-dms" title="Sync DMs from Meta/Instagram">
              <RefreshCw className={`h-3.5 w-3.5 ${syncMut.isPending ? "animate-spin" : ""}`} />
            </Button>
            <a href="/integrations" className="h-7 w-7 p-0 flex items-center justify-center text-slate-400 hover:text-white rounded-md hover:bg-white/10 transition-colors" title="Channel Settings" data-testid="link-channel-settings">
              <Settings className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>

        <TabsContent value="messages" className="flex-1 mt-0 min-h-0">
          <div className="flex h-full">
            <div className={`w-full md:w-80 lg:w-[340px] border-r border-white/5 flex flex-col bg-[#0d0d1a] flex-shrink-0 min-h-0 ${mobileShowThread ? "hidden md:flex" : "flex"}`}>
              <div className="p-2.5 space-y-2 border-b border-white/5 flex-shrink-0">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                  <Input placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-7 pl-8 text-xs bg-white/5 border-white/10 placeholder:text-slate-600 text-slate-200" data-testid="input-search" />
                </div>
                <div className="flex gap-1 overflow-x-auto pb-0.5">
                  {CHANNELS.filter(ch => ch.key === "all" || ["facebook","instagram","whatsapp","telegram","sms","email"].includes(ch.key)).map(ch => {
                    const Icon = ch.icon;
                    const active = channelFilter === ch.key;
                    const cnt = channelCounts[ch.key] || 0;
                    return (
                      <button key={ch.key} onClick={() => setChannelFilter(ch.key)}
                        className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium whitespace-nowrap transition-all ${
                          active ? `${ch.bg} text-white` : "bg-white/5 text-slate-500 hover:bg-white/10 hover:text-slate-300"
                        }`} data-testid={`filter-channel-${ch.key}`}>
                        <Icon className="h-3 w-3" />{ch.label}
                        {cnt > 0 && <span className={active ? "text-white/60" : "text-slate-600"}>{cnt}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto" data-testid="conversation-list">
                {messagesLoading ? (
                  <div className="flex items-center justify-center h-24"><Loader2 className="h-5 w-5 animate-spin text-slate-600" /></div>
                ) : conversations.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-24 text-slate-600 text-xs px-4 text-center">
                    <MessageSquare className="h-6 w-6 mb-1.5 opacity-20" />
                    {channelFilter !== "all" ? `No ${CHANNELS.find(c=>c.key===channelFilter)?.label} conversations` : "No conversations"}
                  </div>
                ) : conversations.map(conv => {
                  const isActive = selectedConv?.contactPhone === conv.contactPhone && selectedConv?.channel === conv.channel;
                  const name = displayName(conv.contactPhone, conv.channel, conv.firstName, conv.lastName);
                  const init = avatarInitial(conv.contactPhone, conv.channel, conv.firstName);
                  return (
                    <button key={`${conv.contactPhone}__${conv.channel}`}
                      className={`w-full text-left px-3 py-2.5 transition-colors border-b border-white/[0.03] ${
                        isActive ? "bg-white/[0.07] border-l-2 border-l-purple-500" : "hover:bg-white/[0.04]"
                      }`} onClick={() => selectConv(conv)} data-testid={`conv-${conv.channel}-${conv.contactPhone.slice(-4)}`}>
                      <div className="flex items-center gap-2.5">
                        <div className={`h-9 w-9 rounded-full ${channelBg(conv.channel)} flex items-center justify-center flex-shrink-0`}>
                          <span className="text-xs font-semibold text-white">{init}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[13px] font-medium text-slate-200 truncate">{name}</span>
                            <span className="text-[10px] text-slate-600 ml-2 flex-shrink-0">{formatTime(conv.lastTime)}</span>
                          </div>
                          <p className="text-[11px] text-slate-500 truncate">{conv.lastMessage || "..."}</p>
                        </div>
                        {conv.unread > 0 && (
                          <span className="h-4 min-w-[16px] px-1 bg-purple-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center flex-shrink-0">
                            {conv.unread}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={`flex-1 flex flex-col bg-[#0f0f1e] min-w-0 ${!mobileShowThread ? "hidden md:flex" : "flex"}`}>
              {selectedConv ? (
                <>
                  <div className="px-4 py-2.5 border-b border-white/5 flex items-center gap-3 bg-[#0d0d1a] flex-shrink-0">
                    <button className="md:hidden p-1 rounded hover:bg-white/10 text-slate-400"
                      onClick={() => setMobileShowThread(false)} data-testid="button-back">
                      <ArrowLeft className="h-5 w-5" />
                    </button>
                    <div className={`h-8 w-8 rounded-full ${channelBg(selectedConv.channel)} flex items-center justify-center`}>
                      <span className="text-xs font-semibold text-white" data-testid="avatar-initial">{selInitial}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-sm font-semibold text-white truncate">{selDisplayName}</h2>
                      <div className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                        <span className="text-[10px] text-slate-500 capitalize">{selectedConv.channel}</span>
                        {!isSocialId(selectedConv.contactPhone, selectedConv.channel) && (
                          <span className="text-[10px] text-slate-600 ml-1">{selectedConv.contactPhone}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto px-4 py-3" data-testid="message-thread" ref={threadContainerRef} onScroll={handleThreadScroll}>
                    <div className="space-y-2 flex flex-col">
                      {threadMessages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-32 text-slate-600">
                          <MessageSquare className="h-6 w-6 mb-1.5 opacity-20" />
                          <p className="text-xs">No messages yet</p>
                        </div>
                      ) : threadMessages.map(msg => (
                        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.12 }}
                          key={msg.id} className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[75%] flex flex-col ${msg.direction === "outbound" ? "items-end" : "items-start"}`}>
                            <div className={`rounded-2xl px-3.5 py-2 ${
                              msg.direction === "outbound"
                                ? "bg-purple-600 text-white rounded-br-md"
                                : "bg-white/[0.06] border border-white/[0.08] text-slate-200 rounded-bl-md"
                            }`}>
                              <p className="text-[13px] leading-relaxed">{msg.body}</p>
                            </div>
                            <div className="flex items-center gap-1 mt-0.5 px-1">
                              <span className="text-[9px] text-slate-600">{format(new Date(msg.createdAt), "h:mm a")}</span>
                              {msg.direction === "outbound" && msg.status && (
                                <span className={`text-[9px] ${msg.status === "read" ? "text-blue-400" : msg.status === "delivered" ? "text-green-500" : "text-slate-600"}`}>
                                  {msg.status === "read" ? <CheckCheck className="h-2.5 w-2.5 inline" /> : `· ${msg.status}`}
                                </span>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      ))}
                      <div ref={scrollRef} />
                    </div>
                  </div>

                  <div className="px-3 py-2.5 border-t border-white/5 bg-[#0d0d1a] flex-shrink-0">
                    {sendChannel === "email" && (
                      <div className="mb-2">
                        <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)}
                          placeholder="Subject"
                          className="h-8 text-sm bg-white/5 border-white/10 text-slate-200 placeholder:text-slate-600 rounded-lg"
                          data-testid="input-email-subject" />
                      </div>
                    )}
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <Textarea value={messageBody} onChange={(e) => setMessageBody(e.target.value)}
                          placeholder={sendChannel === "email" ? "Write your email…" : `Message via ${CHANNELS.find(c=>c.key===sendChannel)?.label || sendChannel}...`}
                          className={`${sendChannel === "email" ? "min-h-[120px] max-h-[260px]" : "min-h-[40px] max-h-[100px]"} resize-none text-sm bg-white/5 border-white/10 text-slate-200 placeholder:text-slate-600 rounded-xl`}
                          onKeyDown={(e) => {
                            if (sendChannel === "email") return;
                            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
                          }}
                          data-testid="input-message" />
                      </div>
                      <Button size="icon" onClick={handleSend}
                        disabled={isSending || !messageBody.trim() || (sendChannel === "email" && !emailSubject.trim())}
                        className={`h-10 w-10 rounded-xl ${channelBg(sendChannel)} hover:opacity-90`} data-testid="button-send">
                        {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </Button>
                    </div>
                    <div className="flex items-center justify-between mt-1 px-0.5">
                      <span className="text-[9px] text-slate-600">
                        {sendChannel === "email" ? "Subject + body required" : "Enter to send"}
                      </span>
                      <span className="text-[9px] text-slate-600">
                        {sendChannel === "email" ? `${messageBody.length} chars` : `${messageBody.length}/1600`}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-600">
                  <div className="h-14 w-14 rounded-full bg-white/5 flex items-center justify-center mb-3">
                    <MessageSquare className="h-7 w-7 opacity-30" />
                  </div>
                  <p className="text-sm font-medium text-slate-400">Select a conversation</p>
                  <p className="text-[11px] mt-1">Choose from the list to start messaging</p>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="comments" className="flex-1 mt-0 min-h-0 overflow-hidden">
          <CommentsView subAccountId={numericAccountId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
