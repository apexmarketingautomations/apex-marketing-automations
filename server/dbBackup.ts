import { db } from "./db";
import { sql } from "drizzle-orm";
import { logSystemEvent, logSystemError } from "./systemLogger";
import fs from "fs";
import path from "path";

const BACKUP_DIR = path.join(process.cwd(), "backups");

export async function createDatabaseSnapshot(): Promise<{
  success: boolean;
  tables: Record<string, number>;
  timestamp: string;
  filePath?: string;
}> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const tableCountsResult = await db.execute(sql`
      SELECT schemaname, tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      ORDER BY tablename
    `);

    const tables: Record<string, number> = {};
    for (const row of tableCountsResult.rows) {
      const tableName = (row as any).tablename;
      try {
        const countResult = await db.execute(
          sql.raw(`SELECT COUNT(*) as count FROM "${tableName}"`)
        );
        tables[tableName] = parseInt((countResult.rows[0] as any).count, 10);
      } catch {
        tables[tableName] = -1;
      }
    }

    const manifest = {
      timestamp,
      createdAt: new Date().toISOString(),
      databaseUrl: "***REDACTED***",
      tables,
      totalRecords: Object.values(tables).filter(v => v >= 0).reduce((a, b) => a + b, 0),
    };

    const filePath = path.join(BACKUP_DIR, `snapshot_${timestamp}.json`);
    fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2));

    await logSystemEvent("info", "backup", `Database snapshot created: ${Object.keys(tables).length} tables, ${manifest.totalRecords} records`, { tables });

    return { success: true, tables, timestamp, filePath };
  } catch (err: any) {
    await logSystemError("backup", `Snapshot failed: ${err.message}`);
    return { success: false, tables: {}, timestamp };
  }
}

export async function listSnapshots(): Promise<{
  name: string;
  createdAt: string;
  size: number;
}[]> {
  if (!fs.existsSync(BACKUP_DIR)) return [];

  return fs
    .readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith("snapshot_") && f.endsWith(".json"))
    .map(f => {
      const fullPath = path.join(BACKUP_DIR, f);
      const stat = fs.statSync(fullPath);
      return {
        name: f,
        createdAt: stat.mtime.toISOString(),
        size: stat.size,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getDatabaseHealth(): Promise<{
  connected: boolean;
  tableCount: number;
  totalRecords: number;
  largestTables: { name: string; count: number }[];
}> {
  try {
    const result = await db.execute(sql`
      SELECT schemaname, tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
    `);

    const tableCounts: { name: string; count: number }[] = [];
    for (const row of result.rows) {
      const tableName = (row as any).tablename;
      try {
        const countResult = await db.execute(
          sql.raw(`SELECT COUNT(*) as count FROM "${tableName}"`)
        );
        tableCounts.push({
          name: tableName,
          count: parseInt((countResult.rows[0] as any).count, 10),
        });
      } catch {
        tableCounts.push({ name: tableName, count: 0 });
      }
    }

    tableCounts.sort((a, b) => b.count - a.count);

    return {
      connected: true,
      tableCount: tableCounts.length,
      totalRecords: tableCounts.reduce((a, b) => a + b.count, 0),
      largestTables: tableCounts.slice(0, 10),
    };
  } catch {
    return { connected: false, tableCount: 0, totalRecords: 0, largestTables: [] };
  }
}
