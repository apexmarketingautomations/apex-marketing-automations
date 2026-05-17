/**
 * client/src/pages/admin/ai-command-center.tsx
 *
 * AI Command Center — Admin Dashboard
 * Real-time visibility into all AI provider health, budget, audit trail, and policy state.
 * Auto-refreshes on configurable intervals per panel.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    healthy:         "bg-green-100 text-green-800",
    degraded:        "bg-yellow-100 text-yellow-800",
    unavailable:     "bg-red-100 text-red-800",
    "quota-exhausted": "bg-orange-100 text-orange-800",
    ok:              "bg-green-100 text-green-800",
    warning:         "bg-yellow-100 text-yellow-800",
    critical:        "bg-red-100 text-red-800",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? "bg-gray-100 text-gray-700"}`}>
      {status}
    </span>
  );
}

// ── Panel wrapper ─────────────────────────────────────────────────────────────

function Panel({ title, children, actions }: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
        {actions}
      </div>
      {children}
    </div>
  );
}

// ── Provider Health Panel ─────────────────────────────────────────────────────

function ProviderHealthPanel() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["ai-health"],
    queryFn: () => fetchJson<any>("/api/admin/ai/health"),
    refetchInterval: 20_000,
  });

  if (isLoading) return <Panel title="Provider Health"><p className="text-xs text-gray-500">Loading...</p></Panel>;
  if (error)     return <Panel title="Provider Health"><p className="text-xs text-red-500">Failed to load</p></Panel>;

  const { providers = [], configured = {}, summary = {}, emergencyShutdown } = data ?? {};

  return (
    <Panel title="Provider Health" actions={
      emergencyShutdown && (
        <span className="text-xs font-bold text-red-600 animate-pulse">BUDGET SHUTDOWN ACTIVE</span>
      )
    }>
      <div className="grid grid-cols-3 gap-2 text-xs text-center">
        <div className="bg-green-50 rounded p-2">
          <div className="text-lg font-bold text-green-700">{summary.healthyProviders ?? 0}</div>
          <div className="text-gray-500">Healthy</div>
        </div>
        <div className="bg-yellow-50 rounded p-2">
          <div className="text-lg font-bold text-yellow-700">{summary.degradedProviders ?? 0}</div>
          <div className="text-gray-500">Degraded</div>
        </div>
        <div className="bg-red-50 rounded p-2">
          <div className="text-lg font-bold text-red-700">{summary.unavailableProviders ?? 0}</div>
          <div className="text-gray-500">Unavailable</div>
        </div>
      </div>
      <div className="space-y-2">
        {providers.map((p: any) => (
          <div key={p.provider} className="flex items-center justify-between text-xs border-b border-gray-100 pb-1">
            <div className="flex items-center gap-2">
              <span className="font-medium capitalize">{p.provider}</span>
              <StatusBadge status={p.status} />
              {!configured[p.provider] && (
                <span className="text-gray-400 italic">not configured</span>
              )}
            </div>
            <div className="flex items-center gap-3 text-gray-500">
              {p.circuitTrippedAt && (
                <span className="text-red-600 font-medium">CIRCUIT OPEN</span>
              )}
              <span>{p.errorRatePct?.toFixed(1) ?? "0.0"}% err</span>
              <span>{Math.round(p.observedP50Ms ?? 0)}ms p50</span>
              <span>{p.consecutiveFailures} consec fail</span>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ── Budget Panel ──────────────────────────────────────────────────────────────

function BudgetPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["ai-budget"],
    queryFn: () => fetchJson<any>("/api/admin/ai/budget"),
    refetchInterval: 30_000,
  });

  const shutdownMut = useMutation({
    mutationFn: (active: boolean) => postJson("/api/admin/ai/budget/shutdown", { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-budget"] }),
  });

  if (isLoading) return <Panel title="AI Budget"><p className="text-xs text-gray-500">Loading...</p></Panel>;

  const { global: g = {}, byProvider = {}, byTaskType = {} } = data ?? {};
  const utilPct = g.hardLimitUsd > 0 ? ((g.currentSpendUsd ?? 0) / g.hardLimitUsd) * 100 : 0;
  const barColor = utilPct > 90 ? "bg-red-500" : utilPct > 70 ? "bg-yellow-400" : "bg-green-500";

  return (
    <Panel title="AI Budget (24h)" actions={
      <button
        onClick={() => shutdownMut.mutate(!data?.emergencyShutdown)}
        disabled={shutdownMut.isPending}
        className={`text-xs px-2 py-1 rounded ${data?.emergencyShutdown
          ? "bg-red-100 text-red-700 hover:bg-red-200"
          : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
      >
        {data?.emergencyShutdown ? "Resume AI" : "Emergency Stop"}
      </button>
    }>
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-gray-600">
          <span>${(g.currentSpendUsd ?? 0).toFixed(4)} spent</span>
          <span>${(g.hardLimitUsd ?? 0).toFixed(2)} limit</span>
        </div>
        <div className="w-full bg-gray-100 rounded h-2">
          <div className={`h-2 rounded ${barColor}`} style={{ width: `${Math.min(utilPct, 100)}%` }} />
        </div>
        <div className="text-xs text-gray-500">{utilPct.toFixed(1)}% utilized</div>
      </div>
      <div className="text-xs space-y-1">
        <div className="font-medium text-gray-700">By Provider</div>
        {Object.entries(byProvider as Record<string, any>).map(([prov, s]) => (
          <div key={prov} className="flex justify-between text-gray-600">
            <span className="capitalize">{prov}</span>
            <span>${(s.currentSpendUsd ?? 0).toFixed(4)}</span>
          </div>
        ))}
      </div>
      <div className="text-xs space-y-1">
        <div className="font-medium text-gray-700">By Task Type</div>
        {Object.entries(byTaskType as Record<string, any>).slice(0, 5).map(([task, s]) => (
          <div key={task} className="flex justify-between text-gray-600">
            <span>{task}</span>
            <span>${(s.currentSpendUsd ?? 0).toFixed(4)}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ── Audit Summary Panel ───────────────────────────────────────────────────────

function AuditSummaryPanel() {
  const [hours, setHours] = useState(24);
  const { data, isLoading } = useQuery({
    queryKey: ["ai-audit-summary", hours],
    queryFn: () => fetchJson<any>(`/api/admin/ai/audit/summary?sinceHours=${hours}`),
    refetchInterval: 60_000,
  });

  if (isLoading) return <Panel title="AI Audit Summary"><p className="text-xs text-gray-500">Loading...</p></Panel>;

  const d = data ?? {};
  const successPct = ((d.successRate ?? 1) * 100).toFixed(1);
  const fallbackPct = ((d.fallbackRate ?? 0) * 100).toFixed(1);

  return (
    <Panel title={`AI Audit — Last ${hours}h`} actions={
      <select
        className="text-xs border rounded px-1 py-0.5"
        value={hours}
        onChange={e => setHours(Number(e.target.value))}
      >
        {[1, 6, 24, 72].map(h => <option key={h} value={h}>{h}h</option>)}
      </select>
    }>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-gray-50 rounded p-2 text-center">
          <div className="text-lg font-bold text-gray-800">{d.totalCalls ?? 0}</div>
          <div className="text-gray-500">Total Calls</div>
        </div>
        <div className={`rounded p-2 text-center ${Number(successPct) >= 95 ? "bg-green-50" : "bg-yellow-50"}`}>
          <div className={`text-lg font-bold ${Number(successPct) >= 95 ? "text-green-700" : "text-yellow-700"}`}>
            {successPct}%
          </div>
          <div className="text-gray-500">Success Rate</div>
        </div>
        <div className="bg-gray-50 rounded p-2 text-center">
          <div className="text-lg font-bold text-gray-800">{Math.round(d.avgLatencyMs ?? 0)}ms</div>
          <div className="text-gray-500">Avg Latency</div>
        </div>
        <div className="bg-gray-50 rounded p-2 text-center">
          <div className="text-lg font-bold text-gray-800">{fallbackPct}%</div>
          <div className="text-gray-500">Fallback Rate</div>
        </div>
      </div>
      <div className="text-xs space-y-1">
        <div className="font-medium text-gray-700">Recent Failures</div>
        {(d.recentFailures ?? []).slice(0, 3).map((f: any, i: number) => (
          <div key={i} className="bg-red-50 rounded p-1.5 text-red-700">
            <div className="font-medium">{f.agentName ?? f.taskType} — {f.provider}/{f.model}</div>
            <div className="text-red-500 truncate">{f.errorMessage}</div>
            <div className="text-gray-400">{f.traceId?.substring(0, 8)}…</div>
          </div>
        ))}
        {!(d.recentFailures?.length) && (
          <div className="text-gray-400 italic">No recent failures</div>
        )}
      </div>
    </Panel>
  );
}

// ── Policy Panel ──────────────────────────────────────────────────────────────

function PolicyPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["ai-policy"],
    queryFn: () => fetchJson<any>("/api/admin/ai/policy"),
    refetchInterval: 60_000,
  });

  const shutdownMut = useMutation({
    mutationFn: (active: boolean) => postJson("/api/admin/ai/policy/shutdown", { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-policy"] }),
  });

  if (isLoading) return <Panel title="AI Execution Policy"><p className="text-xs text-gray-500">Loading...</p></Panel>;

  const d = data ?? {};
  return (
    <Panel title="AI Execution Policy" actions={
      <button
        onClick={() => shutdownMut.mutate(!d.emergencyShutdown)}
        disabled={shutdownMut.isPending}
        className={`text-xs px-2 py-1 rounded ${d.emergencyShutdown
          ? "bg-red-100 text-red-700 hover:bg-red-200"
          : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
      >
        {d.emergencyShutdown ? "Resume Policy" : "Policy Stop"}
      </button>
    }>
      <div className="text-xs space-y-2">
        <div className="flex justify-between">
          <span className="text-gray-500">Policy Shutdown</span>
          <StatusBadge status={d.emergencyShutdown ? "critical" : "ok"} />
        </div>
        <div>
          <div className="font-medium text-gray-700 mb-1">Disabled Task Types</div>
          {d.disabledTaskTypes?.length > 0
            ? d.disabledTaskTypes.map((t: string) => (
                <span key={t} className="mr-1 px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs">{t}</span>
              ))
            : <span className="text-gray-400 italic">None disabled</span>
          }
        </div>
        <div>
          <div className="font-medium text-gray-700 mb-1">Permanently Blocked Actions</div>
          <div className="flex flex-wrap gap-1">
            {(d.permanentlyBlockedActions ?? []).map((a: string) => (
              <span key={a} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{a}</span>
            ))}
          </div>
        </div>
        <div>
          <div className="font-medium text-gray-700 mb-1">Approval-Required Actions</div>
          <div className="flex flex-wrap gap-1">
            {(d.approvalRequiredActions ?? []).map((a: string) => (
              <span key={a} className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs">{a}</span>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}

// ── Process Metrics Panel ─────────────────────────────────────────────────────

function MetricsPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["ai-metrics"],
    queryFn: () => fetchJson<any>("/api/admin/ai/metrics"),
    refetchInterval: 15_000,
  });

  if (isLoading) return <Panel title="AI Process Metrics"><p className="text-xs text-gray-500">Loading...</p></Panel>;

  const d = data ?? {};
  return (
    <Panel title="AI Process Metrics (Session)">
      <div className="grid grid-cols-2 gap-2 text-xs">
        {[
          { label: "Total Calls",     value: d.totalCalls     ?? 0 },
          { label: "Failures",        value: d.totalFailures  ?? 0 },
          { label: "Fallbacks",       value: d.totalFallbacks ?? 0 },
          { label: "Timeouts",        value: d.totalTimeouts  ?? 0 },
          { label: "Avg Latency",     value: `${Math.round(d.avgLatencyMs ?? 0)}ms` },
          { label: "Total Cost",      value: `$${(d.totalCostUsd ?? 0).toFixed(4)}` },
        ].map(({ label, value }) => (
          <div key={label} className="bg-gray-50 rounded p-2">
            <div className="text-gray-800 font-medium">{value}</div>
            <div className="text-gray-500">{label}</div>
          </div>
        ))}
      </div>
      {d.byProvider && (
        <div className="text-xs space-y-1">
          <div className="font-medium text-gray-700">Calls by Provider</div>
          {Object.entries(d.byProvider as Record<string, any>).map(([prov, stats]) => (
            <div key={prov} className="flex justify-between text-gray-600">
              <span className="capitalize">{prov}</span>
              <span>{stats.calls} calls / {stats.failures} fail</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ── Recent Audit Log Panel ────────────────────────────────────────────────────

function AuditLogPanel() {
  const [filter, setFilter] = useState<"all" | "failures">("all");
  const { data, isLoading } = useQuery({
    queryKey: ["ai-audit", filter],
    queryFn: () => fetchJson<any>(
      `/api/admin/ai/audit?limit=20&sinceHours=24${filter === "failures" ? "&success=false" : ""}`
    ),
    refetchInterval: 30_000,
  });

  if (isLoading) return <Panel title="AI Audit Log"><p className="text-xs text-gray-500">Loading...</p></Panel>;

  const entries: any[] = data?.entries ?? [];

  return (
    <Panel title="AI Audit Log (24h)" actions={
      <div className="flex gap-1">
        {(["all", "failures"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-2 py-0.5 rounded ${filter === f ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}
          >
            {f}
          </button>
        ))}
      </div>
    }>
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {entries.map((e: any, i: number) => (
          <div key={i} className={`text-xs rounded p-1.5 flex items-start justify-between gap-2 ${e.success ? "bg-gray-50" : "bg-red-50"}`}>
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${e.success ? "bg-green-400" : "bg-red-400"}`} />
                <span className="font-medium truncate">{e.agentName ?? e.taskType}</span>
                <span className="text-gray-400 flex-shrink-0">{e.provider}/{e.model?.split("-").slice(-1)}</span>
              </div>
              {!e.success && (
                <div className="text-red-600 truncate ml-3">{e.errorMessage}</div>
              )}
              {e.fallbackTriggered && (
                <div className="text-yellow-600 ml-3">↩ fallback triggered</div>
              )}
            </div>
            <div className="text-right text-gray-400 flex-shrink-0">
              <div>{e.latencyMs}ms</div>
              <div>{e.traceId?.substring(0, 6)}…</div>
            </div>
          </div>
        ))}
        {entries.length === 0 && (
          <p className="text-xs text-gray-400 italic text-center py-4">No entries</p>
        )}
      </div>
    </Panel>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AICommandCenter() {
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">AI Command Center</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Real-time AI provider health, budget governance, audit trail, and policy control
          </p>
        </div>
        <div className="text-xs text-gray-400">Auto-refreshes every 15–60s per panel</div>
      </div>

      {/* Row 1: Provider health + Budget */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ProviderHealthPanel />
        <BudgetPanel />
      </div>

      {/* Row 2: Audit summary + Policy */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AuditSummaryPanel />
        <PolicyPanel />
      </div>

      {/* Row 3: Metrics + Audit log */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MetricsPanel />
        <AuditLogPanel />
      </div>
    </div>
  );
}
