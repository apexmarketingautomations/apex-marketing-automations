import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { useActiveSubAccountId } from "@/components/account-required";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity, MessageCircle, Instagram, Facebook, MessageSquare, AlertTriangle,
  CheckCircle2, XCircle, RefreshCw, Wifi, WifiOff, Clock, Send, ArrowDown,
  ArrowUp, Shield, RotateCcw, Zap, Eye, ChevronDown, ChevronUp, Settings,
  TrendingUp, Filter, Search
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Input } from "@/components/ui/input";

type ChannelStatus = "connected" | "token_issue" | "no_ig_account" | "disconnected";

interface ChannelHealth {
  status: ChannelStatus;
  inbound24h?: number;
  outbound24h?: number;
  failed24h?: number;
  total24h?: number;
  lastInbound?: string | null;
  lastOutbound?: string | null;
  lastEvent?: string | null;
  lastReply?: string | null;
}

interface HealthData {
  account: { id: number; name: string; pageId: string; igAccountId: string };
  credentials: { hasPageId: boolean; hasToken: boolean; hasIgId: boolean; tokenValid: boolean; pageName: string; tokenError: string };
  autoReply: { enabled: boolean; hasPersona: boolean };
  commentBot: { enabled: boolean; maxPerHour: number; repliedThisHour: number; replyStyle: string };
  channels: {
    facebookDm: ChannelHealth;
    instagramDm: ChannelHealth;
    facebookComments: ChannelHealth;
    instagramComments: ChannelHealth;
  };
  commentStats24h: { total: number; replied: number; skipped: number; failed: number; rateLimited: number };
}

function StatusDot({ status }: { status: ChannelStatus }) {
  const colors: Record<ChannelStatus, string> = {
    connected: "bg-emerald-400 shadow-emerald-400/50",
    token_issue: "bg-amber-400 shadow-amber-400/50",
    no_ig_account: "bg-amber-400 shadow-amber-400/50",
    disconnected: "bg-red-400 shadow-red-400/50",
  };
  return <div className={`w-2.5 h-2.5 rounded-full shadow-lg ${colors[status]} animate-pulse`} />;
}

function StatusLabel({ status }: { status: ChannelStatus }) {
  const labels: Record<ChannelStatus, { text: string; color: string }> = {
    connected: { text: "Connected", color: "text-emerald-400" },
    token_issue: { text: "Token Issue", color: "text-amber-400" },
    no_ig_account: { text: "No IG Account", color: "text-amber-400" },
    disconnected: { text: "Disconnected", color: "text-red-400" },
  };
  const l = labels[status];
  return <span className={`text-xs font-medium ${l.color}`}>{l.text}</span>;
}

function TimeAgo({ date, label }: { date: string | null | undefined; label: string }) {
  if (!date) return <span className="text-xs text-zinc-500">{label}: Never</span>;
  return (
    <span className="text-xs text-zinc-400" title={new Date(date).toLocaleString()}>
      {label}: {formatDistanceToNow(new Date(date), { addSuffix: true })}
    </span>
  );
}

