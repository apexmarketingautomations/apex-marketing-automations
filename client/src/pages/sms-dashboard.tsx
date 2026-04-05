import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format, isToday, isYesterday } from "date-fns";
import {
  Send, Phone, User, MessageSquare, Loader2, Instagram,
  MessageCircle, Bot, Facebook, RefreshCw, Search, ArrowLeft,
  CheckCheck, Filter, BarChart3, ThumbsUp, ThumbsDown, Minus,
  HelpCircle, ShieldAlert, Clock, CheckCircle2
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import type { SubAccount, Message, CommentAutoReply } from "@shared/schema";

const formSchema = z.object({
  subAccountId: z.string().min(1),
  contactPhone: z.string().min(1),
  messageBody: z.string().min(1).max(1600),
  channel: z.enum(["sms", "instagram", "whatsapp", "facebook"]).default("sms"),
});

type ChannelFilter = "all" | "sms" | "facebook" | "instagram" | "whatsapp";

const CHANNEL_META: Record<string, { label: string; icon: typeof Phone; color: string; activeBg: string }> = {
  all: { label: "All", icon: MessageSquare, color: "text-slate-400", activeBg: "bg-slate-600" },
  facebook: { label: "Facebook", icon: Facebook, color: "text-blue-400", activeBg: "bg-blue-600" },
  instagram: { label: "Instagram", icon: Instagram, color: "text-pink-400", activeBg: "bg-pink-600" },
  sms: { label: "SMS", icon: Phone, color: "text-emerald-400", activeBg: "bg-emerald-600" },
  whatsapp: { label: "WhatsApp", icon: MessageCircle, color: "text-green-400", activeBg: "bg-green-600" },
};

function formatConvTime(date: Date) {
  if (isToday(date)) return format(date, "h:mm a");
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMM d");
}

function isSocialPsid(phone: string, channel: string) {
  return (channel === "facebook" || channel === "instagram") && /^\d{10,20}$/.test(phone);
}

function getDisplayName(phone: string, channel: string, firstName?: string, lastName?: string) {
  const hasRealName = firstName && !firstName.startsWith("FB User") && !firstName.startsWith("IG User") && !firstName.startsWith("IG ");
  if (hasRealName) return `${firstName}${lastName ? ` ${lastName}` : ""}`;
  if (channel === "facebook" || channel === "instagram") return `${channel === "facebook" ? "FB" : "IG"} Contact ...${phone.slice(-4)}`;
  return phone;
}

function getInitials(phone: string, channel: string, firstName?: string) {
  const hasRealName = firstName && !firstName.startsWith("FB User") && !firstName.startsWith("IG User") && !firstName.startsWith("IG ");
  if (hasRealName) return firstName.charAt(0).toUpperCase();
  if (channel === "facebook") return "F";
  if (channel === "instagram") return "I";
  return phone.charAt(phone.length - 1) || "?";
}

function getChannelColor(channel: string) {
  if (channel === "facebook") return "bg-blue-600";
  if (channel === "instagram") return "bg-gradient-to-tr from-purple-600 to-pink-500";
  if (channel === "whatsapp") return "bg-green-600";
  if (channel === "vapi-sms") return "bg-purple-600";
  return "bg-emerald-600";
}

interface CommentStats {
  total: number;
  replied: number;
  skipped: number;
  failed: number;
  disabled: number;
  byPlatform: { facebook: number; instagram: number };
  bySentiment: { positive: number; negative: number; neutral: number; question: number; spam: number };
}

const sentimentConfig: Record<string, { label: string; color: string; icon: typeof ThumbsUp }> = {
  positive: { label: "Positive", color: "text-green-400 bg-green-400/10 border-green-400/20", icon: ThumbsUp },
  negative: { label: "Negative", color: "text-red-400 bg-red-400/10 border-red-400/20", icon: ThumbsDown },
  neutral: { label: "Neutral", color: "text-slate-400 bg-slate-400/10 border-slate-400/20", icon: Minus },
  question: { label: "Question", color: "text-blue-400 bg-blue-400/10 border-blue-400/20", icon: HelpCircle },
  spam: { label: "Spam", color: "text-amber-400 bg-amber-400/10 border-amber-400/20", icon: ShieldAlert },
};

const statusConfig: Record<string, { label: string; color: string }> = {
  replied: { label: "Replied", color: "text-green-400 bg-green-400/10 border-green-400/20" },
  skipped: { label: "Skipped", color: "text-slate-400 bg-slate-400/10 border-slate-400/20" },
  failed: { label: "Failed", color: "text-red-400 bg-red-400/10 border-red-400/20" },
  pending: { label: "Pending", color: "text-amber-400 bg-amber-400/10 border-amber-400/20" },
  disabled: { label: "Disabled", color: "text-slate-500 bg-slate-500/10 border-slate-500/20" },
};

function CommentsView({ subAccountId }: { subAccountId?: number }) {
  const [platformFilter, setPlatformFilter] = useState("all");
  const [sentimentFilter, setSentimentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const queryParams = new URLSearchParams();
  if (platformFilter !== "all") queryParams.set("platform", platformFilter);
  if (sentimentFilter !== "all") queryParams.set("sentiment", sentimentFilter);
  if (statusFilter !== "all") queryParams.set("status", statusFilter);
  queryParams.set("limit", "100");

  const { data: replies = [], isLoading } = useQuery<CommentAutoReply[]>({
    queryKey: ["/api/comment-bot/replies", subAccountId, platformFilter, sentimentFilter, statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/comment-bot/replies?${queryParams.toString()}`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
    enabled: !!subAccountId,
    staleTime: 30_000,
  });

  const { data: stats } = useQuery<CommentStats>({
    queryKey: ["/api/comment-bot/stats", subAccountId],
    queryFn: async () => {
      const res = await fetch("/api/comment-bot/stats", { credentials: "include" });
      return res.ok ? res.json() : null;
    },
    enabled: !!subAccountId,
    staleTime: 30_000,
  });

  return (
    <div className="flex flex-col h-full">
      {stats && (
        <div className="px-4 py-3 border-b border-white/5 flex items-center gap-4 flex-wrap text-xs">
          <div className="flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5 text-slate-500" />
            <span className="text-slate-500">Total:</span>
            <span className="font-semibold text-slate-300" data-testid="stat-total">{stats.total}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
            <span className="font-semibold text-green-400" data-testid="stat-replied">{stats.replied}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-slate-500" />
            <span className="font-semibold text-slate-400" data-testid="stat-skipped">{stats.skipped}</span>
          </div>
          <div className="h-3 w-px bg-white/10" />
          <div className="flex items-center gap-1.5">
            <Facebook className="h-3.5 w-3.5 text-blue-500" />
            <span className="font-medium text-slate-300" data-testid="stat-facebook">{stats.byPlatform.facebook}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Instagram className="h-3.5 w-3.5 text-pink-500" />
            <span className="font-medium text-slate-300" data-testid="stat-instagram">{stats.byPlatform.instagram}</span>
          </div>
        </div>
      )}

      <div className="px-4 py-2 border-b border-white/5 flex items-center gap-2 flex-wrap" data-testid="comments-filters">
        <Filter className="h-3.5 w-3.5 text-slate-500" />
        <Select value={platformFilter} onValueChange={setPlatformFilter}>
          <SelectTrigger className="h-7 w-[120px] text-xs bg-transparent border-white/10" data-testid="filter-platform">
            <SelectValue placeholder="Platform" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Platforms</SelectItem>
            <SelectItem value="facebook">Facebook</SelectItem>
            <SelectItem value="instagram">Instagram</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sentimentFilter} onValueChange={setSentimentFilter}>
          <SelectTrigger className="h-7 w-[110px] text-xs bg-transparent border-white/10" data-testid="filter-sentiment">
            <SelectValue placeholder="Sentiment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sentiment</SelectItem>
            <SelectItem value="positive">Positive</SelectItem>
            <SelectItem value="negative">Negative</SelectItem>
            <SelectItem value="neutral">Neutral</SelectItem>
            <SelectItem value="question">Question</SelectItem>
            <SelectItem value="spam">Spam</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-7 w-[100px] text-xs bg-transparent border-white/10" data-testid="filter-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="replied">Replied</SelectItem>
            <SelectItem value="skipped">Skipped</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-slate-600" />
            </div>
          ) : replies.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate-500">
              <MessageSquare className="h-10 w-10 mb-2 opacity-20" />
              <p className="text-sm">No comments found</p>
              <p className="text-xs mt-1">Comments from Facebook and Instagram posts will appear here</p>
            </div>
          ) : (
            replies.map((reply) => {
              const sentiment = sentimentConfig[reply.sentiment || "neutral"] || sentimentConfig.neutral;
              const status = statusConfig[reply.status] || statusConfig.pending;
              const SentimentIcon = sentiment.icon;
              return (
                <div
                  key={reply.id}
                  className="rounded-lg border border-white/5 bg-[#1a1a2e]/50 p-3 space-y-2"
                  data-testid={`comment-entry-${reply.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {reply.platform === "facebook" ? (
                        <Facebook className="h-4 w-4 text-blue-500 flex-shrink-0" />
                      ) : (
                        <Instagram className="h-4 w-4 text-pink-500 flex-shrink-0" />
                      )}
                      <span className="text-sm font-medium truncate text-slate-200" data-testid={`commenter-name-${reply.id}`}>
                        {reply.commenterName || "Unknown User"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 gap-1 border ${sentiment.color}`} data-testid={`sentiment-badge-${reply.id}`}>
                        <SentimentIcon className="h-2.5 w-2.5" />
                        {sentiment.label}
                      </Badge>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 border ${status.color}`} data-testid={`status-badge-${reply.id}`}>
                        {status.label}
                      </Badge>
                    </div>
                  </div>
                  <div className="rounded-md bg-white/5 px-3 py-2">
                    <p className="text-sm text-slate-300" data-testid={`comment-text-${reply.id}`}>{reply.commentText}</p>
                  </div>
                  {reply.replyText && (
                    <div className="flex items-start gap-2 pl-4 border-l-2 border-purple-500/30">
                      <Bot className="h-3.5 w-3.5 text-purple-400 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-slate-400" data-testid={`reply-text-${reply.id}`}>{reply.replyText}</p>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1">
                    <span className="capitalize">{reply.platform}</span>
                    <span data-testid={`comment-time-${reply.id}`}>{format(new Date(reply.createdAt), "MMM d, h:mm a")}</span>
                  </div>
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

  const [inboxTab, setInboxTab] = useState<string>("messages");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedConv, setSelectedConv] = useState<{ contactPhone: string; channel: string } | null>(null);
  const [mobileShowThread, setMobileShowThread] = useState(false);

  const numericAccountId = activeAccountId ?? undefined;

  const { data: accounts = [] } = useQuery<SubAccount[]>({
    queryKey: ["/api/accounts"],
  });
  const currentAccount = accounts.find(a => a.id === activeAccountId);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      subAccountId: activeAccountId ? String(activeAccountId) : "",
      contactPhone: "",
      messageBody: "",
      channel: "facebook",
    },
  });

  useEffect(() => {
    setSelectedConv(null);
    setMobileShowThread(false);
    form.setValue("subAccountId", activeAccountId ? String(activeAccountId) : "");
    form.setValue("contactPhone", "");
    form.setValue("messageBody", "");
  }, [activeAccountId]);

  const { data: serverMessages = [], isLoading: messagesLoading } = useQuery<Message[]>({
    queryKey: ["/api/messages", numericAccountId],
    queryFn: () => api.getMessages(numericAccountId!),
    enabled: !!numericAccountId,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const { data: threadData = [] } = useQuery<{ contactPhone: string; channel: string; contactFirstName?: string; contactLastName?: string }[]>({
    queryKey: ["/api/conversations", numericAccountId],
    queryFn: () => api.getConversationThreads(numericAccountId!),
    enabled: !!numericAccountId,
    refetchInterval: 10_000,
    staleTime: 2000,
  });

  const contactNameMap = useMemo(() => {
    const map = new Map<string, { firstName?: string; lastName?: string }>();
    for (const t of threadData) {
      map.set(`${t.contactPhone}__${t.channel}`, { firstName: t.contactFirstName, lastName: t.contactLastName });
    }
    return map;
  }, [threadData]);

  const conversations = useMemo(() => {
    const convMap = new Map<string, {
      contactPhone: string; channel: string; lastMessage: string;
      lastTime: Date; unread: number; firstName?: string; lastName?: string;
    }>();

    for (const msg of serverMessages) {
      const ch = msg.channel || "sms";
      const key = `${msg.contactPhone}__${ch}`;
      const existing = convMap.get(key);
      const msgTime = new Date(msg.createdAt);
      const names = contactNameMap.get(key);

      if (!existing || msgTime > existing.lastTime) {
        convMap.set(key, {
          contactPhone: msg.contactPhone,
          channel: ch,
          lastMessage: (msg.body || "").slice(0, 80),
          lastTime: msgTime,
          unread: (existing?.unread || 0) + (msg.direction === "inbound" && msg.status !== "read" ? 1 : 0),
          firstName: names?.firstName,
          lastName: names?.lastName,
        });
      } else if (msg.direction === "inbound" && msg.status !== "read") {
        existing.unread += 1;
      }
    }

    let result = Array.from(convMap.values());

    if (channelFilter !== "all") {
      result = result.filter(c => c.channel === channelFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c => {
        const name = getDisplayName(c.contactPhone, c.channel, c.firstName, c.lastName).toLowerCase();
        return name.includes(q) || c.lastMessage.toLowerCase().includes(q) || c.contactPhone.includes(q);
      });
    }

    return result.sort((a, b) => b.lastTime.getTime() - a.lastTime.getTime());
  }, [serverMessages, contactNameMap, channelFilter, searchQuery]);

  const threadMessages = useMemo(() => {
    if (!selectedConv) return [];
    return serverMessages
      .filter(m => m.contactPhone === selectedConv.contactPhone && (m.channel || "sms") === selectedConv.channel)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [serverMessages, selectedConv]);

  const selectConversation = useCallback((conv: { contactPhone: string; channel: string }) => {
    setSelectedConv(conv);
    setMobileShowThread(true);
    form.setValue("contactPhone", conv.contactPhone);
    form.setValue("channel", conv.channel as any);
  }, [form]);

  useEffect(() => {
    if (!selectedConv && conversations.length > 0) {
      selectConversation(conversations[0]);
      setMobileShowThread(false);
    }
  }, [conversations.length]);

  const convKey = selectedConv ? `${selectedConv.contactPhone}__${selectedConv.channel}` : "";
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [threadMessages.length, convKey]);

  const [isSending, setIsSending] = useState(false);

  const syncDmsMutation = useMutation({
    mutationFn: async () => {
      if (!numericAccountId) throw new Error("No account selected");
      const res = await fetch(`/api/sync-dms/${numericAccountId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxPages: 15 }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Sync failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      toast({
        title: "Sync Complete",
        description: `${data.totalMessagesSynced} messages, ${data.contactsCreated} contacts from ${data.totalConversations} conversations`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Sync Failed", description: err.message, variant: "destructive" });
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!activeAccountId) return;
    setIsSending(true);
    try {
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          subAccountId: activeAccountId,
          contactPhone: values.contactPhone,
          body: values.messageBody,
          channel: values.channel,
          direction: "outbound",
          status: "sent",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      queryClient.invalidateQueries({ queryKey: ["/api/messages", numericAccountId] });
      form.resetField("messageBody");
      toast({ title: "Message sent" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Send failed", description: error.message });
    } finally {
      setIsSending(false);
    }
  }

  const selectedNames = selectedConv ? contactNameMap.get(`${selectedConv.contactPhone}__${selectedConv.channel}`) : undefined;
  const selectedDisplayName = selectedConv ? getDisplayName(selectedConv.contactPhone, selectedConv.channel, selectedNames?.firstName, selectedNames?.lastName) : "";
  const selectedInitial = selectedConv ? getInitials(selectedConv.contactPhone, selectedConv.channel, selectedNames?.firstName) : "";

  const channelCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0, facebook: 0, instagram: 0, sms: 0, whatsapp: 0 };
    const seen = new Set<string>();
    for (const msg of serverMessages) {
      const ch = msg.channel || "sms";
      const key = `${msg.contactPhone}__${ch}`;
      if (!seen.has(key)) {
        seen.add(key);
        counts.all++;
        if (counts[ch] !== undefined) counts[ch]++;
      }
    }
    return counts;
  }, [serverMessages]);

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col">
      <Tabs value={inboxTab} onValueChange={setInboxTab} className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-[#0d0d1a]">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-white tracking-tight">Inbox</h1>
            {currentAccount && (
              <span className="text-xs text-slate-500 hidden sm:inline">{currentAccount.name}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <TabsList className="bg-white/5 border border-white/10 p-0.5 h-8" data-testid="inbox-tab-list">
              <TabsTrigger value="messages" className="text-xs h-7 px-3 data-[state=active]:bg-white/10 data-[state=active]:text-white" data-testid="tab-messages">
                Messages
              </TabsTrigger>
              <TabsTrigger value="comments" className="text-xs h-7 px-3 data-[state=active]:bg-white/10 data-[state=active]:text-white" data-testid="tab-comments">
                Comments
              </TabsTrigger>
            </TabsList>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-slate-400 hover:text-white"
              onClick={() => syncDmsMutation.mutate()}
              disabled={syncDmsMutation.isPending}
              data-testid="button-sync-dms"
              title="Sync messages from Meta"
            >
              <RefreshCw className={`h-4 w-4 ${syncDmsMutation.isPending ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        <TabsContent value="messages" className="flex-1 mt-0 min-h-0">
          <div className="flex h-full">
            <div className={`w-full md:w-80 lg:w-96 border-r border-white/5 flex flex-col bg-[#0d0d1a] ${mobileShowThread ? "hidden md:flex" : "flex"}`}>
              <div className="p-3 space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                  <Input
                    placeholder="Search conversations..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 pl-9 text-xs bg-white/5 border-white/10 placeholder:text-slate-600 text-slate-200"
                    data-testid="input-search"
                  />
                </div>

                <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
                  {(Object.entries(CHANNEL_META) as [ChannelFilter, typeof CHANNEL_META["all"]][]).map(([key, meta]) => {
                    const Icon = meta.icon;
                    const isActive = channelFilter === key;
                    const count = channelCounts[key] || 0;
                    if (key !== "all" && count === 0) return null;
                    return (
                      <button
                        key={key}
                        onClick={() => setChannelFilter(key)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-all ${
                          isActive
                            ? `${meta.activeBg} text-white`
                            : "bg-white/5 text-slate-400 hover:bg-white/10"
                        }`}
                        data-testid={`filter-channel-${key}`}
                      >
                        <Icon className="h-3 w-3" />
                        {meta.label}
                        {count > 0 && <span className={`text-[10px] ${isActive ? "text-white/70" : "text-slate-500"}`}>{count}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto" data-testid="conversation-list">
                {messagesLoading ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="h-6 w-6 animate-spin text-slate-600" />
                  </div>
                ) : conversations.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 text-slate-500 px-4 text-center">
                    <MessageSquare className="h-8 w-8 mb-2 opacity-20" />
                    <p className="text-xs">
                      {channelFilter !== "all" ? `No ${CHANNEL_META[channelFilter].label} conversations` : "No conversations yet"}
                    </p>
                  </div>
                ) : (
                  conversations.map((conv) => {
                    const isActive = selectedConv?.contactPhone === conv.contactPhone && selectedConv?.channel === conv.channel;
                    const displayName = getDisplayName(conv.contactPhone, conv.channel, conv.firstName, conv.lastName);
                    const initial = getInitials(conv.contactPhone, conv.channel, conv.firstName);
                    const channelColor = getChannelColor(conv.channel);

                    return (
                      <button
                        key={`${conv.contactPhone}__${conv.channel}`}
                        className={`w-full text-left px-3 py-3 transition-colors border-b border-white/[0.03] ${
                          isActive
                            ? "bg-white/[0.08] border-l-2 border-l-purple-500"
                            : "hover:bg-white/[0.04]"
                        }`}
                        onClick={() => selectConversation(conv)}
                        data-testid={`conv-${conv.channel}-${conv.contactPhone.slice(-4)}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="relative flex-shrink-0">
                            <div className={`h-10 w-10 rounded-full ${channelColor} flex items-center justify-center`}>
                              <span className="text-sm font-semibold text-white">{initial}</span>
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-sm font-medium text-slate-200 truncate" data-testid={`conv-name-${conv.contactPhone.slice(-4)}`}>
                                {displayName}
                              </span>
                              <span className="text-[10px] text-slate-500 flex-shrink-0 ml-2">
                                {formatConvTime(conv.lastTime)}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 truncate">{conv.lastMessage || "No messages"}</p>
                          </div>
                          {conv.unread > 0 && (
                            <span className="flex-shrink-0 h-5 min-w-[20px] px-1.5 bg-purple-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                              {conv.unread}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className={`flex-1 flex flex-col bg-[#0f0f1e] ${!mobileShowThread ? "hidden md:flex" : "flex"}`}>
              {selectedConv ? (
                <>
                  <div className="px-4 py-3 border-b border-white/5 flex items-center gap-3 bg-[#0d0d1a]">
                    <button
                      className="md:hidden p-1 rounded hover:bg-white/10 text-slate-400"
                      onClick={() => setMobileShowThread(false)}
                      data-testid="button-back"
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </button>
                    <div className={`h-9 w-9 rounded-full ${getChannelColor(selectedConv.channel)} flex items-center justify-center`}>
                      <span className="text-sm font-semibold text-white" data-testid="avatar-initial">{selectedInitial}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-sm font-semibold text-white truncate">{selectedDisplayName}</h2>
                      <div className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                        <span className="text-[11px] text-slate-500 capitalize">{selectedConv.channel === "vapi-sms" ? "Vapi SMS" : selectedConv.channel}</span>
                        {!isSocialPsid(selectedConv.contactPhone, selectedConv.channel) && (
                          <>
                            <span className="text-slate-600 text-[11px]">·</span>
                            <span className="text-[11px] text-slate-500">{selectedConv.contactPhone}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto px-4 py-4" data-testid="message-thread">
                    <div className="space-y-3 flex flex-col">
                      {threadMessages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-slate-500">
                          <MessageSquare className="h-8 w-8 mb-2 opacity-20" />
                          <p className="text-sm">No messages in this thread</p>
                        </div>
                      ) : (
                        threadMessages.map((msg) => (
                          <motion.div
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.15 }}
                            key={msg.id}
                            className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}
                          >
                            <div className={`max-w-[75%] ${msg.direction === "outbound" ? "items-end" : "items-start"} flex flex-col`}>
                              <div
                                className={`rounded-2xl px-4 py-2.5 ${
                                  msg.direction === "outbound"
                                    ? "bg-purple-600 text-white rounded-br-md"
                                    : "bg-white/[0.06] border border-white/[0.08] text-slate-200 rounded-bl-md"
                                }`}
                              >
                                <p className="text-sm leading-relaxed">{msg.body}</p>
                              </div>
                              <div className="flex items-center gap-1 mt-1 px-1">
                                <span className="text-[10px] text-slate-600">{format(new Date(msg.createdAt), "h:mm a")}</span>
                                {msg.direction === "outbound" && msg.status && (
                                  <span className={`text-[10px] flex items-center gap-0.5 ${msg.status === "read" ? "text-blue-400" : msg.status === "delivered" ? "text-green-500" : "text-slate-600"}`}>
                                    {msg.status === "read" ? <><CheckCheck className="h-2.5 w-2.5" /></> : `· ${msg.status}`}
                                  </span>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        ))
                      )}
                      <div ref={scrollRef} />
                    </div>
                  </div>

                  <div className="px-4 py-3 border-t border-white/5 bg-[#0d0d1a]">
                    <form onSubmit={form.handleSubmit(onSubmit)} className="flex items-end gap-2">
                      <div className="flex-1 relative">
                        <Textarea
                          placeholder={`Message via ${CHANNEL_META[selectedConv.channel as ChannelFilter]?.label || selectedConv.channel}...`}
                          className="min-h-[44px] max-h-[120px] resize-none text-sm bg-white/5 border-white/10 text-slate-200 placeholder:text-slate-600 rounded-xl pr-3"
                          {...form.register("messageBody")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              form.handleSubmit(onSubmit)();
                            }
                          }}
                          data-testid="input-message"
                        />
                      </div>
                      <Button
                        type="submit"
                        size="icon"
                        disabled={isSending || !form.watch("messageBody")}
                        className={`h-[44px] w-[44px] rounded-xl ${getChannelColor(selectedConv.channel)} hover:opacity-90`}
                        data-testid="button-send"
                      >
                        {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </Button>
                    </form>
                    <div className="flex justify-between items-center mt-1.5 px-1">
                      <span className="text-[10px] text-slate-600">Enter to send · Shift+Enter for new line</span>
                      <span className="text-[10px] text-slate-600">{form.watch("messageBody")?.length || 0}/1600</span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
                  <div className="h-16 w-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                    <MessageSquare className="h-8 w-8 opacity-30" />
                  </div>
                  <p className="text-sm font-medium text-slate-400">Select a conversation</p>
                  <p className="text-xs mt-1 text-slate-600">Choose from the list to start messaging</p>
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
