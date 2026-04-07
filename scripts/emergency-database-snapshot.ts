/**
 * Emergency database snapshot script — invokable via agent_commands.json webhook.
 * Creates a manifest of all table row counts and saves to /backups/.
 *
 * Requires owner unlock (enforced by agent worker framework).
 */

import pg from "pg";
import * as fs from "fs";
import * as path from "path";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("[DB-SNAPSHOT] DATABASE_URL not set");
  process.exit(1);
}

const BACKUP_DIR = path.resolve(process.cwd(), "backups");

interface SnapshotManifest {
  timestamp: string;
  createdAt: string;
  createdBy: string;
  databaseUrl: string;
  tables: Record<string, number>;
  totalRecords: number;
}

async function run(): Promise<void> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL!, max: 3 });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const tableRes = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`
    );
    const tables: Record<string, number> = {};
    let totalRecords = 0;

    for (const row of tableRes.rows) {
      try {
        const cr = await pool.query<{ c: string }>(`SELECT COUNT(*) as c FROM "${row.tablename}"`);
        const count = parseInt(cr.rows[0].c, 10);
        tables[row.tablename] = count;
        totalRecords += count;
      } catch {
        tables[row.tablename] = -1;
      }
    }

    const manifest: SnapshotManifest = {
      timestamp,
      createdAt: new Date().toISOString(),
      createdBy: "emergency-database-snapshot-script",
      databaseUrl: "***REDACTED***",
      tables,
      totalRecords,
    };

    const filePath = path.join(BACKUP_DIR, `snapshot_${timestamp}.json`);
    fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2));

    console.log(`[DB-SNAPSHOT] Snapshot created: ${filePath}`);
    console.log(`[DB-SNAPSHOT] Tables: ${Object.keys(tables).length}, Total records: ${totalRecords}`);
  } finally {
    await pool.end();
  }

  process.exit(0);
}

run().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[DB-SNAPSHOT] Fatal:", msg);
  process.exit(1);
});
