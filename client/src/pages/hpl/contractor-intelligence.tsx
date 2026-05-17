/**
 * client/src/pages/hpl/contractor-intelligence.tsx
 *
 * HPL Contractor Intelligence Dashboard
 *
 * Panels:
 *   1. Property Intelligence Summary — KPI cards + top opportunity queue
 *   2. Storm Events — active storm feed with opportunity scoring
 *   3. Lead Pipeline — funnel stats by signal type
 *   4. Routing Performance — claim rates, territory coverage
 *   5. Workflow Queue — pending automation drafts awaiting approval
 *   6. County Clusters — geographic opportunity heat map
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PropertyStats {
  totalProperties: number;
  avgOpportunityScore: number;
  highValueCount: number;
  mediumValueCount: number;
  withActiveSignals: number;
  highStormExposure: number;
  skipTracedCount: number;
  avgPropertyValue: number;
  avgRoofAge: number;
  lastEnrichedAt: string | null;
}

interface StormEvent {
  eventId: string;
  eventType: string;
  severity: string;
  county: string;
  state: string;
  startedAt: string;
  opportunityScore: number;
  primaryTrades: string[];
  insuranceCrossFit: boolean;
  hailSizeInches?: number;
  windSpeedMph?: number;
}

interface StormStats {
  activeEvents: number;
  avgScore: number;
  topCounties: string[];
  insuranceCrossFitCount: number;
}

interface RoutingStats {
  totalAssignments: number;
  claimedCount: number;
  expiredCount: number;
  claimRatePct: number;
  byCounty: Record<string, number>;
}

interface WorkflowEntry {
  id: number;
  workflowType: string;
  contractorId?: number;
  scheduledAt: string;
  approvalRequired: boolean;
}

interface WorkflowStats {
  pending: number;
  executed: number;
  byType: Record<string, number>;
}

interface CountyCluster {
  county: string;
  state: string;
  propertyCount: number;
  avgOpportunityScore: number;
  activeSignalCount: number;
  highValueCount: number;
}

interface LeadPipeline {
  total: number;
  pending: number;
  claimed: number;
  expired: number;
  converted: number;
  claimRatePct: number;
  conversionRatePct: number;
  byType: Record<string, { count: number; avgScore: number; highScore: number }>;
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, accent }: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "green" | "yellow" | "red" | "blue";
}) {
  const colors = {
    green: "text-emerald-400",
    yellow: "text-amber-400",
    red: "text-red-400",
    blue: "text-blue-400",
  };
  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardContent className="pt-4 pb-3">
        <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">{label}</p>
        <p className={`text-2xl font-bold ${accent ? colors[accent] : "text-white"}`}>{value}</p>
        {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ── Severity badge ────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    extreme: "bg-red-900 text-red-200",
    severe: "bg-orange-900 text-orange-200",
    moderate: "bg-yellow-900 text-yellow-200",
    minor: "bg-gray-700 text-gray-300",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${map[severity] ?? "bg-gray-700 text-gray-300"}`}>
      {severity}
    </span>
  );
}

// ── Score pill ────────────────────────────────────────────────────────────────

function ScorePill({ score }: { score: number }) {
  const color = score >= 70 ? "bg-emerald-900 text-emerald-200"
    : score >= 50 ? "bg-yellow-900 text-yellow-200"
    : "bg-gray-700 text-gray-300";
  return <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${color}`}>{score}</span>;
}

// ── Panel 1: Property Intelligence ────────────────────────────────────────────

function PropertyIntelligencePanel() {
  const { data: stats, isLoading } = useQuery<PropertyStats>({
    queryKey: ["/api/hpl/property-stats"],
    queryFn: () => apiRequest("GET", "/api/hpl/property-stats").then(r => r.json()),
    refetchInterval: 60_000,
  });

  const { data: topProps } = useQuery<{ properties: any[] }>({
    queryKey: ["/api/hpl/top-properties"],
    queryFn: () => apiRequest("GET", "/api/hpl/top-properties?limit=10&minScore=65").then(r => r.json()),
    refetchInterval: 120_000,
  });

  if (isLoading) return <div className="text-gray-400 text-sm animate-pulse">Loading property intelligence...</div>;

  const s = stats!;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Total Properties" value={s.totalProperties.toLocaleString()} accent="blue" />
        <KpiCard label="High-Value (70+)" value={s.highValueCount.toLocaleString()} accent="green" />
        <KpiCard label="Avg Opportunity Score" value={s.avgOpportunityScore.toFixed(1)} accent="yellow" />
        <KpiCard label="High Storm Exposure" value={s.highStormExposure.toLocaleString()} accent="red" />
        <KpiCard label="With Active Signals" value={s.withActiveSignals.toLocaleString()} />
        <KpiCard label="Skip Traced" value={s.skipTracedCount.toLocaleString()} />
        <KpiCard label="Avg Property Value" value={`$${(s.avgPropertyValue / 1000).toFixed(0)}k`} />
        <KpiCard label="Avg Roof Age" value={`${s.avgRoofAge.toFixed(1)} yrs`} accent={s.avgRoofAge > 15 ? "red" : "green"} />
      </div>

      {topProps?.properties && topProps.properties.length > 0 && (
        <div>
          <h3 className="text-gray-300 text-sm font-semibold mb-2">Top Opportunity Properties</h3>
          <div className="overflow-auto rounded-lg border border-gray-700">
            <table className="w-full text-xs text-gray-300">
              <thead>
                <tr className="bg-gray-700 text-gray-400 uppercase">
                  <th className="px-3 py-2 text-left">Address</th>
                  <th className="px-3 py-2 text-left">County</th>
                  <th className="px-3 py-2 text-left">Owner</th>
                  <th className="px-3 py-2 text-center">Score</th>
                  <th className="px-3 py-2 text-right">Value</th>
                  <th className="px-3 py-2 text-center">Roof Age</th>
                  <th className="px-3 py-2 text-center">Storm</th>
                </tr>
              </thead>
              <tbody>
                {topProps.properties.map((p: any, i: number) => (
                  <tr key={p.apex_property_id ?? i} className="border-t border-gray-700 hover:bg-gray-750">
                    <td className="px-3 py-2 max-w-[200px] truncate">{p.property_address}</td>
                    <td className="px-3 py-2">{p.county}</td>
                    <td className="px-3 py-2">{p.owner_name ?? "—"}</td>
                    <td className="px-3 py-2 text-center"><ScorePill score={p.contractor_opportunity_score} /></td>
                    <td className="px-3 py-2 text-right">
                      {p.estimated_value ? `$${(p.estimated_value / 1000).toFixed(0)}k` : "—"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {p.roof_age_estimate != null ? (
                        <span className={p.roof_age_estimate > 15 ? "text-red-400" : "text-gray-400"}>
                          {p.roof_age_estimate}y
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={p.storm_exposure_score >= 70 ? "text-red-400" : "text-gray-500"}>
                        {p.storm_exposure_score ?? 0}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Panel 2: Storm Events ─────────────────────────────────────────────────────

function StormEventsPanel() {
  const { data, isLoading, refetch } = useQuery<{ events: StormEvent[]; stats: StormStats }>({
    queryKey: ["/api/hpl/storm-events"],
    queryFn: () => apiRequest("GET", "/api/hpl/storm-events?minScore=20").then(r => r.json()),
    refetchInterval: 60_000,
  });

  const s = data?.stats;
  const events = data?.events ?? [];

  return (
    <div className="space-y-4">
      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="Active Events" value={s.activeEvents} accent="red" />
          <KpiCard label="Avg Score" value={s.avgScore.toFixed(1)} accent="yellow" />
          <KpiCard label="Insurance Crossover" value={s.insuranceCrossFitCount} accent="blue" />
          <KpiCard label="Top Counties" value={s.topCounties.slice(0, 3).join(", ") || "—"} />
        </div>
      )}

      {isLoading ? (
        <div className="text-gray-400 text-sm animate-pulse">Loading storm events...</div>
      ) : events.length === 0 ? (
        <div className="text-gray-500 text-sm text-center py-8">No active storm events in the last 72 hours</div>
      ) : (
        <div className="overflow-auto rounded-lg border border-gray-700">
          <table className="w-full text-xs text-gray-300">
            <thead>
              <tr className="bg-gray-700 text-gray-400 uppercase">
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">County</th>
                <th className="px-3 py-2 text-left">Severity</th>
                <th className="px-3 py-2 text-center">Score</th>
                <th className="px-3 py-2 text-left">Primary Trades</th>
                <th className="px-3 py-2 text-center">Insurance</th>
                <th className="px-3 py-2 text-left">Started</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.eventId} className="border-t border-gray-700 hover:bg-gray-750">
                  <td className="px-3 py-2 font-medium capitalize">{e.eventType.replace(/_/g, " ")}</td>
                  <td className="px-3 py-2">{e.county}</td>
                  <td className="px-3 py-2"><SeverityBadge severity={e.severity} /></td>
                  <td className="px-3 py-2 text-center"><ScorePill score={e.opportunityScore} /></td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {e.primaryTrades.slice(0, 3).map(t => (
                        <span key={t} className="bg-gray-700 px-1.5 py-0.5 rounded text-gray-300 capitalize">
                          {t.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {e.insuranceCrossFit ? (
                      <span className="text-emerald-400 font-bold">Yes</span>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-400">
                    {new Date(e.startedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Panel 3: Lead Pipeline ────────────────────────────────────────────────────

function LeadPipelinePanel() {
  const [sinceHours, setSinceHours] = useState("168");

  const { data, isLoading } = useQuery<LeadPipeline>({
    queryKey: ["/api/hpl/lead-pipeline", sinceHours],
    queryFn: () => apiRequest("GET", `/api/hpl/lead-pipeline?sinceHours=${sinceHours}`).then(r => r.json()),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-gray-400 text-sm">Window:</span>
        <Select value={sinceHours} onValueChange={setSinceHours}>
          <SelectTrigger className="w-36 bg-gray-700 border-gray-600 text-gray-200 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-gray-800 border-gray-600">
            <SelectItem value="24">Last 24h</SelectItem>
            <SelectItem value="72">Last 3 days</SelectItem>
            <SelectItem value="168">Last 7 days</SelectItem>
            <SelectItem value="720">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-gray-400 text-sm animate-pulse">Loading pipeline...</div>
      ) : data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Total Leads" value={data.total.toLocaleString()} accent="blue" />
            <KpiCard label="Claim Rate" value={`${data.claimRatePct.toFixed(1)}%`} accent={data.claimRatePct >= 40 ? "green" : "yellow"} />
            <KpiCard label="Conversion Rate" value={`${data.conversionRatePct.toFixed(1)}%`} accent={data.conversionRatePct >= 20 ? "green" : "red"} />
            <KpiCard label="Expired" value={data.expired.toLocaleString()} accent={data.expired > 10 ? "red" : "green"} />
          </div>

          {/* Funnel viz */}
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <h3 className="text-gray-300 text-sm font-semibold mb-3">Lead Funnel</h3>
            <div className="space-y-2">
              {[
                { label: "Total", count: data.total, color: "bg-blue-600" },
                { label: "Claimed", count: data.claimed, color: "bg-emerald-600" },
                { label: "Converted", count: data.converted, color: "bg-purple-600" },
                { label: "Expired", count: data.expired, color: "bg-red-600" },
              ].map(({ label, count, color }) => (
                <div key={label} className="flex items-center gap-3">
                  <span className="text-gray-400 text-xs w-20">{label}</span>
                  <div className="flex-1 bg-gray-700 rounded-full h-3">
                    <div
                      className={`${color} h-3 rounded-full transition-all`}
                      style={{ width: data.total > 0 ? `${Math.min((count / data.total) * 100, 100)}%` : "0%" }}
                    />
                  </div>
                  <span className="text-gray-300 text-xs w-12 text-right">{count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>

          {/* By signal type */}
          {Object.keys(data.byType).length > 0 && (
            <div className="overflow-auto rounded-lg border border-gray-700">
              <table className="w-full text-xs text-gray-300">
                <thead>
                  <tr className="bg-gray-700 text-gray-400 uppercase">
                    <th className="px-3 py-2 text-left">Signal Type</th>
                    <th className="px-3 py-2 text-right">Count</th>
                    <th className="px-3 py-2 text-right">Avg Score</th>
                    <th className="px-3 py-2 text-right">High Score</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.byType).map(([type, stats]) => (
                    <tr key={type} className="border-t border-gray-700">
                      <td className="px-3 py-2 capitalize font-medium">{type.replace(/_/g, " ")}</td>
                      <td className="px-3 py-2 text-right">{stats.count}</td>
                      <td className="px-3 py-2 text-right"><ScorePill score={Math.round(stats.avgScore)} /></td>
                      <td className="px-3 py-2 text-right text-emerald-400">{stats.highScore}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Panel 4: Routing Performance ──────────────────────────────────────────────

function RoutingPerformancePanel() {
  const { data, isLoading } = useQuery<{ routing: RoutingStats; territory: Record<string, string[]> }>({
    queryKey: ["/api/hpl/routing-stats"],
    queryFn: () => apiRequest("GET", "/api/hpl/routing-stats").then(r => r.json()),
    refetchInterval: 60_000,
  });

  const r = data?.routing;
  const territory = data?.territory ?? {};
  const countyList = Object.entries(territory)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 20);

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="text-gray-400 text-sm animate-pulse">Loading routing stats...</div>
      ) : r && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Total Assignments" value={r.totalAssignments} accent="blue" />
            <KpiCard label="Claimed" value={r.claimedCount} accent="green" />
            <KpiCard label="Expired" value={r.expiredCount} accent="red" />
            <KpiCard label="Claim Rate" value={`${r.claimRatePct.toFixed(1)}%`} accent={r.claimRatePct >= 40 ? "green" : "yellow"} />
          </div>

          {/* Top counties by routing volume */}
          {Object.keys(r.byCounty).length > 0 && (
            <div>
              <h3 className="text-gray-300 text-sm font-semibold mb-2">Routing Volume by County</h3>
              <div className="space-y-1">
                {Object.entries(r.byCounty)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 8)
                  .map(([county, count]) => (
                    <div key={county} className="flex items-center gap-2">
                      <span className="text-gray-400 text-xs w-32 capitalize">{county}</span>
                      <div className="flex-1 bg-gray-700 rounded h-2">
                        <div className="bg-blue-600 h-2 rounded" style={{ width: `${Math.min(count * 5, 100)}%` }} />
                      </div>
                      <span className="text-gray-400 text-xs w-8 text-right">{count}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Territory coverage */}
          {countyList.length > 0 && (
            <div>
              <h3 className="text-gray-300 text-sm font-semibold mb-2">Territory Coverage</h3>
              <div className="overflow-auto rounded-lg border border-gray-700 max-h-48">
                <table className="w-full text-xs text-gray-300">
                  <thead>
                    <tr className="bg-gray-700 text-gray-400 uppercase">
                      <th className="px-3 py-2 text-left">County</th>
                      <th className="px-3 py-2 text-right">Contractors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {countyList.map(([county, contractors]) => (
                      <tr key={county} className="border-t border-gray-700">
                        <td className="px-3 py-2">{county}</td>
                        <td className="px-3 py-2 text-right text-emerald-400">{contractors.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Panel 5: Workflow Queue ────────────────────────────────────────────────────

function WorkflowQueuePanel() {
  const { data, isLoading } = useQuery<{ pending: WorkflowEntry[]; stats: WorkflowStats }>({
    queryKey: ["/api/hpl/workflow-queue"],
    queryFn: () => apiRequest("GET", "/api/hpl/workflow-queue?limit=25").then(r => r.json()),
    refetchInterval: 30_000,
  });

  const pending = data?.pending ?? [];
  const stats = data?.stats;

  const WORKFLOW_LABELS: Record<string, string> = {
    missed_call_textback: "Missed Call Text-back",
    estimate_followup: "Estimate Follow-up",
    appointment_reminder: "Appointment Reminder",
    review_request: "Review Request",
    abandoned_estimate: "Abandoned Estimate",
    storm_outreach: "Storm Outreach",
    new_lead_notification: "New Lead Notification",
    lead_expiry_warning: "Lead Expiry Warning",
    seasonal_campaign: "Seasonal Campaign",
  };

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <KpiCard label="Pending Approval" value={stats.pending} accent={stats.pending > 20 ? "red" : "yellow"} />
          <KpiCard label="Executed (7d)" value={stats.executed} accent="green" />
          <KpiCard label="Workflow Types" value={Object.keys(stats.byType).length} />
        </div>
      )}

      <div className="bg-amber-900/20 border border-amber-700 rounded-lg p-3 text-xs text-amber-200">
        All workflow drafts require explicit operator approval before sending. No messages are auto-sent.
      </div>

      {isLoading ? (
        <div className="text-gray-400 text-sm animate-pulse">Loading workflow queue...</div>
      ) : pending.length === 0 ? (
        <div className="text-gray-500 text-sm text-center py-8">No pending workflows</div>
      ) : (
        <div className="overflow-auto rounded-lg border border-gray-700">
          <table className="w-full text-xs text-gray-300">
            <thead>
              <tr className="bg-gray-700 text-gray-400 uppercase">
                <th className="px-3 py-2 text-left">Workflow</th>
                <th className="px-3 py-2 text-left">Contractor</th>
                <th className="px-3 py-2 text-left">Scheduled</th>
                <th className="px-3 py-2 text-center">Approval</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((w) => (
                <tr key={w.id} className="border-t border-gray-700 hover:bg-gray-750">
                  <td className="px-3 py-2 font-medium">
                    {WORKFLOW_LABELS[w.workflowType] ?? w.workflowType}
                  </td>
                  <td className="px-3 py-2 text-gray-400">
                    {w.contractorId ? `#${w.contractorId}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-gray-400">
                    {new Date(w.scheduledAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className="bg-amber-900 text-amber-200 text-xs px-2 py-0.5 rounded">
                      Required
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Panel 6: County Clusters ──────────────────────────────────────────────────

function CountyClustersPanel() {
  const { data, isLoading } = useQuery<{ clusters: CountyCluster[] }>({
    queryKey: ["/api/hpl/county-clusters"],
    queryFn: () => apiRequest("GET", "/api/hpl/county-clusters").then(r => r.json()),
    refetchInterval: 300_000,
  });

  const clusters = data?.clusters ?? [];

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="text-gray-400 text-sm animate-pulse">Loading county clusters...</div>
      ) : clusters.length === 0 ? (
        <div className="text-gray-500 text-sm text-center py-8">No county data yet — run an enrichment pass first</div>
      ) : (
        <div className="overflow-auto rounded-lg border border-gray-700">
          <table className="w-full text-xs text-gray-300">
            <thead>
              <tr className="bg-gray-700 text-gray-400 uppercase">
                <th className="px-3 py-2 text-left">County</th>
                <th className="px-3 py-2 text-right">Properties</th>
                <th className="px-3 py-2 text-center">Avg Score</th>
                <th className="px-3 py-2 text-right">Active Signals</th>
                <th className="px-3 py-2 text-right">High Value</th>
              </tr>
            </thead>
            <tbody>
              {clusters.map((c) => (
                <tr key={`${c.county}-${c.state}`} className="border-t border-gray-700 hover:bg-gray-750">
                  <td className="px-3 py-2 font-medium">
                    {c.county}
                    <span className="text-gray-500 ml-1">{c.state}</span>
                  </td>
                  <td className="px-3 py-2 text-right">{c.propertyCount.toLocaleString()}</td>
                  <td className="px-3 py-2 text-center"><ScorePill score={Math.round(c.avgOpportunityScore)} /></td>
                  <td className="px-3 py-2 text-right text-blue-400">{c.activeSignalCount.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-emerald-400">{c.highValueCount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function ContractorIntelligenceDashboard() {
  const [activePanel, setActivePanel] = useState<
    "properties" | "storms" | "pipeline" | "routing" | "workflows" | "clusters"
  >("properties");

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const linkLeadsMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/hpl/link-leads").then(r => r.json()),
    onSuccess: (data) => {
      toast({ title: "Leads linked", description: `${data.linked} properties linked, ${data.errors} errors` });
      queryClient.invalidateQueries({ queryKey: ["/api/hpl/property-stats"] });
    },
    onError: () => toast({ title: "Link failed", variant: "destructive" }),
  });

  const PANELS = [
    { key: "properties" as const, label: "Property Intel" },
    { key: "storms" as const, label: "Storm Events" },
    { key: "pipeline" as const, label: "Lead Pipeline" },
    { key: "routing" as const, label: "Routing Stats" },
    { key: "workflows" as const, label: "Workflow Queue" },
    { key: "clusters" as const, label: "County Clusters" },
  ];

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">HPL Contractor Intelligence</h1>
          <p className="text-gray-400 text-sm mt-0.5">Property signals · Storm events · Contractor routing · Workflow drafts</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-gray-600 text-gray-300 hover:bg-gray-700"
            onClick={() => linkLeadsMutation.mutate()}
            disabled={linkLeadsMutation.isPending}
          >
            {linkLeadsMutation.isPending ? "Linking..." : "Link Leads → Properties"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-gray-600 text-gray-300 hover:bg-gray-700"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/hpl/"] })}
          >
            Refresh All
          </Button>
        </div>
      </div>

      {/* Panel nav */}
      <div className="flex gap-1 flex-wrap mb-5">
        {PANELS.map(p => (
          <button
            key={p.key}
            onClick={() => setActivePanel(p.key)}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              activePanel === p.key
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Active panel */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-gray-200 text-base">
            {PANELS.find(p => p.key === activePanel)?.label}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activePanel === "properties" && <PropertyIntelligencePanel />}
          {activePanel === "storms"     && <StormEventsPanel />}
          {activePanel === "pipeline"   && <LeadPipelinePanel />}
          {activePanel === "routing"    && <RoutingPerformancePanel />}
          {activePanel === "workflows"  && <WorkflowQueuePanel />}
          {activePanel === "clusters"   && <CountyClustersPanel />}
        </CardContent>
      </Card>
    </div>
  );
}