function ChannelCard({ title, icon: Icon, channel, iconColor }: { title: string; icon: any; channel: ChannelHealth; iconColor: string }) {
  const isDm = channel.inbound24h !== undefined;
  return (
    <Card className="bg-white/5 border-white/10" data-testid={`card-channel-${title.toLowerCase().replace(/\s/g, "-")}`}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Icon size={18} className={iconColor} />
            <span className="text-sm font-semibold text-white">{title}</span>
          </div>
          <div className="flex items-center gap-2">
            <StatusDot status={channel.status} />
            <StatusLabel status={channel.status} />
          </div>
        </div>

        {isDm ? (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-white/5 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-cyan-400" data-testid={`text-inbound-${title}`}>{channel.inbound24h}</div>
                <div className="text-[10px] text-zinc-500 flex items-center justify-center gap-1"><ArrowDown size={10} />Inbound</div>
              </div>
              <div className="bg-white/5 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-emerald-400" data-testid={`text-outbound-${title}`}>{channel.outbound24h}</div>
                <div className="text-[10px] text-zinc-500 flex items-center justify-center gap-1"><ArrowUp size={10} />Sent</div>
              </div>
              <div className="bg-white/5 rounded-lg p-2 text-center">
                <div className={`text-lg font-bold ${(channel.failed24h || 0) > 0 ? "text-red-400" : "text-zinc-500"}`} data-testid={`text-failed-${title}`}>{channel.failed24h}</div>
                <div className="text-[10px] text-zinc-500 flex items-center justify-center gap-1"><XCircle size={10} />Failed</div>
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              <TimeAgo date={channel.lastInbound} label="Last in" />
              <TimeAgo date={channel.lastOutbound} label="Last out" />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="bg-white/5 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-violet-400" data-testid={`text-total-${title}`}>{channel.total24h}</div>
              <div className="text-[10px] text-zinc-500">Events (24h)</div>
            </div>
            <div className="flex flex-col gap-0.5">
              <TimeAgo date={channel.lastEvent} label="Last event" />
              <TimeAgo date={channel.lastReply} label="Last reply" />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OverviewTab({ health }: { health: HealthData }) {
  const ch = health.channels;
  const cs = health.commentStats24h;
  const totalIn = (ch.facebookDm.inbound24h || 0) + (ch.instagramDm.inbound24h || 0);
  const totalOut = (ch.facebookDm.outbound24h || 0) + (ch.instagramDm.outbound24h || 0);
  const totalFailed = (ch.facebookDm.failed24h || 0) + (ch.instagramDm.failed24h || 0) + cs.failed;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-gradient-to-br from-cyan-500/10 to-cyan-500/5 border-cyan-500/20">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-cyan-400" data-testid="text-total-inbound">{totalIn}</div>
            <div className="text-xs text-zinc-400">DMs Received (24h)</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border-emerald-500/20">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-emerald-400" data-testid="text-total-outbound">{totalOut}</div>
            <div className="text-xs text-zinc-400">DMs Sent (24h)</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-violet-500/10 to-violet-500/5 border-violet-500/20">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-violet-400" data-testid="text-comments-replied">{cs.replied}</div>
            <div className="text-xs text-zinc-400">Comments Replied (24h)</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-red-500/10 to-red-500/5 border-red-500/20">
          <CardContent className="p-4 text-center">
            <div className={`text-2xl font-bold ${totalFailed > 0 ? "text-red-400" : "text-zinc-500"}`} data-testid="text-total-failed">{totalFailed}</div>
            <div className="text-xs text-zinc-400">Total Failed (24h)</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChannelCard title="Facebook DMs" icon={Facebook} channel={ch.facebookDm} iconColor="text-blue-400" />
        <ChannelCard title="Instagram DMs" icon={Instagram} channel={ch.instagramDm} iconColor="text-pink-400" />
        <ChannelCard title="FB Comments" icon={MessageSquare} channel={ch.facebookComments} iconColor="text-blue-300" />
        <ChannelCard title="IG Comments" icon={MessageCircle} channel={ch.instagramComments} iconColor="text-pink-300" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-white/5 border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Shield size={16} className="text-cyan-400" />
              <span className="text-sm font-semibold text-white">Credentials</span>
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between"><span className="text-zinc-400">Page ID</span><span className={health.credentials.hasPageId ? "text-emerald-400" : "text-red-400"}>{health.credentials.hasPageId ? "Set" : "Missing"}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Access Token</span><span className={health.credentials.hasToken ? "text-emerald-400" : "text-red-400"}>{health.credentials.hasToken ? "Set" : "Missing"}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">IG Account ID</span><span className={health.credentials.hasIgId ? "text-emerald-400" : "text-amber-400"}>{health.credentials.hasIgId ? "Set" : "Not Set"}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Token Valid</span><span className={health.credentials.tokenValid ? "text-emerald-400" : "text-red-400"}>{health.credentials.tokenValid ? "Yes" : "No"}</span></div>
              {health.credentials.pageName && <div className="flex justify-between"><span className="text-zinc-400">Page Name</span><span className="text-white">{health.credentials.pageName}</span></div>}
              {health.credentials.tokenError && <div className="text-red-400 mt-1">{health.credentials.tokenError}</div>}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/5 border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap size={16} className="text-amber-400" />
              <span className="text-sm font-semibold text-white">AI Auto-Reply</span>
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between"><span className="text-zinc-400">Status</span><span className={health.autoReply.enabled ? "text-emerald-400" : "text-red-400"}>{health.autoReply.enabled ? "Active" : "Disabled"}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Persona Mode</span><span className={health.autoReply.hasPersona ? "text-cyan-400" : "text-zinc-500"}>{health.autoReply.hasPersona ? "Full Persona" : "Default"}</span></div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/5 border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare size={16} className="text-violet-400" />
              <span className="text-sm font-semibold text-white">Comment Bot</span>
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between"><span className="text-zinc-400">Status</span><span className={health.commentBot.enabled ? "text-emerald-400" : "text-red-400"}>{health.commentBot.enabled ? "Active" : "Disabled"}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Rate</span><span className="text-white">{health.commentBot.repliedThisHour}/{health.commentBot.maxPerHour}/hr</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Style</span><span className="text-cyan-400">{health.commentBot.replyStyle}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">24h</span>
                <span className="text-white">{cs.replied}r {cs.skipped}s {cs.failed}f {cs.rateLimited}rl</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DmFeedTab({ subAccountId }: { subAccountId: number }) {
  const [channel, setChannel] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/meta-ops/dm-feed", subAccountId, channel, statusFilter],
    queryFn: () => apiRequest("GET", `/api/meta-ops/dm-feed/${subAccountId}?channel=${channel}&status=${statusFilter}&limit=80`).then(r => r.json()),
    refetchInterval: 15000,
  });

  const msgs = (data?.messages || []).filter((m: any) => !search || m.body?.toLowerCase().includes(search.toLowerCase()) || m.contactPhone?.includes(search));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
          {["all", "facebook", "instagram"].map(c => (
            <button key={c} onClick={() => setChannel(c)} className={`px-3 py-1 text-xs rounded-md transition-colors ${channel === c ? "bg-cyan-500/20 text-cyan-400" : "text-zinc-400 hover:text-white"}`} data-testid={`button-channel-${c}`}>
              {c === "all" ? "All" : c === "facebook" ? "FB" : "IG"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
          {["all", "sent", "failed"].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1 text-xs rounded-md transition-colors ${statusFilter === s ? "bg-cyan-500/20 text-cyan-400" : "text-zinc-400 hover:text-white"}`} data-testid={`button-status-${s}`}>
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search messages..." className="pl-8 h-8 text-xs bg-white/5 border-white/10" data-testid="input-search-dm" />
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()} data-testid="button-refresh-dm"><RefreshCw size={14} /></Button>
      </div>

      {isLoading ? (
        <div className="text-center text-zinc-500 py-8">Loading messages...</div>
      ) : msgs.length === 0 ? (
        <div className="text-center text-zinc-500 py-8">No messages found</div>
      ) : (
        <div className="space-y-1.5 max-h-[600px] overflow-y-auto">
          {msgs.map((m: any) => (
            <motion.div key={m.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-start gap-3 p-3 bg-white/[0.03] hover:bg-white/[0.06] rounded-lg transition-colors" data-testid={`row-dm-${m.id}`}>
              <div className={`mt-0.5 p-1.5 rounded-full ${m.channel === "instagram" ? "bg-pink-500/20" : "bg-blue-500/20"}`}>
                {m.channel === "instagram" ? <Instagram size={12} className="text-pink-400" /> : <Facebook size={12} className="text-blue-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-medium text-white">{m.displayName || m.contactFirstName || m.contactPhone || m.senderId}</span>
                  <Badge variant="outline" className={`text-[10px] px-1 py-0 ${m.direction === "inbound" ? "border-cyan-500/30 text-cyan-400" : "border-emerald-500/30 text-emerald-400"}`}>
                    {m.direction === "inbound" ? "IN" : "OUT"}
                  </Badge>
                  <Badge variant="outline" className={`text-[10px] px-1 py-0 ${m.status === "sent" ? "border-emerald-500/30 text-emerald-400" : m.status === "failed" ? "border-red-500/30 text-red-400" : "border-zinc-500/30 text-zinc-400"}`}>
                    {m.status}
                  </Badge>
                </div>
                <p className="text-xs text-zinc-300 truncate max-w-lg">{m.body}</p>
              </div>
              <span className="text-[10px] text-zinc-500 shrink-0">{m.createdAt ? format(new Date(m.createdAt), "MMM d HH:mm") : ""}</span>
            </motion.div>
          ))}
        </div>
      )}
      {data?.total > 0 && <div className="text-xs text-zinc-500 text-center">Showing {msgs.length} of {data.total} messages</div>}
    </div>
  );
}

function CommentFeedTab({ subAccountId }: { subAccountId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/meta-ops/comment-feed", subAccountId, statusFilter, platformFilter],
    queryFn: () => apiRequest("GET", `/api/meta-ops/comment-feed/${subAccountId}?status=${statusFilter}&platform=${platformFilter}&limit=80`).then(r => r.json()),
    refetchInterval: 15000,
  });

  const retryMutation = useMutation({
    mutationFn: (commentReplyId: number) => apiRequest("POST", `/api/meta-ops/retry-comment/${commentReplyId}`).then(r => r.json()),
    onSuccess: () => { toast({ title: "Retry queued" }); queryClient.invalidateQueries({ queryKey: ["/api/meta-ops/comment-feed"] }); },
    onError: (e: any) => { toast({ title: "Retry failed", description: e.message, variant: "destructive" }); },
  });

  const stats = data?.stats || {};
  const comments = data?.comments || [];

  const statusColors: Record<string, string> = {
    replied: "border-emerald-500/30 text-emerald-400",
    skipped: "border-zinc-500/30 text-zinc-400",
    failed: "border-red-500/30 text-red-400",
    processing: "border-amber-500/30 text-amber-400",
    rate_limited: "border-orange-500/30 text-orange-400",
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-2 text-xs">
          <Badge className="bg-white/5 text-white border-white/10">{stats.total} total</Badge>
          <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">{stats.replied} replied</Badge>
          <Badge className="bg-zinc-500/10 text-zinc-400 border-zinc-500/20">{stats.skipped} skipped</Badge>
          <Badge className="bg-red-500/10 text-red-400 border-red-500/20">{stats.failed} failed</Badge>
          <Badge className="bg-orange-500/10 text-orange-400 border-orange-500/20">{stats.rateLimited} rate-limited</Badge>
        </div>
        <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1 ml-auto">
          {["all", "replied", "skipped", "failed", "rate_limited"].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`px-2 py-0.5 text-[10px] rounded transition-colors ${statusFilter === s ? "bg-cyan-500/20 text-cyan-400" : "text-zinc-400 hover:text-white"}`} data-testid={`button-comment-status-${s}`}>
              {s === "all" ? "All" : s.replace("_", " ")}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
          {["all", "facebook", "instagram"].map(p => (
            <button key={p} onClick={() => setPlatformFilter(p)} className={`px-2 py-0.5 text-[10px] rounded transition-colors ${platformFilter === p ? "bg-cyan-500/20 text-cyan-400" : "text-zinc-400 hover:text-white"}`} data-testid={`button-comment-platform-${p}`}>
              {p === "all" ? "All" : p === "facebook" ? "FB" : "IG"}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()} data-testid="button-refresh-comments"><RefreshCw size={14} /></Button>
      </div>

      {isLoading ? (
        <div className="text-center text-zinc-500 py-8">Loading comments...</div>
      ) : comments.length === 0 ? (
        <div className="text-center text-zinc-500 py-8">No comment replies found</div>
      ) : (
        <div className="space-y-1.5 max-h-[600px] overflow-y-auto">
          {comments.map((c: any) => (
            <div key={c.id} className="bg-white/[0.03] hover:bg-white/[0.06] rounded-lg transition-colors" data-testid={`row-comment-${c.id}`}>
              <div className="flex items-start gap-3 p-3 cursor-pointer" onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}>
                <div className={`mt-0.5 p-1.5 rounded-full ${c.platform === "instagram" ? "bg-pink-500/20" : "bg-blue-500/20"}`}>
                  {c.platform === "instagram" ? <Instagram size={12} className="text-pink-400" /> : <Facebook size={12} className="text-blue-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium text-white">{c.commenterName || c.commenterId || "Unknown"}</span>
                    <Badge variant="outline" className={`text-[10px] px-1 py-0 ${statusColors[c.status] || "border-zinc-500/30 text-zinc-400"}`}>
                      {c.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-zinc-300 truncate max-w-lg">{c.commentText}</p>
                  {c.replyText && <p className="text-[10px] text-cyan-400/70 truncate max-w-lg mt-0.5">→ {c.replyText}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-zinc-500">{c.createdAt ? format(new Date(c.createdAt), "MMM d HH:mm") : ""}</span>
                  {c.status === "failed" && (
                    <Button variant="ghost" size="sm" className="h-6 px-2" onClick={(e) => { e.stopPropagation(); retryMutation.mutate(c.id); }} data-testid={`button-retry-comment-${c.id}`}>
                      <RotateCcw size={12} />
                    </Button>
                  )}
                  {expandedId === c.id ? <ChevronUp size={14} className="text-zinc-500" /> : <ChevronDown size={14} className="text-zinc-500" />}
                </div>
              </div>
              <AnimatePresence>
                {expandedId === c.id && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="px-3 pb-3 space-y-1.5 text-[11px]">
                      <div className="grid grid-cols-2 gap-2">
                        <div><span className="text-zinc-500">Post ID:</span> <span className="text-zinc-300 font-mono">{c.postId}</span></div>
                        <div><span className="text-zinc-500">Comment ID:</span> <span className="text-zinc-300 font-mono">{c.commentId}</span></div>
                        <div><span className="text-zinc-500">Platform:</span> <span className="text-zinc-300">{c.platform}</span></div>
                        <div><span className="text-zinc-500">Replied At:</span> <span className="text-zinc-300">{c.repliedAt ? format(new Date(c.repliedAt), "MMM d HH:mm:ss") : "N/A"}</span></div>
                      </div>
                      {c.errorMessage && <div className="text-red-400 bg-red-500/10 rounded p-2">Error: {c.errorMessage}</div>}
                      {c.commentText && <div><span className="text-zinc-500">Full comment:</span><p className="text-zinc-300 mt-0.5 whitespace-pre-wrap">{c.commentText}</p></div>}
                      {c.replyText && <div><span className="text-zinc-500">Full reply:</span><p className="text-cyan-400/80 mt-0.5 whitespace-pre-wrap">{c.replyText}</p></div>}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FailedEventsTab({ subAccountId }: { subAccountId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/meta-ops/failed-events", subAccountId],
    queryFn: () => apiRequest("GET", `/api/meta-ops/failed-events/${subAccountId}`).then(r => r.json()),
    refetchInterval: 30000,
  });

  const retryDmMutation = useMutation({
    mutationFn: (messageId: number) => apiRequest("POST", `/api/meta-ops/retry-dm/${messageId}`).then(r => r.json()),
    onSuccess: () => { toast({ title: "DM resent successfully" }); queryClient.invalidateQueries({ queryKey: ["/api/meta-ops/failed-events"] }); },
    onError: (e: any) => { toast({ title: "Retry failed", description: e.message, variant: "destructive" }); },
  });

  const retryCommentMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/meta-ops/retry-comment/${id}`).then(r => r.json()),
    onSuccess: () => { toast({ title: "Comment retry queued" }); queryClient.invalidateQueries({ queryKey: ["/api/meta-ops/failed-events"] }); },
    onError: (e: any) => { toast({ title: "Retry failed", description: e.message, variant: "destructive" }); },
  });

  const failedDms = data?.failedDms || [];
  const failedComments = data?.failedComments || [];
  const totalFailed = failedDms.length + failedComments.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} className={totalFailed > 0 ? "text-red-400" : "text-zinc-500"} />
        <span className="text-sm font-semibold text-white">{totalFailed} Failed Events</span>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="ml-auto" data-testid="button-refresh-failed"><RefreshCw size={14} /></Button>
      </div>

      {isLoading ? (
        <div className="text-center text-zinc-500 py-8">Loading...</div>
      ) : totalFailed === 0 ? (
        <div className="text-center py-12">
          <CheckCircle2 size={32} className="text-emerald-400 mx-auto mb-2" />
          <div className="text-sm text-emerald-400">All clear — no failed events</div>
        </div>
      ) : (
        <>
          {failedDms.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-zinc-400 mb-2 uppercase">Failed DMs ({failedDms.length})</h3>
              <div className="space-y-1.5">
                {failedDms.map((m: any) => (
                  <div key={m.id} className="flex items-center gap-3 p-3 bg-red-500/5 border border-red-500/10 rounded-lg" data-testid={`row-failed-dm-${m.id}`}>
                    <XCircle size={14} className="text-red-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs">
                        <Badge variant="outline" className="text-[10px] border-zinc-500/30">{m.channel}</Badge>
                        <span className="text-zinc-400">{m.contactPhone}</span>
                      </div>
                      <p className="text-xs text-zinc-300 truncate mt-0.5">{m.body}</p>
                    </div>
                    <span className="text-[10px] text-zinc-500 shrink-0">{m.createdAt ? format(new Date(m.createdAt), "MMM d HH:mm") : ""}</span>
                    <Button variant="outline" size="sm" className="h-7 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10" onClick={() => retryDmMutation.mutate(m.id)} disabled={retryDmMutation.isPending} data-testid={`button-retry-dm-${m.id}`}>
                      <RotateCcw size={12} className="mr-1" />Retry
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {failedComments.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-zinc-400 mb-2 uppercase">Failed Comments ({failedComments.length})</h3>
              <div className="space-y-1.5">
                {failedComments.map((c: any) => (
                  <div key={c.id} className="flex items-center gap-3 p-3 bg-red-500/5 border border-red-500/10 rounded-lg" data-testid={`row-failed-comment-${c.id}`}>
                    <XCircle size={14} className="text-red-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs">
                        <Badge variant="outline" className="text-[10px] border-zinc-500/30">{c.platform}</Badge>
                        {c.errorMessage && <span className="text-red-400 truncate max-w-[200px]">{c.errorMessage}</span>}
                      </div>
                      <p className="text-xs text-zinc-300 truncate mt-0.5">{c.commentText}</p>
                    </div>
                    <span className="text-[10px] text-zinc-500 shrink-0">{c.createdAt ? format(new Date(c.createdAt), "MMM d HH:mm") : ""}</span>
                    <Button variant="outline" size="sm" className="h-7 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10" onClick={() => retryCommentMutation.mutate(c.id)} disabled={retryCommentMutation.isPending} data-testid={`button-retry-failed-comment-${c.id}`}>
                      <RotateCcw size={12} className="mr-1" />Retry
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PermissionsTab({ subAccountId }: { subAccountId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/meta-ops/permissions", subAccountId],
    queryFn: () => apiRequest("GET", `/api/meta-ops/permissions/${subAccountId}`).then(r => r.json()),
  });

  if (isLoading) return <div className="text-center text-zinc-500 py-8">Checking permissions...</div>;
  if (!data?.configured) return <div className="text-center text-zinc-500 py-8">Meta credentials not configured for this account</div>;

  const requiredPerms = ["pages_messaging", "pages_manage_metadata", "pages_read_engagement", "instagram_basic", "instagram_manage_messages", "instagram_manage_comments"];

  return (
    <div className="space-y-6">
      {data.tokenDebug && (
        <Card className="bg-white/5 border-white/10">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Token Info</h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-zinc-400">Valid:</span> <span className={data.tokenDebug.isValid ? "text-emerald-400" : "text-red-400"}>{data.tokenDebug.isValid ? "Yes" : "No"}</span></div>
              <div><span className="text-zinc-400">Expires:</span> <span className="text-zinc-300">{data.tokenDebug.expiresAt}</span></div>
              <div><span className="text-zinc-400">Type:</span> <span className="text-zinc-300">{data.tokenDebug.type}</span></div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-white/5 border-white/10">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold text-white mb-3">Permissions ({data.permissions?.length || 0})</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {requiredPerms.map(perm => {
              const found = data.permissions?.find((p: any) => p.name === perm);
              const granted = found?.status === "granted";
              return (
                <div key={perm} className={`flex items-center gap-2 text-xs p-2 rounded ${granted ? "bg-emerald-500/10" : "bg-red-500/10"}`} data-testid={`perm-${perm}`}>
                  {granted ? <CheckCircle2 size={12} className="text-emerald-400" /> : <XCircle size={12} className="text-red-400" />}
                  <span className={granted ? "text-emerald-400" : "text-red-400"}>{perm.replace(/_/g, " ")}</span>
                </div>
              );
            })}
          </div>
          {data.permissions?.filter((p: any) => !requiredPerms.includes(p.name) && p.status === "granted").length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] text-zinc-500 mb-1">Additional granted permissions:</div>
              <div className="flex flex-wrap gap-1">
                {data.permissions.filter((p: any) => !requiredPerms.includes(p.name) && p.status === "granted").map((p: any) => (
                  <Badge key={p.name} variant="outline" className="text-[10px] border-zinc-500/30 text-zinc-400">{p.name}</Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {data.subscriptions?.length > 0 && (
        <Card className="bg-white/5 border-white/10">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Subscribed Apps</h3>
            {data.subscriptions.map((s: any, i: number) => (
              <div key={i} className="mb-2">
                <span className="text-xs text-cyan-400 font-medium">{s.name}</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {(s.fields || []).map((f: string) => (
                    <Badge key={f} variant="outline" className="text-[10px] border-cyan-500/20 text-cyan-400/70">{f}</Badge>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {data.igAccount && (
        <Card className="bg-white/5 border-white/10">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Instagram Business Account</h3>
            <div className="text-xs space-y-1">
              <div><span className="text-zinc-400">ID:</span> <span className="text-pink-400 font-mono">{data.igAccount.id}</span></div>
              {data.igAccount.username && <div><span className="text-zinc-400">Username:</span> <span className="text-pink-400">@{data.igAccount.username}</span></div>}
              {data.igAccount.name && <div><span className="text-zinc-400">Name:</span> <span className="text-zinc-300">{data.igAccount.name}</span></div>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ControlsTab({ subAccountId, health, onRefresh }: { subAccountId: number; health: HealthData; onRefresh: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const toggleAutoReply = useMutation({
    mutationFn: () => apiRequest("POST", `/api/meta-ops/toggle-auto-reply/${subAccountId}`).then(r => r.json()),
    onSuccess: (data) => { toast({ title: `Auto-reply ${data.autoReplyEnabled ? "enabled" : "disabled"}` }); onRefresh(); },
  });

  const [showBackfillDetails, setShowBackfillDetails] = useState(false);
  const backfillMutation = useMutation({
    mutationFn: (dryRun: boolean) => {
      setShowBackfillDetails(false);
      return apiRequest("POST", `/api/meta-ops/backfill/${subAccountId}`, { dryRun, maxPosts: 5 }).then(r => r.json());
    },
    onSuccess: (data, dryRun) => {
      const queued = data.commentsQueued || 0;
      const found = data.commentsFound || 0;
      toast({
        title: dryRun ? "Preview complete" : "Backfill complete",
        description: dryRun
          ? `Found ${found} comments. ${queued} would be replied to.`
          : `Replied to ${queued} new comment${queued === 1 ? "" : "s"} out of ${found} found.`,
      });
    },
    onError: (e: any) => { toast({ title: "Backfill failed", description: e.message, variant: "destructive" }); },
  });
  const lastBackfillWasPreview = backfillMutation.variables === true;

  return (
    <div className="space-y-6">
      <Card className="bg-white/5 border-white/10">
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold text-white mb-4">DM Controls</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-white">AI Auto-Reply</div>
                <div className="text-xs text-zinc-400">Layla responds to incoming DMs automatically</div>
              </div>
              <Switch checked={health.autoReply.enabled} onCheckedChange={() => toggleAutoReply.mutate()} disabled={toggleAutoReply.isPending} data-testid="switch-auto-reply" />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-white">Persona Mode</div>
                <div className="text-xs text-zinc-400">{health.autoReply.hasPersona ? "Full persona active (system prompt > 200 chars)" : "Using default AI behavior"}</div>
              </div>
              <Badge className={health.autoReply.hasPersona ? "bg-cyan-500/20 text-cyan-400" : "bg-zinc-500/20 text-zinc-400"}>
                {health.autoReply.hasPersona ? "Persona" : "Default"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white/5 border-white/10">
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Comment Backfill</h3>
          <div className="text-xs text-zinc-400 mb-4">Fetch and process recent comments from your FB/IG posts that may have been missed by webhooks.</div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => backfillMutation.mutate(true)} disabled={backfillMutation.isPending} className="border-zinc-500/30" data-testid="button-backfill-preview">
              <Eye size={14} className="mr-1" />Preview
            </Button>
            <Button size="sm" onClick={() => backfillMutation.mutate(false)} disabled={backfillMutation.isPending} className="bg-cyan-500 hover:bg-cyan-600 text-white" data-testid="button-backfill-run">
              <Zap size={14} className="mr-1" />Run Backfill
            </Button>
          </div>
          {backfillMutation.data && (() => {
            const d = backfillMutation.data as {
              postsScanned: number;
              commentsFound: number;
              commentsQueued: number;
              commentsSkipped: number;
              errors: string[];
              details: Array<{ postId: string; commentId: string; commenterName: string | null; text: string; action: string }>;
            };
            const isPreview = lastBackfillWasPreview;
            const hasErrors = d.errors && d.errors.length > 0;
            const headlineColor = hasErrors ? "text-amber-300" : "text-emerald-300";
            const headlineIcon = hasErrors ? AlertTriangle : CheckCircle2;
            const HeadlineIcon = headlineIcon;
            const skippedBreakdown: Record<string, number> = {};
            for (const det of d.details || []) {
              skippedBreakdown[det.action] = (skippedBreakdown[det.action] || 0) + 1;
            }
            const actionLabel = (a: string) => {
              switch (a) {
                case "queued": return isPreview ? "Would reply" : "Replied";
                case "skipped_already_processed": return "Already handled";
                case "skipped_own_comment": return "Your own comment";
                case "skipped_empty": return "No text";
                case "skipped_dry_run": return "Preview only";
                default: return a;
              }
            };
            const actionColor = (a: string) => {
              if (a === "queued") return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
              if (a === "skipped_already_processed") return "bg-zinc-500/20 text-zinc-300 border-zinc-500/30";
              return "bg-zinc-600/20 text-zinc-400 border-zinc-600/30";
            };
            return (
              <div className="mt-4 space-y-3">
                <div className="p-4 bg-white/5 rounded-lg border border-white/10">
                  <div className={`flex items-center gap-2 text-sm font-medium ${headlineColor} mb-3`} data-testid="text-backfill-headline">
                    <HeadlineIcon size={16} />
                    {isPreview ? "Preview complete" : "Backfill complete"}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-2 rounded-md bg-white/5">
                      <div className="text-[10px] uppercase tracking-wide text-zinc-500">Posts scanned</div>
                      <div className="text-lg font-semibold text-white" data-testid="text-backfill-posts">{d.postsScanned}</div>
                    </div>
                    <div className="p-2 rounded-md bg-white/5">
                      <div className="text-[10px] uppercase tracking-wide text-zinc-500">Comments found</div>
                      <div className="text-lg font-semibold text-white" data-testid="text-backfill-found">{d.commentsFound}</div>
                    </div>
                    <div className="p-2 rounded-md bg-emerald-500/10 border border-emerald-500/20">
                      <div className="text-[10px] uppercase tracking-wide text-emerald-400">{isPreview ? "Would reply" : "New replies"}</div>
                      <div className="text-lg font-semibold text-emerald-300" data-testid="text-backfill-queued">{d.commentsQueued}</div>
                    </div>
                    <div className="p-2 rounded-md bg-white/5">
                      <div className="text-[10px] uppercase tracking-wide text-zinc-500">Skipped</div>
                      <div className="text-lg font-semibold text-zinc-300" data-testid="text-backfill-skipped">{d.commentsSkipped}</div>
                    </div>
                  </div>
                  {Object.keys(skippedBreakdown).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {Object.entries(skippedBreakdown).map(([action, count]) => (
                        <Badge key={action} variant="outline" className={`text-[10px] ${actionColor(action)}`}>
                          {actionLabel(action)}: {count}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {hasErrors && (
                    <div className="mt-3 p-2 rounded-md bg-amber-500/10 border border-amber-500/20">
                      <div className="text-xs font-medium text-amber-300 mb-1 flex items-center gap-1">
                        <AlertTriangle size={12} /> {d.errors.length} error{d.errors.length === 1 ? "" : "s"}
                      </div>
                      <ul className="text-xs text-amber-200/80 space-y-0.5 list-disc list-inside">
                        {d.errors.slice(0, 3).map((err, i) => <li key={i}>{err}</li>)}
                      </ul>
                    </div>
                  )}
                  {d.details && d.details.length > 0 && (
                    <button
                      onClick={() => setShowBackfillDetails(v => !v)}
                      className="mt-3 text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                      data-testid="button-toggle-backfill-details"
                    >
                      {showBackfillDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      {showBackfillDetails ? "Hide" : "Show"} per-comment details ({d.details.length})
                    </button>
                  )}
                </div>
                {showBackfillDetails && d.details && d.details.length > 0 && (
                  <div className="p-3 bg-white/5 rounded-lg border border-white/10 max-h-64 overflow-y-auto space-y-2">
                    {d.details.map((det, i) => (
                      <div key={i} className="text-xs border-b border-white/5 last:border-0 pb-2 last:pb-0" data-testid={`row-backfill-detail-${i}`}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="text-zinc-300 font-medium truncate">{det.commenterName || "Unknown"}</div>
                          <Badge variant="outline" className={`text-[10px] shrink-0 ${actionColor(det.action)}`}>
                            {actionLabel(det.action)}
                          </Badge>
                        </div>
                        {det.text && <div className="text-zinc-400 italic">"{det.text.slice(0, 140)}{det.text.length > 140 ? "…" : ""}"</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      <Card className="bg-white/5 border-white/10">
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold text-white mb-2">Account Info</h3>
          <div className="text-xs space-y-1 text-zinc-400">
            <div>Account ID: <span className="text-white font-mono">{health.account.id}</span></div>
            <div>Account Name: <span className="text-white">{health.account.name}</span></div>
            <div>Page ID: <span className="text-white font-mono">{health.account.pageId || "Not set"}</span></div>
            <div>IG Account ID: <span className="text-pink-400 font-mono">{health.account.igAccountId || "Not set"}</span></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ThreadsTab({ subAccountId }: { subAccountId: number }) {
  const [channel, setChannel] = useState("all");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/meta-ops/dm-threads", subAccountId, channel],
    queryFn: () => apiRequest("GET", `/api/meta-ops/dm-threads/${subAccountId}?channel=${channel}`).then(r => r.json()),
    refetchInterval: 30000,
  });

  const threads = data?.threads || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
          {["all", "facebook", "instagram"].map(c => (
            <button key={c} onClick={() => setChannel(c)} className={`px-3 py-1 text-xs rounded-md transition-colors ${channel === c ? "bg-cyan-500/20 text-cyan-400" : "text-zinc-400 hover:text-white"}`} data-testid={`button-thread-channel-${c}`}>
              {c === "all" ? "All" : c === "facebook" ? "FB" : "IG"}
            </button>
          ))}
        </div>
        <span className="text-xs text-zinc-500 ml-auto">{threads.length} conversations</span>
      </div>

      {isLoading ? (
        <div className="text-center text-zinc-500 py-8">Loading threads...</div>
      ) : threads.length === 0 ? (
        <div className="text-center text-zinc-500 py-8">No conversations found</div>
      ) : (
        <div className="space-y-1.5 max-h-[600px] overflow-y-auto">
          {threads.map((t: any, i: number) => (
            <div key={i} className="flex items-center gap-3 p-3 bg-white/[0.03] hover:bg-white/[0.06] rounded-lg transition-colors" data-testid={`row-thread-${i}`}>
              <div className={`p-2 rounded-full ${t.channel === "instagram" ? "bg-pink-500/20" : "bg-blue-500/20"}`}>
                {t.channel === "instagram" ? <Instagram size={14} className="text-pink-400" /> : <Facebook size={14} className="text-blue-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{t.contact_phone || t.sender_id}</span>
                  <span className="text-[10px] text-zinc-500">{Number(t.message_count)} msgs</span>
                  {Number(t.failed_count) > 0 && <Badge variant="outline" className="text-[10px] px-1 py-0 border-red-500/30 text-red-400">{t.failed_count} failed</Badge>}
                </div>
                <p className="text-xs text-zinc-400 truncate mt-0.5">
                  {t.last_direction === "outbound" ? "→ " : "← "}{t.last_message}
                </p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[10px] text-zinc-500">{t.last_message_at ? formatDistanceToNow(new Date(t.last_message_at), { addSuffix: true }) : ""}</div>
                <div className="text-[10px] text-zinc-500">{Number(t.inbound_count)}↓ {Number(t.outbound_count)}↑</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MetaOpsPage() {
  const subAccountId = useActiveSubAccountId();

  const { data: health, isLoading, refetch } = useQuery<HealthData>({
    queryKey: ["/api/meta-ops/health", subAccountId],
    queryFn: () => apiRequest("GET", `/api/meta-ops/health/${subAccountId}`).then(r => r.json()),
    enabled: !!subAccountId,
    refetchInterval: 30000,
  });

  if (!subAccountId) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center text-zinc-500">
          <Activity size={32} className="mx-auto mb-2 opacity-50" />
          <div className="text-sm">Select an account to view Meta operations</div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-cyan-500/20 to-violet-500/20">
              <Activity size={20} className="text-cyan-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white" data-testid="text-page-title">Meta Ops Center</h1>
              <p className="text-xs text-zinc-400">
                {health ? `${health.account.name} — All 4 channels` : "Loading..."}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetch()} data-testid="button-refresh-health">
            <RefreshCw size={14} className="mr-1" />Refresh
          </Button>
        </div>
      </motion.div>

      {isLoading || !health ? (
        <div className="text-center text-zinc-500 py-12">
          <RefreshCw size={24} className="mx-auto mb-2 animate-spin" />
          <div className="text-sm">Loading channel health...</div>
        </div>
      ) : (
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="bg-white/5 border border-white/10 p-1">
            <TabsTrigger value="overview" className="text-xs data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="threads" className="text-xs data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400" data-testid="tab-threads">Threads</TabsTrigger>
            <TabsTrigger value="dm-feed" className="text-xs data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400" data-testid="tab-dm-feed">DM Feed</TabsTrigger>
            <TabsTrigger value="comments" className="text-xs data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400" data-testid="tab-comments">Comments</TabsTrigger>
            <TabsTrigger value="failed" className="text-xs data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400" data-testid="tab-failed">
              Failed
              {((health.commentStats24h.failed || 0) + (health.channels.facebookDm.failed24h || 0) + (health.channels.instagramDm.failed24h || 0)) > 0 && (
                <span className="ml-1 inline-flex items-center justify-center w-4 h-4 text-[9px] bg-red-500 text-white rounded-full">
                  {(health.commentStats24h.failed || 0) + (health.channels.facebookDm.failed24h || 0) + (health.channels.instagramDm.failed24h || 0)}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="permissions" className="text-xs data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400" data-testid="tab-permissions">Permissions</TabsTrigger>
            <TabsTrigger value="controls" className="text-xs data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400" data-testid="tab-controls">Controls</TabsTrigger>
          </TabsList>

          <TabsContent value="overview"><OverviewTab health={health} /></TabsContent>
          <TabsContent value="threads"><ThreadsTab subAccountId={subAccountId} /></TabsContent>
          <TabsContent value="dm-feed"><DmFeedTab subAccountId={subAccountId} /></TabsContent>
          <TabsContent value="comments"><CommentFeedTab subAccountId={subAccountId} /></TabsContent>
          <TabsContent value="failed"><FailedEventsTab subAccountId={subAccountId} /></TabsContent>
          <TabsContent value="permissions"><PermissionsTab subAccountId={subAccountId} /></TabsContent>
          <TabsContent value="controls"><ControlsTab subAccountId={subAccountId} health={health} onRefresh={refetch} /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}
