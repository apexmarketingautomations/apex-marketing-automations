/**
 * client/src/pages/insurance/insurance-intelligence.tsx
 *
 * Insurance Intelligence Dashboard
 *
 * Six-panel admin dashboard for the Phase 8 Insurance Intelligence Engine.
 * All data is read-only — no actions trigger communications.
 *
 * Panels:
 *   1. HouseholdOpportunitiesPanel  — top-scored households with opportunity types
 *   2. StormClaimPanel              — active storm zones + claim opportunities
 *   3. CommercialOpportunitiesPanel — top commercial risks by county/type
 *   4. PolicyScoringPanel           — score distribution + KPIs
 *   5. AgencyRoutingPanel           — territory routing performance
 *   6. WorkflowQueuePanel           — pending approval-gated workflows
 */

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, Building2, Car, Home, Zap, Activity, MapPin } from "lucide-react";

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch(path: string) {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

// ── Colour helpers ────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 75) return "text-red-600";
  if (score >= 55) return "text-orange-500";
  if (score >= 35) return "text-yellow-500";
  return "text-green-600";
}

function scoreBadge(score: number): string {
  if (score >= 75) return "destructive";
  if (score >= 55) return "secondary";
  return "outline";
}

function urgencyColor(urgency: string) {
  const map: Record<string, string> = {
    immediate: "bg-red-100 text-red-700 border-red-200",
    elevated:  "bg-orange-100 text-orange-700 border-orange-200",
    routine:   "bg-gray-100 text-gray-600 border-gray-200",
  };
  return map[urgency] ?? map.routine;
}

// ── Panel 1: Household KPIs + opportunity table ───────────────────────────────

