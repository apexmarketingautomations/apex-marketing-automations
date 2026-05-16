/**
 * client/src/pages/admin/system-health.tsx
 *
 * System Health Center  (Phase 11)
 *
 * Admin-only dashboard that surfaces:
 *   - DB boot validation status
 *   - Pipeline queue depths (BullMQ) + DLQ snapshot
 *   - Performance audit (slow queries, bloat, cache hit)
 *   - Sequence drift report
 *   - Reconciliation issues with one-click repair
 *   - Tenant integrity score
 *   - TCPA violation summary
 *
 * Refreshes every 30s. Red/yellow/green status chips. Expandable panels.
 */

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ── Types ─────────────────────────────────────────────────────────────────────

interface StatusChip {
  label: string;
  value: string | number;
  status: "healthy" | "degraded" | "critical" | "unknown";
}

function StatusBadge({ status, label }: { status: string; label?: string }) {
  const colors: Record<string, string> = {
    healthy: "bg-green-100 text-green-800 border-green-200",
    clean:   "bg-green-100 text-green-800 border-green-200",
    ok:      "bg-green-100 text-green-800 border-green-200",
    degraded: "bg-yellow-100 text-yellow-800 border-yellow-200",
    warning:  "bg-yellow-100 text-yellow-800 border-yellow-200",
    critical: "bg-red-100 text-red-800 border-red-200",
    unknown:  "bg-gray-100 text-gray-600 border-gray-200",
  };
  const colorClass = colors[status?.toLowerCase()] ?? colors.unknown;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${colorClass}`}>
      {label ?? status}
    </span>
  );
}

function SectionCard({ title, children, loading }: { title: string; children: React.ReactNode; loading?: boolean }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {loading && <span className="text-xs text-gray-400 animate-pulse">refreshing…</span>}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

function StatRow({ label, value, status }: { label: string; value: React.ReactNode; status?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-600">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-900">{value}</span>
        {status && <StatusBadge status={status} />}
      </div>
    </div>
  );
}

// ── API fetchers ──────────────────────────────────────────────────────────────

const fetchJSON = async (url: string) => {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
};

const postJSON = async (url: string, body?: object) => {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body ?? {}),
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
};

// ── Sections ──────────────────────────────────────────────────────────────────

function DBHealthSection() {
  const { data, isLoading } = useQuery({ queryKey: ["admin/db-health"], queryFn: () => fetchJSON("/api/admin/db-health"), refetchInterval: 30_000 });
  if (!data) return <SectionCard title="DB Boot Validation" loading={isLoading}><p className="text-sm text-gray-400">Loading…</p></SectionCard>;
  return (
    <SectionCard title="DB Boot Validation" loading={isLoading}>
      <StatRow label="Passed" value={data.passed ? "Yes" : "No"} status={data.passed ? "healthy" : "critical"} />
      <StatRow label="Migration status" value={data.migrationStatus} status={data.migrationStatus} />
      <StatRow label="Schema drift" value={data.schemaDriftStatus} status={data.schemaDriftStatus} />
      <StatRow label="Tenant status" value={data.tenantStatus} status={data.tenantStatus === "clean" ? "healthy" : data.tenantStatus} />
      <StatRow label="Duration" value={`${data.durationMs}ms`} />
      {data.criticalFailures?.length > 0 && (
        <div className="mt-2 p-2 bg-red-50 rounded text-xs text-red-700">
          {data.criticalFailures.map((f: string, i: number) => <p key={i}>⚠ {f}</p>)}
        </div>
      )}
      {data.warnings?.length > 0 && (
        <div className="mt-2 p-2 bg-yellow-50 rounded text-xs text-yellow-700">
          {data.warnings.map((w: string, i: number) => <p key={i}>⚡ {w}</p>)}
        </div>
      )}
    </SectionCard>
  );
}

function PipelineSection() {
  const { data, isLoading } = useQuery({ queryKey: ["admin/pipeline-metrics"], queryFn: () => fetchJSON("/api/admin/pipeline-metrics"), refetchInterval: 15_000 });
  if (!data) return <SectionCard title="Pipeline Queues" loading={isLoading}><p className="text-sm text-gray-400">Loading…</p></SectionCard>;
  return (
    <SectionCard title="Pipeline Queues" loading={isLoading}>
      <StatRow label="Redis available" value={data.redisAvailable ? "Yes" : "No"} status={data.redisAvailable ? "healthy" : "critical"} />
      <StatRow label="Total waiting" value={data.totals?.waiting ?? 0} status={(data.totals?.waiting ?? 0) > 500 ? "degraded" : "healthy"} />
      <StatRow label="Total active" value={data.totals?.active ?? 0} />
      <StatRow label="DLQ jobs" value={data.dlq?.totalFailed ?? 0} status={(data.dlq?.totalFailed ?? 0) > 0 ? "degraded" : "healthy"} />
      {data.queues?.map((q: any) => (
        <StatRow key={q.name} label={q.name} value={`${q.waiting}w / ${q.active}a / ${q.failed}f`} status={q.failed > 10 ? "degraded" : "healthy"} />
      ))}
    </SectionCard>
  );
}

function PerformanceSection() {
  const { data, isLoading } = useQuery({ queryKey: ["admin/db-performance"], queryFn: () => fetchJSON("/api/admin/db-performance"), refetchInterval: 60_000 });
  if (!data) return <SectionCard title="DB Performance" loading={isLoading}><p className="text-sm text-gray-400">Loading…</p></SectionCard>;
  return (
    <SectionCard title="DB Performance" loading={isLoading}>
      <StatRow label="Status" value={data.status} status={data.status} />
      <StatRow label="Cache hit (tables)" value={`${data.cacheHit?.tableHitRatio ?? "?"}%`} status={data.cacheHit?.status} />
      <StatRow label="Cache hit (indexes)" value={`${data.cacheHit?.indexHitRatio ?? "?"}%`} />
      <StatRow label="Connections" value={`${data.connections?.total ?? 0}/${data.connections?.maxConnections ?? "?"}`} status={data.connections?.usagePct > 80 ? "degraded" : "healthy"} />
      <StatRow label="Slow queries" value={data.slowQueries?.length ?? 0} status={data.slowQueries?.length > 3 ? "degraded" : "healthy"} />
      <StatRow label="Bloated tables" value={data.tableBloat?.filter((t: any) => t.severity !== "ok").length ?? 0} />
      <StatRow label="Unused indexes" value={data.unusedIndexes?.length ?? 0} />
      {data.recommendations?.length > 0 && (
        <div className="mt-2 space-y-1">
          {data.recommendations.map((r: string, i: number) => (
            <p key={i} className="text-xs text-yellow-700 bg-yellow-50 px-2 py-1 rounded">{r}</p>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function ReconciliationSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin/reconciliation"], queryFn: () => fetchJSON("/api/admin/reconciliation-report"), refetchInterval: 60_000 });
  const repair = useMutation({
    mutationFn: (dryRun: boolean) => postJSON("/api/admin/reconciliation/repair", { dryRun }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin/reconciliation"] }),
  });
  if (!data) return <SectionCard title="Reconciliation" loading={isLoading}><p className="text-sm text-gray-400">Loading…</p></SectionCard>;
  return (
    <SectionCard title="Reconciliation Issues" loading={isLoading}>
      <StatRow label="Status" value={data.status} status={data.status} />
      <StatRow label="Issues found" value={data.totalIssues ?? 0} status={data.totalIssues > 0 ? "degraded" : "healthy"} />
      <StatRow label="Critical" value={data.criticalCount ?? 0} status={data.criticalCount > 0 ? "critical" : "healthy"} />
      <StatRow label="Errors" value={data.errorCount ?? 0} />
      <StatRow label="Warnings" value={data.warningCount ?? 0} />
      {data.issues?.map((issue: any) => (
        <div key={issue.category} className="text-xs bg-gray-50 px-2 py-1 rounded mt-1">
          <span className="font-medium">{issue.category}</span>: {issue.affectedCount} affected — {issue.repairHint?.slice(0, 80)}
        </div>
      ))}
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => repair.mutate(true)}
          disabled={repair.isPending}
          className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 disabled:opacity-50"
        >Dry Run</button>
        <button
          onClick={() => repair.mutate(false)}
          disabled={repair.isPending}
          className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
        >Auto Repair</button>
      </div>
      {repair.data && (
        <p className="mt-2 text-xs text-green-700">Repaired {repair.data.repaired} records across {repair.data.results?.length} categories</p>
      )}
    </SectionCard>
  );
}

function DLQSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin/dlq"], queryFn: () => fetchJSON("/api/admin/dlq"), refetchInterval: 30_000 });
  const replay = useMutation({
    mutationFn: (filter: object) => postJSON("/api/admin/dlq/replay", filter),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin/dlq"] }),
  });
  if (!data) return <SectionCard title="Dead Letter Queue" loading={isLoading}><p className="text-sm text-gray-400">Loading…</p></SectionCard>;
  const stats = data.stats;
  return (
    <SectionCard title="Dead Letter Queue" loading={isLoading}>
      <StatRow label="Total jobs" value={stats?.total ?? 0} status={(stats?.total ?? 0) > 0 ? "degraded" : "healthy"} />
      {Object.entries(stats?.byOriginQueue ?? {}).map(([q, n]) => (
        <StatRow key={q} label={q} value={String(n)} />
      ))}
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => replay.mutate({ limit: 50 })}
          disabled={replay.isPending || (stats?.total ?? 0) === 0}
          className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
        >Replay All (50)</button>
      </div>
      {replay.data && (
        <p className="mt-2 text-xs text-green-700">Replayed {replay.data.replayed}, failed {replay.data.failed}</p>
      )}
    </SectionCard>
  );
}

function SequenceSection() {
  const { data, isLoading } = useQuery({ queryKey: ["admin/sequence-audit"], queryFn: () => fetchJSON("/api/admin/sequence-audit"), refetchInterval: 120_000 });
  if (!data) return <SectionCard title="Sequence Audit" loading={isLoading}><p className="text-sm text-gray-400">Loading…</p></SectionCard>;
  return (
    <SectionCard title="PostgreSQL Sequences" loading={isLoading}>
      <StatRow label="Status" value={data.status} status={data.status} />
      <StatRow label="Total sequences" value={data.totalChecked ?? 0} />
      <StatRow label="Drifted" value={data.driftedCount ?? 0} status={(data.driftedCount ?? 0) > 0 ? "critical" : "healthy"} />
      <StatRow label="Errors" value={data.errorCount ?? 0} />
      {data.sequences?.filter((s: any) => s.status === "drifted").map((s: any) => (
        <div key={s.sequence} className="text-xs bg-red-50 px-2 py-1 rounded mt-1 text-red-700">
          {s.table}.{s.column}: drift={s.drift} (lastVal={s.lastValue}, maxId={s.maxId})
        </div>
      ))}
    </SectionCard>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SystemHealthCenter() {
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setLastRefreshed(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">System Health Center</h1>
            <p className="text-sm text-gray-500 mt-1">Database integrity, pipeline health, compliance status</p>
          </div>
          <div className="text-xs text-gray-400">
            Last refreshed: {lastRefreshed.toLocaleTimeString()}
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <DBHealthSection />
          <PipelineSection />
          <DLQSection />
          <PerformanceSection />
          <ReconciliationSection />
          <SequenceSection />
        </div>
      </div>
    </div>
  );
}
