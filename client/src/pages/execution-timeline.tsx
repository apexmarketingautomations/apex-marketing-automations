import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useActiveSubAccountId } from "@/components/account-required";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity, ChevronDown, ChevronUp, Clock, CheckCircle2, XCircle, Loader2,
  MessageSquare, Brain, Send, Database, Zap, AlertTriangle, RefreshCw, GitBranch
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface TraceRow {
  traceId: string;
  contactPhone: string | null;
  conversationId: string | null;
  startedAt: string;
  totalSteps: number;
  failedSteps: number;
  totalLatencyMs: number;
}

interface TimelineEvent {
  id: number;
  traceId: string;
  subAccountId: number;
  conversationId: string | null;
  contactPhone: string | null;
  step: string;
  status: string;
  provider: string | null;
  latencyMs: number | null;
  metadata: any;
  error: string | null;
  createdAt: string;
}

interface TraceSummary {
  totalDurationMs: number;
  aiLatencyMs: number;
  deliveryLatencyMs: number;
  stepCount: number;
  failedStepCount: number;
}

const STEP_LABELS: Record<string, string> = {
  message_received: "Message Received",
  crm_write: "CRM Write",
  automation_triggered: "Automation Triggered",
  ai_decision: "AI Decision",
  ai_response_generated: "AI Response Generated",
  ai_chat: "AI Chat",
  outbound_send: "Outbound Send",
  delivery_status: "Delivery Status",
  contact_created: "Contact Created",
};

const STEP_ICONS: Record<string, any> = {
  message_received: MessageSquare,
  crm_write: Database,
  automation_triggered: GitBranch,
  ai_decision: Brain,
  ai_response_generated: Brain,
  ai_chat: Brain,
  outbound_send: Send,
  delivery_status: CheckCircle2,
  contact_created: Activity,
};