function HouseholdOpportunitiesPanel() {
  const [county, setCounty] = useState<string>("all");
  const [minScore, setMinScore] = useState("50");

  const statsQ = useQuery({
    queryKey: ["insurance", "household-stats"],
    queryFn: () => apiFetch("/api/insurance/household-stats"),
    refetchInterval: 60_000,
  });

  const hhQ = useQuery({
    queryKey: ["insurance", "top-households", county, minScore],
    queryFn: () => {
      const p = new URLSearchParams({ minScore, limit: "20" });
      if (county !== "all") p.set("county", county);
      return apiFetch(`/api/insurance/top-households?${p}`);
    },
    refetchInterval: 90_000,
  });

  const stats = statsQ.data ?? {};
  const households = hhQ.data?.households ?? [];

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Households", value: stats.total ?? "—" },
          { label: "Avg Score", value: stats.avgScore ? `${Number(stats.avgScore).toFixed(1)}/100` : "—" },
          { label: "High-Opportunity", value: stats.highOpportunityCount ?? "—" },
          { label: "Cross-Sell Ready", value: stats.crossSellCount ?? "—" },
        ].map(({ label, value }) => (
          <Card key={label} className="p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-bold mt-1">{String(value)}</p>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <Select value={county} onValueChange={setCounty}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="County" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Counties</SelectItem>
            {["LEE", "COLLIER", "CHARLOTTE", "SARASOTA", "MIAMI-DADE", "BROWARD", "PALM BEACH"].map(c => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={minScore} onValueChange={setMinScore}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Min Score" />
          </SelectTrigger>
          <SelectContent>
            {["30", "50", "65", "75"].map(s => (
              <SelectItem key={s} value={s}>Score ≥ {s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Opportunity table */}
      <div className="border rounded-lg overflow-auto max-h-[480px]">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 sticky top-0">
            <tr>
              {["Address", "County", "Score", "Lines", "Est. Premium", "Urgency"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hhQ.isLoading ? (
              <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</td></tr>
            ) : households.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No households found</td></tr>
            ) : households.map((h: any, i: number) => (
              <tr key={h.householdId ?? i} className="border-t hover:bg-muted/20">
                <td className="px-3 py-2 font-medium max-w-[180px] truncate">{h.primaryAddress}</td>
                <td className="px-3 py-2 text-muted-foreground">{h.county}</td>
                <td className="px-3 py-2">
                  <span className={`font-bold ${scoreColor(h.policyOpportunityScore ?? 0)}`}>
                    {h.policyOpportunityScore ?? 0}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {(h.opportunityTypes ?? []).slice(0, 3).map((t: string) => (
                      <Badge key={t} variant="outline" className="text-[10px] px-1 py-0">{t.replace(/_/g, " ")}</Badge>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2">${(h.estimatedPremium ?? 0).toLocaleString()}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-medium ${urgencyColor(h.scoreBreakdown?.urgency ?? "routine")}`}>
                    {h.scoreBreakdown?.urgency ?? "routine"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Panel 2: Storm Claim Intelligence ────────────────────────────────────────

function StormClaimPanel() {
  const [county, setCounty] = useState("all");

  const statsQ = useQuery({
    queryKey: ["insurance", "storm-claim-stats"],
    queryFn: () => apiFetch("/api/insurance/storm-claim-stats"),
    refetchInterval: 120_000,
  });

  const oppsQ = useQuery({
    queryKey: ["insurance", "storm-opportunities", county],
    queryFn: () => {
      const p = new URLSearchParams({ limit: "30", minScore: "35" });
      if (county !== "all") p.set("county", county);
      return apiFetch(`/api/insurance/storm-opportunities?${p}`);
    },
    refetchInterval: 120_000,
  });

  const stats = statsQ.data ?? {};
  const opportunities = oppsQ.data?.opportunities ?? [];

  return (
    <div className="space-y-4">
      {/* Storm KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Active Storm Events", value: stats.activeEvents ?? "—", icon: <AlertTriangle className="h-4 w-4 text-orange-500" /> },
          { label: "Claim Opportunities", value: stats.totalOpportunities ?? "—", icon: <Zap className="h-4 w-4 text-yellow-500" /> },
          { label: "Homeowner Crossover", value: stats.withInsuranceCrossover ?? "—", icon: <Home className="h-4 w-4 text-blue-500" /> },
          { label: "Avg Opp Score", value: stats.avgScore ? `${Number(stats.avgScore).toFixed(0)}/100` : "—", icon: <Activity className="h-4 w-4 text-green-500" /> },
        ].map(({ label, value, icon }) => (
          <Card key={label} className="p-3">
            <div className="flex items-center gap-2 mb-1">
              {icon}
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
            <p className="text-xl font-bold">{String(value)}</p>
          </Card>
        ))}
      </div>

      <Select value={county} onValueChange={setCounty}>
        <SelectTrigger className="w-36">
          <SelectValue placeholder="County" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Counties</SelectItem>
          {["LEE", "COLLIER", "CHARLOTTE", "SARASOTA", "MIAMI-DADE"].map(c => (
            <SelectItem key={c} value={c}>{c}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="border rounded-lg overflow-auto max-h-[440px]">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 sticky top-0">
            <tr>
              {["Address", "County", "Storm Type", "Opp Score", "Status"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {oppsQ.isLoading ? (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</td></tr>
            ) : opportunities.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No storm opportunities</td></tr>
            ) : opportunities.map((o: any, i: number) => (
              <tr key={o.opportunityId ?? i} className="border-t hover:bg-muted/20">
                <td className="px-3 py-2 font-medium max-w-[160px] truncate">{o.address ?? o.householdId}</td>
                <td className="px-3 py-2 text-muted-foreground">{o.county}</td>
                <td className="px-3 py-2">
                  <Badge variant="outline" className="text-xs">{o.stormType ?? "storm"}</Badge>
                </td>
                <td className="px-3 py-2">
                  <span className={`font-bold ${scoreColor(o.opportunityScore ?? 0)}`}>{o.opportunityScore ?? 0}</span>
                </td>
                <td className="px-3 py-2">
                  <span className="text-xs text-muted-foreground">{o.status ?? "ready"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Panel 3: Commercial Opportunities ─────────────────────────────────────────

function CommercialOpportunitiesPanel() {
  const [businessType, setBusinessType] = useState("all");

  const statsQ = useQuery({
    queryKey: ["insurance", "commercial-stats"],
    queryFn: () => apiFetch("/api/insurance/commercial-stats"),
    refetchInterval: 120_000,
  });

  const oppsQ = useQuery({
    queryKey: ["insurance", "commercial-opportunities", businessType],
    queryFn: () => {
      const p = new URLSearchParams({ limit: "25", minScore: "40" });
      if (businessType !== "all") p.set("businessType", businessType);
      return apiFetch(`/api/insurance/commercial-opportunities?${p}`);
    },
    refetchInterval: 120_000,
  });

  const stats = statsQ.data ?? {};
  const opportunities = oppsQ.data?.opportunities ?? [];

  const glPct  = stats.total > 0 ? Math.round((stats.glCount / stats.total) * 100)  : 0;
  const wcPct  = stats.total > 0 ? Math.round((stats.wcCount / stats.total) * 100)  : 0;
  const bopPct = stats.total > 0 ? Math.round((stats.bopCount / stats.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Businesses", value: stats.total ?? "—" },
          { label: "Avg Score", value: stats.avgScore ? `${Number(stats.avgScore).toFixed(1)}/100` : "—" },
          { label: "Contractors", value: stats.contractorCount ?? "—" },
          { label: "GL Opportunities", value: stats.glCount ?? "—" },
        ].map(({ label, value }) => (
          <Card key={label} className="p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-bold mt-1">{String(value)}</p>
          </Card>
        ))}
      </div>

      {/* Coverage mix bars */}
      <Card className="p-4">
        <p className="text-sm font-medium mb-3">Coverage Line Mix</p>
        <div className="space-y-2">
          {[
            { label: "General Liability", pct: glPct },
            { label: "Workers Comp", pct: wcPct },
            { label: "Business Owner Policy", pct: bopPct },
          ].map(({ label, pct }) => (
            <div key={label} className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-36">{label}</span>
              <Progress value={pct} className="flex-1 h-2" />
              <span className="text-xs font-medium w-8 text-right">{pct}%</span>
            </div>
          ))}
        </div>
      </Card>

      <Select value={businessType} onValueChange={setBusinessType}>
        <SelectTrigger className="w-44">
          <SelectValue placeholder="Business Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          {["contractor", "personal_services", "food_beverage", "healthcare", "real_estate", "financial_services"].map(t => (
            <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="border rounded-lg overflow-auto max-h-[380px]">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 sticky top-0">
            <tr>
              {["Business", "County", "Type", "Score", "Lines", "Est. Premium"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {oppsQ.isLoading ? (
              <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</td></tr>
            ) : opportunities.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No commercial opportunities</td></tr>
            ) : opportunities.map((o: any, i: number) => {
              const lines = [
                o.glOpportunity && "GL",
                o.wcOpportunity && "WC",
                o.bopOpportunity && "BOP",
                o.commercialAutoOpportunity && "Comm Auto",
              ].filter(Boolean);
              return (
                <tr key={o.businessId ?? i} className="border-t hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium max-w-[160px] truncate">{o.businessName}</td>
                  <td className="px-3 py-2 text-muted-foreground">{o.county}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{(o.businessType ?? "other").replace(/_/g, " ")}</td>
                  <td className="px-3 py-2">
                    <span className={`font-bold ${scoreColor(o.opportunityScore ?? 0)}`}>{o.opportunityScore ?? 0}</span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {lines.slice(0, 3).map((l: any) => (
                        <Badge key={l} variant="outline" className="text-[10px] px-1 py-0">{l}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2">${(o.estimatedAnnualPremium ?? 0).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Panel 4: Routing & Agency Performance ────────────────────────────────────

function RoutingPerformancePanel() {
  const [sinceHours, setSinceHours] = useState("24");

  const statsQ = useQuery({
    queryKey: ["insurance", "routing-stats", sinceHours],
    queryFn: () => apiFetch(`/api/insurance/routing-stats?sinceHours=${sinceHours}`),
    refetchInterval: 60_000,
  });

  const stats = statsQ.data ?? {};
  const byLine: Record<string, number> = stats.byLine ?? {};

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Leads Routed", value: stats.totalRouted ?? "—" },
          { label: "Claimed", value: stats.claimed ?? "—" },
          { label: "Expired", value: stats.expired ?? "—" },
          { label: "Claim Rate", value: stats.claimRatePct != null ? `${Number(stats.claimRatePct).toFixed(1)}%` : "—" },
        ].map(({ label, value }) => (
          <Card key={label} className="p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-bold mt-1">{String(value)}</p>
          </Card>
        ))}
      </div>

      <Select value={sinceHours} onValueChange={setSinceHours}>
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[["6", "Last 6h"], ["24", "Last 24h"], ["72", "Last 3d"], ["168", "Last 7d"]].map(([v, l]) => (
            <SelectItem key={v} value={v}>{l}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Per-line routing breakdown */}
      <Card className="p-4">
        <p className="text-sm font-medium mb-3">Routing by Insurance Line</p>
        {Object.keys(byLine).length === 0 ? (
          <p className="text-sm text-muted-foreground">No routing data for this period</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(byLine)
              .sort(([, a], [, b]) => (b as number) - (a as number))
              .map(([line, count]) => (
                <div key={line} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-40">{line.replace(/_/g, " ")}</span>
                  <Progress
                    value={stats.totalRouted > 0 ? ((count as number) / stats.totalRouted) * 100 : 0}
                    className="flex-1 h-2"
                  />
                  <span className="text-xs font-medium w-8 text-right">{count as number}</span>
                </div>
              ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Panel 5: Workflow Queue ───────────────────────────────────────────────────

function WorkflowQueuePanel() {
  const queueQ = useQuery({
    queryKey: ["insurance", "workflow-queue"],
    queryFn: () => apiFetch("/api/insurance/workflow-queue"),
    refetchInterval: 30_000,
  });

  const pending: any[] = queueQ.data?.pending ?? [];
  const wfStats = queueQ.data?.stats ?? {};

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Pending", value: wfStats.pending ?? "—" },
          { label: "Executed (7d)", value: wfStats.executed ?? "—" },
          { label: "Workflow Types", value: Object.keys(wfStats.byType ?? {}).length || "—" },
        ].map(({ label, value }) => (
          <Card key={label} className="p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-bold mt-1">{String(value)}</p>
          </Card>
        ))}
      </div>

      {/* By-type breakdown */}
      {Object.keys(wfStats.byType ?? {}).length > 0 && (
        <Card className="p-4">
          <p className="text-sm font-medium mb-2">Workflow Type Mix (7d)</p>
          <div className="space-y-1.5">
            {Object.entries(wfStats.byType ?? {})
              .sort(([, a], [, b]) => (b as number) - (a as number))
              .map(([type, count]) => (
                <div key={type} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{type.replace(/_/g, " ")}</span>
                  <span className="font-medium">{count as number}</span>
                </div>
              ))}
          </div>
        </Card>
      )}

      <div className="border rounded-lg overflow-auto max-h-[380px]">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 sticky top-0">
            <tr>
              {["Type", "Line", "Scheduled", "Status", "Approval"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {queueQ.isLoading ? (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</td></tr>
            ) : pending.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No pending workflows</td></tr>
            ) : pending.map((w: any) => (
              <tr key={w.id} className="border-t hover:bg-muted/20">
                <td className="px-3 py-2 text-xs">{(w.workflow_type ?? "—").replace(/_/g, " ")}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{w.insurance_line ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {w.scheduled_at ? new Date(w.scheduled_at).toLocaleString() : "—"}
                </td>
                <td className="px-3 py-2">
                  <Badge variant="outline" className="text-[10px]">{w.status ?? "pending"}</Badge>
                </td>
                <td className="px-3 py-2">
                  <span className="text-[10px] font-medium text-orange-600">
                    {w.approval_required ? "Required" : "Auto"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Panel 6: Policy Scoring Overview ─────────────────────────────────────────

function PolicyScoringPanel() {
  const hhQ = useQuery({
    queryKey: ["insurance", "policy-scoring-sample"],
    queryFn: () => apiFetch("/api/insurance/top-households?limit=50&minScore=0"),
    refetchInterval: 120_000,
  });

  const households: any[] = hhQ.data?.households ?? [];

  // Score distribution buckets
  const buckets = [
    { label: "Critical (75-100)", min: 75, max: 100, color: "bg-red-500" },
    { label: "High (55-74)",     min: 55, max: 74,  color: "bg-orange-500" },
    { label: "Medium (35-54)",   min: 35, max: 54,  color: "bg-yellow-500" },
    { label: "Low (0-34)",       min: 0,  max: 34,  color: "bg-green-500" },
  ];

  const total = households.length || 1;
  const bucketCounts = buckets.map(b => ({
    ...b,
    count: households.filter(h => {
      const s = h.policyOpportunityScore ?? 0;
      return s >= b.min && s <= b.max;
    }).length,
  }));

  // Top opportunity types
  const typeCount: Record<string, number> = {};
  for (const h of households) {
    for (const t of (h.opportunityTypes ?? [])) {
      typeCount[t] = (typeCount[t] ?? 0) + 1;
    }
  }
  const topTypes = Object.entries(typeCount)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="text-sm font-medium mb-3">Score Distribution</p>
        <div className="space-y-2">
          {bucketCounts.map(b => (
            <div key={b.label} className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-36">{b.label}</span>
              <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
                <div
                  className={`h-full ${b.color} rounded-full transition-all`}
                  style={{ width: `${(b.count / total) * 100}%` }}
                />
              </div>
              <span className="text-xs font-medium w-8 text-right">{b.count}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <p className="text-sm font-medium mb-3">Top Opportunity Types</p>
        {topTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data yet</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {topTypes.map(([type, count]) => (
              <div key={type} className="flex items-center justify-between text-xs bg-muted/40 rounded px-2 py-1">
                <span className="text-muted-foreground truncate">{type.replace(/_/g, " ")}</span>
                <span className="font-bold ml-2">{count}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Page root ─────────────────────────────────────────────────────────────────

export default function InsuranceIntelligencePage() {
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Insurance Intelligence</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Real-time household, storm, and commercial insurance opportunities — all drafts require agent approval before send.
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline" className="text-xs gap-1">
            <Home className="h-3 w-3" /> Household
          </Badge>
          <Badge variant="outline" className="text-xs gap-1">
            <Car className="h-3 w-3" /> Auto
          </Badge>
          <Badge variant="outline" className="text-xs gap-1">
            <Building2 className="h-3 w-3" /> Commercial
          </Badge>
        </div>
      </div>

      {/* Panels */}
      <Tabs defaultValue="households" className="w-full">
        <TabsList className="grid grid-cols-3 lg:grid-cols-6 gap-1 h-auto">
          <TabsTrigger value="households" className="text-xs">
            <Home className="h-3 w-3 mr-1" /> Households
          </TabsTrigger>
          <TabsTrigger value="storm" className="text-xs">
            <AlertTriangle className="h-3 w-3 mr-1" /> Storm Claims
          </TabsTrigger>
          <TabsTrigger value="commercial" className="text-xs">
            <Building2 className="h-3 w-3 mr-1" /> Commercial
          </TabsTrigger>
          <TabsTrigger value="routing" className="text-xs">
            <MapPin className="h-3 w-3 mr-1" /> Routing
          </TabsTrigger>
          <TabsTrigger value="workflows" className="text-xs">
            <Activity className="h-3 w-3 mr-1" /> Workflows
          </TabsTrigger>
          <TabsTrigger value="scoring" className="text-xs">
            <Zap className="h-3 w-3 mr-1" /> Scoring
          </TabsTrigger>
        </TabsList>

        <TabsContent value="households" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Household Opportunities</CardTitle>
            </CardHeader>
            <CardContent>
              <HouseholdOpportunitiesPanel />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="storm" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Storm Claim Intelligence</CardTitle>
            </CardHeader>
            <CardContent>
              <StormClaimPanel />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="commercial" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Commercial Insurance Opportunities</CardTitle>
            </CardHeader>
            <CardContent>
              <CommercialOpportunitiesPanel />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="routing" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Agency Routing Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <RoutingPerformancePanel />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="workflows" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Insurance Workflow Queue</CardTitle>
            </CardHeader>
            <CardContent>
              <WorkflowQueuePanel />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scoring" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Policy Scoring Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <PolicyScoringPanel />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Compliance notice */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        <strong>Compliance Notice:</strong> All insurance opportunity data is for internal agency intelligence only.
        No outreach is permitted without explicit agency-side human approval. All workflows are draft-only with
        <code className="mx-1">approval_required = TRUE</code> enforced at the database level.
      </div>
    </div>
  );
}
