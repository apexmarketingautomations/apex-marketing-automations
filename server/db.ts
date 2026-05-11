import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

// Normalize DATABASE_URL to use sslmode=verify-full to avoid pg v9 SSL warning
const rawDbUrl = process.env.DATABASE_URL || "";
const dbUrl = rawDbUrl.includes("sslmode=") 
  ? rawDbUrl.replace(/sslmode=[^&]+/, "sslmode=verify-full")
  : rawDbUrl + (rawDbUrl.includes("?") ? "&" : "?") + "sslmode=verify-full";

const pool = new pg.Pool({
  connectionString: dbUrl,
});

export const db = drizzle(pool, { schema });

export { pool };
