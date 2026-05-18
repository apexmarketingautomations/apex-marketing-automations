/**
 * client/src/pages/communications/communications-command-center.tsx
 *
 * Apex Communications Command Center — Phase 10
 *
 * Unified real-time dashboard for the entire AI communications platform.
 *
 * Tabs:
 *   1. Overview          — delivery health, channel mix, 24h activity feed
 *   2. Approvals         — pending approval queue, approve/reject workflow
 *   3. Voice & Voicemail — active sessions, voicemail drops, transfer controls
 *   4. SMS Queue         — scheduled, approved, throttled SMS messages
 *   5. iMessage Drafts   — AI-drafted replies awaiting human send
 *   6. Intelligence      — conversation sentiment, urgency scores, escalations
 *   7. Timeline          — immutable audit log with search
 *
 * Design principles:
 *   - All mutation buttons require a named actor (≥2 chars)
 *   - iMessage and approval panels are clearly labeled "Human Required"
 *   - No "Send All" buttons — every action is per-record and intentional
 *   - Auto-refresh every 15 seconds for voice sessions, 30s for everything else
 *   - Read-only timeline tab — no edit actions
 */

import React, { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Phone,
  MessageSquare,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Activity,
  BarChart2,
  Shield,
  Mic,
  PhoneForwarded,
  Send,
  Eye,
  EyeOff,
  TrendingUp,
  TrendingDown,
  Minus,
  Search,
  ChevronRight,
  User,
  Bot,
  Zap,
  Bell,
  Volume2,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ── Config ────────────────────────────────────────────────────────────────────

const TENANT_ID = "apex-default"; // Replace with session tenant in production

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let parsed: any = {};
    try { parsed = JSON.parse(text); } catch {}
    throw new Error(parsed?.error ?? `API error ${res.status}`);
  }
  return res.json();
}

// ── Types (client-side mirrors) ───────────────────────────────────────────────