function getStepLabel(step: string) {
  return STEP_LABELS[step] || step.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function getStepIcon(step: string) {
  return STEP_ICONS[step] || Zap;
}

function LatencyBadge({ ms }: { ms: number | null }) {
  if (ms == null) return null;
  const color = ms < 200 ? "text-emerald-400" : ms < 1000 ? "text-amber-400" : "text-red-400";
  return (
    <span className={`text-[10px] font-mono ${color} flex items-center gap-0.5`}>
      <Clock size={9} />
      {ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`}
    </span>
  );
}

function StepRow({ event, index }: { event: TimelineEvent; index: number }) {
  const isError = event.status === "error";
  const StepIcon = getStepIcon(event.step);

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04 }}
      className="relative flex gap-4"
    >
      <div className="flex flex-col items-center">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${
            isError
              ? "bg-red-500/20 border-red-500/40 text-red-400"
              : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
          }`}
          data-testid={`step-icon-${event.id}`}
        >
          {isError ? <XCircle size={14} /> : <StepIcon size={14} />}
        </div>
        <div className="w-px flex-1 bg-white/5 mt-1" />
      </div>

      <div className={`flex-1 pb-4 min-w-0 rounded-lg p-3 mb-1 border ${
        isError ? "bg-red-500/5 border-red-500/20" : "bg-white/[0.02] border-white/5"
      }`}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white" data-testid={`step-label-${event.id}`}>
              {getStepLabel(event.step)}
            </span>
            {event.provider && (
              <Badge className="bg-indigo-500/10 text-indigo-300 border-indigo-500/20 text-[9px] font-mono uppercase" data-testid={`step-provider-${event.id}`}>
                {event.provider}
              </Badge>
            )}
            <Badge
              className={`text-[9px] font-bold ${isError ? "bg-red-500/20 text-red-400 border-red-500/30" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"}`}
              data-testid={`step-status-${event.id}`}
            >
              {isError ? "ERROR" : "OK"}
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <LatencyBadge ms={event.latencyMs} />
            <span className="text-[10px] text-slate-600" data-testid={`step-time-${event.id}`}>
              {format(new Date(event.createdAt), "HH:mm:ss.SSS")}
            </span>
          </div>
        </div>

        {isError && event.error && (
          <div className="mt-2 flex items-start gap-1.5" data-testid={`step-error-${event.id}`}>
            <AlertTriangle size={12} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-400 font-mono break-all">{event.error}</p>
          </div>
        )}

        {event.metadata && Object.keys(event.metadata).length > 0 && (
          <div className="mt-2">
            <details className="group">
              <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-400 list-none flex items-center gap-1">
                <ChevronDown size={10} className="group-open:rotate-180 transition-transform" />
                Metadata
              </summary>
              <pre className="text-[10px] text-slate-500 font-mono mt-1 bg-black/20 rounded p-2 overflow-auto max-h-[100px]">
                {JSON.stringify(event.metadata, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function TraceCard({ trace, index }: { trace: TraceRow; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasErrors = trace.failedSteps > 0;

  const { data: events = [], isFetching: eventsLoading } = useQuery<TimelineEvent[]>({
    queryKey: ["/api/timeline/trace", trace.traceId],
    queryFn: async () => {
      const res = await fetch(`/api/timeline/trace/${trace.traceId}`);
      if (!res.ok) throw new Error("Failed to fetch trace events");
      return res.json();
    },
    enabled: expanded,
  });

  const { data: summary } = useQuery<TraceSummary>({
    queryKey: ["/api/timeline/trace", trace.traceId, "summary"],
    queryFn: async () => {
      const res = await fetch(`/api/timeline/trace/${trace.traceId}/summary`);
      if (!res.ok) throw new Error("Failed to fetch trace summary");
      return res.json();
    },
    enabled: expanded,
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04 + index * 0.03 }}
    >
      <Card
        className={`border transition-colors cursor-pointer ${
          hasErrors
            ? "bg-red-500/5 border-red-500/20 hover:bg-red-500/10"
            : "bg-white/[0.02] border-white/10 hover:bg-white/[0.05]"
        }`}
        onClick={() => setExpanded(!expanded)}
        data-testid={`card-trace-${trace.traceId.slice(0, 8)}`}
      >
        <CardContent className="p-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="shrink-0">
              {hasErrors ? (
                <XCircle size={18} className="text-red-400" data-testid={`icon-trace-status-${trace.traceId.slice(0, 8)}`} />
              ) : (
                <CheckCircle2 size={18} className="text-emerald-400" data-testid={`icon-trace-status-${trace.traceId.slice(0, 8)}`} />
              )}
            </div>

            <div className="flex-1 min-w-0 grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-4 items-center">
              <div className="md:col-span-1">
                <p className="text-xs font-mono text-slate-400 truncate" data-testid={`text-trace-id-${trace.traceId.slice(0, 8)}`}>
                  {trace.traceId.slice(0, 8)}…
                </p>
                {trace.contactPhone && (
                  <p className="text-[10px] text-slate-500 truncate" data-testid={`text-trace-phone-${trace.traceId.slice(0, 8)}`}>
                    {trace.contactPhone}
                  </p>
                )}
              </div>

              <div className="md:col-span-1">
                <Badge
                  className={hasErrors
                    ? "bg-red-500/20 text-red-400 border-red-500/30"
                    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  }
                  data-testid={`badge-trace-status-${trace.traceId.slice(0, 8)}`}
                >
                  {hasErrors ? `${trace.failedSteps} Failed` : "Success"}
                </Badge>
              </div>

              <div className="md:col-span-1">
                <span className="text-xs text-slate-400 flex items-center gap-1" data-testid={`text-trace-steps-${trace.traceId.slice(0, 8)}`}>
                  <Activity size={10} />
                  {trace.totalSteps} step{trace.totalSteps !== 1 ? "s" : ""}
                </span>
              </div>

              <div className="md:col-span-1">
                <LatencyBadge ms={trace.totalLatencyMs} />
              </div>

              <div className="md:col-span-1 flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-slate-500" data-testid={`text-trace-time-${trace.traceId.slice(0, 8)}`}>
                    {formatDistanceToNow(new Date(trace.startedAt), { addSuffix: true })}
                  </p>
                  <p className="text-[9px] text-slate-600">
                    {format(new Date(trace.startedAt), "MMM d, HH:mm:ss")}
                  </p>
                </div>
                <div className="shrink-0 text-slate-500">
                  {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
              </div>
            </div>
          </div>

          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-4 pt-4 border-t border-white/5" data-testid={`trace-detail-${trace.traceId.slice(0, 8)}`}>
                  {summary && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5" data-testid={`summary-panel-${trace.traceId.slice(0, 8)}`}>
                      <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                        <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Total Duration</p>
                        <p className="text-sm font-bold text-white" data-testid={`summary-total-${trace.traceId.slice(0, 8)}`}>
                          {summary.totalDurationMs < 1000 ? `${summary.totalDurationMs}ms` : `${(summary.totalDurationMs / 1000).toFixed(2)}s`}
                        </p>
                      </div>
                      <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                        <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">AI Latency</p>
                        <p className="text-sm font-bold text-indigo-400" data-testid={`summary-ai-${trace.traceId.slice(0, 8)}`}>
                          {summary.aiLatencyMs > 0 ? (summary.aiLatencyMs < 1000 ? `${summary.aiLatencyMs}ms` : `${(summary.aiLatencyMs / 1000).toFixed(2)}s`) : "N/A"}
                        </p>
                      </div>
                      <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                        <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Delivery Latency</p>
                        <p className="text-sm font-bold text-cyan-400" data-testid={`summary-delivery-${trace.traceId.slice(0, 8)}`}>
                          {summary.deliveryLatencyMs > 0 ? (summary.deliveryLatencyMs < 1000 ? `${summary.deliveryLatencyMs}ms` : `${(summary.deliveryLatencyMs / 1000).toFixed(2)}s`) : "N/A"}
                        </p>
                      </div>
                      <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                        <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Steps</p>
                        <p className="text-sm font-bold" data-testid={`summary-steps-${trace.traceId.slice(0, 8)}`}>
                          <span className="text-emerald-400">{summary.stepCount - summary.failedStepCount} OK</span>
                          {summary.failedStepCount > 0 && (
                            <span className="text-red-400 ml-2">{summary.failedStepCount} Failed</span>
                          )}
                        </p>
                      </div>
                    </div>
                  )}

                  {eventsLoading && events.length === 0 ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 size={20} className="animate-spin text-indigo-400" />
                    </div>
                  ) : (
                    <div className="space-y-0" data-testid={`steps-list-${trace.traceId.slice(0, 8)}`}>
                      {events.map((event, i) => (
                        <StepRow key={event.id} event={event} index={i} />
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function ExecutionTimelinePage() {
  const subAccountId = useActiveSubAccountId();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  const { data: traces = [], isLoading, refetch, isFetching } = useQuery<TraceRow[]>({
    queryKey: ["/api/timeline/traces", subAccountId, statusFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (statusFilter !== "all") params.set("status", statusFilter);

      const res = await fetch(`/api/timeline/traces/${subAccountId}?${params}`);
      if (!res.ok) throw new Error("Failed to fetch traces");
      return res.json();
    },
    enabled: !!subAccountId,
    refetchInterval: 30000,
  });

  if (!subAccountId) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <p className="text-slate-400">Select a sub-account from the sidebar to continue.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 md:p-10 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-violet-500/30 bg-violet-500/10 text-violet-400 mb-4">
            <Activity size={12} /> OBSERVABILITY
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight" data-testid="text-timeline-title">
            Execution{" "}
            <span className="bg-gradient-to-r from-violet-400 via-indigo-400 to-cyan-400 bg-clip-text text-transparent">
              Timeline
            </span>
          </h1>
          <p className="text-slate-400 mt-2 text-sm">
            Full observability into every message's lifecycle — from inbound receipt through AI processing to delivery
          </p>
        </motion.div>

        <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
          <div className="flex items-center gap-2">
            {["all", "success", "error"].map(f => (
              <button
                key={f}
                onClick={() => { setStatusFilter(f); setPage(0); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  statusFilter === f
                    ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                    : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"
                }`}
                data-testid={`filter-${f}`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-slate-400 hover:text-white gap-2"
            data-testid="button-refresh-traces"
          >
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin text-indigo-400" />
          </div>
        ) : traces.length === 0 ? (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <div className="text-center py-20" data-testid="empty-state-traces">
              <Activity size={48} className="mx-auto mb-4 text-white/10" />
              <p className="text-slate-400 text-sm">No execution traces recorded yet</p>
              <p className="text-slate-600 text-xs mt-1">
                Traces will appear here as inbound messages are processed through the system
              </p>
            </div>
          </motion.div>
        ) : (
          <>
            <Card className="bg-white/[0.02] border-white/10 mb-4">
              <CardContent className="p-3">
                <div className="hidden md:grid grid-cols-5 gap-4 px-4 text-[10px] uppercase tracking-wider text-slate-600 font-bold">
                  <span>Trace ID / Contact</span>
                  <span>Status</span>
                  <span>Steps</span>
                  <span>Total Latency</span>
                  <span>Started</span>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-2" data-testid="traces-list">
              {traces.map((trace, i) => (
                <TraceCard key={trace.traceId} trace={trace} index={i} />
              ))}
            </div>

            <div className="flex items-center justify-between mt-6">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="text-slate-400 hover:text-white"
                data-testid="button-prev-page"
              >
                Previous
              </Button>
              <span className="text-xs text-slate-500" data-testid="text-page-info">
                Page {page + 1} · {traces.length} trace{traces.length !== 1 ? "s" : ""}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage(p => p + 1)}
                disabled={traces.length < PAGE_SIZE}
                className="text-slate-400 hover:text-white"
                data-testid="button-next-page"
              >
                Next
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
