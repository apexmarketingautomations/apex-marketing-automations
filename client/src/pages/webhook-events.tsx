import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useActiveSubAccountId } from "@/components/account-required";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, ChevronDown, ChevronUp, Clock, ExternalLink, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { format } from "date-fns";

interface WebhookEvent {
  id: number;
  eventType: string;
  url: string;
  status: "success" | "failed" | "pending";
  statusCode?: number;
  duration?: number;
  requestBody?: any;
  responseBody?: any;
  createdAt: string;
}

const statusConfig = {
  success: { label: "Success", className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
  failed: { label: "Failed", className: "bg-red-500/20 text-red-400 border-red-500/30", icon: XCircle },
  pending: { label: "Pending", className: "bg-amber-500/20 text-amber-400 border-amber-500/30", icon: Loader2 },
};

function WebhookEventRow({ event, index }: { event: WebhookEvent; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const config = statusConfig[event.status] || statusConfig.pending;
  const StatusIcon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 + index * 0.03 }}
    >
      <Card
        className="bg-white/5 border-white/10 hover:bg-white/[0.07] transition-colors cursor-pointer"
        onClick={() => setExpanded(!expanded)}
        data-testid={`card-webhook-event-${event.id}`}
      >
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="shrink-0">
              <StatusIcon
                size={18}
                className={event.status === "success" ? "text-emerald-400" : event.status === "failed" ? "text-red-400" : "text-amber-400 animate-spin"}
                data-testid={`icon-status-${event.id}`}
              />
            </div>

            <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-5 gap-2 md:gap-4 items-center">
              <div className="md:col-span-1">
                <Badge className="bg-white/5 text-slate-300 border-white/10 text-[11px] font-mono" data-testid={`badge-event-type-${event.id}`}>
                  {event.eventType}
                </Badge>
              </div>

              <div className="md:col-span-1 truncate">
                <span className="text-xs text-slate-500 flex items-center gap-1 truncate" data-testid={`text-event-url-${event.id}`}>
                  <ExternalLink size={10} className="shrink-0" />
                  <span className="truncate">{event.url}</span>
                </span>
              </div>

              <div className="md:col-span-1">
                <Badge className={config.className} data-testid={`badge-event-status-${event.id}`}>
                  {config.label}
                </Badge>
                {event.statusCode && (
                  <span className="text-[10px] text-slate-500 ml-2 font-mono" data-testid={`text-status-code-${event.id}`}>
                    {event.statusCode}
                  </span>
                )}
              </div>

              <div className="md:col-span-1">
                {event.duration != null && (
                  <span className="text-xs text-slate-400 flex items-center gap-1" data-testid={`text-duration-${event.id}`}>
                    <Clock size={10} />
                    {event.duration}ms
                  </span>
                )}
              </div>

              <div className="md:col-span-1 flex items-center justify-between">
                <span className="text-[10px] text-slate-600" data-testid={`text-timestamp-${event.id}`}>
                  {format(new Date(event.createdAt), "MMM d, yyyy HH:mm:ss")}
                </span>
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
                <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-1 md:grid-cols-2 gap-4" data-testid={`detail-panel-${event.id}`}>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">Request Body</p>
                    <pre className="text-xs text-slate-400 bg-black/40 rounded-lg p-3 overflow-auto max-h-[200px] font-mono border border-white/5" data-testid={`text-request-body-${event.id}`}>
                      {event.requestBody ? JSON.stringify(event.requestBody, null, 2) : "No request body"}
                    </pre>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">Response Body</p>
                    <pre className="text-xs text-slate-400 bg-black/40 rounded-lg p-3 overflow-auto max-h-[200px] font-mono border border-white/5" data-testid={`text-response-body-${event.id}`}>
                      {event.responseBody ? JSON.stringify(event.responseBody, null, 2) : "No response body"}
                    </pre>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function WebhookEventsPage() {
  const subAccountId = useActiveSubAccountId();

  const { data: events = [], isLoading } = useQuery<WebhookEvent[]>({
    queryKey: ["/api/webhook-events", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/webhook-events/${subAccountId}`);
      if (!res.ok) throw new Error("Failed to fetch webhook events");
      return res.json();
    },
    enabled: !!subAccountId,
    refetchInterval: 15000,
  });

  if (!subAccountId) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <p className="text-slate-400">Select a sub-account from the sidebar to continue.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 md:p-10 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 mb-4">
            <Activity size={12} /> EVENT LOG
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight" data-testid="text-webhook-events-title">
            Webhook <span className="bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">Event Log</span>
          </h1>
          <p className="text-slate-400 mt-2 text-sm">Timeline of every webhook event fired from your account</p>
        </motion.div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin text-indigo-400">
              <Activity size={32} />
            </div>
          </div>
        ) : events.length === 0 ? (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <div className="text-center py-20" data-testid="empty-state">
              <Activity size={48} className="mx-auto mb-4 text-white/10" />
              <p className="text-slate-400 text-sm">No webhook events recorded yet</p>
              <p className="text-slate-600 text-xs mt-1">Events will appear here when your webhooks are triggered</p>
            </div>
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card className="bg-white/[0.02] border-white/10 mb-4">
              <CardContent className="p-3">
                <div className="hidden md:grid grid-cols-5 gap-4 px-4 text-[10px] uppercase tracking-wider text-slate-600 font-bold">
                  <span>Event</span>
                  <span>Endpoint</span>
                  <span>Status</span>
                  <span>Duration</span>
                  <span>Timestamp</span>
                </div>
              </CardContent>
            </Card>
            <div className="space-y-2" data-testid="webhook-events-list">
              {events.map((event, i) => (
                <WebhookEventRow key={event.id} event={event} index={i} />
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}