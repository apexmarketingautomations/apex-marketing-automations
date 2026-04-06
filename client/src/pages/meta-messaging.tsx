import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveSubAccountId } from "@/components/account-required";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  MessageSquare, Instagram, Facebook, Send, Shield, BarChart3, Settings, CreditCard,
  CheckCircle2, XCircle, AlertTriangle, ArrowRight, Zap, Eye, Edit3, Bot, Power,
  TrendingUp, Clock, MessageCircle, Users, ExternalLink, RefreshCw, Wifi, WifiOff,
  Sparkles, ChevronRight, Filter, Search, ToggleLeft, ToggleRight, Play, Pause,
  ShieldAlert, Lock
} from "lucide-react";
import type { SubAccount } from "@shared/schema";

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: TrendingUp },
  { id: "inbox", label: "DM Inbox", icon: MessageSquare },
  { id: "comments", label: "Comment Bot", icon: MessageCircle },
  { id: "safety", label: "Safety", icon: Shield },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "billing", label: "Usage", icon: CreditCard },
];

function ChannelBadge({ channel }: { channel: string }) {
  return channel === "instagram" ? (
    <Badge className="bg-gradient-to-r from-purple-500 to-pink-500 text-white border-0 text-xs" data-testid={`badge-channel-instagram`}>
      <Instagram size={12} className="mr-1" /> IG
    </Badge>
  ) : (
    <Badge className="bg-blue-600 text-white border-0 text-xs" data-testid={`badge-channel-facebook`}>
      <Facebook size={12} className="mr-1" /> FB
    </Badge>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    critical: "bg-red-500/20 text-red-400 border-red-500/30",
    high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    normal: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  };
  return <Badge className={colors[priority] || colors.normal} data-testid={`badge-priority-${priority}`}>{priority}</Badge>;
}

function StatusDot({ ok }: { ok: boolean }) {
  return ok
    ? <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
    : <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />;
}