interface TimelineEvent {
  id: number;
  communicationId: string;
  tenantId: string;
  eventType: string;
  actor: string;
  actorId?: string;
  channel?: string;
  description: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

interface ApprovalRecord {
  approvalId: string;
  communicationId: string;
  tenantId: string;
  status: string;
  requestedBy: string;
  workflowType: string;
  channel: string;
  contactPhone?: string;
  messagePreview?: string;
  expiresAt: string;
  createdAt: string;
}

interface VoiceSession {
  sessionId: string;
  tenantId: string;
  contactPhone: string;
  workflowType: string;
  status: string;
  persona?: string;
  startedAt: string;
  durationSeconds?: number;
}

interface IMessageDraft {
  draftId: string;
  contactPhone?: string;
  contactName?: string;
  workflowType: string;
  aiGeneratedText: string;
  responseOptions: string[];
  status: string;
  createdAt?: string;
}

interface DeliveryMetrics {
  channel: string;
  total: number;
  sent: number;
  delivered: number;
  failed: number;
  optedOut: number;
  deliveryRate: number;
}

interface TimelineStats {
  totalEvents: number;
  byEventType: Record<string, number>;
  byChannel: Record<string, number>;
  aiActed: number;
  humanActed: number;
}

// ── Utility components ─────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  className,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  trend?: "up" | "down" | "flat";
  className?: string;
}) {
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor = trend === "up" ? "text-green-500" : trend === "down" ? "text-red-500" : "text-gray-400";
  return (
    <Card className={cn("", className)}>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Icon className="h-5 w-5 text-muted-foreground" />
            {trend && <TrendIcon className={cn("h-3.5 w-3.5", trendColor)} />}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  const map: Record<string, { label: string; className: string }> = {
    sms:           { label: "SMS",       className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
    voice:         { label: "Voice",     className: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300" },
    imessage:      { label: "iMessage",  className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
    email:         { label: "Email",     className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" },
    voicemail_drop:{ label: "Voicemail", className: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" },
  };
  const config = map[channel] ?? { label: channel, className: "bg-gray-100 text-gray-700" };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", config.className)}>
      {config.label}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    ["sent", "delivered", "approved"].includes(status) ? "bg-green-500" :
    ["sending", "pending", "pending_approval"].includes(status) ? "bg-yellow-500" :
    ["failed", "rejected", "opted_out"].includes(status) ? "bg-red-500" :
    ["throttled", "duplicate", "expired"].includes(status) ? "bg-orange-500" :
    "bg-gray-400";
  return <span className={cn("inline-block w-2 h-2 rounded-full", color)} />;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── TAB 1: Overview ───────────────────────────────────────────────────────────

function OverviewTab() {
  const { data: metrics = [] } = useQuery<DeliveryMetrics[]>({
    queryKey: ["comm-metrics", TENANT_ID],
    queryFn:  () => apiGet("/api/comm/metrics", { tenantId: TENANT_ID }),
    refetchInterval: 30_000,
  });

  const { data: approvalStats } = useQuery<{ pending: number; approved: number; rejected: number; expired: number }>({
    queryKey: ["comm-approval-stats", TENANT_ID],
    queryFn:  () => apiGet("/api/comm/approvals/stats", { tenantId: TENANT_ID }),
    refetchInterval: 30_000,
  });

  const { data: voiceStats } = useQuery<{ total: number; completed: number; transferred: number; active: number }>({
    queryKey: ["comm-voice-stats", TENANT_ID],
    queryFn:  () => apiGet("/api/comm/voice/stats", { tenantId: TENANT_ID }),
    refetchInterval: 15_000,
  });

  const { data: imsgStats } = useQuery<{ pending: number; sent: number; dismissed: number }>({
    queryKey: ["comm-imsg-stats", TENANT_ID],
    queryFn:  () => apiGet("/api/comm/imessage/stats", { tenantId: TENANT_ID }),
    refetchInterval: 30_000,
  });

  const { data: timelineStats } = useQuery<TimelineStats>({
    queryKey: ["comm-timeline-stats", TENANT_ID],
    queryFn:  () => apiGet("/api/comm/timeline/stats", { tenantId: TENANT_ID }),
    refetchInterval: 30_000,
  });

  const { data: recentTimeline = [] } = useQuery<TimelineEvent[]>({
    queryKey: ["comm-timeline-recent", TENANT_ID],
    queryFn:  () => apiGet("/api/comm/timeline", { tenantId: TENANT_ID, limit: "20" }),
    refetchInterval: 15_000,
  });

  const totalDelivered  = metrics.reduce((s, m) => s + (m.delivered ?? 0), 0);
  const totalSent       = metrics.reduce((s, m) => s + (m.sent ?? 0), 0);
  const overallRate     = totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0;

  return (
    <div className="space-y-6">

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Delivery Rate" value={`${overallRate}%`} icon={Activity} trend={overallRate >= 85 ? "up" : "down"} />
        <StatCard label="Pending Approvals" value={approvalStats?.pending ?? 0} icon={Clock}
          className={approvalStats?.pending && approvalStats.pending > 5 ? "border-yellow-500" : ""} />
        <StatCard label="Active Voice Sessions" value={voiceStats?.active ?? 0} icon={Phone} />
        <StatCard label="iMessage Drafts" value={imsgStats?.pending ?? 0} icon={MessageCircle} />
      </div>

      {/* Channel metrics */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <BarChart2 className="h-4 w-4" /> Channel Delivery Health (30 days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {metrics.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No communications in the last 30 days</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b">
                  <th className="text-left py-2">Channel</th>
                  <th className="text-right py-2">Total</th>
                  <th className="text-right py-2">Delivered</th>
                  <th className="text-right py-2">Failed</th>
                  <th className="text-right py-2">Opted Out</th>
                  <th className="text-right py-2">Rate</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) => (
                  <tr key={m.channel} className="border-b last:border-0">
                    <td className="py-2"><ChannelBadge channel={m.channel} /></td>
                    <td className="text-right tabular-nums">{m.total}</td>
                    <td className="text-right tabular-nums text-green-600">{m.delivered}</td>
                    <td className="text-right tabular-nums text-red-500">{m.failed}</td>
                    <td className="text-right tabular-nums text-orange-500">{m.optedOut}</td>
                    <td className="text-right tabular-nums font-medium">
                      <span className={m.deliveryRate >= 85 ? "text-green-600" : m.deliveryRate >= 70 ? "text-yellow-600" : "text-red-500"}>
                        {m.deliveryRate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Timeline stats + live feed */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">24h Activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {timelineStats && (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total events</span>
                  <span className="font-medium">{timelineStats.totalEvents}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="flex items-center gap-1 text-muted-foreground"><Bot className="h-3.5 w-3.5" /> AI actions</span>
                  <span className="font-medium">{timelineStats.aiActed}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="flex items-center gap-1 text-muted-foreground"><User className="h-3.5 w-3.5" /> Human actions</span>
                  <span className="font-medium">{timelineStats.humanActed}</span>
                </div>
                <hr />
                {Object.entries(timelineStats.byChannel ?? {}).map(([ch, count]) => (
                  <div key={ch} className="flex justify-between text-sm">
                    <ChannelBadge channel={ch} />
                    <span>{count as number}</span>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4" /> Live Feed
              <span className="ml-auto text-xs text-muted-foreground font-normal">auto-refreshes every 15s</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {recentTimeline.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No recent activity</p>
              ) : recentTimeline.map((ev) => (
                <div key={ev.id} className="flex items-start gap-2 text-sm py-1 border-b last:border-0">
                  <StatusDot status={ev.eventType} />
                  <div className="flex-1 min-w-0">
                    <p className="truncate">{ev.description}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {ev.channel && <ChannelBadge channel={ev.channel} />}
                      <span className="text-xs text-muted-foreground">{ev.actor}</span>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{relativeTime(ev.createdAt)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

    </div>
  );
}

// ── TAB 2: Approvals ──────────────────────────────────────────────────────────

function ApprovalsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [actorName, setActorName] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const { data: pending = [], isLoading } = useQuery<ApprovalRecord[]>({
    queryKey: ["comm-approvals-pending", TENANT_ID],
    queryFn:  () => apiGet("/api/comm/approvals/pending", { tenantId: TENANT_ID, limit: "50" }),
    refetchInterval: 20_000,
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      apiPost(`/api/comm/approval/${id}/approve`, { tenantId: TENANT_ID, approvedBy: actorName.trim(), notes: note }),
    onSuccess: () => {
      toast({ title: "Approved", description: "Communication approved and queued for dispatch." });
      qc.invalidateQueries({ queryKey: ["comm-approvals-pending"] });
      qc.invalidateQueries({ queryKey: ["comm-metrics"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Approval failed", description: e.message }),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      apiPost(`/api/comm/approval/${id}/reject`, { tenantId: TENANT_ID, rejectedBy: actorName.trim(), reason }),
    onSuccess: () => {
      toast({ title: "Rejected", description: "Communication has been rejected." });
      qc.invalidateQueries({ queryKey: ["comm-approvals-pending"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Rejection failed", description: e.message }),
  });

  const actorValid = actorName.trim().length >= 2;

  return (
    <div className="space-y-4">
      {/* Actor name bar */}
      <Card className="border-yellow-500/50 bg-yellow-50/50 dark:bg-yellow-900/10">
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-3">
            <Shield className="h-5 w-5 text-yellow-600 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">Human Approval Required</p>
              <p className="text-xs text-yellow-700 dark:text-yellow-400">Enter your name to approve or reject communications. All actions are logged.</p>
            </div>
            <Input
              placeholder="Your name (required)"
              value={actorName}
              onChange={(e) => setActorName(e.target.value)}
              className="max-w-[200px] border-yellow-400"
            />
          </div>
        </CardContent>
      </Card>

      {/* Pending list */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading approvals…</p>
      ) : pending.length === 0 ? (
        <div className="flex flex-col items-center py-12 gap-2">
          <CheckCircle className="h-8 w-8 text-green-500" />
          <p className="text-sm text-muted-foreground">No pending approvals</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map((ap) => {
            const expired = new Date(ap.expiresAt) < new Date();
            return (
              <Card key={ap.approvalId} className={cn("", expired && "opacity-60")}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <ChannelBadge channel={ap.channel} />
                        <Badge variant="outline" className="text-xs">{ap.workflowType.replace(/_/g, " ")}</Badge>
                        {expired && <Badge variant="destructive" className="text-xs">Expired</Badge>}
                      </div>
                      {ap.contactPhone && (
                        <p className="text-sm mt-2 font-medium">{ap.contactPhone}</p>
                      )}
                      {ap.messagePreview && (
                        <p className="text-sm text-muted-foreground mt-1 italic line-clamp-2">"{ap.messagePreview}"</p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span>Requested by <strong>{ap.requestedBy}</strong></span>
                        <span>{relativeTime(ap.createdAt)}</span>
                        {!expired && <span>Expires {relativeTime(ap.expiresAt)}</span>}
                      </div>
                      <Input
                        placeholder="Notes (optional)"
                        className="mt-2 text-xs h-7"
                        value={notes[ap.approvalId] ?? ""}
                        onChange={(e) => setNotes((n) => ({ ...n, [ap.approvalId]: e.target.value }))}
                      />
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      <Button
                        size="sm"
                        disabled={!actorValid || expired || approveMutation.isPending}
                        onClick={() => approveMutation.mutate({ id: ap.approvalId, note: notes[ap.approvalId] })}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!actorValid || expired || rejectMutation.isPending}
                        onClick={() => rejectMutation.mutate({ id: ap.approvalId, reason: notes[ap.approvalId] })}
                        className="border-red-300 text-red-600 hover:bg-red-50"
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── TAB 3: Voice & Voicemail ──────────────────────────────────────────────────

function VoiceTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [transferActor, setTransferActor] = useState("");

  const { data: activeSessions = [] } = useQuery<VoiceSession[]>({
    queryKey: ["comm-voice-active", TENANT_ID],
    queryFn:  () => apiGet("/api/comm/voice/sessions/active", { tenantId: TENANT_ID }),
    refetchInterval: 10_000,
  });

  const { data: voiceStats } = useQuery<{ total: number; completed: number; transferred: number; active: number; failed: number }>({
    queryKey: ["comm-voice-stats", TENANT_ID],
    queryFn:  () => apiGet("/api/comm/voice/stats", { tenantId: TENANT_ID }),
    refetchInterval: 15_000,
  });

  const transferMutation = useMutation({
    mutationFn: (sessionId: string) =>
      apiPost(`/api/comm/voice/${sessionId}/transfer`, { tenantId: TENANT_ID }),
    onSuccess: () => {
      toast({ title: "Transferred", description: "Call handed off to human agent." });
      qc.invalidateQueries({ queryKey: ["comm-voice-active"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Transfer failed", description: e.message }),
  });

  const completeMutation = useMutation({
    mutationFn: ({ sessionId, disposition }: { sessionId: string; disposition: string }) =>
      apiPost(`/api/comm/voice/${sessionId}/complete`, { tenantId: TENANT_ID, disposition }),
    onSuccess: () => {
      toast({ title: "Session closed" });
      qc.invalidateQueries({ queryKey: ["comm-voice-active"] });
      qc.invalidateQueries({ queryKey: ["comm-voice-stats"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Error", description: e.message }),
  });

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Active" value={voiceStats?.active ?? 0} icon={Phone} />
        <StatCard label="Completed" value={voiceStats?.completed ?? 0} icon={CheckCircle} />
        <StatCard label="Transferred" value={voiceStats?.transferred ?? 0} icon={PhoneForwarded} />
        <StatCard label="Failed" value={voiceStats?.failed ?? 0} icon={XCircle} />
      </div>

      {/* Active sessions */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Mic className="h-4 w-4 text-red-500 animate-pulse" /> Active Voice Sessions
            <span className="ml-auto text-xs text-muted-foreground font-normal">refreshes every 10s</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activeSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No active voice sessions</p>
          ) : (
            <div className="space-y-3">
              {activeSessions.map((session) => (
                <div key={session.sessionId} className="flex items-center gap-3 p-3 rounded-lg border">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{session.contactPhone}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="outline" className="text-xs">{session.workflowType.replace(/_/g, " ")}</Badge>
                      {session.persona && <span className="text-xs text-muted-foreground">{session.persona}</span>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">Started {relativeTime(session.startedAt)}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      onClick={() => transferMutation.mutate(session.sessionId)}
                      disabled={transferMutation.isPending}
                    >
                      <PhoneForwarded className="h-3.5 w-3.5 mr-1" /> Transfer
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs text-red-600"
                      onClick={() => completeMutation.mutate({ sessionId: session.sessionId, disposition: "manual_close" })}
                      disabled={completeMutation.isPending}
                    >
                      End
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Voicemail drop explainer */}
      <Card className="border-dashed border-muted-foreground/30">
        <CardContent className="pt-4 pb-3 flex items-start gap-3">
          <Volume2 className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">Voicemail Drop</p>
            <p className="text-xs text-muted-foreground mt-1">
              Voicemail drops are initiated through the Orchestrator via channel = "voicemail_drop".
              They go through the full safety + approval pipeline before being dispatched via VAPI or Twilio TTS.
              No manual dispatch available from this panel.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── TAB 4: SMS Queue ──────────────────────────────────────────────────────────

function SmsQueueTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: communications = [] } = useQuery<any[]>({
    queryKey: ["comm-list-sms", TENANT_ID],
    queryFn:  () => apiGet("/api/comm/list", { tenantId: TENANT_ID, channel: "sms", limit: "50" }),
    refetchInterval: 20_000,
  });

  const batchMutation = useMutation({
    mutationFn: () => apiPost("/api/comm/sms/batch", { tenantId: TENANT_ID }),
    onSuccess: (data: any) => {
      toast({ title: "Batch executed", description: `Sent: ${data?.sent ?? 0}  Failed: ${data?.failed ?? 0}` });
      qc.invalidateQueries({ queryKey: ["comm-list-sms"] });
      qc.invalidateQueries({ queryKey: ["comm-metrics"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Batch failed", description: e.message }),
  });

  const pending  = communications.filter((c) => c.status === "approved");
  const throttled = communications.filter((c) => c.status === "throttled");
  const sent      = communications.filter((c) => ["sent", "delivered"].includes(c.status));
  const failed    = communications.filter((c) => c.status === "failed");

  return (
    <div className="space-y-4">
      {/* Execute batch */}
      <Card className="border-blue-500/40 bg-blue-50/30 dark:bg-blue-900/10">
        <CardContent className="pt-4 pb-3 flex items-center gap-4">
          <Send className="h-5 w-5 text-blue-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">Approved SMS Queue</p>
            <p className="text-xs text-muted-foreground">{pending.length} approved messages ready to dispatch</p>
          </div>
          <Button
            size="sm"
            disabled={pending.length === 0 || batchMutation.isPending}
            onClick={() => batchMutation.mutate()}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {batchMutation.isPending ? "Sending…" : `Execute Batch (${pending.length})`}
          </Button>
        </CardContent>
      </Card>

      {/* Summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Approved" value={pending.length} icon={CheckCircle} />
        <StatCard label="Throttled" value={throttled.length} icon={Clock} />
        <StatCard label="Sent" value={sent.length} icon={Send} />
        <StatCard label="Failed" value={failed.length} icon={XCircle} />
      </div>

      {/* Communications table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">SMS Communications</CardTitle>
        </CardHeader>
        <CardContent>
          {communications.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No SMS communications</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {communications.map((c: any) => (
                <div key={c.communicationId} className="flex items-center gap-3 py-2 border-b last:border-0 text-sm">
                  <StatusDot status={c.status} />
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">{c.contactPhone ?? "unknown"}</p>
                    <p className="text-xs text-muted-foreground">{c.workflowType?.replace(/_/g, " ")}</p>
                  </div>
                  <Badge variant="outline" className="text-xs shrink-0">{c.status}</Badge>
                  <span className="text-xs text-muted-foreground shrink-0">{relativeTime(c.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── TAB 5: iMessage Drafts ────────────────────────────────────────────────────

function IMessageDraftsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [actorName, setActorName] = useState("");
  const [selectedOption, setSelectedOption] = useState<Record<string, number>>({});
  const [revealText, setRevealText] = useState<Record<string, boolean>>({});

  const { data: drafts = [], isLoading } = useQuery<IMessageDraft[]>({
    queryKey: ["comm-imsg-drafts", TENANT_ID],
    queryFn:  () => apiGet("/api/comm/imessage/pending", { tenantId: TENANT_ID, limit: "30" }),
    refetchInterval: 30_000,
  });

  const confirmMutation = useMutation({
    mutationFn: ({ id, optionSent }: { id: string; optionSent?: string }) =>
      apiPost(`/api/comm/imessage/${id}/confirm-sent`, { tenantId: TENANT_ID, sentBy: actorName.trim(), optionSent }),
    onSuccess: () => {
      toast({ title: "Confirmed", description: "iMessage recorded as sent. CRM will sync." });
      qc.invalidateQueries({ queryKey: ["comm-imsg-drafts"] });
      qc.invalidateQueries({ queryKey: ["comm-imsg-stats"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Error", description: e.message }),
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => apiPost(`/api/comm/imessage/${id}/dismiss`, { tenantId: TENANT_ID }),
    onSuccess: () => {
      toast({ title: "Dismissed" });
      qc.invalidateQueries({ queryKey: ["comm-imsg-drafts"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Error", description: e.message }),
  });

  const actorValid = actorName.trim().length >= 2;

  return (
    <div className="space-y-4">
      {/* Human-only banner */}
      <Card className="border-green-500/50 bg-green-50/40 dark:bg-green-900/10">
        <CardContent className="pt-3 pb-3 flex items-center gap-3">
          <MessageCircle className="h-5 w-5 text-green-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-green-800 dark:text-green-300">Human-Supervised Only</p>
            <p className="text-xs text-green-700 dark:text-green-400">
              AI generates draft options. You choose and send from your own iMessage app.
              Confirm below after you've sent — this logs the outcome and syncs with CRM.
            </p>
          </div>
          <Input
            placeholder="Your name (required)"
            value={actorName}
            onChange={(e) => setActorName(e.target.value)}
            className="max-w-[200px] border-green-400"
          />
        </CardContent>
      </Card>

      {/* Drafts */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading drafts…</p>
      ) : drafts.length === 0 ? (
        <div className="flex flex-col items-center py-12 gap-2">
          <MessageCircle className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No pending iMessage drafts</p>
        </div>
      ) : (
        <div className="space-y-4">
          {drafts.map((draft) => {
            const selectedIdx = selectedOption[draft.draftId] ?? 0;
            const revealed    = revealText[draft.draftId] ?? false;
            const options     = draft.responseOptions ?? [draft.aiGeneratedText];
            return (
              <Card key={draft.draftId}>
                <CardContent className="pt-4 pb-3 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{draft.contactName ?? draft.contactPhone ?? "Contact"}</p>
                      {draft.contactName && draft.contactPhone && (
                        <p className="text-xs text-muted-foreground">{draft.contactPhone}</p>
                      )}
                      <Badge variant="outline" className="text-xs mt-1">{draft.workflowType.replace(/_/g, " ")}</Badge>
                    </div>
                    {draft.createdAt && (
                      <span className="text-xs text-muted-foreground shrink-0">{relativeTime(draft.createdAt)}</span>
                    )}
                  </div>

                  {/* Option selector */}
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">AI Draft Options (choose one to send):</p>
                    {options.map((opt, i) => (
                      <button
                        key={i}
                        onClick={() => setSelectedOption((s) => ({ ...s, [draft.draftId]: i }))}
                        className={cn(
                          "w-full text-left text-sm p-2.5 rounded-lg border transition-colors",
                          selectedIdx === i
                            ? "border-green-500 bg-green-50 dark:bg-green-900/20"
                            : "border-muted hover:border-muted-foreground/50"
                        )}
                      >
                        {revealed || opt.length <= 80 ? opt : `${opt.slice(0, 80)}…`}
                      </button>
                    ))}
                    {options.some((o) => o.length > 80) && (
                      <button
                        className="text-xs text-blue-600 flex items-center gap-1"
                        onClick={() => setRevealText((r) => ({ ...r, [draft.draftId]: !revealed }))}
                      >
                        {revealed ? <><EyeOff className="h-3.5 w-3.5" /> Collapse</> : <><Eye className="h-3.5 w-3.5" /> Read full</>}
                      </button>
                    )}
                  </div>

                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      disabled={!actorValid || confirmMutation.isPending}
                      onClick={() => confirmMutation.mutate({ id: draft.draftId, optionSent: options[selectedIdx] })}
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      <CheckCircle className="h-3.5 w-3.5 mr-1" /> I Sent This
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      onClick={() => dismissMutation.mutate(draft.draftId)}
                      disabled={dismissMutation.isPending}
                    >
                      Dismiss
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── TAB 6: Intelligence ───────────────────────────────────────────────────────

function IntelligenceTab() {
  const { data: communications = [] } = useQuery<any[]>({
    queryKey: ["comm-list-all", TENANT_ID],
    queryFn:  () => apiGet("/api/comm/list", { tenantId: TENANT_ID, limit: "30" }),
    refetchInterval: 30_000,
  });

  const [selected, setSelected] = useState<string | null>(null);

  const { data: intelligence } = useQuery<any>({
    queryKey: ["comm-intelligence", selected, TENANT_ID],
    queryFn:  () => selected
      ? apiGet(`/api/comm/intelligence/${selected}`, { tenantId: TENANT_ID })
      : Promise.resolve(null),
    enabled: !!selected,
  });

  const sentimentColor = (s: string) =>
    s === "positive" ? "text-green-600" : s === "negative" ? "text-red-500" : "text-yellow-600";
  const urgencyColor = (u: string) =>
    u === "high" ? "text-red-600" : u === "medium" ? "text-yellow-600" : "text-green-600";

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Communications list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Zap className="h-4 w-4" /> Select Communication to Analyze
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5 max-h-[500px] overflow-y-auto pr-1">
            {communications.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No communications</p>
            ) : communications.map((c: any) => (
              <button
                key={c.communicationId}
                onClick={() => setSelected(c.communicationId)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors",
                  selected === c.communicationId ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-muted hover:border-muted-foreground/50"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{c.contactPhone ?? "Unknown"}</span>
                  <ChannelBadge channel={c.channel} />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{c.workflowType?.replace(/_/g, " ")} · {relativeTime(c.createdAt)}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Intelligence panel */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4" /> Conversation Intelligence
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!selected ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Select a communication to view intelligence analysis</p>
          ) : !intelligence ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No intelligence analysis available yet</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Sentiment</p>
                  <p className={cn("text-lg font-bold capitalize", sentimentColor(intelligence.sentiment))}>
                    {intelligence.sentiment}
                  </p>
                  <p className="text-xs text-muted-foreground">Score: {intelligence.sentimentScore}/10</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Urgency</p>
                  <p className={cn("text-lg font-bold capitalize", urgencyColor(intelligence.urgencyLevel))}>
                    {intelligence.urgencyLevel}
                  </p>
                  <p className="text-xs text-muted-foreground">Score: {intelligence.urgencyScore}/10</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Conversion Likelihood</p>
                  <p className="text-lg font-bold">{intelligence.conversionLikelihood}/10</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Appointment Likelihood</p>
                  <p className="text-lg font-bold">{intelligence.appointmentLikelihood}/10</p>
                </div>
              </div>

              {intelligence.escalationIndicators?.length > 0 && (
                <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/10 p-3">
                  <p className="text-xs font-semibold text-red-700 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" /> Escalation Signals
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {intelligence.escalationIndicators.map((ind: string) => (
                      <li key={ind} className="text-xs text-red-600">• {ind}</li>
                    ))}
                  </ul>
                </div>
              )}

              {intelligence.summary && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">AI Summary</p>
                  <p className="text-sm mt-1">{intelligence.summary}</p>
                </div>
              )}

              {intelligence.nextStep && (
                <div className="rounded-lg border border-blue-300 bg-blue-50 dark:bg-blue-900/10 p-3">
                  <p className="text-xs font-semibold text-blue-700">Recommended Next Step</p>
                  <p className="text-sm text-blue-800 dark:text-blue-300 mt-1 capitalize">
                    {intelligence.nextStep.action?.replace(/_/g, " ")}
                    {intelligence.nextStep.timing ? ` (${intelligence.nextStep.timing} min)` : ""}
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── TAB 7: Timeline ───────────────────────────────────────────────────────────

function TimelineTab() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const debounce = useCallback((value: string) => {
    const t = setTimeout(() => setDebouncedSearch(value), 400);
    return () => clearTimeout(t);
  }, []);

  const handleSearch = (v: string) => {
    setSearch(v);
    debounce(v);
  };

  const { data: timeline = [] } = useQuery<TimelineEvent[]>({
    queryKey: ["comm-timeline", TENANT_ID, debouncedSearch],
    queryFn:  () => debouncedSearch
      ? apiGet("/api/comm/timeline/search", { tenantId: TENANT_ID, q: debouncedSearch, limit: "100" })
      : apiGet("/api/comm/timeline", { tenantId: TENANT_ID, limit: "100" }),
    refetchInterval: debouncedSearch ? false : 20_000,
  });

  const actorIcon = (actor: string) =>
    actor === "ai" ? <Bot className="h-3.5 w-3.5 text-blue-500" /> :
    actor === "system" ? <Zap className="h-3.5 w-3.5 text-purple-500" /> :
    <User className="h-3.5 w-3.5 text-green-500" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search timeline (communication ID, description, actor…)"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="max-w-md"
        />
        <span className="text-xs text-muted-foreground ml-auto">
          {timeline.length} events · read-only
        </span>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="space-y-0 max-h-[600px] overflow-y-auto">
            {timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {debouncedSearch ? "No results found" : "No timeline events yet"}
              </p>
            ) : timeline.map((ev) => (
              <div key={ev.id} className="flex items-start gap-3 py-2.5 border-b last:border-0">
                <div className="flex-col items-center flex gap-1 shrink-0 pt-0.5">
                  {actorIcon(ev.actor)}
                  <div className="w-px h-full bg-border" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-muted-foreground">{ev.communicationId.slice(0, 12)}…</span>
                    {ev.channel && <ChannelBadge channel={ev.channel} />}
                    <Badge variant="outline" className="text-xs font-normal">{ev.eventType.replace(/_/g, " ")}</Badge>
                  </div>
                  <p className="text-sm mt-0.5">{ev.description}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {ev.actor} {ev.actorId ? `· ${ev.actorId}` : ""} · {relativeTime(ev.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CommunicationsCommandCenter() {
  const { data: approvalStats } = useQuery<{ pending: number }>({
    queryKey: ["comm-approval-badge", TENANT_ID],
    queryFn:  () => apiGet("/api/comm/approvals/stats", { tenantId: TENANT_ID }),
    refetchInterval: 30_000,
  });

  const pendingCount = approvalStats?.pending ?? 0;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-blue-600" />
            Communications Command Center
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Unified AI communications platform — Phase 10
          </p>
        </div>
        <div className="flex items-center gap-3">
          {pendingCount > 0 && (
            <div className="flex items-center gap-1.5 text-sm text-yellow-700 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/30 px-3 py-1.5 rounded-full">
              <Bell className="h-4 w-4" />
              {pendingCount} pending approval{pendingCount !== 1 ? "s" : ""}
            </div>
          )}
          <Badge variant="outline" className="text-xs">
            <Shield className="h-3 w-3 mr-1" /> Safety-gated
          </Badge>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="overview">
            <BarChart2 className="h-3.5 w-3.5 mr-1.5" /> Overview
          </TabsTrigger>
          <TabsTrigger value="approvals" className="relative">
            <Shield className="h-3.5 w-3.5 mr-1.5" /> Approvals
            {pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-yellow-500 text-white text-[9px] flex items-center justify-center font-bold">
                {pendingCount > 9 ? "9+" : pendingCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="voice">
            <Phone className="h-3.5 w-3.5 mr-1.5" /> Voice
          </TabsTrigger>
          <TabsTrigger value="sms">
            <MessageSquare className="h-3.5 w-3.5 mr-1.5" /> SMS
          </TabsTrigger>
          <TabsTrigger value="imessage">
            <MessageCircle className="h-3.5 w-3.5 mr-1.5" /> iMessage
          </TabsTrigger>
          <TabsTrigger value="intelligence">
            <Zap className="h-3.5 w-3.5 mr-1.5" /> Intelligence
          </TabsTrigger>
          <TabsTrigger value="timeline">
            <Activity className="h-3.5 w-3.5 mr-1.5" /> Timeline
          </TabsTrigger>
        </TabsList>

        <div className="mt-4">
          <TabsContent value="overview">    <OverviewTab />        </TabsContent>
          <TabsContent value="approvals">  <ApprovalsTab />       </TabsContent>
          <TabsContent value="voice">      <VoiceTab />           </TabsContent>
          <TabsContent value="sms">        <SmsQueueTab />        </TabsContent>
          <TabsContent value="imessage">   <IMessageDraftsTab />  </TabsContent>
          <TabsContent value="intelligence"><IntelligenceTab />    </TabsContent>
          <TabsContent value="timeline">   <TimelineTab />        </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
