import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Activity,
  TrendingUp,
  Users,
  RefreshCw,
  Clock,
  Target,
  Sparkles,
  AlertTriangle,
  Lightbulb,
  Inbox,
} from "lucide-react";

// ---------------------------------------------------------------------------
// CardIntelligencePanel
//
// Premium client-facing surface for /api/intelligence/cards/:id. Handles
// loading / error / empty / low-data states so it can be embedded anywhere
// the user has a cardId. Insights are color-coded; recent activity shows
// the last 5 meaningful events.
// ---------------------------------------------------------------------------

type InsightType = "positive" | "warning" | "opportunity";

interface IntelligenceData {
  cardId: number;
  metrics: {
    taps: number;
    qrScans: number;
    uniqueVisitors: number;
    repeatVisitors: number;
    identifiedVisitors: number;
    leads: number;
    bookedCalls: number;
    qualifiedLeads: number;
    conversionRate: number;
    repeatRate: number;
  };
  behavior: {
    avgTimeToConvert: number | null;
    peakHours: number[];
    topCTA: string | null;
    sessionDepth: number;
  };
  attribution: {
    confidenceScore: number;
    stitchedJourneys: number;
    repeatClusters: number;
  };
  recentActivity: Array<{ type: string; timestamp: string; label: string | null }>;
  insights: Array<{ type: InsightType; message: string; code: string }>;
  state: "ok" | "empty" | "low_data";
  computedAt: string;
}

interface Props {
  cardId: number;
}

const INSIGHT_STYLES: Record<InsightType, { tone: string; icon: React.ReactNode }> = {
  positive: {
    tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
    icon: <Sparkles className="h-4 w-4 text-emerald-400" />,
  },
  warning: {
    tone: "border-amber-500/40 bg-amber-500/10 text-amber-200",
    icon: <AlertTriangle className="h-4 w-4 text-amber-400" />,
  },
  opportunity: {
    tone: "border-sky-500/40 bg-sky-500/10 text-sky-200",
    icon: <Lightbulb className="h-4 w-4 text-sky-400" />,
  },
};

function formatHour(h: number): string {
  const suffix = h >= 12 ? "PM" : "AM";
  const display = ((h + 11) % 12) + 1;
  return `${display}${suffix}`;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function eventLabel(type: string): string {
  return ({
    closed_sale: "Closed sale",
    qualified_lead: "Qualified lead",
    booked_call: "Booked call",
    lead_submit: "Lead submitted",
    form_start: "Form started",
    cta_click: "CTA clicked",
    qr_scan: "QR scanned",
    tap: "Card tapped",
  } as Record<string, string>)[type] || type;
}

function Metric({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3" data-testid={`metric-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="text-[11px] uppercase tracking-wide text-white/50">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-white/40">{sub}</div>}
    </div>
  );
}

export function CardIntelligencePanel({ cardId }: Props) {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<IntelligenceData>({
    queryKey: [`/api/intelligence/cards/${cardId}`],
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="intelligence-loading">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Alert variant="destructive" data-testid="intelligence-error">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Couldn't load intelligence for this card.
          <Button size="sm" variant="outline" className="ml-3" onClick={() => refetch()} data-testid="button-retry-intelligence">
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (data.state === "empty") {
    return (
      <Card className="border-white/10 bg-white/5" data-testid="intelligence-empty">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <Inbox className="h-10 w-10 text-white/30" />
          <div className="text-lg font-medium text-white">No activity yet</div>
          <div className="max-w-sm text-sm text-white/50">
            Once your card is tapped or scanned, performance, behavior, and attribution data will appear here in real time.
          </div>
        </CardContent>
      </Card>
    );
  }

  const { metrics, behavior, attribution, recentActivity, insights, state } = data;

  return (
    <div className="space-y-6" data-testid="intelligence-panel">
      {/* Header / refresh */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-white/40">Apex Intelligence</div>
          <div className="text-lg font-semibold text-white">Card #{cardId}</div>
        </div>
        <div className="flex items-center gap-2">
          {state === "low_data" && (
            <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-200" data-testid="badge-low-data">
              Building baseline
            </Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-intelligence"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* A. Performance */}
      <Card className="border-white/10 bg-white/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-white/80">
            <Activity className="h-4 w-4" />
            Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Metric label="Taps" value={metrics.taps} />
            <Metric label="Visitors" value={metrics.uniqueVisitors} />
            <Metric label="Repeat" value={metrics.repeatVisitors} sub={pct(metrics.repeatRate)} />
            <Metric label="Leads" value={metrics.leads} />
            <Metric label="Booked" value={metrics.bookedCalls} />
            <Metric label="Conversion" value={pct(metrics.conversionRate)} />
          </div>
        </CardContent>
      </Card>

      {/* B. Behavior */}
      <Card className="border-white/10 bg-white/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-white/80">
            <TrendingUp className="h-4 w-4" />
            Behavior
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric
              label="Peak Hours"
              value={behavior.peakHours.length ? behavior.peakHours.map(formatHour).join(" & ") : "—"}
            />
            <Metric label="Avg. Convert" value={formatDuration(behavior.avgTimeToConvert)} />
            <Metric label="Top CTA" value={behavior.topCTA ?? "—"} />
            <Metric label="Session Depth" value={behavior.sessionDepth.toFixed(2)} sub="events / visit" />
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-white/50">
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" /> Identified: {metrics.identifiedVisitors}
            </span>
            <span className="inline-flex items-center gap-1">
              <Target className="h-3.5 w-3.5" /> Confidence: {pct(attribution.confidenceScore)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5" /> Stitched journeys: {attribution.stitchedJourneys}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* C. Insights */}
      <Card className="border-white/10 bg-white/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-white/80">
            <Lightbulb className="h-4 w-4" />
            Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          {insights.length === 0 ? (
            <div className="text-sm text-white/40" data-testid="text-insights-empty">
              {state === "low_data"
                ? "Insights unlock once you have a few more visitors."
                : "No insights right now — performance is steady."}
            </div>
          ) : (
            <ul className="space-y-2">
              {insights.map((ins) => {
                const style = INSIGHT_STYLES[ins.type];
                return (
                  <li
                    key={ins.code}
                    className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${style.tone}`}
                    data-testid={`insight-${ins.code}`}
                  >
                    <span className="mt-0.5">{style.icon}</span>
                    <span>{ins.message}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* D. Recent Activity */}
      <Card className="border-white/10 bg-white/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-white/80">
            <Clock className="h-4 w-4" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentActivity.length === 0 ? (
            <div className="text-sm text-white/40" data-testid="text-activity-empty">
              Waiting for the next meaningful event.
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {recentActivity.map((a, i) => (
                <li
                  key={`${a.type}-${a.timestamp}-${i}`}
                  className="flex items-center justify-between py-2 text-sm"
                  data-testid={`activity-row-${i}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-white/80">{eventLabel(a.type)}</span>
                    {a.label && <span className="text-white/40">· {a.label}</span>}
                  </div>
                  <span className="text-xs text-white/40">{relativeTime(a.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default CardIntelligencePanel;
