import { useState, useEffect, useRef, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { Send, Phone, User, Building2, MessageSquare, Loader2, CheckCircle2, Clock, Instagram, Mail, Bell, BookOpen, MessageCircle, CheckCheck, Bot, Facebook, Zap, Play, Pause, Filter, BarChart3, ThumbsUp, ThumbsDown, Minus, HelpCircle, ShieldAlert } from "lucide-react";
import { TutorialOverlay, useTutorial } from "@/components/tutorial-overlay";
import { INBOX_STEPS } from "@/components/tutorial-steps";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "@/hooks/use-account";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { api } from "@/lib/api";
import type { SubAccount, Message, CommentAutoReply } from "@shared/schema";

const formSchema = z.object({
  subAccountId: z.string().min(1, "Please select an account"),
  contactPhone: z.string().min(10, "Phone number must be at least 10 digits"),
  messageBody: z.string().min(1, "Message cannot be empty").max(1600, "Message too long"),
  channel: z.enum(["sms", "instagram", "whatsapp", "facebook"]).default("sms"),
});

interface LocalMessage extends Message {
  _local?: boolean;
}

function DmSequenceCard({ subAccountId }: { subAccountId?: number }) {
  const { toast } = useToast();
  const [deploying, setDeploying] = useState(false);
  const queryClient = useQueryClient();

  const { data: sequences = [] } = useQuery<any[]>({
    queryKey: ["/api/meta/dm-sequence", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/meta/dm-sequence/${subAccountId}`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
    enabled: !!subAccountId,
    staleTime: 0,
  });

  const deploySequence = async () => {
    if (!subAccountId) return;
    setDeploying(true);
    try {
      const res = await fetch(`/api/meta/dm-sequence/deploy/${subAccountId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Deploy failed");
      toast({ title: "DM Sequence Deployed", description: `"${data.name}" is now active with ${data.steps} steps.` });
      queryClient.invalidateQueries({ queryKey: ["/api/meta/dm-sequence", subAccountId] });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Deploy failed", description: err.message });
    } finally {
      setDeploying(false);
    }
  };

  const activeSequence = sequences.find((s: any) => s.status === "compiled" || s.status === "active");
  const stepLabels: Record<string, string> = {
    SendFacebookDM: "Send DM",
    Wait: "Wait",
    SendFormLink: "Send Form",
    SendBookingLink: "Send Booking Link",
    VapiCall: "Phone Follow-up",
    AIQualify: "AI Qualify",
  };

  return (
    <Card className="border-border shadow-sm" data-testid="card-dm-sequence">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-amber-500" />
          DM Sequence
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {activeSequence ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-xs font-medium text-green-400">{activeSequence.name}</span>
            </div>
            <div className="space-y-1">
              {(activeSequence.manifest?.steps || []).map((step: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="text-[10px] font-mono text-muted-foreground/60">{i + 1}.</span>
                  <span>{stepLabels[step.action] || step.action}</span>
                  {step.action === "Wait" && <span className="text-amber-500">({step.payload?.seconds}s)</span>}
                </div>
              ))}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              Runs: {activeSequence.runCount || 0} | Trigger: {activeSequence.manifest?.trigger}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Auto-engage DM leads with forms, booking links, and phone follow-ups.
            </p>
            <Button
              size="sm"
              className="w-full text-xs"
              onClick={deploySequence}
              disabled={deploying || !subAccountId}
              data-testid="button-deploy-dm-sequence"
            >
              {deploying ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Play className="mr-2 h-3 w-3" />}
              {deploying ? "Deploying..." : "Deploy DM Sequence"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
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
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [sentimentFilter, setSentimentFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const queryParams = new URLSearchParams();
  if (platformFilter !== "all") queryParams.set("platform", platformFilter);
  if (sentimentFilter !== "all") queryParams.set("sentiment", sentimentFilter);
  if (statusFilter !== "all") queryParams.set("status", statusFilter);
  queryParams.set("limit", "100");

  const { data: replies = [], isLoading: repliesLoading } = useQuery<CommentAutoReply[]>({
    queryKey: ["/api/comment-bot/replies", subAccountId, platformFilter, sentimentFilter, statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/comment-bot/replies?${queryParams.toString()}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!subAccountId,
    staleTime: 30_000,
  });

  const { data: stats } = useQuery<CommentStats>({
    queryKey: ["/api/comment-bot/stats", subAccountId],
    queryFn: async () => {
      const res = await fetch("/api/comment-bot/stats", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!subAccountId,
    staleTime: 30_000,
  });

  return (
    <div className="flex flex-col h-full">
      {stats && (
        <div className="p-3 border-b border-border bg-card" data-testid="comments-stats-bar">
          <div className="flex items-center gap-4 flex-wrap text-xs">
            <div className="flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Total:</span>
              <span className="font-semibold text-foreground" data-testid="stat-total">{stats.total}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
              <span className="text-muted-foreground">Replied:</span>
              <span className="font-semibold text-green-400" data-testid="stat-replied">{stats.replied}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-muted-foreground">Skipped:</span>
              <span className="font-semibold text-slate-400" data-testid="stat-skipped">{stats.skipped}</span>
            </div>
            <div className="h-3 w-px bg-border" />
            <div className="flex items-center gap-1.5">
              <Facebook className="h-3.5 w-3.5 text-blue-500" />
              <span className="font-medium" data-testid="stat-facebook">{stats.byPlatform.facebook}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Instagram className="h-3.5 w-3.5 text-pink-500" />
              <span className="font-medium" data-testid="stat-instagram">{stats.byPlatform.instagram}</span>
            </div>
          </div>
        </div>
      )}

      <div className="p-3 border-b border-border bg-card/50 flex items-center gap-2 flex-wrap" data-testid="comments-filters">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        <Select value={platformFilter} onValueChange={setPlatformFilter}>
          <SelectTrigger className="h-7 w-[130px] text-xs" data-testid="filter-platform">
            <SelectValue placeholder="Platform" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Platforms</SelectItem>
            <SelectItem value="facebook">Facebook</SelectItem>
            <SelectItem value="instagram">Instagram</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sentimentFilter} onValueChange={setSentimentFilter}>
          <SelectTrigger className="h-7 w-[120px] text-xs" data-testid="filter-sentiment">
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
          <SelectTrigger className="h-7 w-[110px] text-xs" data-testid="filter-status">
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

      <ScrollArea className="flex-1 bg-muted/30">
        <div className="p-4 space-y-3">
          {repliesLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : replies.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
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
                <motion.div
                  key={reply.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg border border-border bg-card p-3 space-y-2"
                  data-testid={`comment-entry-${reply.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {reply.platform === "facebook" ? (
                        <Facebook className="h-4 w-4 text-blue-500 flex-shrink-0" />
                      ) : (
                        <Instagram className="h-4 w-4 text-pink-500 flex-shrink-0" />
                      )}
                      <span className="text-sm font-medium truncate" data-testid={`commenter-name-${reply.id}`}>
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

                  <div className="rounded-md bg-muted/50 px-3 py-2">
                    <p className="text-sm text-foreground" data-testid={`comment-text-${reply.id}`}>{reply.commentText}</p>
                  </div>

                  {reply.replyText && (
                    <div className="flex items-start gap-2 pl-4 border-l-2 border-primary/30">
                      <Bot className="h-3.5 w-3.5 text-primary mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-muted-foreground" data-testid={`reply-text-${reply.id}`}>{reply.replyText}</p>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1">
                    <span className="capitalize">{reply.platform}</span>
                    <span data-testid={`comment-time-${reply.id}`}>{format(new Date(reply.createdAt), "MMM d, h:mm a")}</span>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export default function SmsDashboard() {
  const { showTutorial, startTutorial, closeTutorial } = useTutorial("apex_tutorial_inbox");
  const { activeAccountId } = useAccount();
  const [inboxTab, setInboxTab] = useState<string>("messages");
  const instagramConnected = true;
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>([]);
  const [selectedConv, setSelectedConv] = useState<{ contactPhone: string; channel: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: accounts = [], isLoading: accountsLoading } = useQuery<SubAccount[]>({
    queryKey: ["/api/accounts"],
  });

  const numericAccountId = activeAccountId ?? undefined;
  const currentAccount = accounts.find(a => a.id === activeAccountId);

  const [isSendingMsg, setIsSendingMsg] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      subAccountId: activeAccountId ? String(activeAccountId) : "",
      contactPhone: "+15559999",
      messageBody: "",
      channel: "sms",
    },
  });

  useEffect(() => {
    setLocalMessages([]);
    setSelectedConv(null);
    form.setValue("subAccountId", activeAccountId ? String(activeAccountId) : "");
    form.setValue("contactPhone", "+15559999");
    form.setValue("messageBody", "");
    form.setValue("channel", "sms");
  }, [activeAccountId]);

  const { data: serverMessages = [], isLoading: messagesLoading } = useQuery<Message[]>({
    queryKey: ["/api/messages", numericAccountId],
    queryFn: () => api.getMessages(numericAccountId!),
    enabled: !!numericAccountId,
    refetchInterval: 3_600_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const { data: threadData = [] } = useQuery<{ contactPhone: string; channel: string; contactFirstName?: string; contactLastName?: string }[]>({
    queryKey: ["/api/conversations", numericAccountId],
    queryFn: () => api.getConversationThreads(numericAccountId!),
    enabled: !!numericAccountId,
    refetchInterval: 3_600_000,
    staleTime: 2000,
  });

  const contactNameMap = useMemo(() => {
    const map = new Map<string, { firstName?: string; lastName?: string }>();
    for (const t of threadData) {
      map.set(`${t.contactPhone}__${t.channel}`, { firstName: t.contactFirstName, lastName: t.contactLastName });
    }
    return map;
  }, [threadData]);

  const allRawMessages: LocalMessage[] = useMemo(() => [
    ...serverMessages,
    ...localMessages.filter(lm => lm.subAccountId === numericAccountId),
  ], [serverMessages, localMessages, numericAccountId]);

  const conversations = useMemo(() => {
    const convMap = new Map<string, { contactPhone: string; channel: string; lastMessage: string; lastTime: Date; unread: number; contactFirstName?: string; contactLastName?: string }>();
    for (const msg of allRawMessages) {
      const key = `${msg.contactPhone}__${msg.channel || "sms"}`;
      const existing = convMap.get(key);
      const msgTime = new Date(msg.createdAt);
      const names = contactNameMap.get(key);
      if (!existing || msgTime > existing.lastTime) {
        convMap.set(key, {
          contactPhone: msg.contactPhone,
          channel: msg.channel || "sms",
          lastMessage: (msg.body || "").slice(0, 60),
          lastTime: msgTime,
          unread: (existing?.unread || 0) + (msg.direction === "inbound" && msg.status !== "read" ? 1 : 0),
          contactFirstName: names?.firstName,
          contactLastName: names?.lastName,
        });
      } else if (msg.direction === "inbound" && msg.status !== "read") {
        existing.unread += 1;
      }
    }
    return Array.from(convMap.values()).sort((a, b) => b.lastTime.getTime() - a.lastTime.getTime());
  }, [allRawMessages, contactNameMap]);

  const getContactDisplayName = (contactPhone: string, channel: string, firstName?: string, lastName?: string) => {
    const hasReal = firstName && !firstName.startsWith("FB User") && !firstName.startsWith("IG User") && !firstName.startsWith("IG ");
    if (hasReal) return `${firstName}${lastName ? ` ${lastName}` : ""}`;
    if (channel === "facebook") return `FB User ...${contactPhone.slice(-4)}`;
    if (channel === "instagram") return `IG ${contactPhone.slice(-6)}`;
    return contactPhone;
  };

  const getContactInitial = (contactPhone: string, channel: string, firstName?: string, lastName?: string) => {
    const hasReal = firstName && !firstName.startsWith("FB User") && !firstName.startsWith("IG User") && !firstName.startsWith("IG ");
    if (hasReal) return firstName.charAt(0).toUpperCase();
    if (channel === "facebook") return "F";
    if (channel === "instagram") return "I";
    return contactPhone.charAt(contactPhone.length - 1) || "?";
  };

  useEffect(() => {
    if (!selectedConv && conversations.length > 0) {
      selectConversation(conversations[0]);
    }
  }, [conversations]);

  const allMessages = useMemo(() => {
    if (!selectedConv) return allRawMessages;
    return allRawMessages.filter(m => m.contactPhone === selectedConv.contactPhone && (m.channel || "sms") === selectedConv.channel);
  }, [allRawMessages, selectedConv]);

  const selectConversation = (conv: { contactPhone: string; channel: string }) => {
    setSelectedConv(conv);
    form.setValue("contactPhone", conv.contactPhone);
    form.setValue("channel", conv.channel as any);
  };

  const clearConversation = () => {
    setSelectedConv(null);
    form.setValue("contactPhone", "");
    form.setValue("channel", "sms");
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [allMessages.length]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!activeAccountId || Number(values.subAccountId) !== activeAccountId) {
      toast({
        variant: "destructive",
        title: "Account mismatch",
        description: "Please select an active account from the sidebar before sending.",
      });
      return;
    }
    setIsSendingMsg(true);
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
      const channelLabel = values.channel === 'facebook' ? 'Facebook DM' : values.channel === 'whatsapp' ? 'WhatsApp' : values.channel === 'instagram' ? 'Instagram DM' : 'SMS';
      toast({
        title: `Message sent via ${channelLabel}`,
        description: `${channelLabel} to ${values.contactPhone}. Status: ${data.status || "sent"}.`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Send failed",
        description: error.message || "Failed to send message. Check channel configuration.",
      });
    } finally {
      setIsSendingMsg(false);
    }
  }

  const isLoading = accountsLoading || messagesLoading;
  const isSending = isSendingMsg;

  return (
    <div className="p-4 md:p-8 font-sans">
      <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        
        {/* Left Sidebar: Configuration */}
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Unified Inbox</h1>
              <Button variant="ghost" size="sm" onClick={startTutorial} className="text-slate-400 hover:text-white" data-testid="button-start-tutorial">
                <BookOpen size={16} className="mr-1" /> Tutorial
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">Manage all your customer conversations in one place.</p>
          </div>

          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none text-muted-foreground">
                  Active Account
                </label>
                <div className="flex items-center gap-2 p-2 rounded-md border border-border bg-muted/50" data-testid="text-active-account">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{currentAccount?.name || "No account selected"}</span>
                </div>
                <p className="text-xs text-muted-foreground">Switch accounts using the sidebar.</p>
              </div>

              <div className="space-y-3 pt-2 border-t border-border">
                 <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-pink-100 rounded-md">
                        <Instagram className="h-4 w-4 text-pink-600" />
                      </div>
                      <span className="text-sm font-medium">Instagram DMs</span>
                    </div>
                    <Badge variant="outline" className="text-xs text-green-400 border-green-500/30">Active</Badge>
                 </div>
                 <p className="text-xs text-muted-foreground">Instagram DMs appear automatically via Meta webhook.</p>
              </div>
            </CardContent>
          </Card>

          <DmSequenceCard subAccountId={numericAccountId} />

          {conversations.length > 0 && (
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Conversations</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="max-h-[300px]">
                  <div className="divide-y divide-border">
                    {conversations.map((conv) => {
                      const isActive = selectedConv?.contactPhone === conv.contactPhone && selectedConv?.channel === conv.channel;
                      const channelIcon = conv.channel === "facebook" ? <Facebook className="h-3.5 w-3.5 text-blue-500" />
                        : conv.channel === "instagram" ? <Instagram className="h-3.5 w-3.5 text-pink-500" />
                        : conv.channel === "whatsapp" ? <MessageCircle className="h-3.5 w-3.5 text-green-500" />
                        : conv.channel === "vapi-sms" ? <Bot className="h-3.5 w-3.5 text-purple-500" />
                        : <Phone className="h-3.5 w-3.5 text-blue-400" />;
                      const displayName = getContactDisplayName(conv.contactPhone, conv.channel, conv.contactFirstName, conv.contactLastName);
                      return (
                        <button
                          key={`${conv.contactPhone}__${conv.channel}`}
                          className={`w-full text-left px-3 py-2.5 hover:bg-secondary/50 transition-colors ${isActive ? "bg-secondary/80 border-l-2 border-l-primary" : ""}`}
                          onClick={() => selectConversation(conv)}
                          data-testid={`conv-${conv.channel}-${conv.contactPhone.slice(-4)}`}
                        >
                          <div className="flex items-center gap-2">
                            {channelIcon}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium truncate">{displayName}</span>
                                <span className="text-[10px] text-muted-foreground">{format(conv.lastTime, "h:mm a")}</span>
                              </div>
                              <p className="text-[11px] text-muted-foreground truncate mt-0.5">{conv.lastMessage}</p>
                            </div>
                            {conv.unread > 0 && (
                              <span className="flex-shrink-0 h-4 min-w-[16px] px-1 bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center">{conv.unread}</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          <Card className="bg-primary/5 border-primary/20 shadow-none">
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-primary/10 rounded-full">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-primary">Omnichannel Ready</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Connected to Twilio (SMS), WhatsApp Business API, Meta Graph API (Facebook DMs & Instagram), and Vapi SMS.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content: Chat Interface */}
        <div className="lg:col-span-2 h-[calc(100vh-12rem)] md:h-[800px] flex flex-col">
          <Tabs value={inboxTab} onValueChange={setInboxTab} className="flex flex-col h-full">
            <TabsList className="bg-muted/50 border border-border p-1 mb-3 self-start" data-testid="inbox-tab-list">
              <TabsTrigger value="messages" className="text-sm gap-1.5 data-[state=active]:bg-background data-[state=active]:text-foreground" data-testid="tab-messages">
                <MessageSquare className="h-3.5 w-3.5" /> Messages
              </TabsTrigger>
              <TabsTrigger value="comments" className="text-sm gap-1.5 data-[state=active]:bg-background data-[state=active]:text-foreground" data-testid="tab-comments">
                <MessageCircle className="h-3.5 w-3.5" /> Comments
              </TabsTrigger>
            </TabsList>

            <TabsContent value="messages" className="flex-1 flex flex-col mt-0 min-h-0">
          <Card className="flex-1 flex flex-col shadow-md border-border overflow-hidden">
            
            {/* Header */}
            <div className="p-4 border-b border-border bg-card flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center">
                  {selectedConv ? (() => {
                    const names = contactNameMap.get(`${selectedConv.contactPhone}__${selectedConv.channel}`);
                    const initial = getContactInitial(selectedConv.contactPhone, selectedConv.channel, names?.firstName, names?.lastName);
                    return <span className="text-sm font-semibold text-secondary-foreground" data-testid="avatar-initial">{initial}</span>;
                  })() : <User className="h-5 w-5 text-secondary-foreground" />}
                </div>
                <div>
                  <h2 className="font-semibold text-foreground">
                    {selectedConv
                      ? (() => {
                          const names = contactNameMap.get(`${selectedConv.contactPhone}__${selectedConv.channel}`);
                          return getContactDisplayName(selectedConv.contactPhone, selectedConv.channel, names?.firstName, names?.lastName);
                        })()
                      : "All Conversations"}
                  </h2>
                  <div className="flex items-center gap-1.5">
                    {selectedConv ? (
                      <>
                        <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-xs text-muted-foreground">Active now</span>
                        <span className="mx-1 text-muted-foreground">·</span>
                        <button className="text-xs text-primary hover:underline" onClick={clearConversation} data-testid="button-show-all">Show all</button>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">{allRawMessages.length} messages</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                 <Badge variant="outline" className="gap-1 text-xs">
                   <Phone className="h-3 w-3" /> SMS
                 </Badge>
                 <Badge variant="outline" className="gap-1 text-xs border-green-500/30 text-green-400 hidden sm:inline-flex" data-testid="badge-whatsapp">
                   <MessageCircle className="h-3 w-3" /> WhatsApp
                 </Badge>
                 <Badge variant="outline" className="gap-1 text-xs border-purple-500/30 text-purple-400 hidden sm:inline-flex" data-testid="badge-vapi-sms">
                   <Bot className="h-3 w-3" /> Vapi SMS
                 </Badge>
                 <Badge variant="outline" className="gap-1 text-xs border-blue-500/30 text-blue-400 hidden md:inline-flex" data-testid="badge-facebook">
                   <Facebook className="h-3 w-3" /> Facebook
                 </Badge>
                 <Badge variant="outline" className="gap-1 text-xs border-pink-500/30 text-pink-400 hidden md:inline-flex">
                   <Instagram className="h-3 w-3" /> Instagram
                 </Badge>
              </div>
            </div>

            {/* Messages Area */}
            <ScrollArea className="flex-1 p-4 bg-muted/30">
              <div className="space-y-4 flex flex-col">
                {isLoading ? (
                  <div className="flex items-center justify-center h-full py-10">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : allMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                    <MessageSquare className="h-10 w-10 mb-2 opacity-20" />
                    <p>No messages yet. Start the conversation!</p>
                  </div>
                ) : (
                  allMessages.map((msg) => (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      key={msg.id}
                      className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`flex flex-col ${msg.direction === 'outbound' ? 'items-end' : 'items-start'} max-w-[80%]`}>
                        <div className="flex items-center gap-1 mb-1 px-1">
                           {msg.channel === 'facebook' ? (
                             <Facebook className="h-3 w-3 text-blue-500" />
                           ) : msg.channel === 'instagram' ? (
                             <Instagram className="h-3 w-3 text-pink-500" />
                           ) : msg.channel === 'whatsapp' ? (
                             <MessageCircle className="h-3 w-3 text-green-500" />
                           ) : msg.channel === 'vapi-sms' ? (
                             <Bot className="h-3 w-3 text-purple-500" />
                           ) : (
                             <MessageSquare className="h-3 w-3 text-blue-500" />
                           )}
                           <span className="text-[10px] text-muted-foreground capitalize">{msg.channel === 'vapi-sms' ? 'Vapi SMS' : msg.channel === 'facebook' ? 'Facebook DM' : (msg.channel || 'sms')}</span>
                        </div>
                        <div
                          className={`rounded-2xl px-4 py-3 shadow-sm ${
                            msg.direction === 'outbound'
                              ? 'bg-primary text-primary-foreground rounded-br-none'
                              : 'bg-[#2a2a3d] border border-[#3a3a4d] text-white rounded-bl-none'
                          }`}
                        >
                          <p className="text-sm leading-relaxed">{msg.body}</p>
                        </div>
                        <div className={`flex items-center gap-1 mt-1 text-[10px] ${
                          msg.direction === 'outbound' ? 'text-muted-foreground' : 'text-muted-foreground'
                        }`}>
                          <span>{format(new Date(msg.createdAt), 'h:mm a')}</span>
                          {msg.direction === 'outbound' && (
                            <span className={`uppercase font-medium flex items-center gap-0.5 ${msg.status === 'read' ? 'text-blue-500' : msg.status === 'delivered' ? 'text-green-500' : ''}`}>
                              • {msg.status === 'read' && msg.channel === 'whatsapp' ? <><CheckCheck className="h-2.5 w-2.5" /> Read</> : msg.status}
                            </span>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}
                <div ref={scrollRef} />
              </div>
            </ScrollArea>

            {/* Composer */}
            <div className="p-4 bg-card border-t border-border">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  
                  {/* Channel Selector for Sending */}
                  <div className="flex gap-1.5 mb-2 flex-wrap">
                     <Button
                      type="button"
                      variant={form.watch("channel") === "sms" ? "default" : "outline"}
                      size="sm"
                      onClick={() => form.setValue("channel", "sms")}
                      className="text-xs h-8 min-w-[44px]"
                      data-testid="button-channel-sms"
                     >
                       <Phone className="mr-1 h-3 w-3" /> SMS
                     </Button>
                     <Button
                      type="button"
                      variant={form.watch("channel") === "whatsapp" ? "default" : "outline"}
                      size="sm"
                      onClick={() => form.setValue("channel", "whatsapp")}
                      className={`text-xs h-8 min-w-[44px] ${form.watch("channel") === "whatsapp" ? "bg-green-600 hover:bg-green-700" : ""}`}
                      data-testid="button-channel-whatsapp"
                     >
                       <MessageCircle className="mr-1 h-3 w-3" /> WA
                     </Button>
                     <Button
                      type="button"
                      variant={form.watch("channel") === "facebook" ? "default" : "outline"}
                      size="sm"
                      onClick={() => form.setValue("channel", "facebook")}
                      className={`text-xs h-8 min-w-[44px] ${form.watch("channel") === "facebook" ? "bg-blue-600 hover:bg-blue-700" : ""}`}
                      data-testid="button-channel-facebook"
                     >
                       <Facebook className="mr-1 h-3 w-3" /> FB
                     </Button>
                       <Button
                        type="button"
                        variant={form.watch("channel") === "instagram" ? "default" : "outline"}
                        size="sm"
                        onClick={() => form.setValue("channel", "instagram")}
                        className={`text-xs h-8 min-w-[44px] ${form.watch("channel") === "instagram" ? "bg-pink-600 hover:bg-pink-700" : ""}`}
                        data-testid="button-channel-instagram"
                       >
                         <Instagram className="mr-1 h-3 w-3" /> IG
                       </Button>
                  </div>

                  <div className="relative">
                    <FormField
                      control={form.control}
                      name="messageBody"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Textarea
                              placeholder={selectedConv ? `Type your ${form.watch("channel") === 'facebook' ? 'Facebook DM' : form.watch("channel") === 'instagram' ? 'Instagram DM' : form.watch("channel") === 'whatsapp' ? 'WhatsApp message' : 'SMS'}...` : 'Select a conversation to reply...'}
                              className="min-h-[80px] resize-none pr-12 text-sm text-foreground bg-muted/30 border-muted-foreground/20 focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                              {...field}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  form.handleSubmit(onSubmit)();
                                }
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="absolute bottom-2 right-2">
                       <Button 
                        type="submit" 
                        size="icon" 
                        disabled={isSending || !form.watch("messageBody") || !selectedConv}
                        className={`h-8 w-8 rounded-full shadow-sm ${form.watch("channel") === 'facebook' ? 'bg-blue-600 hover:bg-blue-700' : form.watch("channel") === 'instagram' ? 'bg-pink-600 hover:bg-pink-700' : form.watch("channel") === 'whatsapp' ? 'bg-green-600 hover:bg-green-700' : ''}`}
                        data-testid="button-send"
                      >
                        {isSending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  
                  <div className="flex justify-between items-center text-xs text-muted-foreground">
                    <p>Press Enter to send</p>
                    <p>{form.watch("messageBody")?.length || 0}/1600 characters</p>
                  </div>
                </form>
              </Form>
            </div>
          </Card>
            </TabsContent>

            <TabsContent value="comments" className="flex-1 flex flex-col mt-0 min-h-0">
              <Card className="flex-1 flex flex-col shadow-md border-border overflow-hidden" data-testid="card-comments-view">
                <CommentsView subAccountId={numericAccountId} />
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
      {showTutorial && <TutorialOverlay steps={INBOX_STEPS} storageKey="apex_tutorial_inbox" onClose={closeTutorial} accentColor="indigo" />}
    </div>
  );
}