function ConnectFlow({ subAccountId }: { subAccountId: number }) {
  const { data: status, isLoading } = useQuery({
    queryKey: ["/api/meta-messaging/connect-status", subAccountId],
    queryFn: async () => { const r = await fetch(`/api/meta-messaging/connect-status/${subAccountId}`); if (!r.ok) throw new Error("Failed to load"); return r.json(); },
    refetchInterval: 10000,
  });

  if (isLoading) return <div className="animate-pulse h-64 bg-slate-800/50 rounded-xl" />;

  const steps = status?.steps || {};
  const pct = status?.completionPct || 0;

  const connectSteps = [
    { key: "metaConnected", label: "Connect Meta Account", desc: "Link your Facebook Business account via OAuth", done: steps.metaConnected },
    { key: "pageSelected", label: "Facebook Page Selected", desc: `Page: ${steps.pageName || "Not selected"}`, done: steps.pageSelected },
    { key: "igConnected", label: "Instagram Connected", desc: "Link your Instagram Business account", done: steps.igConnected },
    { key: "tokenValid", label: "Access Token Valid", desc: "Your token is authenticated and working", done: steps.tokenValid },
    { key: "webhookActive", label: "Webhooks Active", desc: "Real-time messaging is enabled", done: steps.webhookActive },
  ];

  return (
    <Card className="bg-slate-900/80 border-slate-700/50" data-testid="connect-flow-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Wifi size={20} className="text-cyan-400" />
            Connection Status
          </CardTitle>
          <Badge className={pct === 100 ? "bg-green-500/20 text-green-400" : "bg-amber-500/20 text-amber-400"}>
            {pct}% Complete
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="w-full bg-slate-800 rounded-full h-2 mb-4">
          <div className="h-2 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        {connectSteps.map((step, i) => (
          <div key={step.key} className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50" data-testid={`connect-step-${step.key}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${step.done ? "bg-green-500/20 text-green-400" : "bg-slate-700 text-slate-400"}`}>
              {step.done ? <CheckCircle2 size={16} /> : i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white">{step.label}</div>
              <div className="text-xs text-slate-400 truncate">{step.desc}</div>
            </div>
            {!step.done && i === 0 && (
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="button-connect-meta"
                onClick={() => window.location.href = `/api/oauth/meta/authorize/${subAccountId}`}>
                <ExternalLink size={14} className="mr-1" /> Connect
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function DashboardTab({ subAccountId, demoMode }: { subAccountId: number; demoMode: boolean }) {
  const { data: dashboard, isLoading } = useQuery({
    queryKey: ["/api/meta-messaging/dashboard", subAccountId],
    queryFn: () => fetch(`/api/meta-messaging/dashboard/${subAccountId}`).then(r => r.json()),
    enabled: !demoMode,
  });

  const { data: demoData } = useQuery({
    queryKey: ["/api/meta-messaging/demo-data"],
    queryFn: () => fetch("/api/meta-messaging/demo-data").then(r => r.json()),
    enabled: demoMode,
  });

  const d = demoMode ? demoData?.stats : dashboard?.kpi;
  const trend = demoMode ? demoData?.stats?.trend7d : dashboard?.trend7d;
  const connected = demoMode ? true : dashboard?.connected;
  const botActive = demoMode ? true : dashboard?.botActive;

  const toggleBot = useMutation({
    mutationFn: () => apiRequest("POST", `/api/meta-messaging/toggle-bot/${subAccountId}`),
  });

  if (isLoading && !demoMode) return <div className="animate-pulse space-y-4"><div className="h-32 bg-slate-800/50 rounded-xl" /><div className="h-32 bg-slate-800/50 rounded-xl" /></div>;

  const kpis = [
    { label: "Inbound DMs (24h)", value: d?.inbound24h || 0, icon: MessageSquare, color: "text-blue-400", bg: "bg-blue-500/10" },
    { label: "Outbound DMs (24h)", value: d?.outbound24h || 0, icon: Send, color: "text-green-400", bg: "bg-green-500/10" },
    { label: "Comments Replied (24h)", value: demoMode ? d?.commentStats?.replied : d?.commentsReplied24h || 0, icon: MessageCircle, color: "text-purple-400", bg: "bg-purple-500/10" },
    { label: "Failed (24h)", value: demoMode ? d?.failedCount : d?.failed24h || 0, icon: XCircle, color: "text-red-400", bg: "bg-red-500/10" },
  ];

  return (
    <div className="space-y-6">
      {!connected && !demoMode && <ConnectFlow subAccountId={subAccountId} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(k => (
          <Card key={k.label} className="bg-slate-900/80 border-slate-700/50" data-testid={`kpi-${k.label.replace(/\s/g, '-').toLowerCase()}`}>
            <CardContent className="pt-4 pb-4 px-4">
              <div className={`w-10 h-10 rounded-lg ${k.bg} flex items-center justify-center mb-2`}>
                <k.icon size={20} className={k.color} />
              </div>
              <div className="text-2xl font-bold text-white">{k.value}</div>
              <div className="text-xs text-slate-400 mt-1">{k.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-slate-900/80 border-slate-700/50" data-testid="card-bot-status">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2"><Bot size={18} className="text-cyan-400" /> DM Chatbot</span>
              <Button variant="ghost" size="sm" className={botActive ? "text-green-400" : "text-red-400"}
                onClick={() => !demoMode && toggleBot.mutate()} data-testid="button-toggle-bot">
                {botActive ? <><Power size={14} className="mr-1" /> Active</> : <><WifiOff size={14} className="mr-1" /> Paused</>}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-400">Status</span><StatusDot ok={!!botActive} /></div>
              <div className="flex justify-between"><span className="text-slate-400">FB DMs</span><StatusDot ok={!!connected} /></div>
              <div className="flex justify-between"><span className="text-slate-400">IG DMs</span><StatusDot ok={!!connected} /></div>
              <div className="flex justify-between"><span className="text-slate-400">AI Persona</span>
                <Badge className={dashboard?.hasPersona || demoMode ? "bg-green-500/20 text-green-400" : "bg-amber-500/20 text-amber-400"}>
                  {dashboard?.hasPersona || demoMode ? "Trained" : "Not Set"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/80 border-slate-700/50" data-testid="card-comment-bot">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageCircle size={18} className="text-purple-400" /> Comment Bots
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-400">FB Comments</span><StatusDot ok={!!connected} /></div>
              <div className="flex justify-between"><span className="text-slate-400">IG Comments</span><StatusDot ok={!!connected} /></div>
              <div className="flex justify-between">
                <span className="text-slate-400">Replies Today</span>
                <span className="text-white font-medium">{demoMode ? d?.commentStats?.replied : d?.commentsReplied24h || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Reply Rate</span>
                <span className="text-white font-medium">40-60%</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {trend && Array.isArray(trend) && trend.length > 0 && (
        <Card className="bg-slate-900/80 border-slate-700/50" data-testid="card-trend">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp size={18} className="text-cyan-400" /> 7-Day Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-24">
              {(Array.isArray(trend) ? trend : []).map((d: any, i: number) => {
                const val = typeof d === "number" ? d : d?.count || 0;
                const maxVal = Math.max(...(Array.isArray(trend) ? trend : []).map((x: any) => typeof x === "number" ? x : x?.count || 0), 1);
                const h = Math.max((val / maxVal) * 100, 4);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] text-slate-400">{val}</span>
                    <div className="w-full rounded-t bg-gradient-to-t from-cyan-600 to-blue-500 transition-all" style={{ height: `${h}%` }} />
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function InboxTab({ subAccountId, demoMode }: { subAccountId: number; demoMode: boolean }) {
  const [channelFilter, setChannelFilter] = useState("all");
  const [selectedThread, setSelectedThread] = useState<any>(null);
  const [replyText, setReplyText] = useState("");
  const [editingMsg, setEditingMsg] = useState<any>(null);
  const [editText, setEditText] = useState("");
  const [search, setSearch] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: inboxData, isLoading } = useQuery({
    queryKey: ["/api/meta-messaging/inbox", subAccountId, channelFilter],
    queryFn: () => fetch(`/api/meta-messaging/inbox/${subAccountId}?channel=${channelFilter}`).then(r => r.json()),
    enabled: !demoMode,
  });

  const { data: demoData } = useQuery({
    queryKey: ["/api/meta-messaging/demo-data"],
    queryFn: () => fetch("/api/meta-messaging/demo-data").then(r => r.json()),
    enabled: demoMode,
  });

  const { data: threadData } = useQuery({
    queryKey: ["/api/meta-messaging/thread", subAccountId, selectedThread?.sender_id || selectedThread?.senderId, selectedThread?.channel],
    queryFn: () => fetch(`/api/meta-messaging/thread/${subAccountId}/${selectedThread?.sender_id || selectedThread?.senderId}?channel=${selectedThread?.channel}`).then(r => r.json()),
    enabled: !demoMode && !!selectedThread,
  });

  const sendReply = useMutation({
    mutationFn: (data: any) => apiRequest("POST", `/api/meta-messaging/send-reply/${subAccountId}`, data),
    onSuccess: () => { toast({ title: "Reply sent!" }); setReplyText(""); qc.invalidateQueries({ queryKey: ["/api/meta-messaging/thread"] }); },
    onError: (e: any) => toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });

  const approveMsg = useMutation({
    mutationFn: (data: { messageId: number; editedText?: string }) =>
      apiRequest("POST", `/api/meta-messaging/approve/${subAccountId}/${data.messageId}`, data.editedText ? { editedText: data.editedText } : {}),
    onSuccess: () => { toast({ title: "Message approved & sent!" }); setEditingMsg(null); qc.invalidateQueries({ queryKey: ["/api/meta-messaging/thread"] }); },
    onError: (e: any) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });

  const threads = demoMode
    ? (demoData?.conversations || []).filter((c: any) => channelFilter === "all" || c.channel === channelFilter)
    : (inboxData?.threads || []);

  const filteredThreads = search
    ? threads.filter((t: any) => {
        const name = t.name || t.contact_phone || t.sender_id || "";
        const msg = t.last_message || "";
        return name.toLowerCase().includes(search.toLowerCase()) || msg.toLowerCase().includes(search.toLowerCase());
      })
    : threads;

  const currentMessages = demoMode && selectedThread
    ? selectedThread.messages
    : threadData?.messages || [];

  return (
    <div className="flex gap-4 h-[calc(100vh-280px)] min-h-[400px]" data-testid="inbox-container">
      <div className="w-full lg:w-96 flex flex-col bg-slate-900/80 border border-slate-700/50 rounded-xl overflow-hidden">
        <div className="p-3 border-b border-slate-700/50 space-y-2">
          <div className="flex gap-1">
            {["all", "facebook", "instagram"].map(ch => (
              <Button key={ch} size="sm" variant={channelFilter === ch ? "default" : "ghost"}
                className={channelFilter === ch ? "bg-cyan-600 text-white text-xs" : "text-slate-400 text-xs"}
                onClick={() => setChannelFilter(ch)} data-testid={`filter-channel-${ch}`}>
                {ch === "all" ? "All" : ch === "facebook" ? "FB" : "IG"}
              </Button>
            ))}
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input placeholder="Search conversations..." value={search} onChange={e => setSearch(e.target.value)}
              className="pl-7 h-8 text-xs bg-slate-800 border-slate-700" data-testid="input-search-inbox" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading && !demoMode ? (
            <div className="p-4 space-y-3">{[1,2,3].map(i => <div key={i} className="animate-pulse h-16 bg-slate-800/50 rounded-lg" />)}</div>
          ) : filteredThreads.length === 0 ? (
            <div className="p-6 text-center text-slate-500 text-sm">No conversations yet</div>
          ) : (
            filteredThreads.map((t: any, i: number) => {
              const name = t.name || t.contact_phone || t.sender_id || `Thread ${i + 1}`;
              const msg = t.last_message || t.messages?.[t.messages.length - 1]?.body || "";
              const isSelected = selectedThread && (selectedThread.sender_id === t.sender_id || selectedThread.senderId === t.senderId);
              return (
                <button key={i} className={`w-full text-left p-3 border-b border-slate-800/50 hover:bg-slate-800/50 transition ${isSelected ? "bg-slate-800" : ""}`}
                  onClick={() => setSelectedThread(t)} data-testid={`thread-item-${i}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-white truncate flex-1">{name}</span>
                    <ChannelBadge channel={t.channel} />
                  </div>
                  <div className="text-xs text-slate-400 truncate">{msg}</div>
                  <div className="flex items-center gap-2 mt-1">
                    {t.priority && t.priority !== "normal" && <PriorityBadge priority={t.priority} />}
                    {(t.unread || (t.last_direction === "inbound" && t.last_status !== "read")) && (
                      <span className="w-2 h-2 rounded-full bg-cyan-400" />
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="hidden lg:flex flex-1 flex-col bg-slate-900/80 border border-slate-700/50 rounded-xl overflow-hidden">
        {!selectedThread ? (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            <div className="text-center">
              <MessageSquare size={48} className="mx-auto mb-3 opacity-30" />
              <div className="text-sm">Select a conversation to view</div>
            </div>
          </div>
        ) : (
          <>
            <div className="p-3 border-b border-slate-700/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium text-white">{selectedThread.name || selectedThread.contact_phone || selectedThread.sender_id}</span>
                <ChannelBadge channel={selectedThread.channel} />
              </div>
              {threadData?.contact && !demoMode && (
                <div className="flex gap-1">
                  {(threadData.contact.tags || []).map((tag: string) => (
                    <Badge key={tag} className="bg-slate-700 text-slate-300 text-xs">{tag}</Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {currentMessages.map((m: any, i: number) => (
                <div key={i} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] p-3 rounded-xl text-sm ${
                    m.direction === "outbound"
                      ? "bg-cyan-600/20 text-cyan-100 border border-cyan-500/30"
                      : "bg-slate-800 text-slate-200 border border-slate-700"
                  }`} data-testid={`message-bubble-${i}`}>
                    <div>{m.body}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] opacity-50">{new Date(m.createdAt).toLocaleTimeString()}</span>
                      {m.aiGenerated && <Badge className="bg-purple-500/20 text-purple-300 text-[10px] py-0 px-1">AI</Badge>}
                      {m.status === "pending_approval" && !demoMode && (
                        <div className="flex gap-1 ml-1">
                          <button className="text-green-400 hover:text-green-300" data-testid={`button-approve-${m.id}`}
                            onClick={() => approveMsg.mutate({ messageId: m.id })}>
                            <CheckCircle2 size={14} />
                          </button>
                          <button className="text-blue-400 hover:text-blue-300" data-testid={`button-edit-${m.id}`}
                            onClick={() => { setEditingMsg(m); setEditText(m.body || ""); }}>
                            <Edit3 size={14} />
                          </button>
                        </div>
                      )}
                      {m.safetyFlags && m.safetyFlags.length > 0 && (
                        <AlertTriangle size={12} className="text-amber-400" />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-3 border-t border-slate-700/50 flex gap-2">
              <Input placeholder={demoMode ? "Replies disabled in demo mode" : "Type a reply..."} value={replyText} onChange={e => setReplyText(e.target.value)}
                className="bg-slate-800 border-slate-700 text-sm" data-testid="input-reply" disabled={demoMode}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && replyText.trim() && !demoMode && sendReply.mutate({
                  senderId: selectedThread.sender_id || selectedThread.senderId,
                  channel: selectedThread.channel,
                  text: replyText.trim(),
                })} />
              <Button className="bg-cyan-600 hover:bg-cyan-700" disabled={demoMode || !replyText.trim() || sendReply.isPending}
                onClick={() => !demoMode && sendReply.mutate({
                  senderId: selectedThread.sender_id || selectedThread.senderId,
                  channel: selectedThread.channel,
                  text: replyText.trim(),
                })} data-testid="button-send-reply">
                <Send size={16} />
              </Button>
            </div>
          </>
        )}
      </div>

      <Dialog open={!!editingMsg} onOpenChange={() => setEditingMsg(null)}>
        <DialogContent className="bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle>Edit & Approve Message</DialogTitle>
          </DialogHeader>
          <Textarea value={editText} onChange={e => setEditText(e.target.value)} rows={4}
            className="bg-slate-800 border-slate-700" data-testid="textarea-edit-message" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditingMsg(null)}>Cancel</Button>
            <Button className="bg-green-600 hover:bg-green-700" data-testid="button-approve-edited"
              onClick={() => editingMsg && approveMsg.mutate({ messageId: editingMsg.id, editedText: editText })}>
              <CheckCircle2 size={14} className="mr-1" /> Approve & Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CommentsTab({ subAccountId, demoMode }: { subAccountId: number; demoMode: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: modData, isLoading } = useQuery({
    queryKey: ["/api/meta-messaging/moderation", subAccountId],
    queryFn: () => fetch(`/api/meta-messaging/moderation/${subAccountId}`).then(r => r.json()),
    enabled: !demoMode,
  });

  const { data: demoData } = useQuery({
    queryKey: ["/api/meta-messaging/demo-data"],
    queryFn: () => fetch("/api/meta-messaging/demo-data").then(r => r.json()),
    enabled: demoMode,
  });

  const updateConfig = useMutation({
    mutationFn: (data: any) => apiRequest("POST", `/api/meta-messaging/moderation-config/${subAccountId}`, data),
    onSuccess: () => { toast({ title: "Config saved!" }); qc.invalidateQueries({ queryKey: ["/api/meta-messaging/moderation"] }); },
  });

  const comments = demoMode ? (demoData?.comments || []) : [...(modData?.pendingQueue || []), ...(modData?.recentReplied || [])];
  const config = modData?.config || { autoApprove: true, tonePreset: "friendly", maxRepliesPerHour: 30 };

  const statusColors: Record<string, string> = {
    replied: "bg-green-500/20 text-green-400",
    pending_approval: "bg-amber-500/20 text-amber-400",
    processing: "bg-blue-500/20 text-blue-400",
    skipped: "bg-slate-500/20 text-slate-400",
    failed: "bg-red-500/20 text-red-400",
  };

  return (
    <div className="space-y-6" data-testid="comments-tab">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="bg-slate-900/80 border-slate-700/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-slate-400">Auto-Approve</span>
              <Switch checked={config.autoApprove} onCheckedChange={v => !demoMode && updateConfig.mutate({ autoApprove: v })} disabled={demoMode} data-testid="switch-auto-approve" />
            </div>
            <div className="text-xs text-slate-500">When enabled, AI-generated comment replies are posted automatically without manual review.</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-900/80 border-slate-700/50">
          <CardContent className="pt-4 pb-4">
            <div className="text-sm text-slate-400 mb-2">Tone Preset</div>
            <div className="flex gap-1">
              {["friendly", "professional", "casual"].map(tone => (
                <Button key={tone} size="sm" variant={config.tonePreset === tone ? "default" : "ghost"}
                  className={config.tonePreset === tone ? "bg-purple-600 text-white text-xs" : "text-slate-400 text-xs"}
                  onClick={() => !demoMode && updateConfig.mutate({ tonePreset: tone })} disabled={demoMode} data-testid={`button-tone-${tone}`}>
                  {tone}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-slate-900/80 border-slate-700/50">
          <CardContent className="pt-4 pb-4">
            <div className="text-sm text-slate-400 mb-2">Rate Limit</div>
            <div className="text-2xl font-bold text-white">{config.maxRepliesPerHour}<span className="text-sm text-slate-400 font-normal">/hr</span></div>
            <div className="text-xs text-slate-500 mt-1">Maximum comment replies per hour</div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-slate-900/80 border-slate-700/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Comment Feed</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && !demoMode ? (
            <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="animate-pulse h-20 bg-slate-800/50 rounded-lg" />)}</div>
          ) : comments.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">No comment activity yet</div>
          ) : (
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {comments.map((c: any, i: number) => (
                <div key={i} className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/30" data-testid={`comment-item-${i}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium text-white">{c.commenterName || c.commenter_name || "User"}</span>
                    <ChannelBadge channel={c.platform || "facebook"} />
                    <Badge className={statusColors[c.status] || statusColors.processing}>{c.status}</Badge>
                  </div>
                  <div className="text-sm text-slate-300 mb-1">
                    <span className="text-slate-500">Comment:</span> {c.commentText || c.comment_text}
                  </div>
                  {(c.replyText || c.reply_text) && (
                    <div className="text-sm text-cyan-300/80 pl-3 border-l-2 border-cyan-500/30">
                      <span className="text-slate-500">Reply:</span> {c.replyText || c.reply_text}
                    </div>
                  )}
                  {c.safetyFlags && c.safetyFlags.length > 0 && (
                    <div className="flex gap-1 mt-2">
                      {c.safetyFlags.map((f: any, j: number) => (
                        <Badge key={j} className="bg-amber-500/20 text-amber-400 text-xs">{f.flag}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SafetyTab({ subAccountId, demoMode }: { subAccountId: number; demoMode: boolean }) {
  const { data: safetyData, isLoading } = useQuery({
    queryKey: ["/api/meta-messaging/safety", subAccountId],
    queryFn: () => fetch(`/api/meta-messaging/safety/${subAccountId}`).then(r => r.json()),
    enabled: !demoMode,
  });

  const severity = demoMode
    ? { critical: 0, high: 1, medium: 3 }
    : safetyData?.severityCounts || { critical: 0, high: 0, medium: 0 };

  const flaggedItems = demoMode ? [] : [...(safetyData?.flaggedMessages || []), ...(safetyData?.flaggedComments || [])];

  return (
    <div className="space-y-6" data-testid="safety-tab">
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-slate-900/80 border-red-500/30">
          <CardContent className="pt-4 pb-4 text-center">
            <div className="text-3xl font-bold text-red-400">{severity.critical}</div>
            <div className="text-xs text-slate-400 mt-1">Critical</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-900/80 border-orange-500/30">
          <CardContent className="pt-4 pb-4 text-center">
            <div className="text-3xl font-bold text-orange-400">{severity.high}</div>
            <div className="text-xs text-slate-400 mt-1">High</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-900/80 border-yellow-500/30">
          <CardContent className="pt-4 pb-4 text-center">
            <div className="text-3xl font-bold text-yellow-400">{severity.medium}</div>
            <div className="text-xs text-slate-400 mt-1">Medium</div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-slate-900/80 border-slate-700/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield size={18} className="text-amber-400" /> Flagged Content (24h)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && !demoMode ? (
            <div className="animate-pulse space-y-3">{[1,2,3].map(i => <div key={i} className="h-16 bg-slate-800/50 rounded-lg" />)}</div>
          ) : flaggedItems.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 size={48} className="mx-auto mb-3 text-green-500/30" />
              <div className="text-sm text-slate-500">{demoMode ? "Demo mode — no live flags" : "No flagged content in the last 24 hours"}</div>
            </div>
          ) : (
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {flaggedItems.map((item: any, i: number) => (
                <div key={i} className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/30" data-testid={`flagged-item-${i}`}>
                  <div className="text-sm text-slate-300">{item.body || item.commentText || item.comment_text}</div>
                  <div className="flex gap-1 mt-2">
                    {(item.safetyFlags || []).map((f: any, j: number) => (
                      <Badge key={j} className={
                        f.severity === "critical" ? "bg-red-500/20 text-red-400" :
                        f.severity === "high" ? "bg-orange-500/20 text-orange-400" :
                        "bg-yellow-500/20 text-yellow-400"
                      }>{f.flag}</Badge>
                    ))}
                    <ChannelBadge channel={item.channel || item.platform || "facebook"} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AnalyticsTab({ subAccountId, demoMode }: { subAccountId: number; demoMode: boolean }) {
  const [days, setDays] = useState(7);

  const { data: analyticsData, isLoading } = useQuery({
    queryKey: ["/api/meta-messaging/analytics", subAccountId, days],
    queryFn: () => fetch(`/api/meta-messaging/analytics/${subAccountId}?days=${days}`).then(r => r.json()),
    enabled: !demoMode,
  });

  const { data: demoData } = useQuery({
    queryKey: ["/api/meta-messaging/demo-data"],
    queryFn: () => fetch("/api/meta-messaging/demo-data").then(r => r.json()),
    enabled: demoMode,
  });

  const channelData = demoMode
    ? demoData?.analytics?.channelBreakdown || {}
    : (analyticsData?.channelBreakdown || []).reduce((acc: any, r: any) => {
        acc[r.channel] = { total: Number(r.total), inbound: Number(r.inbound), outbound: Number(r.outbound) };
        return acc;
      }, {});

  const dailyVolume = demoMode ? (demoData?.analytics?.dailyVolume || []) : (analyticsData?.dailyVolume || []);

  return (
    <div className="space-y-6" data-testid="analytics-tab">
      <div className="flex gap-2">
        {[7, 14, 30].map(d => (
          <Button key={d} size="sm" variant={days === d ? "default" : "ghost"}
            className={days === d ? "bg-cyan-600 text-white" : "text-slate-400"}
            onClick={() => setDays(d)} data-testid={`button-days-${d}`}>
            {d}d
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-slate-900/80 border-slate-700/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Channel Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading && !demoMode ? (
              <div className="animate-pulse h-32 bg-slate-800/50 rounded" />
            ) : (
              <div className="space-y-3">
                {demoMode ? (
                  Object.entries(channelData as Record<string, number>).map(([key, val]) => (
                    <div key={key} className="flex items-center gap-3">
                      <div className="w-28 text-xs text-slate-400 capitalize">{key.replace(/([A-Z])/g, ' $1')}</div>
                      <div className="flex-1 bg-slate-800 rounded-full h-3">
                        <div className="h-3 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500"
                          style={{ width: `${Math.min(((val as number) / 60) * 100, 100)}%` }} />
                      </div>
                      <span className="text-sm text-white w-8 text-right">{val as number}</span>
                    </div>
                  ))
                ) : (
                  Object.entries(channelData).map(([key, val]: [string, any]) => (
                    <div key={key} className="flex items-center gap-3">
                      <div className="w-28 text-xs text-slate-400 capitalize">{key}</div>
                      <div className="flex-1 bg-slate-800 rounded-full h-3">
                        <div className="h-3 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500"
                          style={{ width: `${Math.min((val.total / 100) * 100, 100)}%` }} />
                      </div>
                      <span className="text-sm text-white w-8 text-right">{val.total}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-slate-900/80 border-slate-700/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Daily Volume</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading && !demoMode ? (
              <div className="animate-pulse h-32 bg-slate-800/50 rounded" />
            ) : dailyVolume.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm">No data for this period</div>
            ) : (
              <div className="flex items-end gap-1 h-32">
                {(demoMode ? dailyVolume : dailyVolume.slice(0, 14)).map((d: any, i: number) => {
                  const val = demoMode ? (d.inbound + d.outbound) : Number(d.count || 0);
                  const maxVal = Math.max(...(demoMode ? dailyVolume : dailyVolume).map((x: any) =>
                    demoMode ? (x.inbound + x.outbound) : Number(x.count || 0)), 1);
                  const h = Math.max((val / maxVal) * 100, 4);
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-[9px] text-slate-500">{val}</span>
                      <div className="w-full rounded-t bg-gradient-to-t from-purple-600 to-pink-500 transition-all" style={{ height: `${h}%` }} />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {demoMode && demoData?.analytics?.topPosts && (
        <Card className="bg-slate-900/80 border-slate-700/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Top Posts by Engagement</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {demoData.analytics.topPosts.map((post: any, i: number) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50" data-testid={`top-post-${i}`}>
                  <div className="text-lg font-bold text-slate-500">#{i + 1}</div>
                  <div className="flex-1">
                    <div className="text-sm text-white font-medium">{post.postId}</div>
                    <div className="text-xs text-slate-400">{post.comments} comments · {post.replies} replies</div>
                  </div>
                  <ChannelBadge channel={post.platform} />
                  <div className="text-sm text-cyan-400 font-medium">{post.engagement}%</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SettingsTab({ subAccountId, demoMode }: { subAccountId: number; demoMode: boolean }) {
  return (
    <div className="space-y-6" data-testid="settings-tab">
      <ConnectFlow subAccountId={subAccountId} />

      <Card className="bg-slate-900/80 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bot size={18} className="text-cyan-400" /> AI Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700/30">
            <div className="text-sm text-white mb-1">AI Persona Training</div>
            <div className="text-xs text-slate-400 mb-3">Train your AI assistant by providing business info, tone preferences, and example responses.</div>
            <Button size="sm" className="bg-purple-600 hover:bg-purple-700" data-testid="button-train-ai"
              onClick={() => window.location.href = "/bot-trainer"}>
              <Sparkles size={14} className="mr-1" /> Open Neural Trainer
            </Button>
          </div>
          <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700/30">
            <div className="text-sm text-white mb-1">Auto-Generated Workflows</div>
            <div className="text-xs text-slate-400 mb-3">Get personalized AI workflows tailored to your business type and industry.</div>
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700" data-testid="button-workflows"
              onClick={() => window.location.href = "/workflows"}>
              <Zap size={14} className="mr-1" /> View Workflows
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-slate-900/80 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield size={18} className="text-amber-400" /> Safety & Compliance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50">
            <div>
              <div className="text-sm text-white">Profanity Filter</div>
              <div className="text-xs text-slate-400">Block messages containing offensive language</div>
            </div>
            <Switch checked={true} disabled data-testid="switch-profanity-filter" />
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50">
            <div>
              <div className="text-sm text-white">Crisis Detection</div>
              <div className="text-xs text-slate-400">Flag and escalate self-harm or threat messages</div>
            </div>
            <Switch checked={true} disabled data-testid="switch-crisis-detection" />
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50">
            <div>
              <div className="text-sm text-white">PII Detection</div>
              <div className="text-xs text-slate-400">Detect and flag personal data in messages</div>
            </div>
            <Switch checked={true} disabled data-testid="switch-pii-detection" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function BillingTab({ subAccountId, demoMode }: { subAccountId: number; demoMode: boolean }) {
  const { data: usageData, isLoading } = useQuery({
    queryKey: ["/api/meta-messaging/usage", subAccountId],
    queryFn: () => fetch(`/api/meta-messaging/usage/${subAccountId}`).then(r => r.json()),
    enabled: !demoMode,
  });

  const { data: demoData } = useQuery({
    queryKey: ["/api/meta-messaging/demo-data"],
    queryFn: () => fetch("/api/meta-messaging/demo-data").then(r => r.json()),
    enabled: demoMode,
  });

  const usage = demoMode ? demoData?.usage : usageData?.usage;
  const plan = demoMode ? "pro" : usageData?.plan || "starter";

  const plans = [
    { id: "starter", name: "Starter", price: 29, msgs: 500, comments: 200, features: ["FB + IG DM Bot", "Comment Bot (FB)", "Basic Analytics"] },
    { id: "pro", name: "Pro", price: 49, msgs: 2000, comments: 1000, features: ["Everything in Starter", "IG Comment Bot", "Advanced Analytics", "Priority Support"] },
    { id: "enterprise", name: "Enterprise", price: 149, msgs: 10000, comments: 5000, features: ["Everything in Pro", "Custom AI Training", "API Access", "White Label", "Dedicated Support"] },
  ];

  return (
    <div className="space-y-6" data-testid="billing-tab">
      {usage && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="bg-slate-900/80 border-slate-700/50">
            <CardContent className="pt-4 pb-4">
              <div className="text-sm text-slate-400 mb-2">DM Messages Used</div>
              <div className="flex items-end gap-2 mb-2">
                <span className="text-3xl font-bold text-white">{usage.messagesUsed}</span>
                <span className="text-sm text-slate-400 mb-1">/ {usage.messagesLimit}</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2">
                <div className="h-2 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all"
                  style={{ width: `${Math.min((usage.messagesUsed / usage.messagesLimit) * 100, 100)}%` }} />
              </div>
              <div className="text-xs text-slate-500 mt-1">{Math.round((usage.messagesUsed / usage.messagesLimit) * 100)}% used</div>
            </CardContent>
          </Card>
          <Card className="bg-slate-900/80 border-slate-700/50">
            <CardContent className="pt-4 pb-4">
              <div className="text-sm text-slate-400 mb-2">Comments Processed</div>
              <div className="flex items-end gap-2 mb-2">
                <span className="text-3xl font-bold text-white">{usage.commentsProcessed}</span>
                <span className="text-sm text-slate-400 mb-1">/ {usage.commentsLimit}</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2">
                <div className="h-2 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all"
                  style={{ width: `${Math.min((usage.commentsProcessed / usage.commentsLimit) * 100, 100)}%` }} />
              </div>
              <div className="text-xs text-slate-500 mt-1">{Math.round((usage.commentsProcessed / usage.commentsLimit) * 100)}% used</div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {plans.map(p => (
          <Card key={p.id} className={`border ${plan === p.id ? "border-cyan-500/50 bg-slate-900/80" : "bg-slate-900/60 border-slate-700/50"}`}
            data-testid={`plan-card-${p.id}`}>
            <CardContent className="pt-5 pb-5">
              {plan === p.id && <Badge className="bg-cyan-500/20 text-cyan-400 mb-3">Current Plan</Badge>}
              <div className="text-lg font-bold text-white">{p.name}</div>
              <div className="text-3xl font-bold text-white mt-1">${p.price}<span className="text-sm text-slate-400 font-normal">/mo</span></div>
              <div className="text-xs text-slate-400 mt-1">{p.msgs.toLocaleString()} DMs · {p.comments.toLocaleString()} comments</div>
              <div className="mt-4 space-y-2">
                {p.features.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-slate-300">
                    <CheckCircle2 size={12} className="text-green-400" /> {f}
                  </div>
                ))}
              </div>
              {plan !== p.id && (
                <Button size="sm" className="w-full mt-4 bg-slate-700 hover:bg-slate-600" data-testid={`button-upgrade-${p.id}`}>
                  {plans.findIndex(x => x.id === p.id) > plans.findIndex(x => x.id === plan) ? "Upgrade" : "Downgrade"}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {demoMode && demoData?.usage?.invoices && (
        <Card className="bg-slate-900/80 border-slate-700/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent Invoices</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {demoData.usage.invoices.map((inv: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50" data-testid={`invoice-${i}`}>
                  <div className="text-sm text-white">{inv.id}</div>
                  <div className="text-sm text-slate-400">{new Date(inv.date).toLocaleDateString()}</div>
                  <div className="text-sm text-white font-medium">${inv.amount.toFixed(2)}</div>
                  <Badge className="bg-green-500/20 text-green-400">{inv.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ProtectedAccountBanner() {
  return (
    <div className="rounded-xl border-2 border-red-500/50 bg-red-950/40 p-4 flex items-center gap-3" data-testid="banner-protected-account">
      <div className="w-12 h-12 rounded-xl bg-red-500/20 flex items-center justify-center flex-shrink-0">
        <ShieldAlert size={24} className="text-red-400" />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <Lock size={14} className="text-red-400" />
          <span className="text-sm font-bold text-red-400 uppercase tracking-wide">Protected Account — Do Not Touch</span>
        </div>
        <p className="text-xs text-red-300/80">
          This account is protected. All write operations (send, approve, edit, seed, toggle) are disabled. Read-only access is available for auditing purposes.
        </p>
      </div>
    </div>
  );
}

export default function MetaMessagingPage() {
  const subAccountId = useActiveSubAccountId();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [demoMode, setDemoMode] = useState(false);

  const { data: accounts = [] } = useQuery<SubAccount[]>({ queryKey: ["/api/accounts"] });
  const activeAccount = accounts.find(a => a.id === subAccountId);
  const isProtected = activeAccount?.isProtected === true;

  return (
    <div className="min-h-screen p-4 lg:p-6 space-y-6" data-testid="meta-messaging-page">
      {isProtected && <ProtectedAccountBanner />}

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2" data-testid="text-page-title">
            <MessageSquare size={28} className="text-cyan-400" />
            Meta Messaging
          </h1>
          <p className="text-sm text-slate-400 mt-1">DM chatbot, comment bots, and AI workflows for Facebook & Instagram</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/50">
            <span className="text-xs text-slate-400">Demo</span>
            <Switch checked={demoMode} onCheckedChange={setDemoMode} data-testid="switch-demo-mode" />
          </div>
          {demoMode && (
            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30" data-testid="badge-demo-mode">
              <Sparkles size={12} className="mr-1" /> Demo Mode
            </Badge>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-slate-900/80 border border-slate-700/50 p-1 w-full overflow-x-auto flex">
          {TABS.map(tab => (
            <TabsTrigger key={tab.id} value={tab.id}
              className="flex items-center gap-1.5 text-xs data-[state=active]:bg-slate-700 data-[state=active]:text-white whitespace-nowrap"
              data-testid={`tab-${tab.id}`}>
              <tab.icon size={14} />
              <span className="hidden sm:inline">{tab.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="mt-4">
          <TabsContent value="dashboard">
            {subAccountId && <DashboardTab subAccountId={subAccountId} demoMode={demoMode || isProtected} />}
          </TabsContent>
          <TabsContent value="inbox">
            {subAccountId && <InboxTab subAccountId={subAccountId} demoMode={demoMode || isProtected} />}
          </TabsContent>
          <TabsContent value="comments">
            {subAccountId && <CommentsTab subAccountId={subAccountId} demoMode={demoMode || isProtected} />}
          </TabsContent>
          <TabsContent value="safety">
            {subAccountId && <SafetyTab subAccountId={subAccountId} demoMode={demoMode || isProtected} />}
          </TabsContent>
          <TabsContent value="analytics">
            {subAccountId && <AnalyticsTab subAccountId={subAccountId} demoMode={demoMode || isProtected} />}
          </TabsContent>
          <TabsContent value="settings">
            {subAccountId && <SettingsTab subAccountId={subAccountId} demoMode={demoMode || isProtected} />}
          </TabsContent>
          <TabsContent value="billing">
            {subAccountId && <BillingTab subAccountId={subAccountId} demoMode={demoMode || isProtected} />}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
