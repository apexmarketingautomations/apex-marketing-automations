/**
 * server/hpl/sqlSafe.ts
 *
 * SQL-safe value helpers for HPL raw-SQL queries.
 *
 * All HPL modules use sql.raw() for dynamic WHERE clauses and upserts that
 * Drizzle's typed API cannot express (GREATEST, array unions, lazy tables).
 * Every value that enters a raw query MUST go through one of these helpers.
 *
 * Rules:
 *  - esc()  → wraps a string in single quotes, escaping internal quotes.
 *             Returns NULL (literal) when the value is null/undefined.
 *  - num()  → returns the numeric string or NULL.
 *  - bool() → returns TRUE / FALSE / NULL.
 *  - arr()  → builds a TEXT[] literal from a string array.
 *  - json() → serializes an object to a JSONB-castable literal.
 *  - id()   → like esc() but for identifiers validated against an allowlist.
 *
 * NEVER interpolate raw user strings directly into sql.raw(). Always use esc().
 */

// ── String escape ─────────────────────────────────────────────────────────────

/** Wrap a string value in single quotes, escaping embedded single-quotes. */
export function esc(value: string | null | undefined): string {
  if (value == null) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Escape and truncate a string to `maxLen` chars before wrapping. */
export function escMax(value: string | null | undefined, maxLen: number): string {
  if (value == null) return "NULL";
  const truncated = String(value).substring(0, maxLen);
  return esc(truncated);
}

// ── Numeric / boolean ─────────────────────────────────────────────────────────

/** Returns the numeric string or NULL. Rejects NaN / Infinity. */
export function num(value: number | null | undefined): string {
  if (value == null) return "NULL";
  if (!isFinite(value)) return "NULL";
  return String(value);
}

/** Returns TRUE / FALSE / NULL. */
export function bool(value: boolean | null | undefined): string {
  if (value == null) return "NULL";
  return value ? "TRUE" : "FALSE";
}

// ── Array literal ─────────────────────────────────────────────────────────────

/** Builds a TEXT[] literal: ARRAY['a','b']::TEXT[] */
export function arr(values: string[] | null | undefined): string {
  if (!values || values.length === 0) return "ARRAY[]::TEXT[]";
  const items = values.map(v => `'${String(v).replace(/'/g, "''")}'`).join(",");
  return `ARRAY[${items}]::TEXT[]`;
}

// ── JSONB literal ─────────────────────────────────────────────────────────────

/** Serializes an object to a JSONB-castable string literal. */
export function json(value: Record<string, unknown> | null | undefined): string {
  if (value == null) return "'{}'::jsonb";
  const serialized = JSON.stringify(value).replace(/'/g, "''");
  return `'${serialized}'::jsonb`;
}

// ── Identifier allowlist ──────────────────────────────────────────────────────

/**
 * Validates an identifier (table name, column name, enum value) against an
 * explicit allowlist and returns it unquoted. Throws on any unlisted value.
 *
 * Use this for dynamic table/column names — not for user-supplied strings.
 */
export function id(value: string, allowlist: readonly string[]): string {
  if (!allowlist.includes(value)) {
    throw new Error(`[SQL-SAFE] Identifier '${value}' not in allowlist`);
  }
  return value;
}

// ── ISO date ──────────────────────────────────────────────────────────────────

/**
 * Validates that the string is a recognizable date/ISO string and escapes it.
 * Returns NULL if the value is falsy or unparseable.
 */
export function isoDate(value: string | null | undefined): string {
  if (!value) return "NULL";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "NULL";
  return esc(d.toISOString());
}
