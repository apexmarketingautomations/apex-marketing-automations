/**
 * server/db/performanceAuditor.ts
 *
 * Read-only database performance audit.
 *
 * Checks:
 * - Slow queries via pg_stat_statements (if extension enabled)
 * - Table bloat estimates via pg_stat_user_tables (dead tuple ratio)
 * - Index usage ratios (unused indexes waste write performance)
 * - Active connection count vs pg_settings max_connections
 * - Cache hit ratios (buffer_hit / (buffer_hit + disk_read))
 *
 * All queries are read-only and safe to run in production at any time.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";

export interface SlowQueryEntry {
  query:          string;
  calls:          number;
  totalTimeMs:    number;
  meanTimeMs:     number;
  rows:           number;
}

export interface TableBloatEntry {
  table:          string;
  liveRows:       number;
  deadRows:       number;
  deadRatio:      number;
  lastVacuum:     string | null;
  lastAutoVacuum: string | null;
  severity:       "ok" | "warning" | "critical";
}

export interface IndexUsageEntry {
  table:          string;
  index:          string;
  scans:          number;
  size:           string;
  status:         "used" | "unused" | "rarely_used";
}

export interface ConnectionSummary {
  active:         number;
  idle:           number;
  idleInTx:       number;
  total:          number;
  maxConnections: number;
  usagePct:       number;
}

export interface CacheHitSummary {
  tableHitRatio:  number;
  indexHitRatio:  number;
  status:         "healthy" | "degraded" | "critical";
}

export interface PerformanceAuditReport {
  slowQueries:        SlowQueryEntry[];
  tableBloat:         TableBloatEntry[];
  unusedIndexes:      IndexUsageEntry[];
  connections:        ConnectionSummary;
  cacheHit:           CacheHitSummary;
  pgStatStatementsAvailable: boolean;
  recommendations:    string[];
  status:             "healthy" | "degraded" | "critical";
  generatedAt:        string;
}

async function getSlowQueries(): Promise<{ entries: SlowQueryEntry[]; available: boolean }> {
  try {
    // Check if pg_stat_statements is available
    const extCheck = await db.execute(sql`
      SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'
    `);
    const extRows = (extCheck as any).rows ?? extCheck;
    if (!Array.isArray(extRows) || extRows.length === 0) {
      return { entries: [], available: false };
    }

    const result = await db.execute(sql`
      SELECT
        LEFT(query, 200)       AS query,
        calls,
        ROUND(total_exec_time) AS total_time_ms,
        ROUND(mean_exec_time)  AS mean_time_ms,
        rows
      FROM pg_stat_statements
      WHERE calls > 5
        AND mean_exec_time > 100
      ORDER BY mean_exec_time DESC
      LIMIT 10
    `);
    const rows = (result as any).rows ?? result;
    if (!Array.isArray(rows)) return { entries: [], available: true };

    const entries: SlowQueryEntry[] = rows.map((r: any) => ({
      query:       String(r.query ?? "").replace(/\s+/g, " ").trim(),
      calls:       Number(r.calls ?? 0),
      totalTimeMs: Number(r.total_time_ms ?? 0),
      meanTimeMs:  Number(r.mean_time_ms ?? 0),
      rows:        Number(r.rows ?? 0),
    }));
    return { entries, available: true };
  } catch {  // allow-silent-catch: non-fatal, returns safe default
    return { entries: [], available: false };
  }
}

async function getTableBloat(): Promise<TableBloatEntry[]> {
  try {
    const result = await db.execute(sql`
      SELECT
        relname                                   AS table_name,
        n_live_tup                                AS live_rows,
        n_dead_tup                                AS dead_rows,
        CASE WHEN n_live_tup + n_dead_tup = 0 THEN 0
             ELSE ROUND(n_dead_tup::numeric / (n_live_tup + n_dead_tup) * 100, 1)
        END                                       AS dead_ratio,
        last_vacuum::text                         AS last_vacuum,
        last_autovacuum::text                     AS last_autovacuum
      FROM pg_stat_user_tables
      WHERE n_dead_tup > 100
      ORDER BY dead_ratio DESC, n_dead_tup DESC
      LIMIT 15
    `);
    const rows = (result as any).rows ?? result;
    if (!Array.isArray(rows)) return [];

    return rows.map((r: any) => {
      const deadRatio = Number(r.dead_ratio ?? 0);
      return {
        table:          String(r.table_name ?? ""),
        liveRows:       Number(r.live_rows ?? 0),
        deadRows:       Number(r.dead_rows ?? 0),
        deadRatio,
        lastVacuum:     r.last_vacuum ? String(r.last_vacuum) : null,
        lastAutoVacuum: r.last_autovacuum ? String(r.last_autovacuum) : null,
        severity:       deadRatio >= 30 ? "critical" : deadRatio >= 15 ? "warning" : "ok",
      };
    });
  } catch { return []; }  // allow-silent-catch: non-fatal, returns safe default
}

async function getIndexUsage(): Promise<IndexUsageEntry[]> {
  try {
    const result = await db.execute(sql`
      SELECT
        t.relname                                         AS table_name,
        i.relname                                         AS index_name,
        idx_scan                                          AS scans,
        pg_size_pretty(pg_relation_size(i.oid))           AS size
      FROM pg_stat_user_indexes  ui
      JOIN pg_index              ix ON ix.indexrelid = ui.indexrelid
      JOIN pg_class              i  ON i.oid         = ui.indexrelid
      JOIN pg_class              t  ON t.oid         = ix.indrelid
      WHERE NOT ix.indisprimary
        AND NOT ix.indisunique
        AND pg_relation_size(i.oid) > 65536
      ORDER BY idx_scan ASC, pg_relation_size(i.oid) DESC
      LIMIT 15
    `);
    const rows = (result as any).rows ?? result;
    if (!Array.isArray(rows)) return [];

    return rows.map((r: any) => {
      const scans = Number(r.scans ?? 0);
      return {
        table:  String(r.table_name ?? ""),
        index:  String(r.index_name ?? ""),
        scans,
        size:   String(r.size ?? ""),
        status: scans === 0 ? "unused" : scans < 10 ? "rarely_used" : "used",
      };
    });
  } catch { return []; }  // allow-silent-catch: non-fatal, returns safe default
}

async function getConnectionSummary(): Promise<ConnectionSummary> {
  try {
    const [connResult, maxResult] = await Promise.all([
      db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE state = 'active')             AS active,
          COUNT(*) FILTER (WHERE state = 'idle')               AS idle,
          COUNT(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_tx,
          COUNT(*)                                              AS total
        FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
      `),
      db.execute(sql`SELECT setting::int AS max FROM pg_settings WHERE name = 'max_connections'`),
    ]);

    const connRows = (connResult as any).rows ?? connResult;
    const maxRows  = (maxResult as any).rows ?? maxResult;

    const active    = Number(Array.isArray(connRows) ? connRows[0]?.active    ?? 0 : 0);
    const idle      = Number(Array.isArray(connRows) ? connRows[0]?.idle      ?? 0 : 0);
    const idleInTx  = Number(Array.isArray(connRows) ? connRows[0]?.idle_in_tx ?? 0 : 0);
    const total     = Number(Array.isArray(connRows) ? connRows[0]?.total     ?? 0 : 0);
    const maxConn   = Number(Array.isArray(maxRows)  ? maxRows[0]?.max        ?? 100 : 100);
    const usagePct  = maxConn > 0 ? Math.round(total / maxConn * 100) : 0;

    return { active, idle, idleInTx, total, maxConnections: maxConn, usagePct };
  } catch {  // allow-silent-catch: non-fatal, returns safe default
    return { active: 0, idle: 0, idleInTx: 0, total: 0, maxConnections: 100, usagePct: 0 };
  }
}

async function getCacheHit(): Promise<CacheHitSummary> {
  try {
    const result = await db.execute(sql`
      SELECT
        ROUND(
          SUM(heap_blks_hit)::numeric /
          NULLIF(SUM(heap_blks_hit) + SUM(heap_blks_read), 0) * 100, 1
        ) AS table_hit_ratio,
        ROUND(
          SUM(idx_blks_hit)::numeric /
          NULLIF(SUM(idx_blks_hit) + SUM(idx_blks_read), 0) * 100, 1
        ) AS index_hit_ratio
      FROM pg_statio_user_tables
    `);
    const rows = (result as any).rows ?? result;
    const tableHitRatio = Number(Array.isArray(rows) ? rows[0]?.table_hit_ratio ?? 100 : 100);
    const indexHitRatio = Number(Array.isArray(rows) ? rows[0]?.index_hit_ratio ?? 100 : 100);

    const minRatio = Math.min(tableHitRatio, indexHitRatio);
    const status: CacheHitSummary["status"] =
      minRatio < 90 ? "critical" :
      minRatio < 95 ? "degraded" :
      "healthy";

    return { tableHitRatio, indexHitRatio, status };
  } catch {  // allow-silent-catch: non-fatal, returns safe default
    return { tableHitRatio: 100, indexHitRatio: 100, status: "healthy" };
  }
}

export async function runPerformanceAudit(): Promise<PerformanceAuditReport> {
  const generatedAt = new Date().toISOString();

  const [slowResult, bloat, unusedIndexes, connections, cacheHit] = await Promise.all([
    getSlowQueries(),
    getTableBloat(),
    getIndexUsage(),
    getConnectionSummary(),
    getCacheHit(),
  ]);

  const recommendations: string[] = [];

  if (!slowResult.available) {
    recommendations.push("Enable pg_stat_statements extension to detect slow queries: CREATE EXTENSION pg_stat_statements;");
  } else if (slowResult.entries.length > 0) {
    recommendations.push(`${slowResult.entries.length} slow queries detected (mean >100ms with >5 calls). Review EXPLAIN ANALYZE for the top entries.`);
  }

  const criticalBloat = bloat.filter(t => t.severity === "critical");
  if (criticalBloat.length > 0) {
    recommendations.push(`${criticalBloat.length} table(s) have >30% dead tuples (${criticalBloat.map(t => t.table).join(", ")}). Run VACUUM ANALYZE on these tables.`);
  }

  const trueUnused = unusedIndexes.filter(i => i.status === "unused");
  if (trueUnused.length > 0) {
    recommendations.push(`${trueUnused.length} unused non-unique index(es) detected. Consider dropping: ${trueUnused.map(i => i.index).join(", ")}`);
  }

  if (connections.usagePct > 80) {
    recommendations.push(`Connection pool usage is ${connections.usagePct}% (${connections.total}/${connections.maxConnections}). Consider connection pooling via pgBouncer.`);
  }

  if (connections.idleInTx > 5) {
    recommendations.push(`${connections.idleInTx} connection(s) stuck in 'idle in transaction'. These hold locks and block autovacuum.`);
  }

  if (cacheHit.status !== "healthy") {
    recommendations.push(`Cache hit ratio is low (tables=${cacheHit.tableHitRatio}%, indexes=${cacheHit.indexHitRatio}%). Consider increasing shared_buffers or adding RAM.`);
  }

  const criticalBloatCount = criticalBloat.length;
  const status: PerformanceAuditReport["status"] =
    criticalBloatCount > 0 || connections.usagePct > 90 || cacheHit.status === "critical" ? "critical" :
    bloat.some(t => t.severity === "warning") || connections.usagePct > 70 || cacheHit.status === "degraded" ? "degraded" :
    "healthy";

  console.log(`[PERF-AUDIT] status=${status} slowQueries=${slowResult.entries.length} bloatTables=${bloat.length} unusedIndexes=${trueUnused.length} connPct=${connections.usagePct}%`);

  return {
    slowQueries:               slowResult.entries,
    tableBloat:                bloat,
    unusedIndexes:             unusedIndexes.filter(i => i.status !== "used"),
    connections,
    cacheHit,
    pgStatStatementsAvailable: slowResult.available,
    recommendations,
    status,
    generatedAt,
  };
}
